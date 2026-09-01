/**
 * 配置与「总要求模板」持久化（localStorage，带版本校验）。
 * Key 明文存浏览器 localStorage（纯静态站无后端，用户已知情接受）。
 */

export const CFG_KEY = 'feishu_ai_fill_cfg_v1';
export const CFG_VERSION = 1;

const DEFAULT_CFG = {
  version: CFG_VERSION,
  baseUrl: '',
  apiKey: '',
  model: '',
  marker: '【1】',
  llmConc: 3,
  requirement: '',           // 当前编辑中的总要求
  templates: [],             // 多套模板 [{name, text}]
  activeTemplate: '',        // 当前模板名
  skipFilled: true,          // 跳过输出列已有内容的行
  autoFill: null,            // 上次成功的建列结果缓存 {columns:[...], marker, sourceFieldId}
};

export function loadCfg() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return { ...DEFAULT_CFG };
    const obj = JSON.parse(raw);
    if (!obj || obj.version !== CFG_VERSION) return { ...DEFAULT_CFG }; // 版本不符丢弃
    return { ...DEFAULT_CFG, ...obj };
  } catch (e) {
    return { ...DEFAULT_CFG };
  }
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
