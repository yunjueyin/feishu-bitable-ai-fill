/** 极简 DOM 工厂（零 UI 库，照抄 飞书一键转记录链接 的 el() 模式） */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** 填充 <select> 选项 */
export function fillSelect(sel, options, placeholder) {
  sel.innerHTML = '';
  if (placeholder !== undefined) {
    sel.appendChild(el('option', { value: '' }, placeholder));
  }
  for (const opt of options) {
    sel.appendChild(el('option', { value: opt.value }, opt.label));
  }
}

/**
 * 模态弹窗（堆叠式）。
 * - 多个弹窗可并存叠放（后开在上层）：设置弹窗上叠「验证结果」、确认门上叠「错误提示」
 *   都不再互相顶掉——此前互斥式移除 overlay 曾导致 ①验证结果吞掉设置弹窗 ②确认门
 *   Promise 永久悬挂两个问题。
 * - Esc / 点遮罩只关最上层；closeAllModals() 立即清空全部（用于重新打开设置等显式替换场景）。
 * - 按钮支持 { label, primary, danger, onClick, keepOpen }：
 *   onClick 返回 false 时不自动关闭；否则点击后自动关闭（keepOpen:true 同效）。
 */
const liveModals = new Set();

/** 立即关闭所有弹窗（无退出动画）。openSettings 等需要「替换」语义的场景调用。 */
export function closeAllModals() {
  for (const m of [...liveModals]) m.close(true);
}

function isTopmost(overlay) {
  const all = document.querySelectorAll('.modal-overlay');
  return all.length && all[all.length - 1] === overlay;
}

export function showModal(title, contentNode, buttons = [], options = {}) {
  const overlay = el('div', { class: 'modal-overlay' });
  const box = el('div', { class: 'modal-box' },
    el('div', { class: 'modal-title' }, title),
    el('div', { class: 'modal-body' }, contentNode),
    el('div', { class: 'modal-foot' },
      buttons.map((b) => el('button', {
        class: b.primary ? 'btn btn-primary' : (b.danger ? 'btn btn-danger' : 'btn'),
        onclick: async () => {
          if (b.onClick) {
            const r = await b.onClick();
            if (r === false) return; // 调用方自行决定何时关闭
          }
          if (b.keepOpen) return;
          close();
        },
      }, b.label)),
    ),
  );
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  let closed = false;
  function finish() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    liveModals.delete(api);
    options.onClose && options.onClose();
  }
  function close(immediate = false) {
    if (closed) return;
    if (immediate) { finish(); return; }
    overlay.classList.add('closing');
    // 仅当退出动画（overlayOut）播完才移除，避免入场动画误触发
    overlay.addEventListener('animationend', (e) => {
      if (e.animationName === 'overlayOut') finish();
    }, { once: true });
    setTimeout(finish, 260); // 兜底
  }
  function onKey(e) {
    if (e.key === 'Escape' && isTopmost(overlay)) close();
  }
  if (options.dismissible !== false) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && isTopmost(overlay)) close();
    });
    document.addEventListener('keydown', onKey);
  }
  const api = { close, overlay };
  liveModals.add(api);
  return api;
}

/**
 * 非阻塞轻提示（toast），替代「已请求取消」这类打断式弹窗。
 * @param {string} msg
 * @param {number} duration 自动消失毫秒数
 */
export function showToast(msg, duration = 2600) {
  const t = el('div', { class: 'toast' }, msg);
  document.body.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 320);
  }, duration);
}

/** 格式化 ETA 秒数为 mm:ss */
export function fmtEta(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
