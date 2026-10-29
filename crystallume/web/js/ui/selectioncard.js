/**
 * Selection card: what is selected (element, position, coordination; distance, angle or dihedral for
 * 2–4 atoms) with quick actions. Bottom-left of the view on desktop, a slim strip on phones.
 * Also exports the selection helpers used by commands and the atom context menu.
 */
import { h, ic, btn } from './dom.js';
import { toast, promptDialog } from './overlays.js';
import { element, normalizeSymbol } from '../core/elements.js';
import { elementColorHex } from '../render/colors.js';
import { bondedFragment } from '../render/display.js';
import { keyLabel } from './keys.js';

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

/** Points for the selected source atoms: drawn copies chained by proximity, else raw positions. */
function selectionPoints(app, sel) {
  const m = app.viewer.model, s = app.structure;
  const ds = m ? chainDisplay(m, sel) : [];
  if (ds.length === sel.length && ds.every((d) => d >= 0)) return { ds, P: ds.map((d) => [m.positions[3 * d], m.positions[3 * d + 1], m.positions[3 * d + 2]]) };
  return { ds: null, P: sel.map((i) => s.pos(i)) };
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

/** Select all atoms of the active structure. */
export function selectAll(app) { if (app.structure) app.select(app.structure.symbols.map((_, i) => i)); }

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

/** Ask for an element and change the selected atoms to it. */
export async function replaceSelection(app) {
  const n = app.selection.length;
  if (!n) return;
  const v = await promptDialog({ title: `Change ${plural(n, 'atom')} to…`, label: 'Element symbol (e.g. Fe, O, Ti)', confirm: 'Change', placeholder: 'Fe' });
  if (!v) return;
  const sym = normalizeSymbol(v);
  if (sym === 'X') { toast(`“${v}” is not an element symbol. Try Fe, O or Ti.`, { type: 'error' }); return; }
  app.replaceSelected(sym);
  toast(`Changed ${plural(n, 'atom')} to ${sym}`, { action: { label: 'Undo', run: () => app.undo() } });
}

// ------------------------------------------------------------------ card
export class SelectionCard {
  constructor(shell) {
    this.shell = shell;
    this.app = shell.app;
    /** On touch screens: taps add to / remove from the selection instead of replacing it. */
    this.multi = false;
    this.el = h('section.float.selcard', { hidden: true, 'aria-label': 'Selected atoms' });
    shell.stage.append(this.el);
    const app = this.app;
    const upd = () => this.update();
    app.on('selection', upd);
    app.on('structure', upd);
    app.on('scene', () => { if (!this.el.hidden) upd(); });
    app.viewer.on('model', () => { if (!this.el.hidden) upd(); });
  }

  update() {
    const app = this.app, s = app.structure, sel = s ? app.selection.filter((i) => i < s.length) : [];
    if (!sel.length) this.multi = false;   // multi-select ends with the selection (its chip is not on screen)
    this.el.hidden = !sel.length || app.tool === 'measure';
    if (this.el.hidden) return;
    const n = sel.length, m = app.viewer.model;
    const touch = matchMedia('(pointer: coarse)').matches;
    const dot = (sym) => h('span.dot', { style: { background: elementColorHex(sym, app.scene.style) } });
    const tag = (i) => h('span.atom', dot(s.symbols[i]), h('b', s.symbols[i]), h('span.idx', `#${i}`));
    const rows = [];
    let title;
    if (n === 1) {
      const i = sel[0], d = displayIndexOf(m, i), info = d >= 0 ? app.viewer.atomInfo(d) : null;
      const e = element(s.symbols[i]);
      title = h('div.t', tag(i), h('span.nm', e.name));
      const f = (a) => a.map((x) => x.toFixed(3)).join('  ');
      rows.push(h('div.r', h('span.k', 'xyz'), h('span.v', `${f(info?.position ?? s.pos(i))} Å`)));
      if (info?.frac) rows.push(h('div.r', h('span.k', 'frac'), h('span.v', f(info.frac))));
      if (info) rows.push(h('div.r', h('span.k', 'CN'), h('span.v', { 'data-tip': 'Coordination number: bonds drawn to this atom' }, String(info.cn))));
    } else if (n <= 4) {
      title = h('div.t', ...sel.flatMap((i, k) => (k ? [h('span.dash', '–'), tag(i)] : [tag(i)])));
      const { P } = selectionPoints(app, sel);
      const val = geometryValue(P);
      const kind = MEASURE[n];
      rows.push(h('div.r.big', h('span.k', kind[0].toUpperCase() + kind.slice(1)), h('span.v', n === 2 ? `${val.toFixed(3)} Å` : `${val.toFixed(1)}°`)));
      if (n === 3) rows.push(h('div.r', h('span.k', ''), h('span.v.muted', `at ${s.symbols[sel[1]]} #${sel[1]}`)));
    } else {
      const comp = {};
      sel.forEach((i) => { comp[s.symbols[i]] = (comp[s.symbols[i]] ?? 0) + 1; });
      title = h('div.t', h('b', plural(n, 'atom')), h('span.nm', `of ${s.length}`));
      rows.push(h('div.r.comp', ...Object.entries(comp).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([sym, c]) => h('span.atom', dot(sym), h('b', sym), h('span.idx', `×${c}`)))));
    }
    const first = n === 1 ? displayIndexOf(m, sel[0]) : -1;
    // phones and tablets get no tooltips, so each action keeps a short label under its icon
    const act = (label, short, o) => btn(touch ? short ?? label : label, { ...o, cls: `${o.cls}${touch ? ' stack' : ''}` });
    const one = new Set(sel.map((i) => s.symbols[i])).size === 1 ? s.symbols[sel[0]] : null;
    const acts = h('div.acts',
      act('Centre', null, { icon: 'crosshair', cls: 'ghost small', tip: n === 1 ? 'Centre the view on this atom' : 'Centre the view on the selection', on: () => centreSelection(app, n === 1 ? first : null) }),
      act('Same element', one ? `All ${one}` : 'Same element', { icon: 'atom', cls: 'ghost small', tip: n === 1 ? `Select every ${s.symbols[sel[0]]} atom` : 'Select every atom of these elements', on: () => selectSameElement(app) }),
      n <= 4 ? act('Measure', null, { icon: 'ruler', cls: 'ghost small', tip: n === 1 ? 'Measure from this atom: click 1 more atom' : `Keep this ${MEASURE[n]} as a measurement in the view`, on: () => this.measure() }) : null,
      act('Replace…', 'Replace', { icon: 'swap', cls: 'ghost small', tip: 'Change the element of the selected atoms', on: () => replaceSelection(app) }),
      act('Delete', null, { icon: 'trash', cls: 'ghost small danger', tip: n === 1 ? 'Delete this atom' : `Delete ${n} atoms`, kbd: keyLabel('Delete'), on: () => app.deleteSelected() }),
    );
    const close = btn('', { icon: 'x', cls: 'ghost icon small close', tip: 'Clear selection', kbd: keyLabel('Escape'), on: () => app.clearSelection() });
    const multi = touch ? h('button.chip.multi', { type: 'button', 'aria-pressed': String(this.multi), 'data-tip': 'When on, each tap adds or removes an atom', on: { click: () => { this.multi = !this.multi; this.update(); this.shell.updateHint?.(); toast(this.multi ? 'Multi-select on: tap atoms to add or remove them' : 'Multi-select off'); } } }, ic('hand', 'sm'), 'Multi-select') : null;
    this.el.replaceChildren(...[h('div.head', title, multi, close), rows.length ? h('div.rows', rows) : null, acts].filter(Boolean));
    document.documentElement.style.setProperty('--selcard-h', `${this.el.offsetHeight}px`);
  }

  /** Keep the selected geometry as a measurement (2–4 atoms) or start measuring from one atom. */
  measure() {
    const app = this.app, sel = app.selection, m = app.viewer.model;
    if (sel.length === 1) { measureFrom(app, displayIndexOf(m, sel[0])); return; }
    const ds = chainDisplay(m, sel);
    if (ds.some((d) => d < 0)) { toast('Show the hidden atoms first to measure them.', { type: 'error' }); return; }
    app.viewer.addMeasurement(MEASURE[sel.length], ds);
    const id = app.viewer.measurements.at(-1)?.id;
    app.emit('measure');
    toast(`Added a ${MEASURE[sel.length]} measurement`, { action: { label: 'Remove', run: () => { app.viewer.removeMeasurement(id); app.emit('measure'); } } });
  }
}
