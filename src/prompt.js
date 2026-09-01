/**
 * 提示词组装：system = 总要求（用户的 AI 输出约束）+ 输出格式契约；user = 素材原文。
 * 纯函数、零依赖。
 */

export const FORMAT_CONTRACT = [
  '输出格式（必须严格遵守）：',
  '- 每个分点单独一段，以「【数字】」开头，如【1】【2】【3】……依次编号；',
  '- 标记后紧跟该分点内容，分点内部可以换行；',
  '- 除分点外，不要输出任何解释、前言、总结或多余文字；',
  '- 不要使用 markdown 代码块包裹。',
].join('\n');

/**
 * 组装 messages。
 * @param {string} requirement 总要求文档（给 AI 的约束）
 * @param {string} sourceText 该行源字段素材原文
 * @returns {Array<{role:string, content:string}>}
 */
export function buildMessages(requirement, sourceText) {
  const req = String(requirement || '').trim();
  const system = [
    req ? `以下是本次任务的总体要求：\n${req}` : '请根据用户提供的素材完成任务。',
    '',
    FORMAT_CONTRACT,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `素材：\n${String(sourceText || '').trim()}` },
  ];
}
