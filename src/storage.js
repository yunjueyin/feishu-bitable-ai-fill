/**
 * 配置与「总要求模板」持久化（localStorage，带版本校验）。
 * Key 明文存浏览器 localStorage（纯静态站无后端，用户已知情接受）。
 * 导入导出支持多种文档格式（txt/md/html/doc/docx/xlsx/json），重库动态 import。
 */

export const CFG_KEY = 'feishu_ai_fill_cfg_v1';
export const CFG_VERSION = 1;

/**
 * 服务商预设。用户只需「选服务商 → 选模型 → 填 API Key」。
 * 固定 Base URL 的服务商（fixedBaseUrl=true）会锁定 Base URL，用户不必填写。
 * 数据均来自官方文档：https://agnes-ai.cn/zh-Hans/docs/agnes-25-flash 、 /agnes-25-pro
 */
export const PROVIDERS = [
  {
    id: 'agnes',
    name: 'Agnes AI（agnes-ai.cn）',
    baseUrl: 'https://api.agnes-ai.cn/v1',
    fixedBaseUrl: true,
    docUrl: 'https://agnes-ai.cn/zh-Hans/docs/agnes-25-flash',
    models: [
      { value: 'agnes-2.5-flash', label: '2.5 Flash（默认 · 快速高性价比 · 512K）' },
      { value: 'agnes-2.5-pro', label: '2.5 Pro（强推理 · 付费 · 1M）' },
    ],
    defaultModel: 'agnes-2.5-flash',
    // 官方限流：免费/默认用户文本模型 Allowed RPM 30 / Effective RPM 20。
    // 保守起见：并发固定 1，请求间隔 ≥ 3.5 秒，确保不触发限流。
    rateLimit: { maxConc: 1, minIntervalMs: 3500 },
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    fixedBaseUrl: false,
    models: [],
    defaultModel: '',
  },
];
export const DEFAULT_PROVIDER = 'agnes';
export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[PROVIDERS.length - 1];
}

const DEFAULT_CFG = {
  version: CFG_VERSION,
  provider: DEFAULT_PROVIDER,                       // 当前服务商（agnes / custom）
  baseUrl: 'https://api.agnes-ai.cn/v1',            // 默认 Agnes AI
  apiKey: '',
  model: 'agnes-2.5-flash',                         // 默认 2.5 Flash（文本/文生文）
  splitMode: 'marker',       // marker / paragraph / blank / heading
  marker: '【1】',
  sep: '---',                // 段落分隔符（paragraph 模式）
  headingLevel: '##',        // 标题级别（heading 模式）
  llmConc: 3,
  requirement: '',           // 当前编辑中的总要求
  templates: [],             // 多套模板 [{name, text}]
  activeTemplate: '',        // 当前模板名
  skipFilled: true,          // 跳过输出列已有内容的行
  outputColumns: [],         // 输出列模板 [{name, example}]，定义后严格按这些列名输出
  autoFill: null,            // 上次成功的建列结果缓存 {columns:[...], marker, sourceFieldId}
};

export function loadCfg() {
  let raw = null;
  try {
    const r = localStorage.getItem(CFG_KEY);
    if (r) raw = JSON.parse(r);
  } catch (e) { raw = null; }
  if (!raw) return { ...DEFAULT_CFG }; // 全新用户：直接用默认（Agnes AI + 2.5 Flash）
  if (raw.version !== CFG_VERSION) return { ...DEFAULT_CFG };
  const base = { ...DEFAULT_CFG, ...raw };
  // 旧版数据无 provider 字段 → 有 baseUrl 视为自定义，否则用默认服务商
  const hadProvider = Object.prototype.hasOwnProperty.call(raw, 'provider');
  if (!hadProvider) base.provider = base.baseUrl ? 'custom' : DEFAULT_PROVIDER;
  const p = getProvider(base.provider);
  if (p.fixedBaseUrl) base.baseUrl = p.baseUrl; // 固定 Base URL 强制对齐，避免手动改坏
  return base;
}

export function saveCfg(cfg) {
  const merged = { ...loadCfg(), ...cfg, version: CFG_VERSION };
  localStorage.setItem(CFG_KEY, JSON.stringify(merged));
  return merged;
}

/** 导出序列化（不含 apiKey，避免模板分享时泄露密钥） */
export function serializeForExport(cfg) {
  const { apiKey, ...rest } = cfg;
  return JSON.stringify({ ...rest, version: CFG_VERSION, _exportedAt: new Date().toISOString() }, null, 2);
}

/** 导入解析：校验版本与结构，apiKey 永不从文件导入 */
export function parseImport(text) {
  const obj = JSON.parse(String(text || ''));
  if (!obj || typeof obj !== 'object') throw new Error('文件格式不正确');
  if (obj.version !== CFG_VERSION) throw new Error(`模板版本不兼容（文件 v${obj.version}，当前 v${CFG_VERSION}）`);
  delete obj.apiKey; // 安全红线：密钥不随文件走
  delete obj._exportedAt;
  return obj;
}

/* ---------- 多格式导入导出 ---------- */

export const EXPORT_FORMATS = [
  { value: 'json', label: 'JSON（完整配置）', ext: 'json', mime: 'application/json' },
  { value: 'txt', label: 'TXT 纯文本', ext: 'txt', mime: 'text/plain' },
  { value: 'md', label: 'Markdown (.md)', ext: 'md', mime: 'text/markdown' },
  { value: 'html', label: 'HTML 网页', ext: 'html', mime: 'text/html' },
  { value: 'doc', label: 'Word 97-2003 (.doc)', ext: 'doc', mime: 'application/msword' },
  { value: 'docx', label: 'Word (.docx)', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { value: 'xlsx', label: 'Excel (.xlsx)', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
];

const IMPORT_ACCEPT = '.txt,.md,.html,.htm,.doc,.docx,.xlsx,.xls,.json,text/plain,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.*,application/json';

export function getImportAccept() { return IMPORT_ACCEPT; }

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function htmlWrap(text, useBr) {
  const body = escapeHtml(text).replace(/\n/g, useBr ? '<br>' : '</p><p>');
  return `<!doctype html><html><head><meta charset="utf-8"><title>总要求</title></head><body>${useBr ? body : '<p>' + body + '</p>'}</body></html>`;
}
function readText(buf) { return new TextDecoder('utf-8').decode(buf); }

async function exportDocx(text) {
  const { Document, Paragraph, TextRun, Packer } = await import('docx');
  const doc = new Document({
    sections: [{
      children: String(text || ' ').split(/\r?\n/).map((line) =>
        new Paragraph({ children: [new TextRun(line || ' ')] })),
    }],
  });
  const blob = await Packer.toBlob(doc);
  return { blob, filename: '总要求.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
}

async function exportXlsx(text) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([['总要求'], [text]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '总要求');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename: '总要求.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

async function importDocx(buf) {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value || '';
}

async function importXlsx(buf) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  return rows.map((r) => (Array.isArray(r) ? r.join('\t') : '')).join('\n').trim();
}

/**
 * 导出总要求为指定格式，返回 { blob, filename, mime }。
 * @param {string} format 见 EXPORT_FORMATS
 * @param {object} cfg 当前完整配置（用 cfg.requirement）
 */
export async function exportRequirement(format, cfg) {
  const text = cfg.requirement || '';
  const fmt = EXPORT_FORMATS.find((f) => f.value === format) || EXPORT_FORMATS[1];
  if (format === 'docx') return exportDocx(text);
  if (format === 'xlsx') return exportXlsx(text);
  let content, mime;
  if (format === 'json') { content = serializeForExport(cfg); mime = 'application/json'; }
  else if (format === 'html') { content = htmlWrap(text, false); mime = 'text/html'; }
  else if (format === 'doc') { content = htmlWrap(text, true); mime = 'application/msword'; }
  else { content = text; mime = fmt.mime; } // txt / md
  return { blob: new Blob([content], { type: mime }), filename: `总要求.${fmt.ext}`, mime };
}

/**
 * 从文档文件导入总要求文本。
 * @returns {Promise<{ text: string|null, json: object|null }>}
 *   json 非 null 表示导入的是本插件导出的配置 JSON（需更新配置）；
 *   text 非 null 表示解析出的纯文本总要求。
 */
export async function importRequirementFile(file) {
  if (!file) throw new Error('未选择文件');
  const name = (file.name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const buf = await file.arrayBuffer();

  if (ext === 'json') {
    const raw = readText(buf);
    try {
      const json = parseImport(raw); // 校验版本，剔除 apiKey
      return { text: json.requirement || '', json };
    } catch (e) {
      return { text: raw, json: null }; // 非本插件配置 → 当纯文本
    }
  }
  if (ext === 'txt' || ext === 'md') {
    return { text: readText(buf), json: null };
  }
  if (ext === 'html' || ext === 'htm') {
    const dom = new DOMParser().parseFromString(readText(buf), 'text/html');
    return { text: (dom.body ? dom.body.innerText : readText(buf)).trim(), json: null };
  }
  if (ext === 'docx') {
    return { text: await importDocx(buf), json: null };
  }
  if (ext === 'xlsx' || ext === 'xls') {
    return { text: await importXlsx(buf), json: null };
  }
  if (ext === 'doc') {
    throw new Error('老版 .doc 格式无法直接解析，请先用 Word / WPS 另存为 .docx 或 .txt 后再导入。');
  }
  // 兜底：当作纯文本
  return { text: readText(buf), json: null };
}
