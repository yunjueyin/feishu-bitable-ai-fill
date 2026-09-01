/**
 * 飞书多维表 SDK 封装。
 * 关键经验（来自【6.0】多维图片一键到excel 实测 + 官方文档查证 + 本插件 Widget 运行时排错）：
 * - 本插件运行于飞书 Base【自定义组件（Widget）】环境，其宿主 `getRecordsByPage` 传入 viewId 会直接以
 *   Table 级 `code:12` 拒绝（SDK 再包成 7 位数 code + "getRecordsByPage error"）。故记录读取【不传 viewId】，
 *   行序按底层存储顺序返回（该环境视图排序不可用，与此前 iframe/自动化插件"必须带 viewId 保序"不同）。
 * - getRecordIdList 已废弃且无序，一律用 getRecordsByPage；
 * - addField 返回形态需归一化（官方文档 Promise<string>，宿主实测兼容多种形态）；
 * - 建列后索引生效需约 2s，立即写入会静默失败；
 * - 写多行文本：官方两处示例分别为字符串与富文本数组，writeTextCell 做双格式兜底。
 */
import { bitable } from '@lark-base-open/js-sdk';

export const FIELD_TYPE_TEXT = 1; // 多行文本

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 当前选中的 base/table 信息 */
export async function getSelection() {
  return bitable.base.getSelection();
}

export async function getTableById(tableId) {
  return bitable.base.getTableById(tableId);
}

/** 当前激活表（用户正在查看的表）。飞书插件环境内有效，非插件环境返回 null。 */
export async function getActiveTable() {
  try {
    const t = await bitable.base.getActiveTable();
    if (t && t.id) return t;
  } catch (e) { /* 非插件环境或权限不足，落入兜底 */ }
  return null;
}

/** 数据表列表（getTableMetaList 最可靠，getTableList 的 name 经常为空） */
export async function listTables() {
  try {
    const metas = await bitable.base.getTableMetaList();
    if (Array.isArray(metas) && metas.length) {
      return metas.map((m) => ({ id: m.id, name: m.name || m.id }));
    }
  } catch (e) { /* 落入兜底 */ }
  const tables = await bitable.base.getTableList();
  return (tables || []).map((t) => ({ id: t.id, name: t.name || t.id }));
}

/**
 * 获取某表「当前视图」的有序字段列表。
 * 注意：getActiveView 基于 base.getSelection() 的全局选择——对非聚焦表会取错视图，
 * 因此仅对用户正在看的表调用本函数；跨表场景须显式传 viewId。
 * @returns {Promise<{viewId: string|null, fields: Array<{id,name,type,isPrimary}>}>}
 */
export async function loadViewFields(table) {
  let viewId = null;
  try { viewId = await table.getActiveView(); } catch (e) { viewId = null; }
  const metas = await table.getFieldMetaList(); // 无序全量（含类型）
  const metaById = new Map(metas.map((m) => [m.id, m]));
  let ordered = [];
  if (viewId) {
    try {
      const view = await table.getViewById(viewId);
      const list = await view.getFieldMetaList(); // 有序：id 字符串或对象，双兼容
      ordered = (list || [])
        .map((x) => (typeof x === 'string' ? metaById.get(x) : metaById.get(x && x.id)))
        .filter(Boolean);
    } catch (e) { ordered = []; }
  }
  if (!ordered.length) ordered = metas;
  return {
    viewId,
    fields: ordered.map((m) => ({
      id: m.id, name: m.name, type: m.type, isPrimary: !!m.isPrimary,
    })),
  };
}

/**
 * 把 SDK/宿主抛出的错误整理成可读字符串（含原始 code/msg，便于定位）。
 */
export function describeErr(e) {
  if (!e) return '未知错误';
  if (typeof e === 'string') return e;
  const code = e.code !== undefined ? e.code : (e.Code !== undefined ? e.Code : '');
  const msg = e.msg || e.message || '';
  if (code !== '' && code !== undefined) return `code: ${code}${msg ? '，msg: ' + msg : ''}`;
  return msg || JSON.stringify(e);
}

/**
 * 分页读记录（stringValue:true 直接拿字符串）。
 * 【重要】本插件运行于飞书 Base【自定义组件（Widget）】环境，宿主 `getRecordsByPage` 传入 viewId
 * 会直接以 Table 级 `code:12` 拒绝（SDK 再包成 7 位数 code + "getRecordsByPage error"）。
 * 因此这里【绝不传 viewId】，统一按底层存储顺序分页读取，避免每次必现的 code:12 与噪声重试日志。
 * （与此前 iframe/自动化插件"必须带 viewId 保序"不同——Widget 运行时视图排序不可用。）
 * @param {ITable} table
 * @param {string} [viewId] 仅保留形参以兼容调用方，本函数内部忽略（Widget 运行时传了会报错）。
 * @returns {Promise<Array<{recordId:string, fields:Object}>>}
 */
export async function readRecords(table, viewId, { pageSize = 200, maxPages = 2000 } = {}) {
  if (!table) throw new Error('数据表未加载，请先在「数据源」面板点击「刷新表/字段」');
  const all = [];
  let pageToken;
  let page = 0;
  let hasMore = true;
  do {
    const params = { pageSize, stringValue: true };
    if (pageToken) params.pageToken = pageToken;
    const resp = await table.getRecordsByPage(params);
    const recs = (resp && resp.records) || [];
    all.push(...recs);
    hasMore = !!(resp && resp.hasMore);
    pageToken = resp && resp.pageToken;
    page++;
    if (page > maxPages) break; // 安全熔断
  } while (hasMore && pageToken);
  return all;
}

/**
 * 幂等建列：按名匹配——已存在且为多行文本则复用；重名但类型不符则跳过并警告；不存在才新建。
 * @param {ITable} table
 * @param {string[]} names 列名列表（输出1…输出N）
 * @returns {Promise<{fieldIds: string[], created: string[], reused: string[], skipped: {name:string,type:number}[], warnings: string[]}>}
 */
export async function ensureColumns(table, names) {
  const metas = await table.getFieldMetaList();
  const byName = new Map(metas.map((m) => [m.name, m]));
  const fieldIds = [];
  const created = [];
  const reused = [];
  const skipped = [];
  const warnings = [];

  for (const name of names) {
    const exist = byName.get(name);
    if (exist) {
      if (exist.type === FIELD_TYPE_TEXT) {
        fieldIds.push(exist.id);
        reused.push(name);
      } else {
        skipped.push({ name, type: exist.type });
        warnings.push(`列「${name}」已存在但类型不是多行文本（type=${exist.type}），已跳过，请改名或手动处理`);
      }
      continue;
    }
    const res = await table.addField({ type: FIELD_TYPE_TEXT, name });
    const fid = normalizeFieldId(res);
    if (!fid) throw new Error(`创建列「${name}」失败：addField 未返回字段 id（返回=${JSON.stringify(res)}）`);
    fieldIds.push(fid);
    created.push(name);
    byName.set(name, { id: fid, name, type: FIELD_TYPE_TEXT });
  }

  if (created.length) {
    // 索引生效等待，避免立即写入静默失败
    await sleep(2000);
  }
  return { fieldIds, created, reused, skipped, warnings };
}

/** addField 返回归一化：字符串 / {id} / {fieldId} / {field.id} / {data.id} */
export function normalizeFieldId(res) {
  if (typeof res === 'string' && res.trim()) return res.trim();
  if (res && typeof res === 'object') {
    return res.id || res.fieldId || (res.field && res.field.id) || (res.data && res.data.id) || null;
  }
  return null;
}

/**
 * 写单个文本单元格（双格式兜底）：先字符串（js-sdk 官方示例写法），抛错再试富文本数组。
 * @returns {Promise<{ok:boolean, format:string}>}
 */
export async function writeTextCell(table, fieldId, recordId, text) {
  try {
    await table.setCellValue(fieldId, recordId, text);
    return { ok: true, format: 'string' };
  } catch (e1) {
    await table.setCellValue(fieldId, recordId, [{ type: 'text', text }]);
    return { ok: true, format: 'richtext' };
  }
}
