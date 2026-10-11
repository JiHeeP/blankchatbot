// 화면 도우미: 요소 만들기, 알림, 확인 창, 입력 창

/** el('div.class1.class2', {attrs, on: {click}}, ...children) */
export function el(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = {};
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'class') node.className += ` ${v}`;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/**
 * 전자칠판은 한 번 눌러도 두 번 들어오는 경우가 있어서, 같은 대상은 잠깐 막는다.
 * 화면이 다시 그려져도 막히도록 key(예: 과제id:학생id)로 기억한다.
 */
const lastTap = new Map();
export function onTap(node, fn, { key, lockMs = 450 } = {}) {
  const k = key || node;
  node.addEventListener('click', (e) => {
    const t = Date.now();
    if (t - (lastTap.get(k) || 0) < lockMs) return;
    lastTap.set(k, t);
    if (!key) setTimeout(() => lastTap.delete(k), lockMs);
    fn(e);
  });
  return node;
}

export function toast(message, kind = 'info', ms = 3500) {
  const root = document.getElementById('toasts');
  const t = el(`div.toast.toast-${kind}`, { role: 'status' }, message);
  root.append(t);
  setTimeout(() => t.classList.add('hide'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

function openModal(build) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const prevFocus = document.activeElement;
    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      prevFocus?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    const box = el('div.modal', { role: 'dialog', 'aria-modal': 'true' });
    const overlay = el('div.modal-overlay', { on: { click: (e) => { if (e.target === overlay) close(null); } } }, box);
    build(box, close);
    root.append(overlay);
    document.addEventListener('keydown', onKey);
    (box.querySelector('[autofocus]') || box.querySelector('input, textarea, button.primary, button'))?.focus();
  });
}

export function confirmBox(title, message, { ok = '확인', danger = false } = {}) {
  return openModal((box, close) => {
    box.append(
      el('h2', title),
      message ? el('p.modal-text', message) : null,
      el('div.modal-actions',
        el('button.btn', { type: 'button', on: { click: () => close(false) } }, '취소'),
        el(`button.btn.${danger ? 'danger' : 'primary'}`, { type: 'button', on: { click: () => close(true) } }, ok)),
    );
  }).then(Boolean);
}

/** 입력 창. fields = [{name, label, value, type, placeholder, hint, options}] → 값 객체 또는 null */
export function formBox(title, fields, { ok = '저장', validate } = {}) {
  return openModal((box, close) => {
    const err = el('p.modal-error', { hidden: true });
    const inputs = {};
    const form = el('form', {
      on: {
        submit: (e) => {
          e.preventDefault();
          const values = {};
          for (const [k, input] of Object.entries(inputs)) values[k] = input.value.trim();
          const msg = validate?.(values);
          if (msg) {
            err.textContent = msg;
            err.hidden = false;
            return;
          }
          close(values);
        },
      },
    });
    fields.forEach((f, i) => {
      let input;
      if (f.options) {
        input = el('select.input', { name: f.name },
          f.options.map(([v, label]) => el('option', { value: v, selected: v === f.value }, label)));
      } else {
        input = el('input.input', {
          name: f.name, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '',
          autofocus: i === 0, inputmode: f.inputmode, min: f.min, max: f.max, autocomplete: 'off',
        });
      }
      inputs[f.name] = input;
      form.append(el('label.field', el('span.field-label', f.label), input, f.hint ? el('span.field-hint', f.hint) : null));
      if (f.extra) form.append(f.extra(inputs));
    });
    form.append(err, el('div.modal-actions',
      el('button.btn', { type: 'button', on: { click: () => close(null) } }, '취소'),
      el('button.btn.primary', { type: 'submit' }, ok)));
    box.append(el('h2', title), form);
  });
}

/** 선택지 메뉴 → 고른 값 또는 null */
export function menuBox(title, items) {
  return openModal((box, close) => {
    box.append(el('h2', title), el('div.menu-list',
      items.map(([value, label, danger]) => el(`button.btn.menu-item${danger ? '.danger-text' : ''}`, {
        type: 'button', on: { click: () => close(value) },
      }, label))),
    el('div.modal-actions', el('button.btn', { type: 'button', on: { click: () => close(null) } }, '닫기')));
  });
}

export function storageGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 못 해도 동작에는 지장 없음
  }
}
