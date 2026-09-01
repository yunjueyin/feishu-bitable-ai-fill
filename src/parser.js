/**
 * 解析 AI 返回的分点文本。
 * 主策略：按用户配置的标记正则（默认【1】样式）切段；
 * 兜底：主正则 0 命中时，依次尝试 [1] / 1. / 1、 等常见变体，最后按空行启发式分段。
 * 纯函数、零依赖，便于 Node 测试。
 */

/** 默认标记样式：【1】 */
export const DEFAULT_MARKER = '【1】';

/** 把标记样式翻译成正则来源（匹配"标记开头"的位置） */
export function markerToPattern(marker) {
  const m = String(marker || DEFAULT_MARKER).trim();
  if (m === '【1】') return '【\\d+】';
  if (m === '[1]') return '\\[\\d+\\]';
  if (m === '1.') return '\\d+[.、]\\s*';
  if (m === '一、') return '[一二三四五六七八九十]+、';
  // 自定义：允许用户直接写正则片段，数字用 \d 表示
  return m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\d/g, '\\d');
}

/**
 * 解析分点。
 * @param {string} text 模型返回全文
 * @param {string} marker 标记样式
 * @returns {{ segments: string[], strategy: string, warnings: string[] }}
 *  segments: 分点内容数组（已去掉标记本身、trim）；strategy: 命中的解析策略名
 */
export function parseSegments(text, marker = DEFAULT_MARKER) {
  const warnings = [];
  const raw = String(text || '').trim();
  if (!raw) return { segments: [], strategy: 'empty', warnings: ['模型返回为空'] };

  // 1) 主标记策略
  const pattern = markerToPattern(marker);
  const re = new RegExp(pattern, 'g');
  const hits = [];
  let mch;
  while ((mch = re.exec(raw)) !== null) {
    hits.push({ start: mch.index, end: re.lastIndex, token: mch[0] });
    if (mch.index === re.lastIndex) re.lastIndex++; // 防空转
  }
  if (hits.length >= 1) {
    const segments = cutSegments(raw, hits, warnings);
    return { segments, strategy: 'marker', warnings };
  }

  // 2) 兜底变体（主标记只命中 0~1 个时）
  const fallbacks = [
    { name: 'bracket', re: /\[(\d+)\]/g },
    { name: 'dot', re: /(?:^|\n)\s*(\d+)[.、]\s*/g },
    { name: 'cnum', re: /[一二三四五六七八九十]+、/g },
  ];
  for (const fb of fallbacks) {
    const hits2 = [];
    let m2;
    while ((m2 = fb.re.exec(raw)) !== null) {
      hits2.push({ start: m2.index, end: fb.re.lastIndex, token: m2[0] });
      if (m2.index === fb.re.lastIndex) fb.re.lastIndex++;
    }
    if (hits2.length >= 2) {
      warnings.push(`未按约定的 ${marker} 标记输出，已按 ${fb.name} 变体解析`);
      return { segments: cutSegments(raw, hits2, warnings), strategy: fb.name, warnings };
    }
  }

  // 3) 空行启发式
  const paras = raw.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (paras.length >= 2) {
    warnings.push('未检测到任何标记，已按空行分段（可能不准）');
    return { segments: paras, strategy: 'blank-line', warnings };
  }

  // 4) 单段：整段当一个分点
  warnings.push('模型未按分段格式输出，仅解析出 1 段');
  return { segments: [raw], strategy: 'single', warnings };
}

/** 按标记命中位置切段：段 = 上一标记结束到下一标记开始 */
function cutSegments(raw, hits, warnings) {
  const segments = [];
  for (let i = 0; i < hits.length; i++) {
    const from = hits[i].end;
    const to = i + 1 < hits.length ? hits[i + 1].start : raw.length;
    const seg = raw.slice(from, to).trim();
    if (!seg) {
      warnings.push(`第 ${i + 1} 个分点内容为空`);
    }
    segments.push(seg);
  }
  return segments;
}

/**
 * 从富文本/字符串/对象等杂形态中提取纯文本（读源字段单元格用）。
 * 兼容：string / [{type:'text',text}] / {text} / {value:[...]} / number
 */
export function cellToText(cell) {
  if (cell == null) return '';
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
  if (Array.isArray(cell)) return cell.map(cellToText).join('');
  if (typeof cell === 'object') {
    if (typeof cell.text === 'string') return cell.text;
    if (Array.isArray(cell.value)) return cell.value.map(cellToText).join('');
    if (typeof cell.value === 'string') return cell.value;
    if (typeof cell.link === 'string') return cell.link;
  }
  return '';
}
