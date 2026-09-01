/**
 * 批量执行编排：试跑首行 → 确认建列 → 并发生成 → 写回 → 失败收集。
 * 依赖全部注入（飞书表操作、模型调用、写回），零直接 import，便于 Node mock 测试。
 * 取消：shouldAbort() 标志位打穿 callModel 重试 / worker 池 / 写回三层。
 */
import { parseSegments } from './parser.js';
import { buildMessages } from './prompt.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 限制并发的 map（固定协程池）。可选 minIntervalMs 控制相邻请求最小间隔，用于限流。 */
export async function mapWithConcurrency(items, limit, worker, onItem, minIntervalMs = 0) {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  let lastAt = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      if (minIntervalMs > 0) {
        const now = Date.now();
        const wait = Math.max(0, minIntervalMs - (now - lastAt));
        if (wait > 0) await sleep(wait);
        lastAt = Date.now();
      }
      results[i] = await worker(items[i], i);
      done++;
      if (onItem) onItem(done, items.length);
    }
  }
  const pool = [];
  const n = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < n; i++) pool.push(run());
  await Promise.all(pool);
  return results;
}

/**
 * 试跑首行：调用模型并解析分点，只预览不写回。
 * @returns {{segments:string[], raw:string, strategy:string, warnings:string[]}}
 */
export async function trialRun(deps, sourceText) {
  const messages = buildMessages(deps.requirement, sourceText, deps.splitCfg, deps.outputColumns);
  const raw = await deps.callModel(messages, {});
  const parsed = parseSegments(raw, deps.splitCfg);
  return { ...parsed, raw };
}

/**
 * 批量执行。
 * @param {object} p
 *  rows: Array<{recordId, text, existing?: string[]}>   existing 为该行输出列当前内容（用于 skipFilled）
 *  columnNames: string[]  输出列名（输出1…输出N）
 *  llmConc: number        LLM 并发
 *  skipFilled: boolean    跳过「输出1 已有内容」的行
 *  shouldAbort: ()=>boolean
 *  onProgress: (done, total, phase) => void
 * @returns {{failed, truncated, lessFilled, written, skipped}}
 */
export async function runBatch(deps, p) {
  const {
    rows, columnNames, llmConc = 3, skipFilled = false,
    shouldAbort = () => false, onProgress = () => {},
  } = p;

  const N = columnNames.length;
  const result = { failed: [], truncated: 0, lessFilled: 0, written: 0, skipped: 0 };

  // 0) 过滤跳过行
  const workRows = rows.filter((r) => {
    if (skipFilled && r.existing && String(r.existing[0] || '').trim()) {
      result.skipped++;
      return false;
    }
    return true;
  });
  if (!workRows.length) {
    // 全部被「跳过已有内容」跳过：显示 N/N 已完成（而非 0/0），调用方据 result.skipped 弹提示
    onProgress(result.skipped, result.skipped, 'done');
    return result;
  }

  // 1)【先建列】纯飞书 API，不依赖 AI。
  //    建列排在生成之前，用户点「开始批量生成」后立刻能在表里看到新列；
  //    若 AI 响应慢/超时，列已就绪，进度只会停在「生成中」而不会连列都没有。
  onProgress(0, workRows.length, 'build_columns');
  let ensured;
  try {
    ensured = await deps.ensureColumns(columnNames);
  } catch (e) {
    return { ...result, failed: [], fatal: String(e && e.message || e), aborted: false };
  }
  if (!ensured || !Array.isArray(ensured.fieldIds)) {
    return { ...result, failed: [], fatal: `建列返回异常：${JSON.stringify(ensured)}`, aborted: false };
  }
  if (ensured.warnings && deps.onWarn) ensured.warnings.forEach((w) => deps.onWarn(null, [w]));
  const nameToId = new Map(ensured.fieldIds.map((fid, i) => [columnNames[i], fid]));
  // 被跳过的列（重名类型不符）没有 id，对应内容改为失败
  const skippedNames = new Set((ensured.skipped || []).map((s) => s.name));

  // 2) 并发生成（AI）
  const cellItems = []; // 待写回
  const failedRows = [];
  let done = 0;
  const total = workRows.length;
  onProgress(0, total, 'generate'); // 进入"生成"阶段（即便第一次 LLM 调用稍慢，UI 也能立刻看到 0/N）

  await mapWithConcurrency(
    workRows,
    llmConc,
    async (row) => {
      if (shouldAbort()) return;
      if (!String(row.text || '').trim()) {
        failedRows.push({ recordId: row.recordId, error: '源字段内容为空' });
        done++; onProgress(done, total, 'generate');
        return;
      }
      try {
        const messages = buildMessages(deps.requirement, row.text, deps.splitCfg, deps.outputColumns);
        const raw = await deps.callModel(messages, { shouldAbort });
        if (shouldAbort()) return;
        const parsed = parseSegments(raw, deps.splitCfg);
        // single 策略：marker/blank 模式视为未分列（失败）；heading/paragraph 单段视为有效 1 列
        const singleFail = parsed.strategy === 'single'
          && parsed.splitMode !== 'heading' && parsed.splitMode !== 'paragraph';
        if (!parsed.segments.length || singleFail) {
          failedRows.push({ recordId: row.recordId, error: '解析出 0 个分点：' + parsed.warnings.join(';') });
        } else {
          if (parsed.segments.length > N) result.truncated++;
          if (parsed.segments.length < N) result.lessFilled++;
          columnNames.forEach((colName, j) => {
            const seg = parsed.segments[j];
            if (!seg) return;
            // 建列已在生成前完成 → 直接取 fieldId；被跳过的列（类型不符）记为失败
            if (skippedNames.has(colName)) {
              failedRows.push({ recordId: row.recordId, error: `列「${colName}」不可用（类型不符）` });
              return;
            }
            const fid = nameToId.get(colName);
            if (fid) cellItems.push({ recordId: row.recordId, cell: { fieldId: fid, columnName: colName, text: seg } });
          });
        }
        if (parsed.warnings.length && deps.onWarn) deps.onWarn(row.recordId, parsed.warnings);
      } catch (e) {
        if (e && e.aborted) return;
        failedRows.push({ recordId: row.recordId, error: String(e && e.message || e) });
      }
      done++; onProgress(done, total, 'generate');
    },
    null,
    deps.minIntervalMs || 0,
  );

  if (shouldAbort()) return { ...result, failed: failedRows, aborted: true };

  // 3) 写回（建列已在步骤 1) 完成，cellItems 里 fieldId 已绑定，此处只过滤可写项）
  const writable = cellItems.filter((it) => it.cell.fieldId);
  if (writable.length && !shouldAbort()) {
    onProgress(0, writable.length, 'write'); // 进入"写回"阶段（重置计数器，用"writable/total"显示写回进度）
    const wr = await deps.writeCells(writable, {
      shouldAbort,
      onBatchDone: (d, t) => onProgress(d, t, 'write'),
    });
    failedRows.push(...(wr.failed || []));
  }

  result.failed = failedRows;
  // 写回成功条数 = 可写条数 - 写回失败条数（failed 中去掉生成阶段失败：空素材/0分点/列不可用）
  const generateFail = (f) => /源字段内容为空|解析出 0 个分点|不可用/.test(f.error || '');
  result.written = writable.length - failedRows.filter((f) => !generateFail(f)).length;
  onProgress(done, total, 'done'); // 全部完成
  return result;
}

/**
 * 重跑失败项：给定失败 recordId 集合，仅对这些行重新生成并写回。
 */
export async function retryFailed(deps, p) {
  const rows = p.rows.filter((r) => p.failedIds.has(r.recordId));
  return runBatch(deps, { ...p, rows, skipFilled: false });
}

/**
 * 分批写回编排（纯逻辑，SDK 调用由 writeBatch/writeCell 注入）。
 * 整批 setRecords 失败时降级逐格写，可精确定位坏行。
 * @param {object} p { items, batchSize, shouldAbort, onBatchDone, writeBatch, writeCell }
 * @returns {Promise<{failed: Array<{recordId, cell, error}>}>}
 */
export async function batchWriteCells(p) {
  const {
    items, batchSize = 50, shouldAbort = () => false,
    onBatchDone = () => {}, writeBatch, writeCell,
  } = p;
  const failed = [];
  for (let i = 0; i < items.length; i += batchSize) {
    if (shouldAbort()) break;
    const batch = items.slice(i, i + batchSize);
    try {
      await writeBatch(batch);
    } catch (e) {
      // 整批失败 → 降级为逐格写（定位个别坏行）
      for (const it of batch) {
        if (shouldAbort()) break;
        try {
          await writeCell(it);
        } catch (e2) {
          failed.push({ recordId: it.recordId, cell: it.cell, error: String(e2 && e2.message || e2) });
        }
      }
    }
    onBatchDone(Math.min(i + batchSize, items.length), items.length);
  }
  return { failed };
}
