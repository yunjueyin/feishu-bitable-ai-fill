/**
 * 解析 AI 返回的分点文本。
 * 支持四种分列模式（splitMode）：
 *  - marker    ：序号标记（默认【1】【2】），主策略 + 多变体兜底 + 空行启发式
 *  - paragraph ：段落分隔符（如 --- / *** / === / 自定义）切分
 *  - blank     ：空行分列
 *  - heading   ：Markdown 标题（## 小标题）分列，段含标题
 * 纯函数、零依赖，便于 Node 测试。
 *
 * parseSegments(text, opts) 的 opts 兼容旧式：
 *  - 传字符串 ''【1】'' 等价于 { marker: '【1】' }（splitMode 默认 marker）
 *  - 传对象 { splitMode, marker, sep, headingLevel }
 */

export const DEFAULT_MARKER = '【1】';

/** 分列方式（下拉选项直接用「分段符 / 换行符」等直观字眼，降低理解成本） */
export const SPLIT_MODES = {
  marker: '序号标记（如【1】【2】）',
  paragraph: '分段符（如 --- 单独一行）',
  blank: '换行符（空行分隔）',
  heading: '标题符（如 ## 小标题）',
};

/** 把标记样式翻译成正则片段（匹配"标记开头"的位置） */
export function markerToPattern(marker) {
  const m = String(marker || DEFAULT_MARKER).trim();
  if (m === '【1】') return '【\\d+】';
  if (m === '[1]') return '\\[\\d+\\]';
  if (m === '1.') return '\\d+[.、]\\s*';
  if (m === '一、') return '[一二三四五六七八九十]+、';
  // 自定义：允许用户直接写正则片段，数字用 \d 表示
  return m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\d/g, '\\d');
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectHits(re, raw) {
  const hits = [];
  let m;
  while ((m = re.exec(raw)) !== null) {
    hits.push({ start: m.index, end: re.lastIndex, token: m[0] });
    if (m.index === re.lastIndex) re.lastIndex++; // 防空转
  }
  return hits;
}

function cutSegments(raw, hits, warnings) {
  const segments = [];
  for (let i = 0; i < hits.length; i++) {
    const from = hits[i].end;
    const to = i + 1 < hits.length ? hits[i + 1].start : raw.length;
    const seg = raw.slice(from, to).trim();
    if (!seg) warnings.push(`第 ${i + 1} 个分点内容为空`);
    segments.push(seg);
  }
  return segments;
}

/** 剥离思考模型混进正文的 <think>…</think>（DeepSeek / GLM / 豆包 thinking 常见） */
function stripThink(raw) {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * @param {string} text 模型返回全文
 * @param {string|object} opts 标记样式字符串 或 { splitMode, marker, sep, headingLevel }
 * @returns {{ segments: string[], strategy: string, splitMode: string, warnings: string[] }}
 */
export function parseSegments(text, opts = {}) {
  const o = typeof opts === 'string' ? { marker: opts } : (opts || {});
  const {
    splitMode = 'marker',
    marker = DEFAULT_MARKER,
    sep = '---',
    headingLevel = '##',
  } = o;
  const warnings = [];
  const raw = stripThink(String(text || '').trim());
  if (!raw) return { segments: [], strategy: 'empty', splitMode, warnings: ['模型返回为空'] };

  let r;
  if (splitMode === 'blank') r = parseByBlank(raw, warnings);
  else if (splitMode === 'heading') r = parseByHeading(raw, headingLevel, warnings);
  else if (splitMode === 'paragraph') r = parseByParagraph(raw, sep, warnings);
  else r = parseByMarker(raw, marker, warnings);

  // 跨模式兜底：非 marker 模式只解析出 1 段时，尝试按序号标记切分
  // （模型见到"输出 N 个分点"时常惯性输出【1】【2】，而忽略所选分隔符）。
  if (r.strategy === 'single' && splitMode !== 'marker') {
    const m = parseByMarker(raw, DEFAULT_MARKER, []);
    if (m.strategy !== 'single' && m.segments.length >= 2) {
      warnings.push('模型未按所选分列方式输出，已按序号标记（【1】【2】）解析');
      return { ...m, splitMode, warnings };
    }
  }

  return { ...r, splitMode, warnings };
}

/** 序号标记模式（保留原兜底链） */
function parseByMarker(raw, marker, warnings) {
  const re = new RegExp(markerToPattern(marker), 'g');
  const hits = collectHits(re, raw);
  if (hits.length >= 1) {
    return { segments: cutSegments(raw, hits, warnings), strategy: 'marker' };
  }
  // 兜底变体
  const fallbacks = [
    { name: 'bracket', re: /\[(\d+)\]/g },
    { name: 'dot', re: /(?:^|\n)\s*(\d+)[.、]\s*/g },
    { name: 'cnum', re: /[一二三四五六七八九十]+、/g },
  ];
  for (const fb of fallbacks) {
    const hits2 = collectHits(fb.re, raw);
    if (hits2.length >= 2) {
      warnings.push(`未按约定的 ${marker} 标记输出，已按 ${fb.name} 变体解析`);
      return { segments: cutSegments(raw, hits2, warnings), strategy: fb.name };
    }
  }
  // 空行启发式
  const paras = raw.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  if (paras.length >= 2) {
    warnings.push('未检测到任何标记，已按空行分段（可能不准）');
    return { segments: paras, strategy: 'blank-line' };
  }
  warnings.push('模型未按分段格式输出，仅解析出 1 段');
  return { segments: [raw], strategy: 'single' };
}

/** 空行分列 */
function parseByBlank(raw, warnings) {
  const paras = raw.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  if (paras.length >= 2) return { segments: paras, strategy: 'blank' };
  // 兜底：模型没输出空行、用单换行分隔分点（各段都较短时按单换行切）
  const lines = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every((l) => l.length <= 120)) {
    warnings.push('未检测到空行分隔，已按单换行切分');
    return { segments: lines, strategy: 'blank-line' };
  }
  if (paras.length === 1) {
    warnings.push('空行分列：仅 1 段，可能未按格式输出');
    return { segments: paras, strategy: 'single' };
  }
  return { segments: [], strategy: 'empty' };
}

/** 段落分隔符分列（分隔符单独成段，切断文本） */
function parseByParagraph(raw, sep, warnings) {
  const s = String(sep || '---').trim();
  if (!s) {
    warnings.push('段落分隔符为空，已按整段处理');
    return { segments: [raw], strategy: 'single' };
  }
  const re = new RegExp(escapeRegex(s), 'g');
  const parts = raw.split(re).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { segments: parts, strategy: 'paragraph' };
  // 宽松变体兜底：模型常输出 --- / === / *** / —— 等"独立成行"分隔线的变体
  const variants = [
    { name: '---', re: /\n\s*-{3,}\s*\n/g },
    { name: '===', re: /\n\s*={3,}\s*\n/g },
    { name: '***', re: /\n\s*\*{3,}\s*\n/g },
    { name: '——', re: /\n\s*[—─＿_]{2,}\s*\n/g },
  ];
  for (const v of variants) {
    const vp = raw.split(v.re).map((x) => x.trim()).filter(Boolean);
    if (vp.length >= 2) {
      warnings.push(`未按「${s}」分隔，已按 ${v.name} 分隔线解析`);
      return { segments: vp, strategy: 'paragraph' };
    }
  }
  if (parts.length === 1) {
    warnings.push(`未按「${s}」分隔，仅解析出 1 段`);
    return { segments: parts, strategy: 'single' };
  }
  return { segments: [], strategy: 'empty' };
}

/** Markdown 标题分列：段 = 自该标题起到下一标题前（含标题行） */
function parseByHeading(raw, headingLevel, warnings) {
  const lv = (headingLevel || '##').trim();
  const re = new RegExp('^\\s*' + escapeRegex(lv) + '\\s+', 'gm');
  const hits = collectHits(re, raw);
  if (hits.length >= 1) {
    const segments = [];
    for (let i = 0; i < hits.length; i++) {
      const from = hits[i].start; // 含标题行
      const to = i + 1 < hits.length ? hits[i + 1].start : raw.length;
      const seg = raw.slice(from, to).trim();
      if (!seg) warnings.push(`第 ${i + 1} 个分点内容为空`);
      segments.push(seg);
    }
    return { segments, strategy: 'heading' };
  }
  warnings.push(`未检测到 ${lv} 标题，已按整段处理`);
  return { segments: [raw], strategy: 'single' };
}

/**
 * 从富文本/字符串/对象等杂形态中提取纯文本（读源字段单元格用）。
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
