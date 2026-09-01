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
 */
export function formatContract(cfg = {}) {
  const { splitMode = 'marker', marker = '【1】', sep = '---', headingLevel = '##' } = cfg;
  const head = '输出格式（必须严格遵守）：';
  const tail = [
    '- 除分点外，不要输出任何解释、前言、总结或多余文字；',
    '- 不要使用 markdown 代码块包裹。',
  ];

  if (splitMode === 'blank') {
    return [head,
      '- 每个分点单独一段，段与段之间用「一个空行」分隔；',
      ...tail,
    ].join('\n');
  }
  if (splitMode === 'heading') {
    const lv = headingLevel || '##';
    return [head,
      `- 每个分点以 Markdown 标题开头，固定用「${lv} 分点标题」形式，如 ${lv} 卖点、${lv} 场景；`,
      '- 标题之后紧跟该分点内容，分点内部可以换行；',
      ...tail,
    ].join('\n');
  }
  if (splitMode === 'paragraph') {
    const s = sep || '---';
    return [head,
      `- 每个分点单独一段，段与段之间用一行分隔符「${s}」隔开；`,
      '- 分隔符单独成行，前后不加其他文字；',
      ...tail,
    ].join('\n');
  }
  // marker（默认）：根据当前标记样式生成
  return [head,
    `- 每个分点单独一段，以序号标记开头（形如【1】【2】【3】，具体样式以设置为准），依次编号；`,
    '- 标记后紧跟该分点内容，分点内部可以换行；',
    ...tail,
  ].join('\n');
}

/**
 * 组装 messages。
 * @param {string} requirement 总要求文档（给 AI 的约束）
 * @param {string} sourceText 该行源字段素材原文
 * @param {object} splitCfg 分列配置 { splitMode, marker, sep, headingLevel }
 * @returns {Array<{role:string, content:string}>}
 */
export function buildMessages(requirement, sourceText, splitCfg = {}) {
  const req = String(requirement || '').trim();
  const system = [
    req ? `以下是本次任务的总体要求：\n${req}` : '请根据用户提供的素材完成任务。',
    '',
    formatContract(splitCfg),
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `素材：\n${String(sourceText || '').trim()}` },
  ];
}
