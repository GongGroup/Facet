/** Toasts, tooltips, context menus, dialogs and in-page confirmation (no native alert/confirm). */
import { h, ic } from './dom.js';

/**
 * Where floating UI is attached: the full-screen element when part of the page is full screen (only
 * its subtree is visible then), otherwise <body>.
 */
export function overlayHost() {
  const fs = document.fullscreenElement;
  return fs && fs !== document.documentElement && fs !== document.body && fs.isConnected ? fs : document.body;
}
const attach = (el) => { const host = overlayHost(); if (el.parentNode !== host) host.append(el); return el; };

// ------------------------------------------------------------------ toasts
let toastHost;
/**
 * Show a toast. Options: type 'info'|'error', action {label, run}, timeout ms (0 = stays until closed),
 * spinner (a busy indicator). Returns the toast element with close() and update(message).
 */
export function toast(message, { type = 'info', action, timeout = 3800, spinner = false } = {}) {
  toastHost ??= h('div.toasts', { role: 'status', 'aria-live': 'polite' });
  attach(toastHost);
  const text = h('span.msg', message);
  const t = h(`div.toast${type === 'error' ? '.err' : ''}${spinner ? '.busy' : ''}`, spinner ? h('span.spinner', { 'aria-hidden': 'true' }) : null, text);
  let timer = 0;
  t.close = () => { clearTimeout(timer); t.remove(); };
  t.update = (m) => { text.textContent = m; };
  if (action) t.append(h('button', { type: 'button', on: { click: () => { t.close(); action.run(); } } }, action.label));
  toastHost.append(t);
  if (timeout > 0) timer = setTimeout(t.close, type === 'error' ? Math.max(timeout, 6500) : timeout);
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
      if (!el.isConnected || !el.dataset.tip) return;
      tip = h('div.tip', { role: 'tooltip' }, h('span', el.dataset.tip), el.dataset.kbd ? h('span.kbd', el.dataset.kbd) : null);
      attach(tip);
      const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      let x = r.left + r.width / 2 - tr.width / 2, y = r.bottom + 8;
      if (y + tr.height > innerHeight - 8) y = r.top - tr.height - 8;
      x = Math.max(8, Math.min(innerWidth - tr.width - 8, x));
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    }, 420);
  };
  root.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;   // no hover on touch screens: a tap would leave a stale tip
    const el = e.target.closest?.('[data-tip]');
    if (el && el !== current) show(el); else if (!el) hide();
  });
  root.addEventListener('pointerdown', hide, true);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
  root.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip]'); if (el && e.target.matches(':focus-visible')) show(el); });
  root.addEventListener('focusout', hide);
  addEventListener('scroll', hide, true);
}

// ------------------------------------------------------------------ menus
let openMenu = null, lastClosed = { anchor: null, t: 0 };
export function closeMenu() { openMenu?.remove(); openMenu = null; }
/** The open menu element, if any. */
export const menuOpen = () => openMenu;
/**
 * items: [{label, icon, kbd, hint, tip, run, header, separator, disabled, checked}]
 * anchor: an element, a DOMRect-like {left, top, right, bottom} or a point {x, y} (context menus).
 */
export function showMenu(anchor, items, { align = 'start', label } = {}) {
  closeMenu();
  // a second click on the button that opened the menu closes it
  if (anchor instanceof Element && lastClosed.anchor === anchor && performance.now() - lastClosed.t < 400) { lastClosed.anchor = null; return null; }
  const back = anchor instanceof Element ? anchor : document.activeElement;
  const m = h('div.menu', { role: 'menu', 'aria-label': label ?? null });
  for (const it of items) {
    if (!it) continue;
    if (it.separator) { m.append(h('div.msep', { role: 'separator' })); continue; }
    if (it.header) { m.append(h('div.mh', { role: 'presentation' }, it.header)); continue; }
    const b = h('button.mi', { type: 'button', role: it.checked != null ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': it.checked != null ? String(!!it.checked) : null, 'aria-disabled': it.disabled ? 'true' : null, 'data-tip': it.tip ?? null });
    if (it.icon) b.append(ic(it.icon, 'sm'));
    b.append(h('span', it.label));
    if (it.kbd) b.append(h('span.kbd.k', it.kbd)); else if (it.hint) b.append(h('small', it.hint));
    b.addEventListener('click', () => { if (it.disabled) return; closeMenu(); restore(); it.run?.(); });
    m.append(b);
  }
  attach(m);
  const r = anchor instanceof Element ? anchor.getBoundingClientRect()
    : anchor && 'x' in anchor && !('left' in anchor) ? { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y } : anchor;
  const mr = m.getBoundingClientRect();
  let x = align === 'end' ? r.right - mr.width : r.left, y = r.bottom + (anchor instanceof Element ? 6 : 2);
  if (y + mr.height > innerHeight - 8) y = Math.max(8, r.top - mr.height - 6);
  x = Math.max(8, Math.min(innerWidth - mr.width - 8, x));
  m.style.left = `${x}px`; m.style.top = `${y}px`;
  openMenu = m;
  const enabled = () => [...m.querySelectorAll('.mi:not([aria-disabled="true"])')];
  (enabled()[0] ?? m.querySelector('.mi'))?.focus();
  function restore() { if (back?.isConnected && back !== document.body) back.focus?.({ preventScroll: true }); }
  m.addEventListener('keydown', (e) => {
    const all = enabled();
    const i = all.indexOf(document.activeElement);
    let handled = true;
    if (e.key === 'ArrowDown') all[(i + 1) % all.length]?.focus();
    else if (e.key === 'ArrowUp') all[(i - 1 + all.length) % all.length]?.focus();
    else if (e.key === 'Home') all[0]?.focus();
    else if (e.key === 'End') all.at(-1)?.focus();
    else if (e.key === 'Escape') { closeMenu(); restore(); }
    else if (e.key === 'Tab') { closeMenu(); restore(); handled = false; }   // Tab continues from the menu button
    else if (e.key === 'Enter' || e.key === ' ') handled = false;   // the focused item's own click
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // type-ahead: jump to the next item starting with the letter
      const k = e.key.toLowerCase();
      const next = [...all.slice(i + 1), ...all.slice(0, i + 1)].find((b) => b.textContent.trim().toLowerCase().startsWith(k));
      next?.focus();
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); } else if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  });
  setTimeout(() => document.addEventListener('pointerdown', function off(e) {
    if (m.contains(e.target)) return;
    document.removeEventListener('pointerdown', off, true);
    if (openMenu !== m) return;
    if (anchor instanceof Element && anchor.contains(e.target)) lastClosed = { anchor, t: performance.now() };
    closeMenu();
  }, true), 0);
  return m;
}

// ------------------------------------------------------------------ modal layer (focus trap, inert background)
const stack = [];
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
const focusables = (el) => [...el.querySelectorAll(FOCUSABLE)].filter((x) => x.getClientRects().length && !x.closest('[inert]'));

/**
 * Show `box` in a scrim as a modal: Tab cycles inside it, everything else on the page is inert, Escape
 * and a click on the scrim close it, and focus returns to where it was. Returns {close(value), el, scrim}.
 */
export function openModal(box, { onClose, closeOnScrim = true } = {}) {
  const prevFocus = document.activeElement;
  const scrim = h('div.scrim', box);
  if (!box.hasAttribute('tabindex')) box.tabIndex = -1;
  const host = overlayHost();
  host.append(scrim);
  // make the rest of the page inert (screen readers and Tab), remembering what we changed
  const made = [...host.children].filter((el) => el !== scrim && !el.inert && !el.matches('.toasts, .tip, script, style, link'));
  made.forEach((el) => { el.inert = true; });
  let closed = false;
  const me = {
    el: box, scrim,
    close(v) {
      if (closed) return;
      closed = true;
      scrim.remove();
      made.forEach((el) => { el.inert = false; });
      const i = stack.indexOf(me); if (i >= 0) stack.splice(i, 1);
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus?.isConnected && !prevFocus.closest('[inert]')) prevFocus.focus?.({ preventScroll: true });
      onClose?.(v);
    },
  };
  const onKey = (e) => {
    if (stack.at(-1) !== me || openMenu?.contains(document.activeElement)) return;
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); me.close(null); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(box);
    if (!f.length) { e.preventDefault(); box.focus(); return; }
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  if (closeOnScrim) scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) me.close(null); });
  stack.push(me);
  return me;
}

/** True while a modal dialog (or the command palette) is open. */
export const modalOpen = () => stack.length > 0;

// ------------------------------------------------------------------ dialogs
export function dialog({ title, body, actions = [], wide = false, onClose, className = '' }) {
  let modal;
  const close = (v) => modal.close(v);
  const foot = actions.length ? h('footer', actions.filter(Boolean).map((a) => {
    const b = h(`button.btn${a.primary ? '.primary' : ''}${a.danger ? '.danger' : ''}`, { type: a.submit ? 'submit' : 'button' }, a.label);
    if (!a.submit) b.addEventListener('click', async () => { const r = await a.run?.(); if (r !== false) close(a.value); });
    return b;
  })) : null;
  const closeBtn = h('button.btn.ghost.icon', { type: 'button', 'aria-label': 'Close', 'data-tip': 'Close', 'data-kbd': 'Esc', on: { click: () => close(null) } }, ic('x'));
  const box = h(`div.dialog${wide ? '.wide' : ''}${className ? '.' + className.split(' ').join('.') : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    title ? h('header', h('h2', title), closeBtn) : null, h('div.body', body), foot);
  modal = openModal(box, { onClose });
  setTimeout(() => { if (box.isConnected && !box.contains(document.activeElement)) (box.querySelector('[autofocus]') ?? box.querySelector('input,select,textarea,button.primary') ?? (title ? closeBtn : box)).focus(); }, 20);
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
