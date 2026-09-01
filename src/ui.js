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

/** 简易模态弹窗：返回 close() */
export function showModal(title, contentNode, buttons = []) {
  const overlay = el('div', { class: 'modal-overlay' });
  const box = el('div', { class: 'modal-box' },
    el('div', { class: 'modal-title' }, title),
    el('div', { class: 'modal-body' }, contentNode),
    el('div', { class: 'modal-foot' },
      buttons.map((b) => el('button', {
        class: b.primary ? 'btn btn-primary' : 'btn',
        onclick: () => b.onClick && b.onClick(),
      }, b.label)),
    ),
  );
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  return { close: () => overlay.remove(), overlay };
}

/** 格式化 ETA 秒数为 mm:ss */
export function fmtEta(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
