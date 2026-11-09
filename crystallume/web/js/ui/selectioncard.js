/**
 * Selection card: what is selected (element, position, coordination; distance, angle or dihedral for
 * 2–4 atoms) with quick actions. Bottom-left of the view on desktop, a slim strip on phones.
 * Also exports the selection helpers used by commands and the atom context menu, and the registry of
 * selection actions (registerSelectionAction) behind the card's buttons and the atom menus.
 */
import { h, ic, btn } from './dom.js';
import { toast, promptDialog, showMenu, dialog } from './overlays.js';
import { element, normalizeSymbol } from '../core/elements.js';
import { elementColorHex } from '../render/colors.js';
import { bondedFragment, storedImage } from '../render/display.js';
import { inv3, cartToFrac, det3, cross, norm } from '../core/util.js';
import { keyLabel } from './keys.js';
import { atomInfoRows } from './atominfo.js';

const MEASURE = { 2: 'distance', 3: 'angle', 4: 'dihedral' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ------------------------------------------------------------------ helpers (shared)
/** Display index of source atom `src`, preferring the copy inside the cell (image 0,0,0); -1 if hidden. */
export function displayIndexOf(model, src) {
  if (!model?.n) return -1;
  let first = -1;
  for (let d = 0; d < model.n; d++) {
    if (model.src[d] !== src) continue;
    if (!model.img[3 * d] && !model.img[3 * d + 1] && !model.img[3 * d + 2]) return d;
    if (first < 0) first = d;
  }
  return first;
}

/** Display indices for a list of source atoms, each the drawn copy nearest to the previous one. */
export function chainDisplay(model, srcs) {
  const out = [];
  for (const s of srcs) {
    if (!out.length) { out.push(displayIndexOf(model, s)); continue; }
    const prev = out.at(-1);
    if (prev < 0) { out.push(displayIndexOf(model, s)); continue; }
    const p = model.positions, px = p[3 * prev], py = p[3 * prev + 1], pz = p[3 * prev + 2];
    let best = -1, bd = Infinity;
    for (let d = 0; d < model.n; d++) {
      if (model.src[d] !== s) continue;
      const dd = (p[3 * d] - px) ** 2 + (p[3 * d + 1] - py) ** 2 + (p[3 * d + 2] - pz) ** 2;
      if (dd < bd) { bd = dd; best = d; }
    }
    out.push(best);
  }
  return out;
}

const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);

/** Distance (Å), angle (°) or dihedral (°) between 2, 3 or 4 points. */
export function geometryValue(P) {
  if (P.length === 2) return vlen(vsub(P[1], P[0]));
  if (P.length === 3) {
    const u = vsub(P[0], P[1]), v = vsub(P[2], P[1]);
    return (Math.acos(Math.max(-1, Math.min(1, vdot(u, v) / (vlen(u) * vlen(v) || 1)))) * 180) / Math.PI;
  }
  const b1 = vsub(P[1], P[0]), b2 = vsub(P[2], P[1]), b3 = vsub(P[3], P[2]);
  const n1 = vcross(b1, b2), n2 = vcross(b2, b3), m1 = vcross(n1, b2.map((x) => x / (vlen(b2) || 1)));
  return (Math.atan2(vdot(m1, n2), vdot(n1, n2)) * 180) / Math.PI;
}

/** Atom i's stored position (current frame) moved by whole cells I: r_i + I·cell. */
function storedPoint(s, i, I) {
  const p = s.pos(i), c = s.cell;
  if (!c || !(I[0] || I[1] || I[2])) return p;
  return [0, 1, 2].map((k) => p[k] + I[0] * c[0][k] + I[1] * c[1][k] + I[2] * c[2][k]);
}

/**
 * The shortest periodic image of vector v over the periodic axes of `cell`. Rounding the fractional coordinates gives
 * an image of length R; a shorter one differs from it by a lattice vector t with |t| ≤ 2R, whose coefficient along
 * a_k is at most 2R / h_k (h_k: the distance of a_k from the span of the other periodic vectors), so the search below
 * misses none, whatever the shape of the cell.
 */
function minimumImage(v, cell, pbc) {
  const P = [0, 1, 2].filter((k) => pbc?.[k]);
  if (!cell || !P.length) return v.slice();
  let inv;
  try { inv = inv3(cell); } catch { return v.slice(); }
  const g = cartToFrac(v, inv), v0 = v.slice();
  for (const k of P) { const n = -Math.floor(g[k] + 0.5); for (let c = 0; c < 3; c++) v0[c] += n * cell[k][c]; }
  const R = norm(v0);
  if (!(R > 0)) return v0;
  const h = P.map((k) => {
    const o = P.filter((j) => j !== k);
    if (o.length === 2) return Math.abs(det3(cell)) / norm(cross(cell[o[0]], cell[o[1]]));
    if (o.length === 1) return norm(cross(cell[k], cell[o[0]])) / norm(cell[o[0]]);
    return norm(cell[k]);
  });
  const K = h.map((x) => Math.floor((2 * R) / x + 1e-9));
  const sizes = K.map((x) => 2 * x + 1), total = sizes.reduce((a, b) => a * b, 1);
  if (!Number.isFinite(total) || total > 1e6) return v0;
  let best = v0, bestL = R * R;
  for (let t = 0; t < total; t++) {
    const w = v0.slice();
    for (let a = 0, r = t; a < P.length; a++) {
      const n = (r % sizes[a]) - K[a];
      r = Math.floor(r / sizes[a]);
      if (n) for (let c = 0; c < 3; c++) w[c] += n * cell[P[a]][c];
    }
    const L = w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
    if (L < bestL - 1e-12) { bestL = L; best = w; }
  }
  return best;
}

/**
 * Float64 points for the selected source atoms: on the drawn copies chained by proximity, each the stored position
 * plus that copy's stored image; when an atom has no drawn copy (hidden), a chain of shortest periodic images from the
 * first atom (P_k+1 = P_k + the shortest image of r_k+1 − r_k). {ds: drawn indices | null, P}.
 */
export function selectionPoints(app, sel) {
  const m = app.viewer?.model, s = app.structure;
  const ds = m ? chainDisplay(m, sel) : [];
  if (ds.length === sel.length && ds.every((d) => d >= 0)) return { ds, P: ds.map((d, k) => storedPoint(s, sel[k], storedImage(m, d))) };
  const P = [];
  sel.forEach((i, k) => {
    if (!k) { P.push(s.pos(i)); return; }
    const a = s.pos(sel[k - 1]), b = s.pos(i), prev = P[k - 1];
    const d = s.periodic ? minimumImage([b[0] - a[0], b[1] - a[1], b[2] - a[2]], s.cell, s.pbc) : [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    P.push([prev[0] + d[0], prev[1] + d[1], prev[2] + d[2]]);
  });
  return { ds: null, P };
}

/** Select every atom of the elements in the selection (or of `symbol`). */
export function selectSameElement(app, symbol = null) {
  const s = app.structure;
  if (!s) return;
  const syms = new Set(symbol ? [symbol] : app.selection.map((i) => s.symbols[i]));
  if (!syms.size) { toast('Select an atom first.'); return; }
  app.select(s.symbols.map((x, i) => (syms.has(x) ? i : -1)).filter((i) => i >= 0));
}

/** Grow the selection (or select `srcs`) by the bonded neighbours, as drawn. */
export function selectNeighbours(app, srcs = null) {
  const m = app.viewer.model;
  const base = new Set(srcs ?? app.selection);
  if (!m?.n || !base.size) { toast('Select an atom first.'); return; }
  const out = new Set(base);
  const pairs = m.bonds?.pairs ?? [];
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const a = m.src[pairs[k]], b = m.src[pairs[k + 1]];
    if (base.has(a)) out.add(b);
    if (base.has(b)) out.add(a);
  }
  app.select([...out]);
  if (out.size === base.size) toast(m.bonds?.count ? 'No more bonded neighbours to add.' : 'Bonds are hidden, so there are no neighbours to add.');
}

/** Select the bonded fragments (molecules) of `srcs` or of the selected atoms, as drawn. */
export function selectFragment(app, srcs = null) {
  const m = app.viewer.model;
  const base = srcs ?? app.selection;
  if (!m?.n || !base.length) { toast('Select an atom first.'); return; }
  app.select(bondedFragment(m, base));
  if (!m.bonds?.count && m.n > 1) toast('Bonds are hidden, so each atom is a fragment of its own.');
}

/**
 * Select all atoms of the active structure. While visibility masks hide atoms (viewer.setVisibility), only the
 * visible ones, and a toast says how many are hidden (selecting by index, through the API or a query, still reaches
 * hidden atoms).
 */
export function selectAll(app) {
  const s = app.structure;
  if (!s) return;
  const v = app.viewer, hidden = v?.hiddenCount ?? 0;
  const all = s.symbols.map((_, i) => i);
  if (!hidden) { app.select(all); return; }
  const shown = all.filter((i) => v.isVisible(i));
  app.select(shown);
  toast(`Selected ${plural(shown.length, 'visible atom')} (${hidden} hidden).`);
}

/** The atoms of `sel` (source indices) that visibility masks hide. */
export function hiddenInSelection(app, sel = app.selection) {
  const v = app.viewer;
  return (v?.hiddenCount ?? 0) > 0 ? sel.filter((i) => !v.isVisible(i)) : [];
}

/**
 * Before a destructive action on the selection (`verb`: 'Delete' or 'Change'): when visibility masks hide some of its
 * atoms, ask whether the action takes them too. Resolves to the atoms to act on: the whole selection, only its visible
 * atoms, or null (cancelled); without hidden atoms, to `sel` at once.
 */
export function confirmHiddenSelection(app, verb = 'Delete', sel = app.selection) {
  const hidden = hiddenInSelection(app, sel);
  if (!hidden.length) return Promise.resolve(sel);
  const gone = new Set(hidden), visible = sel.filter((i) => !gone.has(i));
  const n = sel.length, k = hidden.length;
  const message = k < n
    ? `${k} of the ${n} selected atoms ${k === 1 ? 'is' : 'are'} hidden. ${verb} ${k === 1 ? 'it' : 'them'} too?`
    : `${n === 1 ? 'The selected atom is' : `All ${n} selected atoms are`} hidden. ${verb} ${n === 1 ? 'it' : 'them'}?`;
  return new Promise((resolve) => {
    let done = false;
    const pick = (atoms) => () => { done = true; resolve(atoms); };
    dialog({
      title: `${verb} hidden atoms?`,
      body: h('p.hint', { style: { fontSize: '13.5px', color: 'var(--fg-2)' } }, message),
      actions: [
        { label: 'Cancel', run: pick(null) },
        visible.length ? { label: `Only the ${visible.length} visible`, run: pick(visible) } : null,
        { label: n === 1 ? verb : `${verb} all ${n}`, danger: verb === 'Delete', primary: verb !== 'Delete', run: pick(sel) },
      ],
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

/** Delete the selected atoms (Delete key, selection card, menus), asking first when visibility masks hide some of them. */
export async function deleteSelection(app) {
  const sel = app.selection;
  if (!sel.length || !app.structure) return;
  const atoms = await confirmHiddenSelection(app, 'Delete', sel);
  if (!atoms?.length) return;
  if (atoms.length !== sel.length) app.select(atoms);
  app.deleteSelected();
}

/** Centre the view on an atom (display index) or on the drawn atom nearest the selection's centre. */
export function centreSelection(app, display = null) {
  const v = app.viewer, m = v.model;
  if (!m?.n) return;
  let d = display;
  if (d == null) {
    // the selected atom nearest the selection's centre (one pass over the drawn atoms at the end)
    const sel = app.selection, s = app.structure;
    if (!sel.length || !s) return;
    const P = sel.map((i) => s.pos(i));
    const c = P.reduce((a, p) => [a[0] + p[0] / P.length, a[1] + p[1] / P.length, a[2] + p[2] / P.length], [0, 0, 0]);
    let k = 0;
    P.forEach((p, j) => { if (vlen(vsub(p, c)) < vlen(vsub(P[k], c))) k = j; });
    d = displayIndexOf(m, sel[k]);
  }
  if (d >= 0) v.focusAtom(d);
}

/** Start the measure tool with atom `display` as the first pick. */
export function measureFrom(app, display) {
  app.setTool('measure', 'distance');
  if (display == null || display < 0) return;
  app.measurePicks = [display];
  app.viewer.setSelection([app.viewer.model.src[display]]);
  app.emit('tool'); app.emit('selection');
}

/** Ask for an element and change the selected atoms to it; the toast's Undo reverts that change. */
export async function replaceSelection(app) {
  const n = app.selection.length;
  if (!n) return;
  const v = await promptDialog({ title: `Change ${plural(n, 'atom')} to…`, label: 'Element symbol (e.g. Fe, O, Ti)', confirm: 'Change', placeholder: 'Fe' });
  if (!v) return;
  const sym = normalizeSymbol(v);
  if (sym === 'X') { toast(`“${v}” is not an element symbol. Try Fe, O or Ti.`, { type: 'error' }); return; }
  const k = app.selection.length, r = app.replaceSelected(sym);   // the selection may have changed while the dialog was open
  if (r) app.toastUndo(`Changed ${plural(k, 'atom')} to ${sym}`, { entry: r.entry });
}

/** Keep the selected geometry as a measurement (2–4 atoms of `sel`) or start measuring from one atom. */
export function measureSelection(app, sel = app.selection) {
  const m = app.viewer.model;
  if (sel.length === 1) { measureFrom(app, displayIndexOf(m, sel[0])); return; }
  if (sel.length < 2 || sel.length > 4) return;
  const ds = chainDisplay(m, sel);
  if (ds.some((d) => d < 0)) { toast('Show the hidden atoms first to measure them.', { type: 'error' }); return; }
  // the id stays for the session (edits, undo and redo keep it), so Remove still finds the measurement later
  const { id } = app.viewer.addMeasurement(MEASURE[sel.length], ds);
  app.emit('measure');
  toast(`Added a ${MEASURE[sel.length]} measurement`, { action: { label: 'Remove', run: () => { app.viewer.removeMeasurement(id); app.emit('measure'); } } });
}

/** Change the element of the selected atoms (Replace…), asking first when visibility masks hide some of them. */
async function replaceSelectionChecked(app) {
  const sel = app.selection;
  if (!sel.length) return;
  const atoms = await confirmHiddenSelection(app, 'Change', sel);
  if (!atoms?.length) return;
  if (atoms.length !== sel.length) app.select(atoms);
  await replaceSelection(app);
}

/** Negative numbers with a minus sign: (0, 0, −1). */
const signed = (x) => (x < 0 ? `−${-x}` : String(x));
/** Stored fractional coordinates of atom i (null without a usable cell). */
function storedFrac(s, i) {
  if (!s.cell) return null;
  try { return cartToFrac(s.pos(i), inv3(s.cell)); } catch { return null; }
}

// ------------------------------------------------------------------ selection actions (card buttons, atom menus)
/**
 * Actions on selected atoms: selection-card buttons and atom context-menu items, which modules add with
 *   registerSelectionAction({ id, label, short = label, icon, tip, kbd, order = 100, card = true, menu = true,
 *                             when(app, sel), enabled(app, sel), run(app, sel, ctx), items(app, sel), rows(app, sel), danger })
 * - label, short (touch screens, narrow windows), icon and tip are strings or functions (app, sel) → string; kbd is a key spec shown as a hint.
 * - when(app, sel) false: not shown (takes no place); enabled(app, sel) false: shown greyed (buttons do not jump around).
 * - card: a selection-card button. menu: true = the atom context menu, 'blank' = the menu on empty space, 'both', false.
 * - run(app, sel, ctx): sel = source indices; ctx = {source: 'card' | 'menu' | 'blank', atom, display} (the right-clicked
 *   atom and its drawn copy, −1 on the card). In the atom menu sel is the whole selection when the clicked atom is in a
 *   selection of several, else just that atom (menuTarget); on empty space it is the selection (maybe empty).
 * - items(app, sel) → [{id, label, kbd, tip, icon, separator, enabled, run}]: a split button (main part runs `run`, ▾ lists
 *   the items); menus list the items instead of the action. An item without run calls the action's run with ctx.item = id.
 * - rows(app, sel) → [{label, value}]: lines the card shows while the action is shown.
 * Order numbers are a contract (F0-A §5.4): Centre 10, Same element 20, Measure 30, Fix ▾ 35, Replace 40, Delete 50,
 * Move… 60, Rotate… 61, Mark as adsorbate 70. The card shows up to 7 buttons (5 on touch or narrow screens); with more,
 * the last place is More, a menu of the rest.
 */
export const CARD_LIMITS = Object.freeze({ desktop: 7, narrow: 5 });
const MENU_VALUES = [true, false, 'blank', 'both'];
const actions = new Map();   // id → [entry, …]; the last entry of a list is the active one
let actionSeq = 0;
const cards = new Set();     // live selection cards, redrawn when the actions change
const reported = new WeakSet();

/** Call fn(app, sel) of an action, or return `fallback` when it throws (reported once per function). */
function attempt(fn, app, sel, fallback) {
  try { return fn(app, sel); } catch (e) {
    if (!reported.has(fn)) { reported.add(fn); console.error('selection action failed', e); }
    return fallback;
  }
}
const resolve = (v, app, sel, fallback = null) => (typeof v === 'function' ? attempt(v, app, sel, fallback) : v ?? fallback);

/** Add a selection action; returns a function that removes it (bringing back an earlier one with the same id). */
export function registerSelectionAction(a, { replace = false } = {}) {
  if (!a || typeof a !== 'object') throw new TypeError('registerSelectionAction: expected an action object');
  if (typeof a.id !== 'string' || !a.id) throw new TypeError('registerSelectionAction: missing id');
  if (!(typeof a.label === 'string' && a.label) && typeof a.label !== 'function') throw new TypeError(`registerSelectionAction: “${a.id}” needs a label`);
  if (typeof a.run !== 'function' && typeof a.items !== 'function') throw new TypeError(`registerSelectionAction: “${a.id}” needs run(app, sel, ctx) or items(app, sel)`);
  for (const k of ['when', 'enabled', 'items', 'rows']) if (a[k] != null && typeof a[k] !== 'function') throw new TypeError(`registerSelectionAction: “${a.id}”: ${k} must be a function (app, sel)`);
  const menu = a.menu ?? true;
  if (!MENU_VALUES.includes(menu)) throw new TypeError(`registerSelectionAction: “${a.id}”: menu must be true, false, 'blank' or 'both'`);
  if (a.order != null && !Number.isFinite(a.order)) throw new TypeError(`registerSelectionAction: “${a.id}”: order must be a number`);
  const e = { ...a, order: a.order ?? 100, card: a.card !== false, menu, seq: actionSeq++ };
  if (!actions.has(a.id)) actions.set(a.id, []);
  const list = actions.get(a.id);
  if (list.length && !replace) console.warn(`registerSelectionAction: “${a.id}” already exists and is replaced (pass { replace: true } to do this on purpose)`);
  list.push(e);
  redrawCards();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
    if (!list.length && actions.get(a.id) === list) actions.delete(a.id);
    redrawCards();
  };
}
let redrawQueued = false;
function redrawCards() {
  if (redrawQueued) return;
  redrawQueued = true;
  queueMicrotask(() => { redrawQueued = false; for (const c of cards) if (!c.el.hidden) c.update(); });
}

/** Whether action `a` belongs in `where`: 'card', 'menu' (an atom's context menu) or 'blank' (the menu on empty space). */
const shownIn = (a, where) => (where === 'card' ? a.card : where === 'blank' ? a.menu === 'blank' || a.menu === 'both' : a.menu === true || a.menu === 'both');

/** The actions shown for `sel` in 'card', 'menu' or 'blank', in order (`when` true; disabled ones included). */
export function selectionActions(app, sel, where = 'card') {
  const out = [];
  for (const list of actions.values()) {
    const a = list.at(-1);
    if (!a || !shownIn(a, where)) continue;
    if (a.when && !attempt(a.when, app, sel, false)) continue;
    out.push(a);
  }
  return out.sort((x, y) => x.order - y.order || x.seq - y.seq);
}

/** An action's label, short label, icon, tip, key hint, enabled state and items for `sel`. */
export function actionView(a, app, sel) {
  const label = String(resolve(a.label, app, sel, a.id) || a.id);
  const items = a.items ? resolve(a.items, app, sel, null) : null;
  return {
    id: a.id, label, short: String(resolve(a.short, app, sel, label) || label),
    icon: resolve(a.icon, app, sel, null), tip: resolve(a.tip, app, sel, null), kbd: a.kbd ? keyLabel(a.kbd) : null,
    enabled: a.enabled ? !!attempt(a.enabled, app, sel, false) : true, danger: !!a.danger,
    items: Array.isArray(items) && items.length ? items : null,
  };
}

/** The card lines of the shown actions: [{label, value}] as strings. */
export function actionRows(list, app, sel) {
  const out = [];
  for (const a of list) {
    if (!a.rows) continue;
    const rows = attempt(a.rows, app, sel, null);
    for (const r of Array.isArray(rows) ? rows : []) if (r && r.label != null && r.label !== '') out.push({ label: String(r.label), value: r.value == null ? '' : String(r.value) });
  }
  return out;
}

/** The atoms an atom-menu action works on: the selection when the clicked atom `src` is in a selection of several, else that atom. */
export function menuTarget(selection, src) {
  const sel = [...(selection ?? [])];
  return sel.length > 1 && sel.includes(src) ? sel : [src];
}

/** Card buttons for the shown actions: all of them up to the limit, else the first limit − 1 and More with the rest. */
export function splitCardActions(list, { narrow = false } = {}) {
  const limit = narrow ? CARD_LIMITS.narrow : CARD_LIMITS.desktop;
  return list.length <= limit ? { shown: list.slice(), more: [] } : { shown: list.slice(0, limit - 1), more: list.slice(limit - 1) };
}

/** Run an action or item; errors (thrown or rejected) become a toast. */
function runAction(fn, app, sel, ctx) {
  try { const r = fn?.(app, sel, ctx); r?.catch?.((e) => toast(e?.message ?? String(e), { type: 'error' })); }
  catch (e) { console.error(e); toast(e?.message ?? String(e), { type: 'error' }); }
}

/**
 * Menu items (for showMenu) of an action: its items when it has any, else one item. `locked` greys them all
 * (a drag preview is open).
 */
export function actionMenuItems(a, app, sel, ctx, { locked = false } = {}) {
  const v = actionView(a, app, sel);
  const off = locked || !v.enabled;
  if (!v.items) return [{ label: v.label, icon: v.icon, kbd: v.kbd, tip: v.tip, disabled: off, run: () => runAction(a.run, app, sel, ctx) }];
  return v.items.filter(Boolean).map((it) => (it.separator ? { separator: true } : {
    label: String(it.label ?? it.id ?? ''), icon: it.icon ?? null, kbd: it.kbd ? keyLabel(it.kbd) : null, tip: it.tip ?? null,
    disabled: off || (typeof it.enabled === 'function' ? !attempt(it.enabled, app, sel, false) : it.enabled === false),
    run: () => runAction(typeof it.run === 'function' ? it.run : (aa, ss, cc) => a.run?.(aa, ss, { ...cc, item: it.id }), app, sel, ctx),
  }));
}

// the five built-in actions (the atom menu has its own Centre here, Measure from here and Delete items)
const one = (app, sel) => { const s = app.structure; const syms = new Set(sel.map((i) => s?.symbols[i])); return syms.size === 1 ? [...syms][0] : null; };
registerSelectionAction({
  id: 'sel.centre', label: 'Centre', icon: 'crosshair', order: 10, menu: false,
  tip: (app, sel) => (sel.length === 1 ? 'Centre the view on this atom' : 'Centre the view on the selection'),
  run: (app, sel) => centreSelection(app, sel.length === 1 ? displayIndexOf(app.viewer.model, sel[0]) : null),
});
registerSelectionAction({
  id: 'sel.sameElement', label: 'Same element', icon: 'atom', order: 20, menu: false,
  short: (app, sel) => { const x = one(app, sel); return x ? `All ${x}` : 'Same element'; },
  tip: (app, sel) => (sel.length === 1 ? `Select every ${app.structure.symbols[sel[0]]} atom` : 'Select every atom of these elements'),
  run: (app) => selectSameElement(app),
});
registerSelectionAction({
  id: 'sel.measure', label: 'Measure', icon: 'ruler', order: 30, menu: false,
  when: (app, sel) => sel.length >= 1 && sel.length <= 4,
  tip: (app, sel) => (sel.length === 1 ? 'Measure from this atom: click 1 more atom' : `Keep this ${MEASURE[sel.length]} as a measurement in the view`),
  run: (app, sel) => measureSelection(app, sel),
});
registerSelectionAction({
  id: 'sel.replace', label: 'Replace…', short: 'Replace', icon: 'swap', order: 40, menu: false,
  tip: 'Change the element of the selected atoms',
  run: (app) => replaceSelectionChecked(app),
});
registerSelectionAction({
  id: 'sel.delete', label: 'Delete', icon: 'trash', order: 50, menu: false, danger: true, kbd: 'Delete',
  tip: (app, sel) => (sel.length === 1 ? 'Delete this atom' : `Delete ${sel.length} atoms`),
  run: (app) => deleteSelection(app),
});

// ------------------------------------------------------------------ card
const isTouch = () => matchMedia('(pointer: coarse)').matches;
/** Touch screens and narrow windows get fewer card buttons (CARD_LIMITS.narrow). */
const isNarrow = () => isTouch() || matchMedia('(max-width: 920px)').matches;

export class SelectionCard {
  constructor(shell) {
    this.shell = shell;
    this.app = shell.app;
    /** On touch screens: taps add to / remove from the selection instead of replacing it. */
    this.multi = false;
    this.el = h('section.float.selcard', { hidden: true, 'aria-label': 'Selected atoms' });
    shell.stage.append(this.el);
    cards.add(this);
    const app = this.app;
    const upd = () => this.update();
    app.on('selection', upd);
    app.on('structure', upd);
    app.on('preview', upd);
    app.on('scene', () => { if (!this.el.hidden) upd(); });
    app.viewer.on('model', () => { if (!this.el.hidden) upd(); });
  }

  update() {
    const app = this.app, s = app.structure, sel = s ? app.selection.filter((i) => i < s.length) : [];
    if (!sel.length) this.multi = false;   // multi-select ends with the selection (its chip is not on screen)
    // hidden under a tool that does not select atoms and while another structure is previewed; a drag preview keeps
    // the card with its actions greyed (F0-A §3.6.3)
    const session = app.session && app.session.active !== false ? app.session : null;
    this.el.hidden = !sel.length || app.tool === 'measure' || app.toolDef?.selects === false || session?.kind === 'structure';
    if (this.el.hidden) return;
    const n = sel.length, m = app.viewer.model;
    // phones, tablets and narrow windows: fewer buttons, each an icon over a short label (touch gets no tooltips)
    const touch = isTouch(), compact = isNarrow();
    const dot = (sym) => h('span.dot', { style: { background: elementColorHex(sym, app.scene.style) } });
    const tag = (i) => h('span.atom', dot(s.symbols[i]), h('b', s.symbols[i]), h('span.idx', `#${i}`));
    const line = (r) => h('div.r', h('span.k', r.label), h('span.v', r.value));
    const rows = [];
    let title;
    // atoms hidden by visibility masks are counted in the title, in words
    const nHidden = hiddenInSelection(app, sel).length;
    const hiddenNote = nHidden ? h('span.nm', `(${nHidden} hidden)`) : null;
    if (n === 1) {
      const i = sel[0], d = displayIndexOf(m, i), info = d >= 0 ? app.viewer.atomInfo(d) : null;
      const e = element(s.symbols[i]);
      title = h('div.t', tag(i), h('span.nm', e.name), hiddenNote);
      const f = (a) => a.map((x) => x.toFixed(3)).join('  ');
      // stored coordinates, as files and the structure hold them, wherever the view draws the atom
      const frac = info ? info.frac : storedFrac(s, i);
      rows.push(h('div.r', h('span.k', 'xyz'), h('span.v', `${f(info?.position ?? s.pos(i))} Å`)));
      if (frac) rows.push(h('div.r', h('span.k', 'frac'), h('span.v', f(frac))));
      if (info?.image.some(Boolean)) rows.push(h('div.r', h('span.k', ''), h('span.v.muted', { 'data-tip': 'The view draws this atom shifted by whole cell vectors from its stored position' }, `Drawn image (${info.image.map(signed).join(', ')})`)));
      if (info) rows.push(h('div.r', h('span.k', 'CN'), h('span.v', { 'data-tip': 'Coordination number: bonds drawn to this atom' }, String(info.cn))));
      rows.push(...atomInfoRows(app, i, 'card').map(line));
    } else if (n <= 4) {
      title = h('div.t', ...sel.flatMap((i, k) => (k ? [h('span.dash', '–'), tag(i)] : [tag(i)])), hiddenNote);
      const { P } = selectionPoints(app, sel);
      const val = geometryValue(P);
      const kind = MEASURE[n];
      rows.push(h('div.r.big', h('span.k', kind[0].toUpperCase() + kind.slice(1)), h('span.v', n === 2 ? `${val.toFixed(3)} Å` : `${val.toFixed(1)}°`)));
      if (n === 3) rows.push(h('div.r', h('span.k', ''), h('span.v.muted', `at ${s.symbols[sel[1]]} #${sel[1]}`)));
    } else {
      const comp = {};
      sel.forEach((i) => { comp[s.symbols[i]] = (comp[s.symbols[i]] ?? 0) + 1; });
      title = nHidden ? h('div.t', h('b', `${n} selected`), hiddenNote) : h('div.t', h('b', plural(n, 'atom')), h('span.nm', `of ${s.length}`));
      rows.push(h('div.r.comp', ...Object.entries(comp).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([sym, c]) => h('span.atom', dot(sym), h('b', sym), h('span.idx', `×${c}`)))));
    }
    const list = selectionActions(app, sel, 'card');
    rows.push(...actionRows(list, app, sel).map(line));
    const { shown, more } = splitCardActions(list, { narrow: compact });
    const locked = session?.kind === 'positions';
    const ctx = { source: 'card', atom: -1, display: -1 };
    const buttons = shown.map((a) => this.button(a, sel, ctx, { compact, locked }));
    if (more.length) {
      const b = btn('More', { icon: 'more', cls: `ghost small${compact ? ' stack' : ''}`, tip: 'More actions', on: (ev) => showMenu(ev.currentTarget, more.flatMap((a) => actionMenuItems(a, app, sel, ctx, { locked })), { label: 'More actions' }) });
      b.setAttribute('aria-haspopup', 'menu');
      buttons.push(b);
    }
    const acts = h('div.acts', { role: 'group', 'aria-label': 'Actions on the selection' }, buttons);
    const close = btn('', { icon: 'x', cls: 'ghost icon small close', tip: 'Clear selection', kbd: keyLabel('Escape'), on: () => app.clearSelection() });
    const multi = touch ? h('button.chip.multi', { type: 'button', 'aria-pressed': String(this.multi), 'data-tip': 'When on, each tap adds or removes an atom', on: { click: () => { this.multi = !this.multi; this.update(); this.shell.updateHint?.(); toast(this.multi ? 'Multi-select on: tap atoms to add or remove them' : 'Multi-select off'); } } }, ic('hand', 'sm'), 'Multi-select') : null;
    this.el.replaceChildren(...[h('div.head', title, multi, close), rows.length ? h('div.rows', rows) : null, acts].filter(Boolean));
    document.documentElement.style.setProperty('--selcard-h', `${this.el.offsetHeight}px`);
  }

  /** A card button for action `a` (a split button with a ▾ menu when it has items); `compact`: icon over the short label. */
  button(a, sel, ctx, { compact, locked }) {
    const app = this.app, v = actionView(a, app, sel);
    const off = locked || !v.enabled;
    const menu = (anchor) => showMenu(anchor, actionMenuItems(a, app, sel, ctx, { locked }), { label: v.label });
    const main = btn(compact ? v.short : v.label, {
      icon: v.icon, cls: `ghost small${v.danger ? ' danger' : ''}${compact ? ' stack' : ''}`, tip: v.tip, kbd: v.kbd,
      on: (ev) => { if (off) return; if (typeof a.run === 'function') runAction(a.run, app, sel, ctx); else menu(ev.currentTarget); },
    });
    main.dataset.action = a.id;
    if (off) main.setAttribute('aria-disabled', 'true');
    if (!v.items || typeof a.run !== 'function') return main;
    const name = v.label.replace(/…$/, '');
    const caret = btn('', { icon: 'chevronDown', cls: 'ghost small icon caret', tip: `${name} options`, on: (ev) => menu(ev.currentTarget) });
    caret.setAttribute('aria-haspopup', 'menu');
    return h('span.split', { role: 'group', 'aria-label': name, dataset: { action: a.id } }, main, caret);
  }

  /** Keep the selected geometry as a measurement (2–4 atoms) or start measuring from one atom. */
  measure() { measureSelection(this.app, this.app.selection); }
}
