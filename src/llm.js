/**
 * OpenAI 兼容 /chat/completions 调用层（非流式）。
 * 重试策略：429/5xx/网络错误 → 指数退避重试（尊重 Retry-After 头）；
 * 400/401/403/404 等客户端错误 → 不重试直接抛错。
 * fetch 可注入（便于测试），默认 globalThis.fetch。
 */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 单次调用模型。
 * @param {object} cfg { baseUrl, apiKey, model, temperature, maxTokens, timeoutMs }
 * @param {Array<{role,content}>} messages
 * @param {object} opts { fetchImpl, onRetry, shouldAbort }
 * @returns {Promise<string>} 模型返回全文
 */
export async function callLLM(cfg, messages, opts = {}) {
  const {
    baseUrl, apiKey, model,
    temperature = 0.7,
    maxTokens = 4096,
    timeoutMs = 120000,
  } = cfg;
  if (!baseUrl) throw new Error('缺少 Base URL');
  if (!apiKey) throw new Error('缺少 API Key');
  if (!model) throw new Error('缺少模型名');

  const url = joinUrl(baseUrl, '/chat/completions');
  const doFetch = opts.fetchImpl || globalThis.fetch;
  const body = JSON.stringify({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  });

  let attempt = 0;
  for (;;) {
    if (opts.shouldAbort && opts.shouldAbort()) {
      const e = new Error('已取消');
      e.aborted = true;
      throw e;
    }
    try {
      return await requestOnce(doFetch, url, { apiKey, body, timeoutMs, model });
    } catch (err) {
      if (err.aborted) throw err;
      if (!err.retryable) throw err;
      attempt++;
      if (attempt > (opts.retries ?? 3)) throw err;
      const delay = err.retryAfterMs || 2000 * Math.pow(2, attempt - 1);
      if (opts.onRetry) opts.onRetry(attempt, err, delay);
      await sleep(delay);
    }
  }
}

async function requestOnce(doFetch, url, { apiKey, body, timeoutMs, model }) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const resp = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const err = new Error(`模型接口返回 ${resp.status}：${text.slice(0, 300)}`);
      err.retryable = RETRYABLE_STATUS.has(resp.status);
      const ra = resp.headers && resp.headers.get && resp.headers.get('retry-after');
      if (ra) {
        const sec = Number(ra);
        if (!Number.isNaN(sec)) err.retryAfterMs = Math.min(sec * 1000, 30000);
      }
      throw err;
    }
    const data = await resp.json();
    const content = data && data.choices && data.choices[0]
      && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) {
      const err = new Error('模型返回内容为空（可能被安全策略拦截或 max_tokens 过小）');
      err.retryable = true;
      throw err;
    }
    return content;
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.type === 'aborted')) {
      const err = new Error(`模型请求超时（${Math.round(timeoutMs / 1000)}s）`);
      err.retryable = true;
      throw err;
    }
    if (e instanceof TypeError) {
      // fetch 网络层错误（断网/CORS/DNS）
      const err = new Error(`网络错误：${e.message}`);
      err.retryable = true;
      throw err;
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 拼 baseUrl 与路径：容忍结尾带 / 与带 /v1 的写法 */
export function joinUrl(base, path) {
  let b = String(base || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b)) return b; // 用户直接填了完整端点
  if (!/\/v\d+$/.test(b)) b += '/v1'; // 未带版本号则补 /v1（DeepSeek/硅基流动/OpenAI 均兼容）
  return b + path;
}
