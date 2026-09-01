/**
 * UI 装配与事件编排。SDK 为静态 import（Vite 打包，无外部 CDN 请求）。
 */
import { el, fillSelect, showModal, fmtEta } from './ui.js';
import {
  loadCfg, saveCfg, EXPORT_FORMATS,
  exportRequirement, importRequirementFile, getImportAccept,
} from './storage.js';
import { callLLM, verifyModel } from './llm.js';
import { cellToText, SPLIT_MODES } from './parser.js';
import {
  getTableById, loadViewFields, readRecords,
  ensureColumns, writeTextCell, listTables, getActiveTable,
} from './feishu.js';
import { trialRun, runBatch, retryFailed, batchWriteCells } from './runner.js';

export const APP_VERSION = '20260901c';

const state = {
  cfg: loadCfg(),
  table: null,
  viewId: null,
  fields: [],
  sourceFieldId: '',
  aborted: false,
  running: false,
  lastResult: null,
  lastRows: null,
  lastColumns: null,
  t0: 0,
};

const $ = (id) => document.getElementById(id);

/* ---------- 渲染 ---------- */
function render() {
  const app = $('app');
  app.innerHTML = '';
  app.appendChild(el('div', { class: 'topbar' },
    el('div', { class: 'brand' },
      el('div', { class: 'brand-logo' }, 'AI'),
      el('div', { class: 'brand-text' },
        el('b', {}, 'AI 批量填表'),
        el('span', {}, `v${APP_VERSION} · 飞书多维表内容生成`),
      ),
    ),
    el('div', { class: 'topbar-actions' },
      el('button', { class: 'icon-btn', title: '设置', onclick: openSettings }, '⚙'),
    ),
  ));

  // ① 数据源
  app.appendChild(el('div', { class: 'panel', style: '--d:.05s' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-index' }, '1'),
      el('div', { class: 'panel-title' }, '数据源'),
    ),
    el('div', { class: 'field-row' },
      el('div', { class: 'form-field' },
        el('div', { class: 'form-label' }, '源字段（每行该列内容作为素材喂给 AI）'),
        el('select', { id: 'sourceField' }),
      ),
    ),
    el('div', { class: 'field-row' },
      el('button', { class: 'btn', id: 'btnReload', onclick: reloadTable }, '↻ 刷新表 / 字段'),
      el('div', { class: 'hint', id: 'tableInfo', style: 'flex:1' }, '加载中…'),
    ),
  ));

  // ② 总要求
  app.appendChild(el('div', { class: 'panel', style: '--d:.12s' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-index' }, '2'),
      el('div', { class: 'panel-title' }, '总要求'),
      el('div', { class: 'panel-extra' },
        el('select', { id: 'tplSel', style: 'max-width:170px' }),
      ),
    ),
    el('textarea', { id: 'requirement', class: 'textarea-req', placeholder: '粘贴总要求文档（给 AI 的输出约束）。例：\n基于素材撰写产品文案，口语化、每条不超过 30 字、不得出现"首先"等套话；输出 5 个分点，分别覆盖卖点、场景、人群、对比、行动号召。' }),
    el('div', { class: 'toolbar' },
      el('button', { class: 'btn', id: 'btnImport', onclick: onImportClick }, '📥 导入文档'),
      el('select', { id: 'exportFmt', style: 'max-width:200px' },
        ...EXPORT_FORMATS.map((f) => el('option', { value: f.value }, f.label)),
      ),
      el('button', { class: 'btn', id: 'btnExport', onclick: onExportClick }, '📤 导出文档'),
      el('input', { type: 'file', id: 'importFile', accept: getImportAccept(), style: 'display:none' }),
    ),
    el('div', { class: 'hint-block' },
      '导入支持 txt / md / html / doc / docx / xlsx / json 等；导出可选多种格式。总要求即给 AI 的约束，模型按「分列设置」输出分段。',
    ),
  ));

  // ③ 分列设置（从设置弹窗移出，主界面显著展示）
  app.appendChild(el('div', { class: 'panel', style: '--d:.15s' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-index' }, '3'),
      el('div', { class: 'panel-title' }, '分列设置'),
      el('span', { class: 'panel-tag', id: 'splitModeTag' }, '当前：序号标记'),
    ),
    el('div', { class: 'field-row' },
      el('div', { class: 'form-field' },
        el('div', { class: 'form-label' }, '分列方式（决定如何把模型答案切分为多个分点列）'),
        (() => {
          const s = el('select', { id: 'splitMode' },
            ...Object.entries(SPLIT_MODES).map(([k, v]) => el('option', { value: k }, v)),
          );
          s.value = state.cfg.splitMode || 'marker';
          s.onchange = () => { state.cfg = saveCfg({ splitMode: s.value }); refreshSplitUI(); };
          return s;
        })(),
      ),
    ),
    el('div', { id: 'splitConfigArea' }),
    el('div', { class: 'field-row' },
      el('div', { class: 'form-field' },
        el('div', { class: 'form-label' }, '运行范围'),
        (() => {
          const s = el('select', { id: 'skipFilled' },
            el('option', { value: '1' }, '跳过「输出1」已有内容的行'),
            el('option', { value: '0' }, '覆盖全部行'),
          );
          s.value = state.cfg.skipFilled ? '1' : '0';
          s.onchange = () => saveCfg({ skipFilled: s.value === '1' });
          return s;
        })(),
      ),
    ),
    el('div', { class: 'hint-block', id: 'splitHint' }, ''),
  ));

  // ④ 执行
  app.appendChild(el('div', { class: 'panel', style: '--d:.19s' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-index' }, '4'),
      el('div', { class: 'panel-title' }, '执行'),
    ),
    el('div', { class: 'field-row' },
      el('button', { class: 'btn', id: 'btnTrial', onclick: onTrial }, '试跑首行（预览）'),
      el('button', { class: 'btn', id: 'btnRetry', onclick: onRetryFailed, disabled: true }, '重跑失败项'),
      el('button', { class: 'btn btn-danger', id: 'btnCancel', onclick: onCancelClick, disabled: true }, '取消'),
    ),
    el('button', { class: 'btn btn-primary btn-block', id: 'btnRun', onclick: onRun, disabled: true }, '开始批量生成'),
    el('div', { class: 'hint-block' }, '先试跑首行确认分点结构，再批量。新列将自动创建为「多行文本」，默认追加在表尾（飞书暂不支持 API 指定列位置，可手动拖动列序）。'),
    el('div', { class: 'progress-wrap', id: 'progressBox' },
      el('div', { class: 'progress-track' }, el('div', { class: 'progress-bar', id: 'progressBar' })),
      el('div', { class: 'progress-meta' },
        el('span', { id: 'progressStage' }, ''),
        el('span', {}, '进度 ', el('b', { id: 'progressCount' }, '0/0')),
        el('span', { id: 'progressPct' }, '0%'),
        el('span', {}, '剩余 ', el('b', { id: 'progressEta' }, '--:--')),
      ),
    ),
  ));

  // 日志
  app.appendChild(el('div', { class: 'logbox', id: 'logbox', style: '--d:.26s' },
    el('div', { class: 'log-toggle', onclick: toggleLog },
      el('span', { class: 'chev' }, '▸'),
      el('span', {}, '运行日志'),
      el('span', { class: 'v' }, 'v' + APP_VERSION),
    ),
    el('div', { class: 'log-collapsible' },
      el('div', {}, el('div', { id: 'log' })),
    ),
  ));
}

/* ---------- 工具 ---------- */
export function log(msg, cls = '') {
  const box = $('log');
  if (!box) return;
  const d = el('div', { class: 'row' }, el('span', { class: cls }, `[${new Date().toLocaleTimeString()}] ${msg}`));
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  const lb = $('logbox');
  if (lb && !lb.classList.contains('open')) lb.classList.add('open');
}

function toggleLog() {
  const lb = $('logbox');
  if (lb) lb.classList.toggle('open');
}

function collectCfg() {
  state.cfg = saveCfg({ requirement: $('requirement') ? $('requirement').value : state.cfg.requirement });
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
  return showModal('已请求取消', el('div', { class: 'hint' }, '正在等待在途请求结束，已完成的单元格会保留。'), [
    { label: '知道了', primary: true },
  ]);
}

/* ---------- 分列设置 UI ---------- */
function refreshSplitUI() {
  const mode = state.cfg.splitMode || 'marker';
  const tag = $('splitModeTag');
  if (tag) tag.textContent = '当前：' + (SPLIT_MODES[mode] || mode);
  const area = $('splitConfigArea');
  if (!area) return;
  area.innerHTML = '';

  if (mode === 'marker') {
    const s = el('select', { id: 'markerSel' },
      el('option', { value: '【1】' }, '【1】【2】…（推荐）'),
      el('option', { value: '[1]' }, '[1] [2]…'),
      el('option', { value: '1.' }, '1. 2.…'),
      el('option', { value: '一、' }, '一、二、…'),
      el('option', { value: '__custom__' }, '自定义正则…'),
    );
    s.value = state.cfg.marker || '【1】';
    s.onchange = () => {
      const wrap = $('customMarkerWrap');
      if (s.value === '__custom__') {
        if (!wrap) {
          const inp = el('input', { type: 'text', placeholder: '如 §1 §2 或直接写正则（数字用 \\d）', id: 'customMarker' });
          inp.addEventListener('input', () => saveCfg({ marker: inp.value.trim() || '【1】' }));
          area.appendChild(el('div', { class: 'form-field full', id: 'customMarkerWrap', style: 'margin-top:10px' },
            el('div', { class: 'form-label' }, '自定义标记（支持正则，数字用 \\d）'), inp));
        }
      } else {
        saveCfg({ marker: s.value });
        if (wrap) wrap.remove();
      }
    };
    area.appendChild(el('div', { class: 'form-field full' },
      el('div', { class: 'form-label' }, '分列标记样式（模型依此序号标记分段）'), s));
  } else if (mode === 'paragraph') {
    const inp = el('input', { type: 'text', value: state.cfg.sep || '---', placeholder: '段落分隔符，如 ---、***、===' });
    inp.addEventListener('input', () => saveCfg({ sep: inp.value }));
    area.appendChild(el('div', { class: 'form-field full' },
      el('div', { class: 'form-label' }, '段落分隔符（模型输出中用于切分各分点）'),
      el('div', { class: 'field-row' },
        inp,
        el('button', { class: 'btn', onclick: () => { inp.value = '---'; saveCfg({ sep: '---' }); } }, '---'),
        el('button', { class: 'btn', onclick: () => { inp.value = '***'; saveCfg({ sep: '***' }); } }, '***'),
        el('button', { class: 'btn', onclick: () => { inp.value = '==='; saveCfg({ sep: '===' }); } }, '==='),
      ),
    ));
  } else if (mode === 'heading') {
    const s = el('select', { id: 'headingSel' },
      el('option', { value: '#' }, '一级 #'),
      el('option', { value: '##' }, '二级 ##（推荐）'),
      el('option', { value: '###' }, '三级 ###'),
    );
    s.value = state.cfg.headingLevel || '##';
    s.onchange = () => saveCfg({ headingLevel: s.value });
    area.appendChild(el('div', { class: 'form-field full' },
      el('div', { class: 'form-label' }, '标题级别（每段以该级 Markdown 标题开头）'), s));
  } else { // blank
    area.appendChild(el('div', { class: 'hint', style: 'margin-top:4px' },
      '空行分列：模型输出中每个分点之间用「一个空行」分隔，无需额外配置。'));
  }

  const hint = $('splitHint');
  if (hint) {
    const hints = {
      marker: '模型按【1】【2】…序号标记输出，插件依标记切分为多列。',
      paragraph: '模型用你设定的分隔符（如 ---）隔开各分点，插件依分隔符切分。',
      blank: '模型用空行分隔分点，插件按空行切分。',
      heading: '模型用 Markdown 标题（如 ## 卖点）分隔分点，段含标题一并写入。',
    };
    hint.textContent = hints[mode] || '';
  }
}

/* ---------- 设置弹窗（收纳次要配置） ---------- */
function openSettings() {
  const cfg = loadCfg();
  const content = el('div', {});

  // 分组：模型配置
  const gModel = el('div', { class: 'set-group' },
    el('div', { class: 'set-group-title' }, '模型配置（OpenAI 兼容，仅存本浏览器）'),
    el('div', { class: 'set-grid' },
      liveField({ label: 'Base URL', value: cfg.baseUrl, placeholder: 'https://api.deepseek.com', key: 'baseUrl', full: true }),
      liveField({ label: 'API Key', type: 'password', value: cfg.apiKey, placeholder: 'sk-…', key: 'apiKey', full: true }),
      liveField({ label: '模型名', value: cfg.model, placeholder: 'deepseek-chat', key: 'model' }),
      liveField({ label: '并发数（1–8）', value: cfg.llmConc || 3, key: 'llmConc', isNum: true }),
    ),
    el('div', { class: 'field-row', style: 'margin-top:10px' },
      el('button', { class: 'btn', onclick: onVerifyClick }, '验证模型配置'),
    ),
    el('div', { class: 'set-tip' }, '点击「验证」或「完成」会自动用该配置发一次最小请求，校验地址 / 密钥 / 模型是否可用；Key 明文存于浏览器 localStorage，不会上传，勿在公共设备保存。'),
  );

  // 分组：总要求模板（仅存/删；导入导出在主界面总要求面板）
  const gTpl = el('div', { class: 'set-group' },
    el('div', { class: 'set-group-title' }, '总要求模板'),
    el('div', { class: 'field-row' },
      el('button', { class: 'btn', onclick: onSaveTemplate }, '存为模板'),
      el('button', { class: 'btn', onclick: onDeleteTemplate }, '删除当前'),
    ),
    el('div', { class: 'set-tip' }, '模板存于本浏览器，用于快速切换不同总要求；导入 / 导出文档请在主界面「总要求」面板操作。'),
  );

  content.append(gModel, gTpl,
    el('div', { id: 'verifyMsg', class: 'verify-msg', style: 'display:none' }));

  showModal('设置', content, [{ label: '完成', primary: true, onClick: onSettingsDone }]);
}

/** 把输入实时写入 state.cfg（避免弹窗关闭后 DOM 移除导致配置丢失） */
function bindLive(input, key, isNum = false, transform = null) {
  const ev = input.tagName === 'SELECT' ? 'change' : 'input';
  input.addEventListener(ev, () => {
    let v = input.value;
    if (isNum) v = Math.max(1, Math.min(8, Number(v) || 3));
    if (transform) v = transform(v);
    state.cfg = saveCfg({ [key]: v });
  });
}

/** 生成一个带标签、自动实时落盘的表单字段（扁平化，避免深层嵌套） */
function liveField({ label, type = 'text', value = '', placeholder = '', key, isNum = false, transform = null, full = false, options = null }) {
  const control = options
    ? (() => {
        const s = el('select', {}, ...options.map((o) => el('option', { value: o.value }, o.label)));
        s.value = value;
        bindLive(s, key, false, transform);
        return s;
      })()
    : (() => {
        const i = el('input', { type, value: value === '' ? '' : value, placeholder });
        bindLive(i, key, isNum, transform);
        return i;
      })();
  return el('div', { class: 'form-field' + (full ? ' full' : '') },
    el('div', { class: 'form-label' }, label),
    control,
  );
}

/* ---------- 模型配置验证 ---------- */
async function verifyCurrentModel() {
  const cfg = collectCfg();
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    return { ok: false, message: '请先填写 Base URL、API Key、模型名。' };
  }
  log('正在验证模型配置…');
  return verifyModel(cfg, { shouldAbort: () => false });
}

async function onVerifyClick() {
  const res = await verifyCurrentModel();
  showModal(
    res.ok ? '✅ 模型配置有效' : '⚠ 模型配置有问题',
    el('div', { class: res.ok ? '' : 'err-text', style: 'font-size:13px;line-height:1.6' }, res.message),
    [{ label: '知道了', primary: true }],
  );
}

async function onSettingsDone() {
  const res = await verifyCurrentModel();
  const msgEl = $('verifyMsg');
  if (res.ok) {
    log('模型配置校验通过 ✅', 'ok');
    if (msgEl) { msgEl.style.display = 'none'; }
    return true;
  }
  if (msgEl) {
    msgEl.textContent = '⚠ ' + res.message;
    msgEl.className = 'verify-msg err';
    msgEl.style.display = 'block';
  }
  return false; // 留在设置弹窗让用户修改
}

/* ---------- 模板管理 ---------- */
function refreshTemplates() {
  const sel = $('tplSel');
  sel.innerHTML = '';
  sel.appendChild(el('option', { value: '' }, '— 切换模板 —'));
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

/* ---------- 多格式导入导出 ---------- */
function onImportClick() {
  const f = $('importFile');
  if (f) f.click();
}

function downloadBlob(blob, filename) {
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

async function onExportClick() {
  const cfg = collectCfg();
  if (!cfg.requirement.trim()) return log('总要求为空，无可导出内容', 'warn');
  try {
    const fmt = $('exportFmt').value;
    const { blob, filename } = await exportRequirement(fmt, cfg);
    downloadBlob(blob, filename);
    log(`已导出 ${filename}`, 'ok');
  } catch (e) {
    log('导出失败：' + e.message, 'err');
  }
}

async function handleImportFile(file) {
  if (!file) return;
  try {
    const res = await importRequirementFile(file);
    if (res.json) {
      const j = res.json;
      saveCfg({
        templates: j.templates || [],
        requirement: j.requirement || '',
        splitMode: j.splitMode || 'marker',
        marker: j.marker || '【1】',
        sep: j.sep || '---',
        headingLevel: j.headingLevel || '##',
        skipFilled: j.skipFilled !== false,
        activeTemplate: j.activeTemplate || '',
      });
      state.cfg = loadCfg();
      $('requirement').value = state.cfg.requirement;
      refreshTemplates();
      refreshSplitUI();
      log(`已导入配置（含 ${(j.templates || []).length} 套模板）`, 'ok');
    } else {
      $('requirement').value = res.text || '';
      collectCfg();
      log('已从文档导入总要求文本', 'ok');
    }
  } catch (e) {
    log('导入失败：' + e.message, 'err');
  }
}

/* ---------- 表加载（修复：用当前激活表） ---------- */
export async function reloadTable() {
  try {
    const active = await getActiveTable();
    const activeId = active && active.id;
    const tables = await listTables();
    const current = tables.find((t) => t.id === activeId) || tables[0];
    if (!current) throw new Error('未找到数据表');
    state.table = active || await getTableById(current.id);
    const { viewId, fields } = await loadViewFields(state.table);
    state.viewId = viewId;
    state.fields = fields;
    const sel = $('sourceField');
    fillSelect(sel, fields.map((f) => ({ value: f.id, label: f.name + (f.isPrimary ? '（主键）' : '') })), '请选择源字段…');
    $('tableInfo').textContent = `当前表：${current.name} · 字段 ${fields.length} 个${viewId ? ' · 已按当前视图排序' : ''}`;
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
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) return log('请先在右上角 ⚙ 设置中填写模型配置（Base URL / Key / 模型名）', 'err');
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
    wrap.appendChild(el('div', { class: 'err-text' }, '未解析出任何分点，请调整要求中的格式约定或分列设置。'));
    wrap.appendChild(el('pre', { style: 'white-space:pre-wrap;font-size:12px;max-height:160px;overflow:auto;background:#fafbfc;padding:8px;border-radius:6px' }, result.raw.slice(0, 1500)));
    showModal('试跑结果', wrap, [{ label: '关闭', primary: true }]);
    return;
  }
  wrap.appendChild(el('div', { class: 'hint', style: 'margin-bottom:10px' },
    `模型返回 ${n} 个分点（方式=${result.splitMode}）。将创建 ${n} 个「多行文本」列（可改列名）：`));
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
  const m = showModal('首行预览（不写回）', wrap, [
    { label: '取消' },
    {
      label: '确认并开始批量生成', primary: true,
      onClick: async () => {
        const columnNames = nameInputs.map((inp) => inp.value.trim()).filter(Boolean);
        m.close();
        await onRun(columnNames);
        return false;
      },
    },
  ]);
}

/* ---------- 批量执行 ---------- */
function makeDeps(cfg) {
  const splitCfg = {
    splitMode: cfg.splitMode || 'marker',
    marker: cfg.marker || '【1】',
    sep: cfg.sep || '---',
    headingLevel: cfg.headingLevel || '##',
  };
  return {
    requirement: cfg.requirement,
    splitCfg,
    callModel: async (messages, { shouldAbort }) => callLLM(cfg, messages, {
      shouldAbort,
      onRetry: (attempt, err, delay) => log(`模型请求第 ${attempt} 次重试（${err.message.slice(0, 80)}），${(delay / 1000).toFixed(0)}s 后…`, 'warn'),
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
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) return log('请先在右上角 ⚙ 设置中填写模型配置', 'err');
  setRunning(true, 'run');
  state.aborted = false;
  state.t0 = Date.now();
  $('progressBox').classList.add('show');
  let columns = presetColumns;
  try {
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
  const req = $('requirement');
  req.value = state.cfg.requirement || '';
  req.addEventListener('change', () => saveCfg({ requirement: req.value }));
  const imp = $('importFile');
  imp.addEventListener('change', () => { handleImportFile(imp.files[0]); imp.value = ''; });
}

async function init() {
  render();
  bindCfgInputs();
  refreshTemplates();
  refreshSplitUI();
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
