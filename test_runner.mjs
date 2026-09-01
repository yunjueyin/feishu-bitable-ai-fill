/**
 * 零框架回归测试：node test_runner.mjs，退出码 0=全绿 / 1=有失败。
 * 覆盖：解析器容错 / cellToText / joinUrl / LLM 重试分类 / runBatch 各分支 / batchWriteCells / retryFailed。
 * 不 import feishu.js / main.js（它们依赖 SDK 与 DOM）。
 */
import {
  parseSegments, markerToPattern, cellToText, DEFAULT_MARKER,
} from './src/parser.js';
import { buildMessages, FORMAT_CONTRACT } from './src/prompt.js';
import { callLLM, joinUrl } from './src/llm.js';
import { runBatch, trialRun, retryFailed, batchWriteCells, mapWithConcurrency, cleanSegment } from './src/runner.js';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? '  -- ' + detail : ''}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const row = (id, text, existing) => ({ recordId: id, text, existing: existing || [] });

/* ---------- parser ---------- */
console.log('# parser');
{
  const r = parseSegments('【1】卖点内容\n【2】场景内容\n【3】人群内容');
  check('标准【1】标记 3 段', r.segments.length === 3 && r.segments[0] === '卖点内容' && r.strategy === 'marker');
}
{
  const r = parseSegments('【1】A\n【2】B\n【3】C', '【1】');
  check('段内换行保留', parseSegments('【1】第一行\n第二行\n【2】B').segments[0] === '第一行\n第二行');
}
{
  const r = parseSegments('[1] 甲\n[2] 乙\n[3] 丙', '【1】');
  check('漏标记兜底到 [n] 变体', r.strategy === 'bracket' && r.segments.length === 3 && r.warnings.length > 0);
}
{
  const r = parseSegments('1. 甲\n2. 乙\n3. 丙', '【1】');
  check('兜底到 1. 变体', r.strategy === 'dot' && r.segments.length === 3);
}
{
  const r = parseSegments('一、甲\n二、乙', '【1】');
  check('兜底到中文序号', r.strategy === 'cnum' && r.segments.length === 2);
}
{
  const r = parseSegments('就一段话，没有任何标记也没有空行', '【1】');
  check('无标记单段', r.strategy === 'single' && r.segments.length === 1);
}
{
  const r = parseSegments('段一内容\n\n段二内容', '【1】');
  check('空行启发式分段', r.strategy === 'blank-line' && r.segments.length === 2);
}
{
  const r = parseSegments('', '【1】');
  check('空文本 0 分点', r.segments.length === 0 && r.strategy === 'empty');
}
{
  const r = parseSegments('【1】甲\n【2】', '【1】');
  check('空分点给警告', r.warnings.some((w) => w.includes('分点内容为空')));
}
{
  const r = parseSegments('【1】只有一个标记的输出', '【1】');
  check('单标记命中按 marker 策略', r.strategy === 'marker' && r.segments.length === 1 && r.segments[0] === '只有一个标记的输出');
}
{
  check('cellToText 字符串', cellToText('abc') === 'abc');
  check('cellToText 富文本数组', cellToText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]) === 'ab');
  check('cellToText 对象 value', cellToText({ value: [{ text: 'x' }] }) === 'x');
  check('cellToText null/undefined', cellToText(null) === '' && cellToText(undefined) === '');
  check('cellToText 数字', cellToText(123) === '123');
}

/* ---------- parser: 多分列模式 ---------- */
console.log('# parser (multi-mode)');
{
  const r = parseSegments('段一\n---\n段二\n---\n段三', { splitMode: 'paragraph', sep: '---' });
  check('paragraph 分隔符 3 段', r.segments.length === 3 && r.strategy === 'paragraph' && r.segments[0] === '段一' && r.segments[2] === '段三');
}
{
  const r = parseSegments('只有一段没有分隔', { splitMode: 'paragraph', sep: '---' });
  check('paragraph 无分隔符 → 单段', r.segments.length === 1 && r.strategy === 'single');
}
{
  const r = parseSegments('段一\n\n段二', { splitMode: 'blank' });
  check('blank 空行 2 段', r.segments.length === 2 && r.strategy === 'blank');
}
{
  const r = parseSegments('## 卖点\n好东西\n## 场景\n随处用', { splitMode: 'heading', headingLevel: '##' });
  check('heading 2 段含标题', r.segments.length === 2 && r.strategy === 'heading' && r.segments[0].startsWith('## 卖点') && r.segments[1].includes('随处用'));
}
{
  const r = parseSegments('毫无标题的一段文字', { splitMode: 'heading', headingLevel: '##' });
  check('heading 无标题 → single', r.strategy === 'single' && r.segments.length === 1);
}
{
  const r = parseSegments('【1】甲\n【2】乙', { splitMode: 'marker', marker: '【1】' });
  check('marker 显式 splitMode', r.strategy === 'marker' && r.segments.length === 2);
}
{
  // runBatch 透传 splitCfg：heading 单段视为有效 1 列（非失败）
  const deps = makeDeps({
    splitCfg: { splitMode: 'heading', headingLevel: '##' },
    callModel: async () => '## 标题\n仅一段内容',
  });
  const r = await runBatch(deps, {
    rows: [row('r1', 'a')], columnNames: ['输出1'], llmConc: 1, shouldAbort: () => false, onProgress: () => {},
  });
  check('heading 单段不判失败（填 1 列）', r.failed.length === 0 && deps._written.length === 1);
}

/* ---------- prompt ---------- */
console.log('# prompt');
{
  const msgs = buildMessages('要求A', '素材B');
  check('system 含要求与格式契约', msgs[0].role === 'system' && msgs[0].content.includes('要求A') && msgs[0].content.includes('【'));
  check('user 含素材', msgs[1].role === 'user' && msgs[1].content.includes('素材B'));
  check('格式契约要求编号标记', FORMAT_CONTRACT.includes('【数字】'));
}

/* ---------- llm ---------- */
console.log('# llm');
{
  check('joinUrl 补 /v1', joinUrl('https://api.deepseek.com', '/chat/completions') === 'https://api.deepseek.com/v1/chat/completions');
  check('joinUrl 已带 /v1 不重复', joinUrl('https://api.deepseek.com/v1', '/chat/completions') === 'https://api.deepseek.com/v1/chat/completions');
  check('joinUrl 完整端点不改写', joinUrl('https://x.com/v1/chat/completions', '/chat/completions') === 'https://x.com/v1/chat/completions');
  check('joinUrl 去尾部斜杠', joinUrl('https://api.x.com/', '/chat/completions').startsWith('https://api.x.com/v1'));
}
{
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 3) return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } });
    return Response.json({ choices: [{ message: { content: '【1】甲\n【2】乙' } }] });
  };
  const retries = [];
  const text = await callLLM(
    { baseUrl: 'https://x.com', apiKey: 'k', model: 'm' },
    [{ role: 'user', content: 'hi' }],
    { fetchImpl, onRetry: (a) => retries.push(a) },
  );
  check('429 重试后成功', text.includes('甲') && calls === 3 && eq(retries, [1, 2]));
}
{
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('unauthorized', { status: 401 }); };
  let err = null;
  try {
    await callLLM({ baseUrl: 'https://x.com', apiKey: 'k', model: 'm' }, [{ role: 'user', content: 'hi' }], { fetchImpl });
  } catch (e) { err = e; }
  check('401 不重试直接抛错', err && err.retryable === false && calls === 1);
}
{
  let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json({ choices: [{ message: { content: '  ' } }] }); };
  let err = null;
  try {
    await callLLM({ baseUrl: 'https://x.com', apiKey: 'k', model: 'm' }, [{ role: 'user', content: 'hi' }], { fetchImpl, retries: 1 });
  } catch (e) { err = e; }
  check('空内容按可重试处理', err && err.retryable === true && calls === 2);
}
{
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new TypeError('fetch failed'); };
  let err = null;
  try {
    await callLLM({ baseUrl: 'https://x.com', apiKey: 'k', model: 'm' }, [{ role: 'user', content: 'hi' }], { fetchImpl, retries: 2 });
  } catch (e) { err = e; }
  check('网络错误重试后抛出', err && err.retryable === true && calls === 3);
}

/* ---------- runBatch ---------- */
console.log('# runBatch');

function makeDeps(over = {}) {
  const created = [];
  const written = [];
  return {
    requirement: '要求',
    marker: '【1】',
    splitCfg: over.splitCfg,
    callModel: over.callModel || (async (messages) => '【1】甲\n【2】乙'),
    ensureColumns: over.ensureColumns || (async (names) => ({
      fieldIds: names.map((n, i) => 'fld' + i),
      created: created.concat(names), reused: [], skipped: over.skippedCols || [], warnings: [],
    })),
    writeCells: over.writeCells || (async (items) => {
      written.push(...items);
      return { failed: over.writeFailures || [] };
    }),
    onWarn: over.onWarn || (() => {}),
    _created: created, _written: written,
  };
}

{
  const deps = makeDeps();
  const r = await runBatch(deps, {
    rows: [row('r1', '素材1'), row('r2', '素材2'), row('r3', '素材3')],
    columnNames: ['输出1', '输出2'], llmConc: 2, shouldAbort: () => false, onProgress: () => {},
  });
  check('正常 3 行 × 2 列写回 6 格', deps._written.length === 6 && r.written === 6 && r.failed.length === 0);
  check('fieldId 绑定正确', deps._written[0].cell.fieldId === 'fld0' && deps._written[1].cell.fieldId === 'fld1');
  check('素材传递正确', deps._written[0].cell.text === '甲');
}
{
  let idx = 0;
  const deps = makeDeps({
    callModel: async () => { idx++; return idx === 2 ? '【1】甲\n【2】乙\n【3】丙' : '【1】甲\n【2】乙'; },
  });
  const r = await runBatch(deps, {
    rows: [row('r1', 'a'), row('r2', 'b'), row('r3', 'c')],
    columnNames: ['输出1', '输出2'], llmConc: 1, shouldAbort: () => false, onProgress: () => {},
  });
  check('分点超列：第 3 段被截断', r.truncated === 1 && deps._written.length === 6);
}
{
  const deps = makeDeps({
    callModel: async () => '【1】甲',
  });
  const r = await runBatch(deps, {
    rows: [row('r1', 'a'), row('r2', 'b')],
    columnNames: ['输出1', '输出2'], llmConc: 1, shouldAbort: () => false, onProgress: () => {},
  });
  check('分点不足：留空并计数', r.lessFilled === 2 && deps._written.length === 2);
}
{
  const deps = makeDeps({
    callModel: async () => '模型废话没有分点',
  });
  const r = await runBatch(deps, {
    rows: [row('r1', 'a')],
    columnNames: ['输出1'], llmConc: 1, shouldAbort: () => false, onProgress: () => {},
  });
  check('0 分点计入失败', r.failed.length === 1 && /解析出 0 个分点/.test(r.failed[0].error));
}
{
  const deps = makeDeps();
  const r = await runBatch(deps, {
    rows: [row('r1', ''), row('r2', 'b')],
    columnNames: ['输出1'], llmConc: 1, shouldAbort: () => false, onProgress: () => {},
  });
  check('空素材行跳过并失败', r.failed.some((f) => /源字段内容为空/.test(f.error)) && deps._written.length === 1);
}
{
  const deps = makeDeps();
  const r = await runBatch(deps, {
    rows: [row('r1', 'a', ['已有内容']), row('r2', 'b', [])],
    columnNames: ['输出1'], llmConc: 1, skipFilled: true, shouldAbort: () => false, onProgress: () => {},
  });
  check('skipFilled 跳过已有内容行', r.skipped === 1 && deps._written.length === 1);
}
{
  // 新语义：部分填充行不整行跳过——生成后只补空列，已有内容列不覆盖
  const deps = makeDeps();
  const r = await runBatch(deps, {
    rows: [row('r1', 'a', ['已有', ''])],
    columnNames: ['输出1', '输出2'], llmConc: 1, skipFilled: true, shouldAbort: () => false, onProgress: () => {},
  });
  check('部分填充行不跳过，只补空列', r.skipped === 0 && deps._written.length === 1
    && deps._written[0].cell.columnName === '输出2');
}
{
  const deps = makeDeps();
  const r = await runBatch(deps, {
    rows: [row('r1', 'a', ['已有', '已有'])],
    columnNames: ['输出1', '输出2'], llmConc: 1, skipFilled: true, shouldAbort: () => false, onProgress: () => {},
  });
  check('整行全满才整行跳过', r.skipped === 1 && deps._written.length === 0);
}
{
  // 写回内容清洗：模型输出「输出1：」前缀与残留标记不得混进单元格
  const deps = makeDeps({ callModel: async () => '【1】输出1：甲\n【2】乙' });
  const r = await runBatch(deps, {
    rows: [row('r1', 'a')], columnNames: ['输出1', '输出2'], llmConc: 1,
    shouldAbort: () => false, onProgress: () => {},
  });
  check('写回内容去标记与列名前缀', r.written === 2 && deps._written[0].cell.text === '甲' && deps._written[1].cell.text === '乙');
}
{
  check('cleanSegment 去【1】与列名前缀', cleanSegment('【1】输出1：甲内容', '输出1', { splitMode: 'marker' }) === '甲内容');
  check('cleanSegment 不误伤正文数字开头', cleanSegment('3.5万用户好评', '输出1', { splitMode: 'marker' }) === '3.5万用户好评');
  check('cleanSegment 1. 样式按配置清洗', cleanSegment('1.甲', '输出1', { splitMode: 'marker', marker: '1.' }) === '甲');
  check('cleanSegment 无配置兜底', cleanSegment('【2】乙', '输出1', {}) === '乙');
}
{
  let aborted = false;
  const deps = makeDeps({
    callModel: async () => { aborted = true; throw Object.assign(new Error('x'), { aborted: true }); },
  });
  const r = await runBatch(deps, {
    rows: [row('r1', 'a')],
    columnNames: ['输出1'], llmConc: 1, shouldAbort: () => aborted, onProgress: () => {},
  });
  check('取消：不写回且 aborted 标记', r.aborted === true && deps._written.length === 0);
}
{
  const deps = makeDeps({
    ensureColumns: async () => { throw new Error('重名列冲突'); },
  });
  const r = await runBatch(deps, {
    rows: [row('r1', 'a')],
    columnNames: ['输出1'], llmConc: 1, shouldAbort: () => false, onProgress: () => {},
  });
  check('建列失败 fatal 上报', !!r.fatal && /重名列冲突/.test(r.fatal));
}
{
  const deps = makeDeps({
    skippedCols: [{ name: '输出1', type: 2 }],
    ensureColumns: async () => ({ fieldIds: [], created: [], reused: [], skipped: [{ name: '输出1', type: 2 }], warnings: ['类型不符'] }),
  });
  const r = await runBatch(deps, {
    rows: [row('r1', 'a')],
    columnNames: ['输出1'], llmConc: 1, shouldAbort: () => false, onProgress: () => {},
  });
  check('重名类型不符列：内容转失败', r.failed.length === 1 && /不可用/.test(r.failed[0].error) && deps._written.length === 0);
}
{
  const deps = makeDeps({ writeFailures: [{ recordId: 'r1', cell: {}, error: 'boom' }] });
  const r = await runBatch(deps, {
    rows: [row('r1', 'a'), row('r2', 'b')],
    columnNames: ['输出1'], llmConc: 1, shouldAbort: () => false, onProgress: () => {},
  });
  check('写回失败收集且 written 扣减', r.failed.length === 1 && r.written === 1);
}

/* ---------- trialRun / retryFailed ---------- */
console.log('# trialRun / retryFailed');
{
  const deps = makeDeps();
  const tr = await trialRun(deps, '素材');
  check('trialRun 解析 2 分点', tr.segments.length === 2 && tr.raw.includes('甲'));
}
{
  const calls = [];
  const deps = makeDeps({
    callModel: async (m, o) => { calls.push(1); return '【1】x'; },
  });
  const r = await retryFailed(deps, {
    rows: [row('r1', 'a'), row('r2', 'b'), row('r3', 'c')],
    failedIds: new Set(['r2']),
    columnNames: ['输出1'], llmConc: 1, shouldAbort: () => false, onProgress: () => {},
  });
  check('retryFailed 仅重跑失败行', calls.length === 1 && r.written === 1);
}

/* ---------- batchWriteCells ---------- */
console.log('# batchWriteCells');
{
  const batches = [];
  const r = await batchWriteCells({
    items: Array.from({ length: 120 }, (_, i) => ({ recordId: 'r' + i, cell: { fieldId: 'f', text: 't' + i } })),
    batchSize: 50,
    writeBatch: async (b) => { batches.push(b.length); },
    writeCell: async () => {},
    onBatchDone: () => {},
  });
  check('120 条分 3 批（50/50/20）', eq(batches, [50, 50, 20]) && r.failed.length === 0);
}
{
  const cellWrites = [];
  const items = [1, 2, 3, 4].map((i) => ({ recordId: 'r' + i, cell: { fieldId: 'f', text: 't' + i } }));
  const r = await batchWriteCells({
    items, batchSize: 10,
    writeBatch: async () => { throw new Error('整批失败'); },
    writeCell: async (it) => {
      if (it.recordId === 'r2') throw new Error('坏行');
      cellWrites.push(it.recordId);
    },
  });
  check('整批失败降级逐格写，坏行收集', cellWrites.length === 3 && r.failed.length === 1 && r.failed[0].recordId === 'r2');
}
{
  let stop = false;
  const calls = [];
  const r = await batchWriteCells({
    items: Array.from({ length: 10 }, (_, i) => ({ recordId: 'r' + i, cell: { fieldId: 'f', text: 't' } })),
    batchSize: 2,
    shouldAbort: () => calls.length >= 3, // 第 3 次检查时中止
    writeBatch: async (b) => { calls.push(b.length); },
    writeCell: async () => {},
  });
  check('取消时停止后续批次', calls.length === 3, '实际批次=' + calls.length);
}

/* ---------- mapWithConcurrency ---------- */
console.log('# mapWithConcurrency');
{
  let concurrent = 0;
  let maxConcurrent = 0;
  const r = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (x) => {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r2) => setTimeout(r2, 5));
    concurrent--;
    return x * 2;
  });
  check('并发池限制 2 且结果有序', eq(r, [2, 4, 6, 8, 10, 12]) && maxConcurrent <= 2);
}

/* ---------- markerToPattern ---------- */
console.log('# markerToPattern');
{
  check('【1】样式正则', markerToPattern('【1】') === '【\\d+】');
  check('[1] 样式正则', markerToPattern('[1]') === '\\[\\d+\\]');
}

console.log('————————————————');
console.log(`通过 ${passed} 项${failures.length ? `，失败 ${failures.length} 项：\n  - ${failures.join('\n  - ')}` : '，全部通过 ✅'}`);
process.exit(failures.length ? 1 : 0);
