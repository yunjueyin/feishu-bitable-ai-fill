/**
 * UI 装配与事件编排。SDK 为静态 import（Vite 打包，无外部 CDN 请求）。
 */
import { el, fillSelect, showModal, fmtEta } from './ui.js';
import {
  loadCfg, saveCfg, EXPORT_FORMATS,
  exportRequirement, importRequirementFile, getImportAccept,
  PROVIDERS, getProvider,
} from './storage.js';
import { callLLM, verifyModel } from './llm.js';
import { cellToText, SPLIT_MODES } from './parser.js';
import {
  getTableById, loadViewFields, readRecords, describeErr,
  ensureColumns, writeTextCell, listTables, getActiveTable,
} from './feishu.js';
import { trialRun, runBatch, retryFailed, batchWriteCells } from './runner.js';

export const APP_VERSION = '20260902c';

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

/* ---------- 线性图标（Feishu 风格，替换 emoji） ---------- */
const ICONS = {
  sparkle: '<path d="M12 2l2.4 6.4L21 11l-6.6 2.6L12 20l-2.4-6.4L3 11l6.6-2.6z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
  refresh: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
  upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>',
  play: '<path d="M6 4l14 8-14 8V4z"/>',
  retry: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
};
function iconSvg(name, size = 16) {
  const span = el('span', { class: 'ic' });
  span.style.width = size + 'px';
  span.style.height = size + 'px';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}
const SHORT_SPLIT = { marker: '序号标记', paragraph: '分段符', blank: '换行符', heading: '标题符' };

/* ---------- 渲染 ---------- */
function render() {
  const app = $('app');
  app.innerHTML = '';

  // 顶栏
  app.appendChild(el('div', { class: 'topbar' },
    el('div', { class: 'brand' },
      el('div', { class: 'brand-logo' }, iconSvg('sparkle', 18)),
      el('div', { class: 'brand-text' },
        el('b', {}, 'AI 批量填表'),
        el('span', {}, '飞书多维表内容生成'),
      ),
    ),
    el('div', { class: 'topbar-actions' },
      el('button', { class: 'icon-btn', title: '设置', onclick: openSettings }, iconSvg('gear', 18)),
    ),
  ));

  // ① 数据源
  app.appendChild(el('div', { class: 'panel', style: '--d:.05s' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-title' }, '数据源'),
      el('div', { class: 'panel-extra' },
        el('button', { class: 'icon-btn', id: 'btnReload', title: '刷新表 / 字段', onclick: reloadTable }, iconSvg('refresh', 16)),
      ),
    ),
    el('div', { class: 'seg-control' },
      el('select', { id: 'sourceField', class: 'grow' }),
    ),
    el('div', { class: 'hint', id: 'tableInfo', style: 'margin-top:8px' }, '加载中…'),
  ));

  // ② 总要求
  app.appendChild(el('div', { class: 'panel', style: '--d:.12s' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-title' }, '总要求'),
      el('div', { class: 'panel-extra' },
        el('select', { id: 'tplSel', class: 'mini' }),
        el('button', { class: 'icon-btn', id: 'btnImport', title: '导入文档', onclick: onImportClick }, iconSvg('upload', 16)),
        el('select', { id: 'exportFmt', class: 'mini', title: '导出格式' },
          ...EXPORT_FORMATS.map((f) => el('option', { value: f.value }, f.label))),
        el('button', { class: 'icon-btn', id: 'btnExport', title: '导出文档', onclick: onExportClick }, iconSvg('download', 16)),
        el('input', { type: 'file', id: 'importFile', accept: getImportAccept(), style: 'display:none' }),
      ),
    ),
    el('textarea', { id: 'requirement', class: 'textarea-req', placeholder: '粘贴总要求文档（给 AI 的输出约束）。例如：基于素材写产品文案，口语化、每条不超过 30 字、不出现"首先"等套话；输出 5 个分点，覆盖卖点、场景、人群、对比、行动号召。' }),
  ));

  // ③ 执行
  app.appendChild(el('div', { class: 'panel', style: '--d:.18s' },
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-title' }, '执行'),
      el('span', { class: 'panel-tag', id: 'splitModeTag' }, ''),
    ),
    el('div', { class: 'btn-group' },
      el('button', { class: 'btn', id: 'btnTrial', onclick: onTrial }, '试跑预览'),
      el('button', { class: 'btn', id: 'btnRetry', onclick: onRetryFailed, disabled: true }, '重跑失败'),
      el('button', { class: 'btn btn-danger', id: 'btnCancel', onclick: onCancelClick, disabled: true }, '取消'),
    ),
    el('button', { class: 'btn btn-primary btn-block', id: 'btnRun', onclick: () => onRun(), disabled: true }, '开始批量生成'),
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
      el('span', { class: 'chev' }, iconSvg('chevron', 14)),
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
  const stageMap = {
    init: '准备中', trial: '试跑中', build_columns: '建列中', generate: '生成中', write: '写回中', done: '已完成',
  };
  $('progressStage').textContent = stageMap[phase] || (phase === 'write' ? '写回中' : '生成中');
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

/** 严重错误：弹窗提示，避免只在日志/底部提示用户看不到 */
function showError(title, message) {
  return showModal(title || '出错了', el('div', { class: 'err-text', style: 'font-size:13px;line-height:1.6;white-space:pre-wrap' }, message), [
    { label: '知道了', primary: true },
  ]);
}

/* ---------- 分列设置 UI ---------- */
function refreshSplitUI() {
  const mode = state.cfg.splitMode || 'marker';
  const tag = $('splitModeTag');
  if (tag) tag.textContent = '分列 · ' + (SHORT_SPLIT[mode] || mode);
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

/* ---------- 输出列模板 ---------- */
function getOutputColumns() {
  return Array.isArray(state.cfg.outputColumns) ? state.cfg.outputColumns : [];
}

function addOutputColumn() {
  const cols = getOutputColumns();
  cols.push({ name: `输出${cols.length + 1}`, example: '' });
  state.cfg = saveCfg({ outputColumns: cols });
  renderOutputColumns();
}

function removeOutputColumn(index) {
  const cols = getOutputColumns();
  if (index >= 0 && index < cols.length) {
    cols.splice(index, 1);
    state.cfg = saveCfg({ outputColumns: cols });
  }
  renderOutputColumns();
}

function updateOutputColumn(index, key, value) {
  const cols = getOutputColumns();
  if (index >= 0 && index < cols.length) {
    cols[index] = { ...cols[index], [key]: value };
    state.cfg = saveCfg({ outputColumns: cols });
  }
}

function clearOutputColumns() {
  if (confirm('确定清空所有输出列模板？清空后批量生成将按首次试跑结果自动建列。')) {
    state.cfg = saveCfg({ outputColumns: [] });
    renderOutputColumns();
  }
}

function renderOutputColumns() {
  const list = $('outputColList');
  if (!list) return;
  list.innerHTML = '';
  const cols = getOutputColumns();
  const tag = $('outputColTag');
  if (tag) tag.textContent = cols.length ? `已定义 ${cols.length} 列` : '未定义';
  if (!cols.length) {
    list.appendChild(el('div', { class: 'hint', style: 'margin:8px 0' }, '暂无模板，点击「+ 添加列」定义输出列名和参考案例。'));
    return;
  }
  const grid = el('div', { class: 'output-col-grid' });
  cols.forEach((col, i) => {
    const nameInp = el('input', { type: 'text', value: col.name || '', placeholder: `输出${i + 1}` });
    nameInp.addEventListener('input', () => updateOutputColumn(i, 'name', nameInp.value));
    const exInp = el('input', { type: 'text', value: col.example || '', placeholder: '该列的参考案例（可选）' });
    exInp.addEventListener('input', () => updateOutputColumn(i, 'example', exInp.value));
    grid.appendChild(el('div', { class: 'output-col-row' },
      el('span', { class: 'output-col-index' }, `${i + 1}`),
      el('div', { class: 'form-field' }, el('div', { class: 'form-label' }, '列名'), nameInp),
      el('div', { class: 'form-field' }, el('div', { class: 'form-label' }, '参考案例（可选）'), exInp),
      el('button', { class: 'btn btn-danger btn-sm', onclick: () => removeOutputColumn(i), title: '删除列' }, iconSvg('trash', 14)),
    ));
  });
  list.appendChild(grid);
}

/* ---------- 设置弹窗（收纳次要配置） ---------- */
function openSettings() {
  const cfg = loadCfg();
  const content = el('div', {});

  // 分组：模型配置（服务商 → 模型 → API Key）
  const p = getProvider(cfg.provider);
  const gModel = el('div', { class: 'set-group' },
    el('div', { class: 'set-group-title' }, iconSvg('gear', 15), '模型配置'),
    el('div', { class: 'set-grid' },
      // 服务商
      (() => {
        const s = el('select', { id: 'setProvider' },
          ...PROVIDERS.map((pr) => el('option', { value: pr.id }, pr.name)));
        s.value = p.id;
        s.addEventListener('change', () => {
          const np = getProvider(s.value);
          const patch = { provider: np.id };
          if (np.fixedBaseUrl) { patch.baseUrl = np.baseUrl; patch.model = np.defaultModel; }
          saveCfg(patch);
          openSettings(); // 服务商切换后重渲染，刷新模型下拉与 Base URL 显示
        });
        return el('div', { class: 'form-field full' },
          el('div', { class: 'form-label' }, '服务商'), s);
      })(),
      // Base URL：固定服务商只读显示，自定义才允许填写
      p.fixedBaseUrl
        ? el('div', { class: 'form-field full' },
            el('div', { class: 'form-label' }, 'Base URL（由服务商固定）'),
            el('input', { type: 'text', id: 'setBaseUrl', value: p.baseUrl, disabled: true, style: 'background:#f5f6f8;color:var(--muted)' }))
        : liveField({ label: 'Base URL', value: cfg.baseUrl, placeholder: 'https://api.deepseek.com', key: 'baseUrl', full: true, id: 'setBaseUrl' }),
      // 模型：预设服务商用下拉，自定义自由输入
      (p.models && p.models.length)
        ? (() => {
            const cur = cfg.model && p.models.some((m) => m.value === cfg.model) ? cfg.model : p.models[0].value;
            const s = el('select', { id: 'setModel' }, ...p.models.map((m) => el('option', { value: m.value }, m.label)));
            s.value = cur;
            bindLive(s, 'model');
            return el('div', { class: 'form-field full' },
              el('div', { class: 'form-label' }, '模型（默认 2.5 Flash）'), s);
          })()
        : liveField({ label: '模型名', value: cfg.model, placeholder: 'deepseek-chat', key: 'model', full: true, id: 'setModel' }),
      // API Key
      liveField({ label: 'API Key', type: 'password', value: cfg.apiKey, placeholder: 'sk-…', key: 'apiKey', full: true, id: 'setApiKey' }),
      // 并发：Agnes 等带 rateLimit 的服务商固定为保守值，不让用户手动设置
      p.rateLimit
        ? el('div', { class: 'form-field full' },
            el('div', { class: 'form-label' }, '并发与限流（由服务商自动配置）'),
            el('input', {
              type: 'text', disabled: true,
              value: `并发 ${p.rateLimit.maxConc}，请求间隔 ≥ ${p.rateLimit.minIntervalMs}ms（避免触发限流）`,
              style: 'background:#f5f6f8;color:var(--muted)',
            }))
        : liveField({ label: '并发数（1–8）', value: cfg.llmConc || 3, key: 'llmConc', isNum: true, id: 'setConc' }),
    ),
    el('div', { class: 'field-row', style: 'margin-top:10px' },
      el('button', { class: 'btn', onclick: onVerifyClick }, '验证模型配置'),
    ),
    el('div', { class: 'set-tip' },
      p.tip || (p.fixedBaseUrl ? `已选「${p.name}」：填好 API Key 即可使用。` : '填好服务商信息即可，Key 仅存本浏览器、不会上传。')),
  );

  // 分组：分列设置（迁入设置，主界面只留摘要标签）
  const gSplit = el('div', { class: 'set-group' },
    el('div', { class: 'set-group-title' }, iconSvg('sparkle', 15), '分列设置'),
    el('div', { class: 'form-field full' },
      el('div', { class: 'form-label' }, '分列方式'),
      (() => {
        const s = el('select', { id: 'splitMode' },
          ...Object.entries(SPLIT_MODES).map(([k, v]) => el('option', { value: k }, v)));
        s.value = state.cfg.splitMode || 'marker';
        s.onchange = () => { state.cfg = saveCfg({ splitMode: s.value }); refreshSplitUI(); };
        return s;
      })(),
    ),
    el('div', { id: 'splitConfigArea' }),
    el('div', { class: 'form-field full' },
      el('div', { class: 'form-label' }, '运行范围'),
      (() => {
        const s = el('select', { id: 'skipFilled' },
          el('option', { value: '1' }, '跳过已填满的行（部分填充的行只补空列）'),
          el('option', { value: '0' }, '覆盖全部行'),
        );
        s.value = state.cfg.skipFilled ? '1' : '0';
        s.onchange = () => saveCfg({ skipFilled: s.value === '1' });
        return s;
      })(),
    ),
    el('div', { class: 'set-tip', id: 'splitHint' }, ''),
  );

  // 分组：输出列模板（迁入设置）
  const gOutput = el('div', { class: 'set-group' },
    el('div', { class: 'set-group-title' }, iconSvg('plus', 15), '输出列模板'),
    el('div', { id: 'outputColList' }),
    el('div', { class: 'field-row', style: 'margin-top:8px' },
      el('button', { class: 'btn', id: 'btnAddOutputCol', onclick: addOutputColumn }, '添加列'),
      el('button', { class: 'btn', onclick: clearOutputColumns }, '清空'),
    ),
    el('div', { class: 'set-tip' }, '定义列名与参考案例，AI 按此生成；留空则按试跑结果自动建列。'),
  );

  // 分组：总要求模板（仅存/删；导入导出在主界面总要求面板）
  const gTpl = el('div', { class: 'set-group' },
    el('div', { class: 'set-group-title' }, '总要求模板'),
    el('div', { class: 'field-row' },
      el('button', { class: 'btn', onclick: onSaveTemplate }, '存为模板'),
      el('button', { class: 'btn', onclick: onDeleteTemplate }, '删除当前'),
    ),
    el('div', { class: 'set-tip' }, '模板用于快速切换不同总要求；导入 / 导出在「总要求」面板。'),
  );

  content.append(gModel, gSplit, gOutput, gTpl);
  refreshSplitUI();
  renderOutputColumns();

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
function liveField({ label, type = 'text', value = '', placeholder = '', key, isNum = false, transform = null, full = false, options = null, id = null }) {
  const control = options
    ? (() => {
        const s = el('select', id ? { id } : {}, ...options.map((o) => el('option', { value: o.value }, o.label)));
        s.value = value;
        bindLive(s, key, false, transform);
        return s;
      })()
    : (() => {
        const attrs = { type, value: value === '' ? '' : value, placeholder };
        if (id) attrs.id = id;
        const i = el('input', attrs);
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
  // 直接从 DOM 读取（兼容密码管理器自动填充、避免 bindLive 事件未触发）
  const providerId = $('setProvider') ? $('setProvider').value : state.cfg.provider;
  const provider = getProvider(providerId);

  const domBase = $('setBaseUrl');
  const domKey = $('setApiKey');
  const domModel = $('setModel');

  const baseUrl = provider.fixedBaseUrl
    ? provider.baseUrl
    : ((domBase ? domBase.value : state.cfg.baseUrl) || '').trim();
  const apiKey = (domKey ? domKey.value : state.cfg.apiKey || '').trim();
  const model = (domModel ? domModel.value : state.cfg.model || '').trim();

  // 把当前读到的值持久化（尤其密码管理器填充未触发 input 时）
  state.cfg = saveCfg({ provider: providerId, baseUrl, apiKey, model });

  if (!apiKey) return { ok: false, message: '请填写 API Key。' };
  if (!model) return { ok: false, message: provider.models.length ? '请选择模型。' : '请填写模型名。' };
  if (!provider.fixedBaseUrl && !baseUrl) return { ok: false, message: '请填写 Base URL。' };

  log('正在验证模型配置…');
  return verifyModel({ ...state.cfg, baseUrl, apiKey, model }, { shouldAbort: () => false });
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
  if (res.ok) {
    log('模型配置校验通过 ✅', 'ok');
    return true;
  }
  showError('⚠ 模型配置有问题', res.message);
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
        outputColumns: Array.isArray(j.outputColumns) ? j.outputColumns : [],
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
    $('tableInfo').textContent = '加载失败：' + describeErr(e);
    showError('表加载失败', describeErr(e));
  }
}

/* ---------- 读取行数据 ---------- */
async function loadRows(columnNames = []) {
  const records = await readRecords(state.table, state.viewId);
  if (!Array.isArray(records)) throw new Error(`读取记录返回非数组：${typeof records}`);
  if (!Array.isArray(state.fields)) throw new Error('字段列表异常，请重新点击「刷新表/字段」');
  // 兜底防御：columnNames 非数组时降级为空数组并 log warn，
  // 而不是 throw "输出列名不是数组" 让批量弹窗直接失败。
  // （已在 onRun 中校验调用方传入的是数组；此处再做一层防意外。）
  if (!Array.isArray(columnNames)) {
    log(`loadRows 收到非数组 columnNames（${typeof columnNames}），降级为空数组`, 'warn');
    columnNames = [];
  }
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

/** 校验并返回可用于调用的有效模型配置；缺配置时弹窗并返回 null */
function ensureModelConfig() {
  const cfg = collectCfg();
  const provider = getProvider(cfg.provider);
  const effectiveBaseUrl = provider.fixedBaseUrl ? provider.baseUrl : cfg.baseUrl;
  if (!effectiveBaseUrl || !cfg.apiKey || !cfg.model) {
    const missing = [];
    if (!effectiveBaseUrl && !provider.fixedBaseUrl) missing.push('Base URL');
    if (!cfg.apiKey) missing.push('API Key');
    if (!cfg.model) missing.push(provider.models.length ? '模型' : '模型名');
    showError('缺少模型配置', missing.length ? `请先在右上角「设置」中填写：${missing.join('、')}。` : '模型配置不完整，请检查设置。');
    return null;
  }
  return { ...cfg, baseUrl: effectiveBaseUrl };
}

/* ---------- 试跑 ---------- */
async function onTrial() {
  if (!state.sourceFieldId) {
    showError('缺少数据源', '请先选择「源字段」（每行素材所在列）。');
    return;
  }
  if (!state.table) {
    showError('数据表未加载', '请先在「数据源」面板点击「刷新表/字段」。');
    return;
  }
  const cfg = ensureModelConfig();
  if (!cfg) return;
  if (!cfg.requirement.trim()) {
    showError('总要求为空', '请在「总要求」面板输入给 AI 的输出约束。');
    return;
  }
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
    showError('试跑失败', describeErr(e));
  } finally {
    setRunning(false);
  }
}

/**
 * 批量前的试跑确认弹窗（无输出列模板时）：
 * 展示将创建的列数、每列名与每列内容，用户确认后才继续批量。
 * @returns {Promise<boolean>} true=确认继续；false=取消中止
 */
function confirmColumnsBeforeRun(result, firstRow, columns) {
  return new Promise((resolve) => {
    const wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'hint', style: 'margin-bottom:10px' },
      `试跑解析出 ${result.segments.length} 个分点（方式=${result.splitMode}）→ 将创建 ${columns.length} 个「多行文本」列。请确认每列内容是否符合预期，确认后开始批量生成。`));
    columns.forEach((colName, i) => {
      wrap.appendChild(el('div', { class: 'seg-item' },
        el('div', { class: 'seg-head' }, el('span', { class: 'badge' }, colName || `输出${i + 1}`)),
        el('pre', {}, result.segments[i] || '（空）'),
      ));
    });
    wrap.appendChild(el('div', { class: 'hint', style: 'margin-top:10px' },
      `素材预览：${firstRow.text.slice(0, 100)}…（列数或内容不对？点「取消」去调整总要求/分列方式，或改用「输出列模板」固定列。）`));
    showModal('确认输出列（试跑首行结果）', wrap, [
      { label: '取消，我去调整', onClick: () => resolve(false) },
      { label: `确认 ${columns.length} 列，开始批量`, primary: true, onClick: () => resolve(true) },
    ]);
  });
}

function showPreview(result, firstRow) {  const explicitCols = Array.isArray(state.cfg.outputColumns)
    ? state.cfg.outputColumns.filter((c) => String(c.name || '').trim())
    : [];
  // 有模板时严格按模板列数/名称展示；无模板时按解析出的分点数
  const displayNames = explicitCols.length
    ? explicitCols.map((c) => c.name)
    : result.segments.map((_, i) => `输出${i + 1}`);
  const n = displayNames.length;
  const wrap = el('div', {});
  if (n === 0) {
    wrap.appendChild(el('div', { class: 'err-text' }, '未解析出任何分点，请调整总要求、分列方式，或在「输出列模板」中定义输出列。'));
    wrap.appendChild(el('pre', { style: 'white-space:pre-wrap;font-size:12px;max-height:160px;overflow:auto;background:#fafbfc;padding:8px;border-radius:6px' }, result.raw.slice(0, 1500)));
    showModal('试跑结果', wrap, [{ label: '关闭', primary: true }]);
    return;
  }
  wrap.appendChild(el('div', { class: 'hint', style: 'margin-bottom:10px' },
    explicitCols.length
      ? `已启用「输出列模板」共 ${n} 列。模型返回 ${result.segments.length} 个分点（方式=${result.splitMode}），将按模板列名写回。`
      : `模型返回 ${result.segments.length} 个分点（方式=${result.splitMode}）。将创建 ${n} 个「多行文本」列：`));
  for (let i = 0; i < n; i++) {
    wrap.appendChild(el('div', { class: 'seg-item' },
      el('div', { class: 'seg-head' }, el('span', { class: 'badge' }, displayNames[i] || `分点 ${i + 1}`)),
      el('pre', {}, result.segments[i] || '（空）'),
    ));
  }
  wrap.appendChild(el('div', { class: 'hint', style: 'margin-top:10px' },
    `素材预览：${firstRow.text.slice(0, 100)}…（本窗口仅预览，关闭后请点击主界面「开始批量生成」）`));
  showModal('首行预览（不写回）', wrap, [{ label: '关闭', primary: true }]);
}

/* ---------- 批量执行 ---------- */
/** 根据服务商限流策略计算有效并发（ Agnes 等固定服务商不开放给用户手动设置并发） */
function getEffectiveConc(cfg) {
  const provider = getProvider(cfg.provider);
  if (provider.rateLimit && typeof provider.rateLimit.maxConc === 'number') {
    return Math.min(Math.max(1, cfg.llmConc || 1), provider.rateLimit.maxConc);
  }
  return Math.max(1, Math.min(8, cfg.llmConc || 3));
}

function makeDeps(cfg) {
  const splitCfg = {
    splitMode: cfg.splitMode || 'marker',
    marker: cfg.marker || '【1】',
    sep: cfg.sep || '---',
    headingLevel: cfg.headingLevel || '##',
  };
  const outputColumns = Array.isArray(cfg.outputColumns) ? cfg.outputColumns.filter((c) => String(c.name || '').trim()) : [];
  const provider = getProvider(cfg.provider);
  const rateLimit = provider.rateLimit;
  return {
    requirement: cfg.requirement,
    splitCfg,
    outputColumns,
    minIntervalMs: rateLimit ? rateLimit.minIntervalMs : 0,
    callModel: async (messages, { shouldAbort }) => {
      const t0 = Date.now();
      try {
        const r = await callLLM(cfg, messages, {
          shouldAbort,
          onRetry: (attempt, err, delay) => log(`模型请求第 ${attempt} 次重试（${String(err.message || err).slice(0, 80)}），${(delay / 1000).toFixed(0)}s 后…`, 'warn'),
        });
        return r;
      } catch (e) {
        // 失败时带耗时落日志：卡进度时用户可直接看到具体错误与耗时
        log(`模型调用失败（${((Date.now() - t0) / 1000).toFixed(1)}s）：${String(e && e.message || e).slice(0, 160)}`, 'err');
        throw e;
      }
    },
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
  // 防御：若被当作事件处理器直接 addEventListener（onclick: onRun），
  // 浏览器会注入 Event 对象作为第一参数；Event 对象是 truthy 且非数组，
  // 会导致下面 `if (!columns)` 误判并跳过 columns 计算，进而让 loadRows 报错。
  if (presetColumns != null && !Array.isArray(presetColumns)) presetColumns = null;
  if (!state.sourceFieldId) {
    showError('缺少数据源', '请先选择「源字段」（每行素材所在列）。');
    return;
  }
  if (!state.table) {
    showError('数据表未加载', '请先在「数据源」面板点击「刷新表/字段」。');
    return;
  }
  const cfg = ensureModelConfig();
  if (!cfg) return;
  setRunning(true, 'run');
  state.aborted = false;
  state.t0 = Date.now();
  $('progressBox').classList.add('show');
  let columns = presetColumns;
  try {
    const explicitCols = Array.isArray(cfg.outputColumns)
      ? cfg.outputColumns.filter((c) => String(c.name || '').trim())
      : [];
    if (!columns) {
      if (explicitCols.length) {
        columns = explicitCols.map((c) => c.name);
        log(`使用「输出列模板」共 ${columns.length} 列：[${columns.join(', ')}]`);
      } else {
        const rows0 = await loadRows([]);
        const first = rows0.find((r) => r.text.trim());
        if (!first) throw new Error('源字段没有非空内容');
        // 未填模板：需先试跑首行确定输出列数（仅 1 次 AI 调用），显式提示"试跑中"
        setProgress(0, 1, 'trial');
        log('未配置输出列模板：先试跑首行以确定输出列数…');
        const trialDeps = makeDeps(cfg);
        const tTrial = Date.now();
        const tr = await trialRun(trialDeps, first.text);
        log(`试跑首行完成（${((Date.now() - tTrial) / 1000).toFixed(1)}s），解析出 ${tr.segments.length} 个分点`);
        if (!tr.segments.length) throw new Error('首行解析出 0 个分点，请先调整要求（试跑预览可查看模型原始输出）');
        columns = tr.segments.map((_, i) => `输出${i + 1}`);
        // 【确认门】试跑结果弹窗：用户确认列数与每列输出后才继续批量；取消则中止
        const ok = await confirmColumnsBeforeRun(tr, first, columns);
        if (!ok) {
          log('已取消：在试跑确认弹窗中止批量（列数/内容未确认）', 'warn');
          setRunning(false);
          return;
        }
        log(`已确认 ${columns.length} 列：[${columns.join(', ')}]`);
      }
    }
    state.lastColumns = columns;
    const rows = await loadRows(columns);
    state.lastRows = rows;
    const effConc = getEffectiveConc(cfg);
    log(`开始批量：共 ${rows.length} 行，输出列 [${columns.join(', ')}]，并发 ${effConc}${cfg.skipFilled ? '，跳过已填满的行' : ''}`);
    // 立刻初始化进度条（避免一直停在 HTML 默认的 0/0）。runBatch 内会按阶段更新。
    setProgress(0, rows.length, 'init');
    const deps = makeDeps(cfg);
    const result = await runBatch(deps, {
      rows, columnNames: columns, llmConc: effConc, skipFilled: cfg.skipFilled,
      shouldAbort: () => state.aborted,
      onProgress: setProgress,
    });
    state.lastResult = result;
    if (result.aborted) {
      log('已取消：生成/写回中止，已完成内容保留', 'warn');
    } else {
      log(`完成：写回 ${result.written} 格，跳过 ${result.skipped} 行，失败 ${result.failed.length} 项，分点超列截断 ${result.truncated} 行，不足留空 ${result.lessFilled} 行`, result.skipped && !result.written ? 'warn' : 'ok');
    }
    // 全部行被「跳过已有内容」跳过：醒目弹窗说明原因与解决方法（而非静默"完成"让用户困惑）
    if (!result.aborted && !result.fatal && result.skipped > 0 && result.skipped === rows.length) {
      showError('所有行都被跳过了', `共 ${rows.length} 行全部因「跳过已填满的行」被跳过——这些行的所有输出列都已有内容（通常是之前生成过的残留）。\n\n如需重新生成，二选一：\n① 在「分列设置 → 运行范围」改为「覆盖全部行」；\n② 或先清空这些行的输出列内容再跑（只清空部分列的话，会只补空列）。`);
    }
    if (result.fatal) showError('建列失败', result.fatal);
    if (result.failed.length) {
      $('btnRetry').disabled = false;
      log('失败明细（前 20 条）：\n' + result.failed.slice(0, 20).map((f) => `  行 ${f.recordId}: ${f.error}`).join('\n'), 'err');
    }
  } catch (e) {
    showError('批量执行失败', describeErr(e));
  } finally {
    setRunning(false);
  }
}

async function onRetryFailed() {
  if (!state.lastResult || !state.lastResult.failed.length) {
    showError('没有可重跑的失败项', '当前没有失败的行，无需重跑。');
    return;
  }
  const cfg = ensureModelConfig();
  if (!cfg) return;
  const failedIds = new Set(state.lastResult.failed.map((f) => f.recordId));
  setRunning(true, 'run');
  state.aborted = false;
  state.t0 = Date.now();
  try {
    const rows = (state.lastRows || []).filter((r) => failedIds.has(r.recordId));
    log(`重跑 ${rows.length} 个失败行…`);
    const deps = makeDeps(cfg);
    const result = await runBatch(deps, {
      rows, columnNames: state.lastColumns, llmConc: getEffectiveConc(cfg), skipFilled: false,
      shouldAbort: () => state.aborted,
      onProgress: setProgress,
    });
    state.lastResult = result;
    log(`重跑完成：写回 ${result.written} 格，仍失败 ${result.failed.length} 项`, result.failed.length ? 'warn' : 'ok');
    if (!result.failed.length) $('btnRetry').disabled = true;
  } catch (e) {
    showError('重跑失败', describeErr(e));
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
/**
 * 把粘贴进来的 HTML 转成 Markdown，尽量保留标题等级和背景高亮。
 * 背景色等无法直接用 Markdown 表达，保留为带 style 的 inline HTML。
 */
function htmlToMarkdown(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html.replace(/<br\s*\/?>/gi, '\n');
  // 先把背景色 span 做占位保护（避免被后续规则误处理）
  tmp.querySelectorAll('span[style*="background"], span[style*="background-color"]').forEach((n) => {
    const style = n.getAttribute('style') || '';
    const m = style.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    const color = m ? m[1].trim() : '';
    if (color) {
      const wrap = document.createElement('span');
      wrap.textContent = `<span style="background-color:${color}">${n.textContent}</span>`;
      n.replaceWith(wrap);
    }
  });
  function walk(node) {
    let md = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        md += c.textContent;
      } else if (c.nodeType === 1) {
        const tag = c.tagName.toLowerCase();
        const inner = walk(c);
        if (/^h([1-6])$/.test(tag)) {
          const lv = tag[1];
          md += '\n' + '#'.repeat(Number(lv)) + ' ' + inner.trim() + '\n';
        } else if (tag === 'p') {
          md += '\n' + inner.trim() + '\n';
        } else if (tag === 'div') {
          md += '\n' + inner.trim() + '\n';
        } else if (tag === 'b' || tag === 'strong') {
          md += `**${inner.trim()}**`;
        } else if (tag === 'i' || tag === 'em') {
          md += `*${inner.trim()}*`;
        } else if (tag === 'u') {
          md += `<u>${inner.trim()}</u>`;
        } else if (tag === 's' || tag === 'strike' || tag === 'del') {
          md += `~~${inner.trim()}~~`;
        } else if (tag === 'li') {
          md += inner.trim();
        } else if (tag === 'ul') {
          md += '\n' + Array.from(c.children).map((li) => '- ' + walk(li).trim()).join('\n') + '\n';
        } else if (tag === 'ol') {
          md += '\n' + Array.from(c.children).map((li, i) => `${i + 1}. ` + walk(li).trim()).join('\n') + '\n';
        } else if (tag === 'pre') {
          md += '\n```\n' + inner.trim() + '\n```\n';
        } else if (tag === 'code') {
          md += '`' + inner.trim() + '`';
        } else if (tag === 'a' && c.getAttribute('href')) {
          md += `[${inner.trim()}](${c.getAttribute('href')})`;
        } else {
          md += inner;
        }
      }
    }
    return md;
  }
  return walk(tmp).replace(/\n{3,}/g, '\n\n').trim();
}

function bindCfgInputs() {
  const req = $('requirement');
  req.value = state.cfg.requirement || '';
  req.addEventListener('change', () => saveCfg({ requirement: req.value }));
  // 粘贴时保留标题等级/背景色（转换为 Markdown + inline HTML）
  req.addEventListener('paste', (e) => {
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    if (!html) return; // 无 HTML 时走默认纯文本粘贴
    e.preventDefault();
    const md = htmlToMarkdown(html);
    const start = req.selectionStart || 0;
    const end = req.selectionEnd || 0;
    const before = req.value.slice(0, start);
    const after = req.value.slice(end);
    req.value = before + md + after;
    saveCfg({ requirement: req.value });
  });
  const imp = $('importFile');
  imp.addEventListener('change', () => { handleImportFile(imp.files[0]); imp.value = ''; });
}

async function init() {
  render();
  bindCfgInputs();
  refreshTemplates();
  refreshSplitUI();
  renderOutputColumns();
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
