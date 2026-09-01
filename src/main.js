/**
 * UI 装配与事件编排。SDK 为静态 import（Vite 打包，无外部 CDN 请求）。
 */
import { el, fillSelect, showModal, fmtEta } from './ui.js';
import { loadCfg, saveCfg, serializeForExport, parseImport } from './storage.js';
import { callLLM } from './llm.js';
import { cellToText, markerToPattern } from './parser.js';
import {
  getTableById, loadViewFields, readRecords,
  ensureColumns, writeTextCell, listTables,
} from './feishu.js';
import { trialRun, runBatch, retryFailed, batchWriteCells } from './runner.js';

export const APP_VERSION = '20260901a';

const state = {
  cfg: loadCfg(),
  table: null,
  viewId: null,
  fields: [],
  sourceFieldId: '',
  aborted: false,
  running: false,
  lastResult: null,   // 上次批量结果（供重跑失败项）
  lastRows: null,
  lastColumns: null,
  t0: 0,
};

/* ---------- DOM 引用 ---------- */
const $ = (id) => document.getElementById(id);

function render() {
  const app = $('app');
  app.innerHTML = '';
  app.appendChild(el('div', { class: 'card' },
    el('h3', {}, '① 数据表与源字段'),
    el('div', { class: 'row' },
      el('label', { class: 'field' }, el('span', {}, '源字段（每行该列内容作为素材喂给 AI）'),
        (() => { const s = el('select', { id: 'sourceField' }); return s; })()),
      el('button', { class: 'btn', id: 'btnReload', onclick: reloadTable }, '刷新表/字段'),
    ),
    el('div', { class: 'hint', id: 'tableInfo' }, '加载中…'),
  ));

  app.appendChild(el('div', { class: 'card' },
    el('h3', {}, '② 模型配置（OpenAI 兼容，存本浏览器）'),
    el('div', { class: 'row' },
      el('label', { class: 'field' }, el('span', {}, 'Base URL（如 https://api.deepseek.com）'),
        el('input', { type: 'text', id: 'baseUrl', placeholder: 'https://api.deepseek.com' })),
      el('label', { class: 'field' }, el('span', {}, 'API Key'),
        el('input', { type: 'password', id: 'apiKey', placeholder: 'sk-…' })),
      el('label', { class: 'field' }, el('span', {}, '模型名（如 deepseek-chat）'),
        el('input', { type: 'text', id: 'model', placeholder: 'deepseek-chat' })),
      el('label', { class: 'field', style: 'max-width:110px' }, el('span', {}, '并发数'),
        el('input', { type: 'text', id: 'llmConc' })),
    ),
    el('div', { class: 'hint' }, 'Key 仅保存在本浏览器 localStorage，不会上传；勿在公共设备勾选保存。'),
  ));

  app.appendChild(el('div', { class: 'card' },
    el('h3', {}, '③ 总要求（给 AI 的输出约束）'),
    el('div', { class: 'row' },
      el('select', { id: 'tplSel', style: 'max-width:200px' }),
      el('button', { class: 'btn', id: 'btnTplSave', onclick: onSaveTemplate }, '存为模板'),
      el('button', { class: 'btn', id: 'btnTplDel', onclick: onDeleteTemplate }, '删除'),
      el('button', { class: 'btn', id: 'btnTplExport', onclick: onExport }, '导出 JSON'),
      el('button', { class: 'btn', id: 'btnTplImport', onclick: () => $('importFile').click() }, '导入 JSON'),
      el('input', { type: 'file', id: 'importFile', accept: '.json', style: 'display:none' }),
    ),
    el('textarea', { id: 'requirement', placeholder: '粘贴总要求文档。例：\n基于素材撰写产品文案，要求口语化、每条不超过 30 字、不得出现"首先"等套话；输出 5 个分点，分别覆盖卖点、场景、人群、对比、行动号召。' }),
    el('div', { class: 'row', style: 'margin-top:6px' },
      el('label', { class: 'field', style: 'max-width:160px' }, el('span', {}, '分点标记样式'),
        el('select', { id: 'marker' },
          el('option', { value: '【1】' }, '【1】【2】…（推荐）'),
          el('option', { value: '[1]' }, '[1] [2]…'),
          el('option', { value: '1.' }, '1. 2.…'),
          el('option', { value: '一、' }, '一、二、…'),
        )),
      el('label', { class: 'field', style: 'max-width:220px' }, el('span', {}, '运行范围'),
        el('select', { id: 'skipFilled' },
          el('option', { value: '1' }, '跳过「输出1」已有内容的行'),
          el('option', { value: '0' }, '覆盖全部行'),
        )),
    ),
  ));

  app.appendChild(el('div', { class: 'card' },
    el('h3', {}, '④ 执行'),
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-primary', id: 'btnTrial', onclick: onTrial }, '试跑首行（预览，不写回）'),
      el('button', { class: 'btn btn-primary', id: 'btnRun', onclick: onRun, disabled: true }, '开始批量生成'),
      el('button', { class: 'btn', id: 'btnRetry', onclick: onRetryFailed, disabled: true }, '重跑失败项'),
      el('button', { class: 'btn btn-danger', id: 'btnCancel', onclick: onCancelClick, disabled: true }, '取消'),
    ),
    el('div', { class: 'hint', id: 'runHint' }, '先试跑首行确认分点结构，再批量。新列将创建为「多行文本」，默认追加在表尾（飞书不支持 API 指定列位置，可手动拖动列序）。'),
    el('div', { id: 'progressBox' },
      el('div', { class: 'progress-track' }, el('div', { id: 'progressBar' })),
      el('div', { class: 'progress-meta' },
        el('span', { id: 'progressStage' }, ''),
        el('span', { id: 'progressCount' }, ''),
        el('span', { id: 'progressPct' }, ''),
        el('span', {}, '剩余 ', el('span', { id: 'progressEta' }, '--:--')),
      ),
    ),
  ));

  app.appendChild(el('div', { class: 'card', id: 'logPanel' },
    el('div', { class: 'log-head', onclick: toggleLog }, '运行日志（点击折叠/展开）— v' + APP_VERSION),
    el('div', { id: 'log' }),
  ));

  const file = $('importFile');
  file.addEventListener('change', onImport);
}

/* ---------- 工具 ---------- */
export function log(msg, cls = '') {
  const box = $('log');
  if (!box) return;
  const d = el('div', { class: 'row' }, el('span', { class: cls }, `[${new Date().toLocaleTimeString()}] ${msg}`));
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function toggleLog() {
  const box = $('log');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

function collectCfg() {
  state.cfg = saveCfg({
    baseUrl: $('baseUrl').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
    llmConc: Math.max(1, Math.min(8, Number($('llmConc').value) || 3)),
    requirement: $('requirement').value,
    marker: $('marker').value,
    skipFilled: $('skipFilled').value === '1',
  });
  return state.cfg;
}

function setProgress(done, total, phase) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('progressBar').style.width = pct + '%';
  $('progressPct').textContent = pct + '%';
  $('progressStage').textContent = phase === 'write' ? '写回中' : '生成中';
  $('progressCount').textContent = `${done}/${total}`;
  const elapsed = (Date.now() - state.t0) / 1000;
  const eta = done > 0 ? (elapsed / done) * (total - done) : NaN;
  $('progressEta').textContent = fmtEta(eta);
}

function showCancelOverlay() {
  return showModal('已请求取消', el('div', {}, '正在等待在途请求结束，已完成的单元格会保留。'), [
    { label: '终止并保留', onClick: () => {} },
  ]);
}

/* ---------- 模板管理 ---------- */
function refreshTemplates() {
  const sel = $('tplSel');
  sel.innerHTML = '';
  sel.appendChild(el('option', { value: '' }, '— 选择模板 —'));
  for (const t of state.cfg.templates || []) {
    sel.appendChild(el('option', { value: t.name }, t.name));
  }
  if (state.cfg.activeTemplate) sel.value = state.cfg.activeTemplate;
}

function onSaveTemplate() {
  const text = $('requirement').value.trim();
  if (!text) return log('要求内容为空，无法保存模板', 'warn');
  const name = prompt('模板名称：', '模板' + ((state.cfg.templates?.length || 0) + 1));
  if (!name) return;
  const templates = (state.cfg.templates || []).filter((t) => t.name !== name);
  templates.push({ name, text });
  saveCfg({ templates, activeTemplate: name });
  state.cfg = loadCfg();
  refreshTemplates();
  log(`模板「${name}」已保存`, 'ok');
}

function onDeleteTemplate() {
  const name = $('tplSel').value;
  if (!name) return log('未选择模板', 'warn');
  const templates = (state.cfg.templates || []).filter((t) => t.name !== name);
  saveCfg({ templates, activeTemplate: '' });
  state.cfg = loadCfg();
  refreshTemplates();
  log(`模板「${name}」已删除`);
}

function onExport() {
  collectCfg();
  const blob = new Blob([serializeForExport(state.cfg)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'ai-fill-templates.json' });
  document.body.appendChild(a); a.click(); a.remove();
  log('配置已导出（不含 API Key）', 'ok');
}

function onImport() {
  const file = $('importFile').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = parseImport(reader.result);
      const templates = obj.templates || [];
      saveCfg({
        templates,
        requirement: obj.requirement || '',
        marker: obj.marker || '【1】',
        skipFilled: obj.skipFilled !== false,
        activeTemplate: obj.activeTemplate || '',
      });
      state.cfg = loadCfg();
      $('requirement').value = state.cfg.requirement;
      $('marker').value = state.cfg.marker;
      $('skipFilled').value = state.cfg.skipFilled ? '1' : '0';
      refreshTemplates();
      log(`已导入 ${templates.length} 套模板`, 'ok');
    } catch (e) {
      log('导入失败：' + e.message, 'err');
    }
  };
  reader.readAsText(file);
}

/* ---------- 表加载 ---------- */
export async function reloadTable() {
  try {
    const tables = await listTables();
    const current = tables[0];
    if (!current) throw new Error('未找到数据表');
    state.table = await getTableById(current.id);
    const { viewId, fields } = await loadViewFields(state.table);
    state.viewId = viewId;
    state.fields = fields;
    const sel = $('sourceField');
    fillSelect(sel, fields.map((f) => ({ value: f.id, label: f.name + (f.isPrimary ? '（主键）' : '') })), '请选择源字段…');
    $('tableInfo').textContent = `当前表：${current.name} · 字段 ${fields.length} 个${viewId ? ' · 已按当前视图排序' : ''}`;
    // 恢复上次源字段选择
    if (state.cfg.sourceFieldId && fields.some((f) => f.id === state.cfg.sourceFieldId)) {
      sel.value = state.cfg.sourceFieldId;
      state.sourceFieldId = state.cfg.sourceFieldId;
    }
    sel.onchange = () => {
      state.sourceFieldId = sel.value;
      saveCfg({ sourceFieldId: sel.value });
    };
  } catch (e) {
    $('tableInfo').textContent = '加载失败：' + e.message;
    log('表加载失败：' + e.message, 'err');
  }
}

/* ---------- 读取行数据 ---------- */
async function loadRows(columnNames = []) {
  const records = await readRecords(state.table, state.viewId);
  const outIdByName = new Map(state.fields.map((f) => [f.name, f.id]));
  return records.map((rec) => {
    const text = cellToText(rec.fields && rec.fields[state.sourceFieldId]);
    const existing = columnNames.map((name) => {
      const fid = outIdByName.get(name);
      return fid ? cellToText(rec.fields && rec.fields[fid]) : '';
    });
    return { recordId: rec.recordId, text, existing };
  });
}

/* ---------- 试跑 ---------- */
async function onTrial() {
  const cfg = collectCfg();
  if (!state.sourceFieldId) return log('请先选择源字段', 'warn');
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) return log('请先填写模型配置（Base URL / Key / 模型名）', 'err');
  if (!cfg.requirement.trim()) return log('总要求为空', 'warn');
  setRunning(true, 'trial');
  try {
    const rows = await loadRows([]);
    const first = rows.find((r) => r.text.trim());
    if (!first) throw new Error('源字段没有非空内容');
    log(`试跑首行（recordId=${first.recordId}，素材 ${first.text.length} 字）…`);
    state.t0 = Date.now();
    const deps = makeDeps(cfg);
    const result = await trialRun(deps, first.text);
    log(`解析出 ${result.segments.length} 个分点（策略=${result.strategy}）`, result.segments.length ? 'ok' : 'warn');
    (result.warnings || []).forEach((w) => log(w, 'warn'));
    showPreview(result, first);
  } catch (e) {
    log('试跑失败：' + e.message, 'err');
  } finally {
    setRunning(false);
  }
}

function showPreview(result, firstRow) {
  const n = result.segments.length;
  const wrap = el('div', {});
  if (n === 0) {
    wrap.appendChild(el('div', { class: 'err-text' }, '未解析出任何分点，请调整要求中的格式约定或标记样式。'));
    wrap.appendChild(el('pre', { style: 'white-space:pre-wrap;font-size:12px;max-height:160px;overflow:auto;background:#fafbfc;padding:8px;border-radius:6px' }, result.raw.slice(0, 1500)));
    showModal('试跑结果', wrap, [{ label: '关闭', primary: true }]);
    return;
  }
  wrap.appendChild(el('div', { class: 'hint', style: 'margin-bottom:8px' },
    `模型返回 ${n} 个分点。将创建 ${n} 个「多行文本」列（可改列名）：`));
  const nameInputs = [];
  for (let i = 0; i < n; i++) {
    const input = el('input', { type: 'text', value: `输出${i + 1}` });
    nameInputs.push(input);
    wrap.appendChild(el('div', { class: 'seg-item' },
      el('div', { class: 'seg-head' }, el('span', { class: 'badge' }, `分点 ${i + 1}`), input),
      el('pre', {}, result.segments[i] || '（空）'),
    ));
  }
  wrap.appendChild(el('div', { class: 'hint' }, `素材预览：${firstRow.text.slice(0, 100)}…`));
  showModal('首行预览（不写回）', wrap, [
    { label: '取消' },
    {
      label: '确认并开始批量生成', primary: true,
      onClick: async () => {
        const columnNames = nameInputs.map((inp) => inp.value.trim()).filter(Boolean);
        document.querySelectorAll('.modal-overlay').forEach((m) => m.remove());
        await onRun(columnNames);
      },
    },
  ]);
}

/* ---------- 批量执行 ---------- */
function makeDeps(cfg) {
  return {
    requirement: cfg.requirement,
    marker: cfg.marker,
    callModel: async (messages, { shouldAbort }) => callLLM(cfg, messages, {
      shouldAbort,
      onRetry: (attempt, err, delay) => log(`模型请求第 ${attempt} 次重试（${err.message.slice(0, 80)}），${Math.round(delay / 1000)}s 后…`, 'warn'),
    }),
    ensureColumns: (names) => ensureColumns(state.table, names),
    writeCells: (items, opts) => batchWriteCells({
      items,
      batchSize: 50,
      shouldAbort: opts.shouldAbort,
      onBatchDone: opts.onBatchDone,
      writeBatch: (batch) => state.table.setRecords(batch.map(({ recordId, cell }) => ({
        recordId,
        fields: { [cell.fieldId]: cell.text },
      }))),
      writeCell: (it) => writeTextCell(state.table, it.cell.fieldId, it.recordId, it.cell.text),
    }),
    onWarn: (recordId, warnings) => warnings.forEach((w) => log(`行 ${recordId || '-'}：${w}`, 'warn')),
  };
}

async function onRun(presetColumns = null) {
  const cfg = collectCfg();
  if (!state.sourceFieldId) return log('请先选择源字段', 'warn');
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) return log('请先填写模型配置', 'err');
  setRunning(true, 'run');
  state.aborted = false;
  state.t0 = Date.now();
  $('progressBox').style.display = 'block';
  let columns = presetColumns;
  try {
    // 未经过试跑直接点「开始批量」：先用试跑确定列
    if (!columns) {
      const rows0 = await loadRows([]);
      const first = rows0.find((r) => r.text.trim());
      if (!first) throw new Error('源字段没有非空内容');
      const tr = await trialRun(makeDeps(cfg), first.text);
      if (!tr.segments.length) throw new Error('首行解析出 0 个分点，请先调整要求（试跑预览可查看模型原始输出）');
      columns = tr.segments.map((_, i) => `输出${i + 1}`);
      log(`未试跑，按首行解析结果自动建 ${columns.length} 列`, 'warn');
    }
    state.lastColumns = columns;
    const rows = await loadRows(columns);
    state.lastRows = rows;
    log(`开始批量：共 ${rows.length} 行，输出列 [${columns.join(', ')}]，并发 ${cfg.llmConc}${cfg.skipFilled ? '，跳过已有内容' : ''}`);
    const deps = makeDeps(cfg);
    const result = await runBatch(deps, {
      rows, columnNames: columns, llmConc: cfg.llmConc, skipFilled: cfg.skipFilled,
      shouldAbort: () => state.aborted,
      onProgress: setProgress,
    });
    state.lastResult = result;
    if (result.aborted) {
      log('已取消：生成/写回中止，已完成内容保留', 'warn');
    } else {
      log(`完成：写回 ${result.written} 格，跳过 ${result.skipped} 行，失败 ${result.failed.length} 项，分点超列截断 ${result.truncated} 行，不足留空 ${result.lessFilled} 行`, 'ok');
    }
    if (result.fatal) log('建列失败：' + result.fatal, 'err');
    if (result.failed.length) {
      $('btnRetry').disabled = false;
      log('失败明细（前 20 条）：\n' + result.failed.slice(0, 20).map((f) => `  行 ${f.recordId}: ${f.error}`).join('\n'), 'err');
    }
  } catch (e) {
    log('批量执行失败：' + e.message, 'err');
  } finally {
    setRunning(false);
  }
}

async function onRetryFailed() {
  if (!state.lastResult || !state.lastResult.failed.length) return log('没有可重跑的失败项', 'warn');
  const failedIds = new Set(state.lastResult.failed.map((f) => f.recordId));
  setRunning(true, 'run');
  state.aborted = false;
  state.t0 = Date.now();
  try {
    const cfg = collectCfg();
    const rows = (state.lastRows || []).filter((r) => failedIds.has(r.recordId));
    log(`重跑 ${rows.length} 个失败行…`);
    const deps = makeDeps(cfg);
    const result = await runBatch(deps, {
      rows, columnNames: state.lastColumns, llmConc: cfg.llmConc, skipFilled: false,
      shouldAbort: () => state.aborted,
      onProgress: setProgress,
    });
    state.lastResult = result;
    log(`重跑完成：写回 ${result.written} 格，仍失败 ${result.failed.length} 项`, result.failed.length ? 'warn' : 'ok');
    if (!result.failed.length) $('btnRetry').disabled = true;
  } catch (e) {
    log('重跑失败：' + e.message, 'err');
  } finally {
    setRunning(false);
  }
}

function onCancelClick() {
  if (!state.running) return;
  state.aborted = true;
  showCancelOverlay();
  log('已请求取消，等待在途请求结束…', 'warn');
}

function setRunning(running, mode) {
  state.running = running;
  $('btnTrial').disabled = running;
  $('btnRun').disabled = running || mode === 'trial';
  $('btnCancel').disabled = !running;
  if (!running) $('progressStage').textContent = $('progressStage').textContent;
}

/* ---------- 启动 ---------- */
function bindCfgInputs() {
  $('baseUrl').value = state.cfg.baseUrl || '';
  $('apiKey').value = state.cfg.apiKey || '';
  $('model').value = state.cfg.model || '';
  $('llmConc').value = state.cfg.llmConc || 3;
  $('requirement').value = state.cfg.requirement || '';
  $('marker').value = state.cfg.marker || '【1】';
  $('skipFilled').value = state.cfg.skipFilled ? '1' : '0';
}

async function init() {
  render();
  bindCfgInputs();
  refreshTemplates();
  $('tplSel').onchange = () => {
    const t = (state.cfg.templates || []).find((x) => x.name === $('tplSel').value);
    if (t) {
      $('requirement').value = t.text;
      saveCfg({ requirement: t.text, activeTemplate: t.name });
      state.cfg = loadCfg();
    }
  };
  log(`插件已加载 v${APP_VERSION}`);
  await reloadTable();
}

init();
