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
 * 模态弹窗：返回 { close, overlay }。
 * - 进入/退出均有动画（遮罩模糊淡入、卡片弹入）；点遮罩 / 按 Esc 可关（可被 options.dismissible=false 禁用）。
 * - 按钮支持 { label, primary, danger, onClick, keepOpen }：
 *   onClick 返回 false 时不自动关闭；否则点击后自动关闭（keepOpen:true 同效）。
 */
export function showModal(title, contentNode, buttons = [], options = {}) {
  // 互斥：同一时间只保留一个弹窗。
  // 【根修】此前 openSettings() 切换服务商时直接重新 showModal，旧 overlay 未移除，
  // DOM 中出现两个 #setProvider —— $('setProvider') 命中旧的（Agnes）下拉，
  // 点「完成」时 verifyCurrentModel 把 Agnes 配置覆盖回 localStorage，
  // 用户刚保存的「自定义」配置被吞。清理旧 overlay 后 $('id') 必然命中当前弹窗。
  document.querySelectorAll('.modal-overlay').forEach((ov) => ov.remove());
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
    options.onClose && options.onClose();
  }
  function close() {
    if (closed) return;
    overlay.classList.add('closing');
    // 仅当退出动画（overlayOut）播完才移除，避免入场动画误触发
    overlay.addEventListener('animationend', (e) => {
      if (e.animationName === 'overlayOut') finish();
    }, { once: true });
    setTimeout(finish, 260); // 兜底
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  if (options.dismissible !== false) {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
  }
  return { close, overlay };
}

/** 格式化 ETA 秒数为 mm:ss */
export function fmtEta(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
