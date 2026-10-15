/** Toasts, tooltips, context menus, dialogs and in-page confirmation (no native alert/confirm). */
import { h, ic } from './dom.js';

// ------------------------------------------------------------------ toasts
let toastHost;
export function toast(message, { type = 'info', action, timeout = 3800 } = {}) {
  toastHost ??= document.body.appendChild(h('div.toasts', { role: 'status', 'aria-live': 'polite' }));
  const t = h(`div.toast${type === 'error' ? '.err' : ''}`, h('span', message));
  if (action) t.append(h('button', { type: 'button', on: { click: () => { action.run(); t.remove(); } } }, action.label));
  toastHost.append(t);
  setTimeout(() => t.remove(), type === 'error' ? Math.max(timeout, 6500) : timeout);
  return t;
}

// ------------------------------------------------------------------ tooltips (data-tip, data-kbd)
export function installTooltips(root = document.body) {
  let tip = null, timer = 0, current = null;
  const hide = () => { clearTimeout(timer); tip?.remove(); tip = null; current = null; };
  const show = (el) => {
    hide();
    current = el;
    timer = setTimeout(() => {
      if (!document.body.contains(el)) return;
      tip = h('div.tip', { role: 'tooltip' }, h('span', el.dataset.tip), el.dataset.kbd ? h('span.kbd', el.dataset.kbd) : null);
      document.body.append(tip);
      const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      let x = r.left + r.width / 2 - tr.width / 2, y = r.bottom + 8;
      if (y + tr.height > innerHeight - 8) y = r.top - tr.height - 8;
      x = Math.max(8, Math.min(innerWidth - tr.width - 8, x));
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    }, 420);
  };
  root.addEventListener('pointerover', (e) => { const el = e.target.closest?.('[data-tip]'); if (el && el !== current) show(el); else if (!el) hide(); });
  root.addEventListener('pointerdown', hide, true);
  root.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip]'); if (el && e.target.matches(':focus-visible')) show(el); });
  root.addEventListener('focusout', hide);
  addEventListener('scroll', hide, true);
}

// ------------------------------------------------------------------ menus
let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
/**
 * items: [{label, icon, kbd, hint, run, header, separator, disabled}]
 */
export function showMenu(anchor, items, { align = 'start' } = {}) {
  closeMenu();
  const m = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if (it.separator) { m.append(h('div.msep')); continue; }
    if (it.header) { m.append(h('div.mh', it.header)); continue; }
    const b = h('button.mi', { type: 'button', role: 'menuitem', disabled: it.disabled });
    if (it.icon) b.append(ic(it.icon, 'sm'));
    b.append(h('span', it.label));
    if (it.kbd) b.append(h('span.kbd.k', it.kbd)); else if (it.hint) b.append(h('small', it.hint));
    b.addEventListener('click', () => { closeMenu(); it.run?.(); });
    m.append(b);
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect(), mr = m.getBoundingClientRect();
  let x = align === 'end' ? r.right - mr.width : r.left, y = r.bottom + 6;
  if (y + mr.height > innerHeight - 8) y = Math.max(8, r.top - mr.height - 6);
  x = Math.max(8, Math.min(innerWidth - mr.width - 8, x));
  m.style.left = `${x}px`; m.style.top = `${y}px`;
  openMenu = m;
  m.querySelector('.mi')?.focus();
  m.addEventListener('keydown', (e) => {
    const all = [...m.querySelectorAll('.mi:not([disabled])')];
    const i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { all[(i + 1) % all.length]?.focus(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { all[(i - 1 + all.length) % all.length]?.focus(); e.preventDefault(); }
    if (e.key === 'Escape') { closeMenu(); anchor.focus?.(); }
  });
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', off); } }), 0);
  return m;
}

// ------------------------------------------------------------------ dialogs
export function dialog({ title, body, actions = [], wide = false, onClose, className = '' }) {
  const prevFocus = document.activeElement;
  const close = (v) => { scrim.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); onClose?.(v); };
  const foot = actions.length ? h('footer', actions.map((a) => {
    const b = h(`button.btn${a.primary ? '.primary' : ''}${a.danger ? '.danger' : ''}`, { type: a.submit ? 'submit' : 'button' }, a.label);
    if (!a.submit) b.addEventListener('click', async () => { const r = await a.run?.(); if (r !== false) close(a.value); });
    return b;
  })) : null;
  const closeBtn = h('button.btn.ghost.icon', { type: 'button', 'aria-label': 'Close', on: { click: () => close(null) } }, ic('x'));
  const box = h(`div.dialog${wide ? '.wide' : ''}${className ? '.' + className : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    title ? h('header', h('h2', title), closeBtn) : null, h('div.body', body), foot);
  const scrim = h('div.scrim', box);
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(null); });
  const onKey = (e) => { if (e.key === 'Escape') close(null); };
  document.addEventListener('keydown', onKey);
  document.body.append(scrim);
  setTimeout(() => (box.querySelector('[autofocus]') ?? box.querySelector('input,select,textarea,button.primary') ?? closeBtn).focus(), 20);
  return { close, el: box };
}

/** Promise<boolean> confirmation rendered in-page. */
export function confirmDialog({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const d = dialog({
      title, body: h('p.hint', { style: { fontSize: '13.5px', color: 'var(--fg-2)' } }, message),
      actions: [{ label: 'Cancel', run: () => { done = true; resolve(false); } }, { label: confirm, primary: !danger, danger, run: () => { done = true; resolve(true); } }],
      onClose: () => { if (!done) resolve(false); },
    });
    return d;
  });
}

/** Promise<string|null> single-line input. */
export function promptDialog({ title, label, value = '', confirm = 'OK', placeholder = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input.field', { value, placeholder, autofocus: true, 'aria-label': label });
    const d = dialog({
      title, body: h('div', { style: { display: 'grid', gap: '6px' } }, h('label.ctl-label', label), input),
      actions: [{ label: 'Cancel', run: () => { done = true; resolve(null); } }, { label: confirm, primary: true, run: () => { done = true; resolve(input.value.trim()); } }],
      onClose: () => { if (!done) resolve(null); },
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; resolve(input.value.trim()); d.close(); } });
  });
}
