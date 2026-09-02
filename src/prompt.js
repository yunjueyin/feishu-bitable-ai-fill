/**
 * 提示词组装：system = 总要求（用户的 AI 输出约束）+ 输出格式契约；user = 素材原文。
 * 格式契约随「分列模式」动态生成，告诉模型按哪种格式输出分点。
 * 纯函数、零依赖。
 */

/** marker 模式的默认格式契约（保留供测试与兜底） */
export const FORMAT_CONTRACT = [
  '输出格式（必须严格遵守）：',
  '- 每个分点单独一段，以「【数字】」开头，如【1】【2】【3】……依次编号；',
  '- 标记后紧跟该分点内容，分点内部可以换行；',
  '- 除分点外，不要输出任何解释、前言、总结或多余文字；',
  '- 不要使用 markdown 代码块包裹。',
].join('\n');

/**
 * 按分列模式生成格式契约。
 * @param {object} cfg { splitMode, marker, sep, headingLevel }
 * @param {Array<{name:string, example?:string}>} outputColumns 显式输出列模板（可选）
 */
export function formatContract(cfg = {}, outputColumns = []) {
  const { splitMode = 'marker', marker = '【1】', sep = '---', headingLevel = '##' } = cfg;
/** 通用禁令：输出内容禁止用 markdown 符号表示分行/分段/列表/强调（写回单元格会带脏符号） */
const NO_MARKDOWN_RULE = '- 严禁使用任何 Markdown 符号表示分行、分段、列表或强调：不要输出 #、##、***、**、*、- 、——— 等符号，分点内部直接写纯文本正文，不要用符号另起小标题或列表；';

  const head = '输出格式（必须严格遵守）：';
  const tail = [
    '- 第一行直接输出第一个分点，不要任何开场白、思考过程或说明文字；',
    NO_MARKDOWN_RULE,
    '- 除分点外，不要输出任何解释、前言、总结或多余文字；',
    '- 不要使用 markdown 代码块包裹。',
  ];

  const colLines = [];
  if (Array.isArray(outputColumns) && outputColumns.length) {
    colLines.push('');
    colLines.push('输出列（必须按以下列名和顺序输出，不要额外列）：');
    outputColumns.forEach((col, i) => {
      const ex = String(col.example || '').trim();
      colLines.push(`${i + 1}. 列名「${col.name || `输出${i + 1}`}」${ex ? '：参考案例如「' + ex + '」' : ''}`);
    });
    colLines.push('- 每个分点的序号标记之后直接写该列的内容本身：不要重复列名（如「输出1：」），不要重复其他分点的内容，也不要输出多余的解释文字。');
  }

  if (splitMode === 'blank') {
    return [head,
      '- 每个分点单独一段，段与段之间用「一个空行」分隔；',
      ...tail,
      ...colLines,
    ].join('\n');
  }
  if (splitMode === 'heading') {
    const lv = headingLevel || '##';
    return [head,
      `- 每个分点以 Markdown 标题开头，固定用「${lv} 分点标题」形式，如 ${lv} 卖点、${lv} 场景；`,
      '- 标题之后紧跟该分点内容，分点内部可以换行；',
      `- 唯一例外：分点开头的「${lv} 标题」行允许使用 # 号；标题之后的内容仍严禁再用 #、*、- 等任何 Markdown 符号；`,
      ...tail,
      ...colLines,
    ].join('\n');
  }
  if (splitMode === 'paragraph') {
    const s = sep || '---';
    return [head,
      `- 每个分点单独一段，段与段之间用一行分隔符「${s}」隔开；`,
      '- 分隔符单独成行，前后不加其他文字；',
      ...tail,
      ...colLines,
    ].join('\n');
  }
  // marker（默认）：根据当前标记样式生成
  return [head,
    `- 每个分点单独一段，以序号标记开头（形如【1】【2】【3】，具体样式以设置为准），依次编号；`,
    '- 标记后紧跟该分点内容，分点内部可以换行；',
    ...tail,
    ...colLines,
  ].join('\n');
}

/**
 * 组装 messages。
 * @param {string} requirement 总要求文档（给 AI 的约束）
 * @param {string} sourceText 该行源字段素材原文
 * @param {object} splitCfg 分列配置 { splitMode, marker, sep, headingLevel }
 * @param {Array<{name:string, example?:string}>} outputColumns 显式输出列模板（可选）
 * @returns {Array<{role:string, content:string}>}
 */
export function buildMessages(requirement, sourceText, splitCfg = {}, outputColumns = []) {
  const req = String(requirement || '').trim();
  const system = [
    req ? `以下是本次任务的总体要求：\n${req}` : '请根据用户提供的素材完成任务。',
    '',
    formatContract(splitCfg, outputColumns),
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `素材：\n${String(sourceText || '').trim()}` },
  ];
}
