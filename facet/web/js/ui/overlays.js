/** Toasts, tooltips, menus with submenus, dialogs and in-page confirmation (no native alert/confirm). */
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
/** Time a toast stays at least once the pointer or focus leaves it (ms). */
const TOAST_RESUME = 1500;
/**
 * Show a toast. Options: type 'info'|'error' (errors stay at least 6.5 s); actions [{label, run}], one button each,
 * which closes the toast and then runs (`action`, one more of them, comes first); timeout ms (0 = the toast stays
 * until closed: by one of its buttons, its close button or Esc); spinner (a busy indicator, which its owner closes).
 * The countdown pauses while the pointer is over the toast or keyboard focus is in it, and Esc closes the toast that
 * has focus. Returns the toast element with close() and update(message).
 */
export function toast(message, { type = 'info', action, actions = [], timeout = 3800, spinner = false } = {}) {
  toastHost ??= h('div.toasts', { role: 'status', 'aria-live': 'polite' });
  attach(toastHost);
  const text = h('span.msg', message);
  const t = h(`div.toast${type === 'error' ? '.err' : ''}${spinner ? '.busy' : ''}`, spinner ? h('span.spinner', { 'aria-hidden': 'true' }) : null, text);
  const ms = timeout > 0 ? (type === 'error' ? Math.max(timeout, 6500) : timeout) : 0;
  let timer = 0, left = ms, since = 0, hovered = false, focused = false, closed = false;
  const run = () => {   // count down what is left, unless the pointer or focus holds the toast
    if (closed || !ms || timer || hovered || focused) return;
    since = Date.now();
    timer = setTimeout(t.close, left);
  };
  const hold = () => {
    if (!timer) return;
    clearTimeout(timer); timer = 0;
    left = Math.max(TOAST_RESUME, left - (Date.now() - since));
  };
  t.close = () => { if (closed) return; closed = true; clearTimeout(timer); timer = 0; t.remove(); };
  t.update = (m) => { text.textContent = m; };
  for (const a of [action, ...(actions ?? [])]) {
    if (a?.label == null || typeof a.run !== 'function') continue;
    t.append(h('button', { type: 'button', on: { click: () => { t.close(); a.run(); } } }, a.label));
  }
  if (!ms && !spinner) t.append(h('button.toast-close', { type: 'button', 'aria-label': 'Close', title: 'Close', on: { click: () => t.close() } }, '×'));
  t.addEventListener('pointerenter', () => { hovered = true; hold(); });
  t.addEventListener('pointerleave', () => { hovered = false; run(); });
  t.addEventListener('focusin', () => { focused = true; hold(); });
  t.addEventListener('focusout', (e) => { if (t.contains(e.relatedTarget)) return; focused = false; run(); });
  t.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); t.close(); } });
  toastHost.append(t);
  run();
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
/** The open menus: the root menu first, then each open submenu (one root menu is open at a time). */
let chain = [];
/** {anchor, restore(), opts: {onClose, onNav}, detach()} of the root menu. */
let rootState = null;
let lastClosed = { anchor: null, t: 0 };

/** Close the open menu with all its submenus. */
export function closeMenu() {
  if (!chain.length) return;
  const st = rootState, closing = chain;
  chain = []; rootState = null;
  for (const m of closing) { clearTimeout(m._timer); m.remove(); }
  st?.detach?.();
  try { st?.opts?.onClose?.(); } catch (e) { console.error(e); }
}
/** The open (root) menu element, if any. */
export const menuOpen = () => chain[0] ?? null;
/** True when `node` is inside the open menu or one of its submenus. */
export const menuContains = (node) => !!node && chain.some((m) => m.contains(node));

/**
 * A list of menu items ready to show (no DOM: tested in node): a function is called for its list, empty entries
 * are dropped, as are separators at the start, at the end and after another separator, a header that no item
 * follows, and a submenu whose list is empty (`items: []`; a function is only called when the submenu opens).
 */
export function cleanItems(items) {
  const list = (typeof items === 'function' ? items() : items) ?? [];
  const out = [];
  for (const it of list) {
    if (!it) continue;
    if (Array.isArray(it.items)) {
      const sub = cleanItems(it.items);
      if (sub.length) out.push({ ...it, items: sub });
      continue;
    }
    if (it.separator) { if (!out.length || out.at(-1).separator) continue; if (out.at(-1).header) out.pop(); if (!out.length) continue; }
    else if (it.header && out.at(-1)?.header) out.pop();
    out.push(it);
  }
  while (out.length && (out.at(-1).separator || out.at(-1).header)) out.pop();
  return out;
}

/** Phones: a submenu takes the place of its parent menu (with a way back) instead of opening beside it. */
const drillDown = () => (globalThis.innerWidth ?? 1280) <= 560;
const enabledItems = (m) => [...m.querySelectorAll('.mi:not([aria-disabled="true"])')];
function focusFirst(m) {
  const all = enabledItems(m);
  (all.find((b) => !b._item?.back) ?? all[0] ?? m.querySelector('.mi'))?.focus?.({ preventScroll: true });
}
/** Close the submenus from `level` on (the root menu, level 0, stays). */
function closeFrom(level) {
  while (chain.length > Math.max(1, level)) {
    const m = chain.pop();
    clearTimeout(m._timer);
    m._parentItem?.setAttribute('aria-expanded', 'false');
    if (m._drill && chain.at(-1)) chain.at(-1).hidden = false;
    m.remove();
  }
}
/** Close submenu `m` and put the focus back on the item that opened it. */
function backFrom(m) {
  const p = m._parentItem;
  closeFrom(m._level);
  p?.focus?.({ preventScroll: true });
}

function renderMenu(items, { label, level }) {
  const list = cleanItems(items);
  const m = h(`div.menu${level ? '.sub' : ''}`, { role: 'menu', 'aria-label': label ?? null });
  m._level = level;
  // one column for icons and check marks when any item has one, so the labels line up
  const gutter = list.some((it) => !it.separator && !it.header && (it.icon || it.checked != null));
  if (!list.some((it) => !it.separator && !it.header && !it.back)) list.push({ label: 'Nothing here yet', disabled: true });
  for (const it of list) {
    if (it.separator) { m.append(h('div.msep', { role: 'separator' })); continue; }
    if (it.header) { m.append(h('div.mh', { role: 'presentation' }, it.header)); continue; }
    const sub = it.items != null;
    const role = it.checked == null ? 'menuitem' : it.radio ? 'menuitemradio' : 'menuitemcheckbox';
    const b = h(`button.mi${it.back ? '.back' : ''}`, {
      type: 'button', role, 'aria-checked': it.checked != null ? String(!!it.checked) : null, 'aria-disabled': it.disabled ? 'true' : null,
      'aria-haspopup': sub ? 'menu' : null, 'aria-expanded': sub ? 'false' : null, 'data-tip': it.tip ?? null,
    });
    b._item = it;
    if (it.icon) b.append(ic(it.icon, 'sm'));
    else if (it.checked != null) b.append(ic(it.radio ? 'dot' : 'check', 'sm'));
    else if (gutter) b.append(h('i.mi-gap', { 'aria-hidden': 'true' }));
    b.append(h('span', it.label));
    if (it.kbd) b.append(h('span.kbd.k', it.kbd)); else if (it.hint) b.append(h('small', it.hint));
    if (sub) b.append(ic('chevronRight', 'sm mi-sub'));
    b.addEventListener('click', () => {
      if (it.disabled) return;
      if (it.back) { backFrom(m); return; }
      if (sub) { openSub(m, b, it, { focus: true }); return; }
      const restore = rootState?.restore;
      closeMenu(); restore?.(true); it.run?.();
    });
    // the mouse opens a submenu by resting on its item, and closes it by resting on another item
    b.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') hoverItem(m, b, sub && !it.disabled ? it : null); });
    m.append(b);
  }
  m.addEventListener('keydown', (e) => menuKey(m, e));
  return m;
}

function hoverItem(m, b, it) {
  clearTimeout(m._timer);
  const open = chain[m._level + 1];
  if (it) { if (open?._parentItem !== b) m._timer = setTimeout(() => { if (b.isConnected && chain[m._level] === m) openSub(m, b, it); }, 130); }
  else if (open && !open._drill) m._timer = setTimeout(() => { if (chain[m._level] === m) closeFrom(m._level + 1); }, 240);
}

/** Open the submenu of item `b` of menu `m`: beside it (on the other side when there is no room), or in its place on phones. */
function openSub(m, b, it, { focus = false } = {}) {
  clearTimeout(m._timer);
  const cur = chain[m._level + 1];
  if (cur?._parentItem === b) { if (focus) focusFirst(cur); return cur; }
  closeFrom(m._level + 1);
  const drill = drillDown();
  const items = cleanItems(it.items);
  const sub = renderMenu(drill ? [{ label: it.label, icon: 'chevronLeft', back: true }, { separator: true }, ...items] : items, { label: it.label, level: m._level + 1 });
  sub._parentItem = b; sub._drill = drill;
  attach(sub);
  const W = globalThis.innerWidth ?? 1280, H = globalThis.innerHeight ?? 800;
  const sr = sub.getBoundingClientRect();
  let x, y;
  if (drill) {
    const mr = m.getBoundingClientRect();
    x = mr.left; y = mr.top;
    m.hidden = true;
  } else {
    const r = b.getBoundingClientRect();
    x = r.right - 3; y = r.top - 6;
    if (x + sr.width > W - 8) x = r.left - sr.width + 3;   // no room on that side: open on the other one
  }
  x = Math.max(8, Math.min(W - sr.width - 8, x));
  y = Math.max(8, Math.min(H - sr.height - 8, y));
  sub.style.left = `${x}px`; sub.style.top = `${y}px`;
  b.setAttribute('aria-expanded', 'true');
  chain.push(sub);
  sub.addEventListener('pointerenter', () => clearTimeout(m._timer));
  if (focus || drill) focusFirst(sub);
  return sub;
}

function menuKey(m, e) {
  const all = enabledItems(m);
  const cur = document.activeElement;
  const i = all.indexOf(cur);
  const k = e.key;
  let handled = true;
  if (k === 'ArrowDown') all[(i + 1) % all.length]?.focus();
  else if (k === 'ArrowUp') all[i < 0 ? all.length - 1 : (i - 1 + all.length) % all.length]?.focus();
  else if (k === 'Home') all[0]?.focus();
  else if (k === 'End') all.at(-1)?.focus();
  else if (k === 'ArrowRight') {
    const it = i >= 0 ? cur._item : null;
    if (it?.items != null) openSub(m, cur, it, { focus: true });
    else if (rootState?.opts?.onNav) rootState.opts.onNav(1);   // a menu of the menu bar: on to the next menu
    else handled = false;
  } else if (k === 'ArrowLeft') {
    if (m._level > 0) backFrom(m);
    else if (rootState?.opts?.onNav) rootState.opts.onNav(-1);
    else handled = false;
  } else if (k === 'Escape') {
    if (m._level > 0) backFrom(m);   // Esc leaves a submenu first
    else { const restore = rootState?.restore; closeMenu(); restore?.(); }
  } else if (k === 'Tab') { const restore = rootState?.restore; closeMenu(); restore?.(); handled = false; }   // Tab continues from the menu button
  else if (k === 'Enter' || k === ' ') handled = false;   // the focused item's own click
  else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // type-ahead: jump to the next item starting with the letter
    const c = k.toLowerCase();
    const next = [...all.slice(i + 1), ...all.slice(0, i + 1)].find((b) => String(b._item?.label ?? b.textContent ?? '').trim().toLowerCase().startsWith(c));
    next?.focus();
  } else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); } else if (k === 'Enter' || k === ' ') e.stopPropagation();
}

/**
 * Show a menu.
 * items: [{label, icon, kbd, hint, tip, run, header, separator, disabled, checked, radio, items}] (or a function
 *   that returns them). `checked` (true/false) makes a check item, with `radio` one of a group. `items` (a list, or
 *   a function called when it opens) makes the item a submenu: it opens beside the item when the pointer rests on
 *   it, on a click, Enter or →, and closes with ← or Esc; on phones it takes the menu's place, with a way back.
 * anchor: an element, a DOMRect-like {left, top, right, bottom} or a point {x, y} (context menus).
 * Options: align 'start' | 'end'; label (the accessible name); gap (px below the anchor); below: true keeps the
 *   menu under its anchor (it scrolls rather than move above it); className; onClose() when the menu closes for any
 *   reason; onNav(±1) for ← and → on the root menu (the menu bar moves to the neighbouring menu); returnFocus() →
 *   the element that takes the focus once an item has run (default: the anchor, which also gets it back on Esc).
 */
export function showMenu(anchor, items, { align = 'start', label, gap = null, below = false, className = null, onClose = null, onNav = null, returnFocus = null } = {}) {
  closeMenu();
  // a second click on the button that opened the menu closes it
  if (anchor instanceof Element && lastClosed.anchor === anchor && performance.now() - lastClosed.t < 400) { lastClosed.anchor = null; return null; }
  const back = anchor instanceof Element ? anchor : document.activeElement;
  const m = renderMenu(items, { label, level: 0 });
  if (className) m.classList.add(...String(className).split(/\s+/).filter(Boolean));
  attach(m);
  const W = globalThis.innerWidth ?? 1280, H = globalThis.innerHeight ?? 800;
  const r = anchor instanceof Element ? anchor.getBoundingClientRect()
    : anchor && 'x' in anchor && !('left' in anchor) ? { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y } : anchor;
  const mr = m.getBoundingClientRect();
  let x = align === 'end' ? r.right - mr.width : r.left, y = r.bottom + (gap ?? (anchor instanceof Element ? 6 : 2));
  if (below) m.style.maxHeight = `${Math.max(140, H - y - 8)}px`;
  else if (y + mr.height > H - 8) y = Math.max(8, r.top - mr.height - 6);
  x = Math.max(8, Math.min(W - mr.width - 8, x));
  m.style.left = `${x}px`; m.style.top = `${y}px`;
  chain = [m];
  const off = (e) => {
    if (chain[0] !== m || menuContains(e.target)) return;
    if (anchor instanceof Element && anchor.contains(e.target)) lastClosed = { anchor, t: performance.now() };
    closeMenu();
  };
  let listening = false;
  const timer = setTimeout(() => { if (chain[0] === m) { document.addEventListener('pointerdown', off, true); listening = true; } }, 0);
  rootState = {
    anchor, opts: { onClose, onNav },
    /** Put the focus back: on the anchor, or, after an item has run (`ran`), where returnFocus says. */
    restore(ran = false) {
      const to = ran && typeof returnFocus === 'function' ? returnFocus() : back;
      if (to?.isConnected && to !== document.body) to.focus?.({ preventScroll: true });
    },
    detach() { clearTimeout(timer); if (listening) document.removeEventListener('pointerdown', off, true); },
  };
  focusFirst(m);
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
    if (stack.at(-1) !== me || menuContains(document.activeElement)) return;
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
