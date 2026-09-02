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

/** 分列方式（下拉/卡片选项用「分段符 / 换行符」等直观文字描述，不直接展示符号；具体符号在选中后的配置区出现） */
export const SPLIT_MODES = {
  marker: '序号标记（按序号逐条分段）',
  paragraph: '分段符（分隔符单独一行）',
  blank: '换行符（空行分隔）',
  heading: '标题符（按标题行分段）',
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
export { stripThink };

/* ---------- 自适应分段探测：按文本实际格式判断，不依赖固定符号 ---------- */

/** 行首序号标记形态（按优先级；数字形态用 (?!\d) 排除 3.5万 这类小数误伤） */
const AUTO_MARKER_PROBES = [
  { re: /^\s*【\d+】/gm, note: '序号标记' },
  { re: /^\s*\[\d+\]/gm, note: '序号标记' },
  { re: /^\s*\d+[.、](?!\d)\s*\S/gm, note: '序号标记' },
  { re: /^\s*[一二三四五六七八九十]+、/gm, note: '序号标记' },
];

/**
 * 探测文本实际的分段结构（优先级从高到低）：
 * ① 行首序号标记（任一常见形态，≥2 处）→ ② 标题行（≥2 处）→
 * ③ 空行分段（≥2 段）→ ④ 独立分隔行（兼容模型违规输出，≥2 段）→ ⑤ 单换行（行短且 ≥2 行）。
 * @returns {{ segments: string[], strategy: string, note: string }} note 为探测依据，供警告文案
 */
function autoDetectSegments(raw) {
  // ① 行首序号标记：取命中 ≥2 的第一个形态
  for (const p of AUTO_MARKER_PROBES) {
    const hits = collectHits(p.re, raw);
    if (hits.length >= 2) {
      const w = [];
      return { segments: cutSegments(raw, hits, w), strategy: 'auto-marker', note: p.note };
    }
  }
  // ② 标题行（含标题行切分）
  const hHits = collectHits(/^\s*#{1,6}\s+\S/gm, raw);
  if (hHits.length >= 2) {
    const segments = [];
    for (let i = 0; i < hHits.length; i++) {
      const from = hHits[i].start;
      const to = i + 1 < hHits.length ? hHits[i + 1].start : raw.length;
      segments.push(raw.slice(from, to).trim());
    }
    return { segments, strategy: 'auto-heading', note: '标题行' };
  }
  // ③ 空行分段
  const paras = raw.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  if (paras.length >= 2) {
    return { segments: paras, strategy: 'auto-blank', note: '空行' };
  }
  // ④ 独立分隔行（整行只有符号）：兼容模型违反禁令仍输出 ---/===/*** 的情况
  const sepline = /^\s*(?:-{2,}|={2,}|\*{2,}|[—─＿_]{2,})\s*$/gm;
  const bounds = [];
  let m;
  while ((m = sepline.exec(raw)) !== null) {
    bounds.push({ start: m.index, end: m.index + m[0].length });
    if (m.index === sepline.lastIndex) sepline.lastIndex++;
  }
  if (bounds.length) {
    const segments = [];
    let cursor = 0;
    for (const b of bounds) {
      const seg = raw.slice(cursor, b.start).trim();
      if (seg) segments.push(seg);
      cursor = b.end;
    }
    const tail = raw.slice(cursor).trim();
    if (tail) segments.push(tail);
    if (segments.length >= 2) {
      return { segments, strategy: 'auto-sepline', note: '分隔行' };
    }
  }
  // ⑤ 单换行：行数 ≥2 且每行都较短
  const lines = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every((l) => l.length <= 120)) {
    return { segments: lines, strategy: 'auto-line', note: '单换行' };
  }
  return { segments: raw ? [raw] : [], strategy: 'single', note: '' };
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

  // 统一自适应兜底：任何模式只解析出 1 段时，按文本实际格式重新探测
  // （用户要求：不按固定符号切分，根据文本实际格式判断）。
  if (r.strategy === 'single') {
    const a = autoDetectSegments(raw);
    if (a.segments.length >= 2) {
      warnings.push(`模型未按所选分列方式输出，已按文本实际格式自适应切分（${a.note}）`);
      return { segments: a.segments, strategy: a.strategy, splitMode, warnings };
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
    // (?!\d) 防小数误伤：3.5万 不应被切成 3. / 5万
    { name: 'dot', re: /(?:^|\n)\s*(\d+)[.、](?!\d)\s*/g },
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

/**
 * 分段符分列：按文本实际格式自适应判断（用户要求：不再按固定符号 ---/===/*** 作分隔依据，
 * 因契约已禁止模型输出这些符号；符号分隔行仅在自适应探测中作兼容兜底）。
 * sep 参数保留形参兼容旧调用，不再参与切分。
 */
function parseByParagraph(raw, sep, warnings) {
  const a = autoDetectSegments(raw);
  if (a.segments.length >= 2) {
    // 轻提示：告知实际按哪种文本格式切分（不视为错误），便于用户对照「模型原始输出」排查
    warnings.push(`已按文本实际格式自动切分（${a.note}）`);
    return { segments: a.segments, strategy: a.strategy };
  }
  if (a.segments.length === 1) {
    warnings.push('分段符模式：仅解析出 1 段，可能未按格式输出');
    return { segments: a.segments, strategy: 'single' };
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
