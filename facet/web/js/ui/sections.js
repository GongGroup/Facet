/**
 * Panel sections: the Surface panel and the Structure panel's Cell and Transform slots are made of
 * collapsible sections that the feature modules register, so they never edit the panel files:
 *   registerPanelSection('surface', { id: 'cleave', title: 'Cleave', order: 10, available, emptyActions,
 *                                     render(app, el, shell, ctx), signature, refreshOn, badge })
 * Each section is a <details class="sec" data-sec="<panel>.<id>"> with a <summary><h3>title</h3> + badge and a
 * body of its own:
 * - The body is drawn when the section is open (`ctx = {section: <details>, id, open, focus, tab}`) and drawn
 *   again, alone, when an event in its `refreshOn` changes its `signature(app)` or what `available(app)` says;
 *   while the user types in it the redraw waits until they leave the field. A collapsed body is drawn when
 *   it is opened. Whether a section is open is kept in the `sections` preference.
 * - `available(app)` returns true or a reason (a sentence): the body then shows only the reason and the
 *   buttons of `emptyActions(app)`. requireCell, requireVacuumGap, requireNoPreview and requireBootTask
 *   below give the usual reasons. Sections never change with the kind of structure (U1): a tool that needs
 *   a vacuum gap says so; `badge(app)` shows the tool's own parameters ('(1 1 1)'), never a "slab"/"bulk" label.
 * - A panel reserves the sections it always shows (reservePanelSection): until a module registers one it
 *   reads "Not available in this build yet."
 * The Shell attaches itself (attachSections) so that sections follow app and viewer events and
 * openSection() can open a panel at a section.
 */
import { h, ic, btn } from './dom.js';
import { commands } from '../core/commands.js';
import { bootTaskStatus } from '../core/boot.js';

/** The slots of the built-in panels; a section goes in 'main' unless its panel has other slots. */
export const PANEL_SLOTS = Object.freeze({ surface: Object.freeze(['main']), structure: Object.freeze(['cell', 'transform']) });
const DEFAULT_REFRESH = Object.freeze(['project', 'structure']);
export const PLACEHOLDER_TEXT = 'Not available in this build yet.';
const NO_STRUCTURE = 'Load a structure first.';
const NO_CELL = 'This structure has no unit cell. Surface tools work on crystals and slabs with a unit cell.';
const IN_PREVIEW = 'Apply or cancel the current preview first.';

const registry = new Map();   // panelId → Map(sectionId → [entry, …]); the last entry of a list is the active one
const reserved = new Map();   // panelId → Map(sectionId → entry)
let seq = 0;

/** A section's text as a sentence: first letter upper case, ending in a full stop. */
const sentence = (t) => { const s = String(t ?? '').trim(); return s ? `${s[0].toUpperCase()}${s.slice(1)}${/[.!?…]$/.test(s) ? '' : '.'}` : s; };

// ------------------------------------------------------------------ registry (no DOM: tested in node)
function normalize(panelId, s) {
  if (!s || typeof s !== 'object') throw new TypeError('registerPanelSection: expected a section object');
  if (typeof s.id !== 'string' || !s.id) throw new TypeError('registerPanelSection: missing id');
  const key = `${panelId}.${s.id}`;
  if (typeof s.title !== 'string' || !s.title.trim()) throw new TypeError(`registerPanelSection: “${key}” needs a title`);
  if (typeof s.render !== 'function') throw new TypeError(`registerPanelSection: “${key}” needs render(app, el, shell, ctx)`);
  for (const k of ['available', 'emptyActions', 'signature', 'badge']) {
    if (s[k] != null && typeof s[k] !== 'function') throw new TypeError(`registerPanelSection: “${key}”: ${k} must be a function of the app`);
  }
  const slot = s.slot ?? 'main';
  const slots = PANEL_SLOTS[panelId];
  if (slots && !slots.includes(slot)) throw new Error(`registerPanelSection: the ${panelId} panel has no slot “${slot}” (use ${slots.join(' or ')})`);
  if (s.order != null && !Number.isFinite(s.order)) throw new TypeError(`registerPanelSection: “${key}”: order must be a number`);
  const refreshOn = s.refreshOn ?? DEFAULT_REFRESH;
  if (!Array.isArray(refreshOn) || refreshOn.some((r) => typeof r !== 'string' || !r)) throw new TypeError(`registerPanelSection: “${key}”: refreshOn must be a list of event names`);
  return { src: s, panelId, id: s.id, key, title: s.title, order: s.order ?? null, slot, defaultOpen: s.defaultOpen ?? null, refreshOn: [...refreshOn], seq: seq++ };
}

/**
 * Add a section to a panel ('surface', or 'structure' with slot 'cell' | 'transform'); returns a function
 * that removes it again. A section with the id of an existing one replaces it (with a console warning unless
 * `replace` is set) until it is removed, which brings the earlier one back.
 */
export function registerPanelSection(panelId, section, { replace = false } = {}) {
  if (typeof panelId !== 'string' || !panelId) throw new TypeError("registerPanelSection: expected a panel id ('surface' or 'structure')");
  const e = normalize(panelId, section);
  if (!registry.has(panelId)) registry.set(panelId, new Map());
  const byId = registry.get(panelId);
  if (!byId.has(e.id)) byId.set(e.id, []);
  const list = byId.get(e.id);
  if (list.length && !replace) console.warn(`registerPanelSection: “${e.key}” already exists and is replaced (pass { replace: true } to do this on purpose)`);
  list.push(e);
  subscribe(e.refreshOn);
  changed(panelId);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
    if (!list.length && byId.get(e.id) === list) byId.delete(e.id);
    changed(panelId);
  };
}

/**
 * A section that panel `panelId` always shows ({id, title, order, slot, defaultOpen}): a placeholder until a
 * module registers that id, whose own title, order and defaultOpen win when it gives them. Returns a remover.
 */
export function reservePanelSection(panelId, { id, title, order = 100, slot = 'main', defaultOpen = true } = {}) {
  if (typeof panelId !== 'string' || !panelId || typeof id !== 'string' || !id || typeof title !== 'string' || !title) throw new TypeError('reservePanelSection: expected a panel id and {id, title}');
  if (!reserved.has(panelId)) reserved.set(panelId, new Map());
  const e = { panelId, id, key: `${panelId}.${id}`, title, order, slot, defaultOpen, seq: seq++ };
  reserved.get(panelId).set(id, e);
  changed(panelId);
  return () => { if (reserved.get(panelId)?.get(id) === e) { reserved.get(panelId).delete(id); changed(panelId); } };
}

/**
 * The sections of a panel as shown: [{key, id, title, order, slot, defaultOpen, refreshOn, placeholder, src}], by slot
 * (in the panel's order), then order, then registration. `slot` limits them to one slot (all slots when omitted).
 */
export function panelSections(panelId, { slot } = {}) {
  const res = reserved.get(panelId) ?? new Map();
  const out = [];
  for (const list of (registry.get(panelId) ?? new Map()).values()) {
    const e = list.at(-1);
    if (!e) continue;
    const r = res.get(e.id);
    out.push({ key: e.key, id: e.id, panelId, title: e.title, order: e.order ?? r?.order ?? 100, slot: e.slot, defaultOpen: e.defaultOpen ?? r?.defaultOpen ?? true,
      refreshOn: e.refreshOn, placeholder: false, src: e.src, seq: e.seq });
  }
  const have = new Set(out.map((s) => s.id));
  for (const r of res.values()) {
    if (have.has(r.id)) continue;
    out.push({ key: r.key, id: r.id, panelId, title: r.title, order: r.order, slot: r.slot, defaultOpen: r.defaultOpen, refreshOn: [], placeholder: true, src: null, seq: r.seq });
  }
  const rank = (s) => Math.max(0, PANEL_SLOTS[panelId]?.indexOf(s.slot) ?? 0);   // slots in the panel's order
  return out.filter((s) => slot == null || s.slot === slot).sort((a, b) => rank(a) - rank(b) || a.order - b.order || a.seq - b.seq);
}

/** What a section's available() says: {ok: true}, {reason} (a sentence) or {error} (it threw). */
export function sectionAvailability(sec, app) {
  if (sec.placeholder) return { reason: PLACEHOLDER_TEXT };
  if (typeof sec.src?.available !== 'function') return { ok: true };
  let r;
  try { r = sec.src.available(app); } catch (error) { return { error }; }
  if (r === true || r == null) return { ok: true };
  if (typeof r === 'string' && r.trim()) return { reason: r };
  return { reason: 'Not available right now.' };
}
const availKey = (a) => (a.ok ? '' : a.reason != null ? `r:${a.reason}` : `e:${a.error?.message ?? a.error}`);

let unique = 0;
/** A section's signature; a fresh value (always "changed") when it has none or it throws. */
export function sectionSignature(sec, app) {
  if (typeof sec.src?.signature !== 'function') return `\u0000${++unique}`;
  try { return String(sec.src.signature(app)); } catch { return `\u0000${++unique}`; }
}

/** The badge text of a section ('' for none). */
export function sectionBadge(sec, app) {
  if (typeof sec.src?.badge !== 'function') return '';
  try { const b = sec.src.badge(app); return b == null ? '' : String(b); } catch { return ''; }
}

/**
 * The part of a panel's signature that comes from its sections: which sections it has and what their
 * available() says (all slots). The Surface panel's signature is this plus the active structure and its key.
 */
export function sectionsSignature(panelId, app) {
  return panelSections(panelId).map((s) => [s.key, s.title, availKey(sectionAvailability(s, app))]);
}

/** Whether a section is open: the `sections` preference, else its defaultOpen. */
export function sectionOpen(app, sec) {
  const v = app?.prefs?.sections?.[sec.key];
  return typeof v === 'boolean' ? v : sec.defaultOpen !== false;
}
function rememberOpen(app, key, open) {
  const cur = app?.prefs?.sections ?? {};
  if (cur[key] === open || typeof app?.setPref !== 'function') return;
  app.setPref('sections', { ...cur, [key]: open });
}

// ------------------------------------------------------------------ reasons for available()
/** available() helper: true when the active structure has a unit cell, else the reason. */
export function requireCell(app) {
  const s = app?.structure;
  if (!s) return NO_STRUCTURE;
  return s.cell ? true : NO_CELL;
}

// F0-D's vacuum-gap module (core/vacuum.js), loaded on first use: undefined = not asked for, null = not (yet) loaded
let vacuum;
function vacuumModule() {
  if (vacuum === undefined) {
    vacuum = null;
    import('../core/vacuum.js').then((m) => { vacuum = m; refreshAllSections(); }, () => { /* not in this build */ });
  }
  return vacuum;
}

/**
 * available() helper: true when the active structure has a surface (surfaceNormal(s).surface: a vacuum gap
 * along one cell vector, or one non-periodic axis), else vacuumGapHint(s) as a sentence, e.g. "No vacuum gap
 * of 5 Å or more along a cell vector (the widest is 4.4 Å along c); add vacuum first." A section that shows
 * this reason and has no emptyActions gets a "Build vacuum slab…" button (when that command exists).
 * `vac` = {surfaceNormal, vacuumGapHint} (core/vacuum.js); while that module is not loaded this returns true.
 */
export function requireVacuumGap(app, vac = vacuumModule()) {
  const s = app?.structure;
  if (!s) return NO_STRUCTURE;
  if (typeof vac?.surfaceNormal !== 'function') return true;
  if (vac.surfaceNormal(s)?.surface) return true;
  return sentence(vac.vacuumGapHint?.(s) || 'no vacuum gap found');
}

/**
 * available() helper: the reason while another module's preview is open (app.session); a section whose own
 * preview it is passes its `owner`. List 'preview' in the section's refreshOn so it follows the session.
 */
export function requireNoPreview(app, { owner = null } = {}) {
  const ses = app?.session;
  if (!ses || ses.active === false) return true;
  return owner != null && ses.owner === owner ? true : IN_PREVIEW;
}

/** available() helper for a section that needs start-up data (core/boot.js): the reason when that task failed. */
export function requireBootTask(name, title = 'This section') {
  return bootTaskStatus(name)?.state === 'failed' ? `${title} needs data that failed to load; reload the page.` : true;
}

// ------------------------------------------------------------------ drawing and refreshing (DOM)
let host = null;                 // the Shell (attachSections)
const mounts = new Map();        // panelId → Set of drawn sections {sec, app, shell, details, body, badge, open, avail, sig, pending}
const subscribed = new Set();    // app and viewer events the sections follow
let queued = null;               // events since the last refresh (refreshed together, after the event)
let openArgs = null;             // {key, focus, tab}: handed to that section's next draw by openSection()
let changedPanels = null;

/** Called by the Shell once it exists: sections follow app and viewer events, and openSection() can open panels. */
export function attachSections(shell) {
  if (host === shell) return;
  host = shell;
  for (const byId of registry.values()) for (const list of byId.values()) for (const e of list) subscribe(e.refreshOn);
}

function subscribe(reasons) {
  const app = host?.app;
  if (!app) return;
  for (const r of reasons) {
    if (subscribed.has(r)) continue;
    subscribed.add(r);
    app.on?.(r, () => queue(r));
    app.viewer?.on?.(r, () => queue(r));
  }
}
function queue(reason) {
  if (!queued) { queued = new Set(); queueMicrotask(() => { const r = [...queued]; queued = null; for (const id of [...mounts.keys()]) refresh(id, r); }); }
  queued.add(reason);
}

/** A section was added or removed: the panel showing it is drawn again (after the user leaves a field). */
function changed(panelId) {
  if (!changedPanels) {
    changedPanels = new Set();
    queueMicrotask(() => { const ids = [...changedPanels]; changedPanels = null; for (const id of ids) host?.refreshPanel?.(id); });
  }
  changedPanels.add(panelId);
}

/**
 * Draw the sections of `panelId` (one `slot`) at the end of `el`; returns how many there are. The panel's
 * render calls this; each section then redraws on its own.
 */
export function renderSections(panelId, app, el, shell, { slot = 'main' } = {}) {
  if (shell && !host) attachSections(shell);
  if (!mounts.has(panelId)) mounts.set(panelId, new Set());
  const set = mounts.get(panelId);
  for (const m of [...set]) if (!m.details.isConnected) set.delete(m);
  const list = panelSections(panelId, { slot });
  for (const sec of list) {
    const m = mount(sec, app, shell);
    set.add(m);
    el.append(m.details);
    if (m.open) draw(m, { inPlace: false });
  }
  return list.length;
}

function mount(sec, app, shell) {
  const badge = h('span.badge', { hidden: true });
  const summary = h('summary', { 'data-key': `sec:${sec.key}` }, ic('chevronRight', 'sm chev'), h('h3', sec.title), badge);
  const body = h('div.sec-body');
  const details = h('details.sec', { dataset: { sec: sec.key } }, summary, body);
  const m = { sec, app, shell, details, body, badge, open: sectionOpen(app, sec), avail: null, sig: null, pending: false };
  details.open = m.open;
  // (setting `open` above queues a toggle event too: only real changes count)
  details.addEventListener('toggle', () => {
    if (details.open === m.open) return;
    m.open = details.open;
    rememberOpen(app, sec.key, m.open);
    if (m.open) draw(m);
  });
  body.addEventListener('focusout', () => { if (m.pending) later(m); });
  setBadge(m);
  return m;
}

function setBadge(m) {
  const t = sectionBadge(m.sec, m.app);
  if (m.badge.textContent !== t) m.badge.textContent = t;
  m.badge.hidden = !t;
}

/**
 * Draw a section's body afresh. Redrawn in place (`inPlace`), it keeps the focus in it and the panel's scroll
 * position; the panel's own first draw skips that (reading the scroll position there would lay out the page each time).
 */
function draw(m, { inPlace = true } = {}) {
  const { sec, app, shell, body } = m;
  const a = sectionAvailability(sec, app);
  const focus = inPlace ? shell?._captureFocus?.(body) ?? null : null;
  const scroller = inPlace ? body.closest?.('.panel-body') : null;
  const y = scroller?.scrollTop;
  m.pending = false;
  body.replaceChildren();
  if (a.ok) {
    const args = openArgs?.key === sec.key ? openArgs : null;
    const ctx = { section: m.details, id: sec.key, open: m.details.open, focus: args?.focus ?? null, tab: args?.tab ?? null };
    try { sec.src.render(app, body, shell, ctx); }
    catch (e) { console.error(e); body.replaceChildren(h('p.err-text', `This section failed to load: ${e?.message ?? e}`)); }
  } else if (a.error) {
    console.error(a.error);
    body.append(h('p.err-text', `This section failed to load: ${a.error?.message ?? a.error}`));
  } else {
    body.append(h('p.hint.sec-why', a.reason));
    const acts = emptyActions(m, a.reason);
    if (acts.length) body.append(h('div.sec-acts', acts));
  }
  m.avail = availKey(a);
  m.sig = a.ok ? sectionSignature(sec, app) : null;
  if (scroller && y != null) scroller.scrollTop = y;
  if (focus) shell._restoreFocus?.(body, focus);
}

/** The buttons under a reason: the section's emptyActions, else "Build vacuum slab…" for a missing vacuum gap. */
function emptyActions(m, reason) {
  const { sec, app, shell } = m;
  if (sec.placeholder) return [];
  if (typeof sec.src?.emptyActions === 'function') {
    try { return (sec.src.emptyActions(app) ?? []).filter((x) => x instanceof Node); } catch (e) { console.error(e); return []; }
  }
  const c = commands.get('surface.vacuum');
  if (!c || reason !== requireVacuumGap(app)) return [];
  return [btn('Build vacuum slab…', { icon: 'plus', cls: 'small', tip: 'Add a vacuum gap along one cell vector', on: () => (shell?.runCommand ? shell.runCommand(c) : commands.run(c.id)) })];
}

/** Redraw one drawn section if what it shows changed (a collapsed one only updates its badge). */
function update(m) {
  setBadge(m);
  if (!m.open) return;
  const a = sectionAvailability(m.sec, m.app);
  const same = availKey(a) === m.avail && (!a.ok || sectionSignature(m.sec, m.app) === m.sig);
  if (same) return;
  const sh = m.shell;
  // the user is typing in this section, or a field just handed the focus on: wait until they leave it
  if (sh?._typingIn?.(m.body) || (sh?.drawer && sh._focusMoving?.(sh.drawer))) {
    if (!m.pending) { m.pending = true; if (!sh._typingIn(m.body)) later(m); }
    return;
  }
  draw(m);
}
function later(m) {
  const run = () => setTimeout(() => {
    if (!m.pending || !m.details.isConnected) return;
    if (m.shell?._typingIn?.(m.body)) return;   // moved to another field of the same section: wait for that one
    m.pending = false;
    m.avail = null;   // what changed while typing is unknown: draw afresh
    update(m);
  }, 0);
  // wait for the click that moved the focus (e.g. on Apply) to land before the section is rebuilt
  if (m.shell?._pointerDown) addEventListener('pointerup', run, { once: true, capture: true }); else run();
}

function refresh(panelId, reasons) {
  const set = mounts.get(panelId);
  if (!set) return;
  for (const m of [...set]) if (!m.details.isConnected) set.delete(m);
  if (!set.size) return;
  const shell = host ?? [...set][0].shell;
  // hidden (drawn afresh when shown) or about to be drawn again as a whole: nothing to do here
  if ((shell?.panelState?.(panelId, reasons ?? []) ?? 'current') !== 'current') return;
  for (const m of [...set]) if (!reasons || reasons.some((r) => m.sec.refreshOn.includes(r))) update(m);
}

/**
 * Redraw the sections of a panel whose signature or availability changed; `reason` limits this to the
 * sections that list it in refreshOn (all sections when omitted). Events in refreshOn do this by themselves.
 */
export function refreshSections(panelId, reason) {
  refresh(panelId, reason == null ? null : [].concat(reason));
}
function refreshAllSections() { for (const id of [...mounts.keys()]) refresh(id, null); }

/**
 * Open panel `panelId` at a section: expand it, scroll to it and focus its control with data-key `focus`
 * (else its heading). `tab` is handed to the section's render as ctx.tab. Returns false for an unknown section.
 */
export function openSection(panelId, sectionId, { focus = null, tab = null } = {}) {
  const key = `${panelId}.${sectionId}`;
  const known = panelSections(panelId).some((s) => s.id === sectionId);
  if (!host) return false;
  if (known) rememberOpen(host.app, key, true);
  openArgs = { key, focus, tab };
  try { host.openLeft(panelId); } finally { openArgs = null; }
  const m = [...(mounts.get(panelId) ?? [])].find((x) => x.sec.key === key && x.details.isConnected);
  if (!m) return known;
  if (!m.details.open) m.details.open = true;
  // after the drawer has put back its own scroll position (it may do so in the next frame)
  requestAnimationFrame(() => {
    if (!m.details.isConnected) return;
    m.details.scrollIntoView?.({ block: 'start' });
    const target = (focus != null && m.body.querySelector(`[data-key="${CSS.escape(String(focus))}"]`)) || m.details.querySelector('summary');
    target?.focus({ preventScroll: true });
  });
  return true;
}
