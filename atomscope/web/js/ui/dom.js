/** Tiny DOM helpers and form controls (no framework). */
import { icon } from './icons.js';
import { escapeHTML } from '../core/util.js';

/** h('div.class#id', {attrs, on:{click}}, ...children) */
export function h(sel, attrs = {}, ...children) {
  const [tag, ...rest] = sel.split(/(?=[.#])/);
  const el = document.createElement(tag || 'div');
  for (const r of rest) { if (r[0] === '.') el.classList.add(r.slice(1)); else el.id = r.slice(1); }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = {}; }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const ic = (name, cls) => { const t = document.createElement('template'); t.innerHTML = icon(name, cls); return t.content.firstChild; };

export function btn(label, { icon: ico, cls = '', tip, kbd, on, pressed, title, disabled, id } = {}) {
  const b = h(`button.btn${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button', id, disabled, 'aria-label': label || tip, 'aria-pressed': pressed == null ? null : String(!!pressed), title: title ?? null });
  if (tip) { b.dataset.tip = tip; if (kbd) b.dataset.kbd = kbd; }
  if (ico) b.append(ic(ico));
  if (label && !cls.includes('icon')) b.append(h('span', label));
  if (on) b.addEventListener('click', on);
  return b;
}

let _id = 0;
const nid = (p) => `${p}-${++_id}`;

/** Stable identity of a control across re-renders (the shell restores focus by it). */
const keyOf = (key, label) => (key ?? (typeof label === 'string' ? label : null));

export function slider({ label, value, min, max, step = 0.01, fmt = (v) => (+v).toFixed(2), onInput, tip, id, key }) {
  const iid = id ?? nid('rng');
  const out = h('output', { for: iid }, fmt(value));
  const input = h('input', { type: 'range', id: iid, min, max, step, value, 'data-key': keyOf(key, label) });
  input.addEventListener('input', () => { out.textContent = fmt(+input.value); onInput(+input.value); });
  const lab = h('label', { for: iid }, label);
  if (tip) lab.dataset.tip = tip;
  const el = h('div.ctl', lab, input, out);
  el.set = (v) => { input.value = v; out.textContent = fmt(v); };
  return el;
}

export function toggle({ label, sub, checked, onChange, tip, id, key }) {
  const iid = id ?? nid('tg');
  const input = h('input', { type: 'checkbox', id: iid, checked: !!checked, role: 'switch', 'data-key': keyOf(key, label) });
  input.addEventListener('change', () => onChange(input.checked));
  const t = h('label.t', { for: iid }, h('b', label), sub ? h('small', sub) : null);
  if (tip) t.dataset.tip = tip;
  return h('div.toggle-row', t, h('span.switch', input, h('span')));
}

export function seg(options, value, onChange, { label, iconsOnly, key } = {}) {
  const wrap = h('div.seg', { role: 'group', 'aria-label': label ?? null });
  const base = keyOf(key, label) ?? 'seg';
  const btns = options.map((o) => {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    const b = h('button', { type: 'button', 'aria-pressed': String(opt.value === value), 'aria-label': opt.label, 'data-key': `${base}:${opt.value}` });
    if (opt.icon) b.append(ic(opt.icon, 'sm'));
    if (!iconsOnly) b.append(h('span', opt.label));   // (a span, so a label too long for its segment ends in …)
    if (opt.tip) b.dataset.tip = opt.tip;
    b.addEventListener('click', () => { btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); onChange(opt.value); });
    return b;
  });
  wrap.append(...btns);
  return wrap;
}

export function select({ options, value, onChange, id, label, key }) {
  const s = h('select.field', { id: id ?? nid('sel'), 'aria-label': label ?? null, 'data-key': keyOf(key, label) });
  for (const o of options) {
    if (o.group) {
      const g = h('optgroup', { label: o.group });
      o.options.forEach((x) => g.append(h('option', { value: x.value, selected: x.value === value }, x.label)));
      s.append(g);
    } else s.append(h('option', { value: o.value, selected: o.value === value }, o.label));
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function colorInput(value, onChange, label = 'Colour', key) {
  const c = h('input', { type: 'color', value: toHex6(value), 'aria-label': label, 'data-key': keyOf(key, label) });
  c.addEventListener('input', () => onChange(c.value));
  return c;
}
const toHex6 = (v) => { const s = String(v || '#000000'); return /^#[0-9a-f]{3}$/i.test(s) ? '#' + s.slice(1).split('').map((c) => c + c).join('') : s.slice(0, 7); };

export function section(title, ...children) {
  const head = typeof title === 'string' ? h('h3', h('span.grow', title)) : title;
  return h('div.section', head, ...children);
}

export function field(label, control, tip) {
  const l = h('label', label);
  if (tip) l.dataset.tip = tip;
  return h('div.ctl.wide', l, control);
}

export { escapeHTML };
