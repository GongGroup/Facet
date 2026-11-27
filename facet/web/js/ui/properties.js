/**
 * The Properties explorer (ui/workbench.js), as in Materials Studio: a Filter (All, Atom, Lattice 3D, Physical
 * System, Reciprocal Lattice 3D, Symmetry System, and Display and Project, which Facet adds) over a grid of
 * Name | Value rows, sorted by name. Grey rows are read-only; a click on a black value edits it in place (Enter or
 * leaving the field applies it, Esc cancels); every edit is one undo step. The description of the row in focus is shown
 * under the grid.
 *
 * What it shows follows the Project explorer: the project, or a document — for the active document the selected atoms
 * (Atom) as well. Several selected atoms show a value only where they agree (as Materials Studio does); an edit applies
 * to all of them.
 *
 * Modules add rows with registerProperties((ctx) => [{category, name, value, tip, edit?}] | null): ctx =
 * {app, kind: 'project' | 'document', entry, structure, active, atoms}. `edit` = {type: 'text' | 'number' | 'enum' |
 * 'bool' | 'vec3', options?: [[value, label]], value, apply(value)}.
 */
import { h, ic } from './dom.js';
import { toast } from './overlays.js';
import { element, normalizeSymbol } from '../core/elements.js';
import { reciprocalCell, isHexagonalCell } from '../core/lattice.js';
import { cellParams, fracToCart, cartToFrac, inv3, relativeTime } from '../core/util.js';
import { moveFlags, setMoveFlags, constraintSummary } from '../core/constraints.js';
import { styles } from '../render/styles.js';
import { looks } from '../render/looks.js';
import { lightingPresets } from '../render/lighting.js';
import { atomInfoRows } from './atominfo.js';
import { setLatticeParameters, setHiddenAtoms, isUserHidden } from './mscommands.js';

const providers = [];
/** Add rows to the Properties explorer (see the top of this file); returns a function that removes the provider. */
export function registerProperties(fn) {
  if (typeof fn !== 'function') throw new TypeError('registerProperties: expected a function (ctx) → rows');
  providers.push(fn);
  return () => { const i = providers.indexOf(fn); if (i >= 0) providers.splice(i, 1); };
}

export const CATEGORIES = ['Atom', 'Lattice 3D', 'Physical System', 'Reciprocal Lattice 3D', 'Symmetry System', 'Display', 'Project'];
const MIXED = Symbol('mixed');
const f5 = (v) => (Number.isFinite(v) ? v.toFixed(5) : '');
const vec = (v, d = 5) => `(${v.map((x) => (Number.isFinite(x) ? x.toFixed(d) : '?')).join(', ')})`;
const yesNo = (b) => (b ? 'Yes' : 'No');
const LABEL_KEYS = ['labels', 'label', 'atom_names'];
const SKIP_PROPS = new Set(['selective_dynamics', ...LABEL_KEYS]);
const pascal = (k) => String(k).replace(/(^|[_\s-]+)(\w)/g, (_, __, c) => c.toUpperCase());

/** Every atom's value of `fn`, or MIXED when they differ. */
function common(atoms, fn) {
  let first;
  for (let k = 0; k < atoms.length; k++) {
    const v = fn(atoms[k]);
    const key = typeof v === 'object' && v ? JSON.stringify(v) : v;
    if (k === 0) first = { v, key };
    else if (key !== first.key) return MIXED;
  }
  return first ? first.v : MIXED;
}

/** Crystal family of a cell from its parameters (Materials Studio's "Lattice system"). */
function latticeSystem(cp) {
  const eq = (x, y, t = 1e-3) => Math.abs(x - y) <= t * Math.max(1, Math.abs(x));
  const ang = (x, y) => Math.abs(x - y) < 0.05;
  const { a, b, c, alpha, beta, gamma } = cp;
  const right = [alpha, beta, gamma].map((x) => ang(x, 90));
  if (right.every(Boolean)) return eq(a, b) && eq(b, c) ? 'Cubic' : eq(a, b) || eq(b, c) || eq(a, c) ? 'Tetragonal' : 'Orthorhombic';
  if (ang(alpha, 90) && ang(beta, 90) && ang(gamma, 120) && eq(a, b)) return 'Hexagonal';
  if (eq(a, b) && eq(b, c) && ang(alpha, beta) && ang(beta, gamma)) return 'Rhombohedral';
  if (right.filter(Boolean).length === 2) return 'Monoclinic';
  return 'Triclinic';
}

function parseVec(text) {
  const v = String(text).trim().replace(/^[([{]|[)\]}]$/g, '').split(/[\s,;]+/).filter(Boolean).map(Number);
  if (v.length !== 3 || !v.every(Number.isFinite)) throw new Error('Type three numbers, like 0.5, 0.5, 0.25.');
  return v;
}
function parseNum(text, { min = -Infinity, max = Infinity, what = 'value' } = {}) {
  const v = Number(String(text).trim());
  if (!Number.isFinite(v)) throw new Error(`The ${what} must be a number.`);
  if (v < min || v > max) throw new Error(`The ${what} must be between ${min} and ${max}.`);
  return v;
}

export class PropertiesExplorer {
  constructor(bench) {
    this.bench = bench;
    this.app = bench.app;
    this.shell = bench.shell;
    this.filterSel = h('select.field.pfilter', { 'aria-label': 'Filter' });
    this.filterSel.addEventListener('change', () => { this.filter = this.filterSel.value; this._userFilter = this.filter; this.render(); });
    this.grid = h('div.pgrid', { role: 'grid', 'aria-label': 'Properties', tabindex: '0' });
    this.desc = h('div.pdesc', { 'aria-live': 'polite' });
    this.el = h('div.xbody.props-body', h('div.pf-row', h('label', 'Filter:'), this.filterSel), this.grid, this.desc);
    this.filter = null;
    this.focused = null;   // the name of the row in focus
    this.editing = null;
    this._pending = false;
    this.grid.addEventListener('keydown', (e) => this._key(e));
  }

  focus() { requestAnimationFrame(() => (this.grid.querySelector('.pr[aria-selected="true"]') ?? this.grid).focus()); }

  /** Draw again on the next frame (several events in one frame draw once); waits while a value is being edited. */
  schedule() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => { this._pending = false; if (this.editing) { this._stale = true; return; } this.render(); });
  }

  /** What the explorer describes now: {kind, entry, structure, active, atoms}. */
  context() {
    const app = this.app, sel = this.bench.project.current();
    if (sel === 'root') return { app, kind: 'project', entry: null, structure: null, active: false, atoms: [] };
    const entry = app.project.structures.find((e) => e.id === sel) ?? null;
    const active = !!entry && entry.id === app.project.activeStructure;
    return { app, kind: entry ? 'document' : 'project', entry, structure: entry?.structure ?? null, active, atoms: active ? app.selection : [] };
  }

  /** The rows of every category for `ctx`: [{category, name, value, ro, tip, edit}]. */
  collect(ctx) {
    const rows = [];
    const add = (category, name, value, { tip = null, edit = null } = {}) => rows.push({ category, name, value: value === MIXED ? '' : String(value ?? ''), mixed: value === MIXED, tip, edit });
    const app = this.app, s = ctx.structure;
    if (ctx.kind === 'project') this._project(add);
    if (s) {
      if (ctx.atoms.length) this._atoms(add, s, ctx.atoms);
      this._physical(add, ctx, s);
      if (s.cell) { this._lattice(add, ctx, s); this._reciprocal(add, s); this._symmetry(add, s); }
    }
    if (ctx.kind === 'project' || ctx.active) this._display(add);
    for (const p of providers) {
      let extra;
      try { extra = p(ctx); } catch (e) { console.error('registerProperties: a provider failed', e); continue; }
      for (const r of [].concat(extra ?? [])) if (r?.name && r.category) add(r.category, r.name, r.value, r);
    }
    return rows;
  }

  // ---------------------------------------------------------------- categories
  _project(add) {
    const app = this.app, p = app.project;
    const prov = app.storage.get(p.location?.provider ?? app.defaultProvider);
    add('Project', 'Name', p.name, { tip: 'The name of the project', edit: { type: 'text', value: p.name, apply: (v) => app.rename(String(v).trim() || 'Untitled project') } });
    add('Project', 'Description', p.description ?? '', { tip: 'A note about the project, saved with it', edit: { type: 'text', value: p.description ?? '', apply: (v) => { p.description = String(v); app.markDirty(); app.emit('project'); } } });
    add('Project', 'NumDocuments', p.structures.length, { tip: 'Documents (structures) in the project' });
    add('Project', 'SavedIn', p.location ? (prov?.label ?? p.location.provider) : 'Not saved yet', { tip: 'Where the project is saved' });
    add('Project', 'LastSaved', p.updated ? `${new Date(p.updated).toLocaleString()} (${relativeTime(p.updated)})` : '—');
    add('Project', 'Created', p.created ? new Date(p.created).toLocaleString() : '—');
    add('Project', 'SaveState', { idle: 'Not saved yet', dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', error: `Save failed${app.saveDetail ? ` (${app.saveDetail})` : ''}` }[app.saveState] ?? app.saveState);
    add('Project', 'Autosave', yesNo(app.prefs.autosave !== false), { tip: 'Save the project by itself a few seconds after each change', edit: { type: 'bool', value: app.prefs.autosave !== false, apply: (v) => { app.setPref('autosave', !!v); this.shell.updateSaveChip?.(); } } });
  }

  _atoms(add, s, atoms) {
    const app = this.app, one = atoms.length === 1, i0 = atoms[0];
    const labelKey = LABEL_KEYS.find((k) => Array.isArray(s.props[k]));
    const cell = s.cell, inv = cell ? inv3(cell) : null;
    const flags = moveFlags(s);
    const cname = (f) => (f.every(Boolean) ? 'Free' : f.every((x) => !x) ? 'Fixed' : `Partly fixed (${['a', 'b', 'c'].filter((_, k) => !f[k]).join(', ')} fixed)`);
    if (one) add('Atom', 'Index', i0, { tip: 'The atom’s number in the document (from 0)' });
    add('Atom', 'NumSelected', atoms.length.toLocaleString(), { tip: 'Atoms this category describes (the selection)' });
    const name = common(atoms, (i) => (labelKey ? String(s.props[labelKey][i] ?? '') : `${s.symbols[i]}${i + 1}`));
    add('Atom', 'Name', name, {
      tip: 'The atom’s label (written to CIF, XSD and PDB files)',
      edit: one ? { type: 'text', value: name === MIXED ? '' : name, apply: (v) => this._edit(`Rename atom ${i0}`, (st) => {
        const key = labelKey ?? 'labels';
        const col = Array.isArray(st.props[key]) ? st.props[key].slice() : st.symbols.map((sym, k) => `${sym}${k + 1}`);
        col[i0] = String(v).trim() || `${st.symbols[i0]}${i0 + 1}`;
        st.setProp(key, col);
      }, { rebuild: 'appearance' }) } : null,
    });
    const sym = common(atoms, (i) => s.symbols[i]);
    add('Atom', 'ElementSymbol', sym, {
      tip: 'The element; changing it changes every selected atom (Modify › Modify Element)',
      edit: { type: 'text', value: sym === MIXED ? '' : sym, apply: (v) => {
        const z = normalizeSymbol(String(v));
        if (z === 'X') throw new Error(`“${v}” is not an element symbol.`);
        app.replaceSelected(z, { toast: `Changed ${atoms.length} atom${atoms.length === 1 ? '' : 's'} to ${z}` });
      } },
    });
    add('Atom', 'ElementName', sym === MIXED ? MIXED : element(sym).name);
    add('Atom', 'AtomicNumber', sym === MIXED ? MIXED : element(sym).Z);
    add('Atom', 'Mass', sym === MIXED ? MIXED : f5(element(sym).mass), { tip: 'Atomic mass (amu)' });
    add('Atom', 'CovalentRadius', sym === MIXED ? MIXED : f5(element(sym).rcov), { tip: 'Covalent radius (Å), used to find bonds' });
    const xyz = common(atoms, (i) => s.pos(i).map((x) => +x.toFixed(5)));
    add('Atom', 'XYZ', xyz === MIXED ? MIXED : vec(xyz), {
      tip: 'Cartesian position (Å)',
      edit: one ? { type: 'vec3', value: vec(xyz), apply: (v) => this._edit(`Move atom ${i0}`, (st) => st.setPositions({ indices: [i0], positions: [parseVec(v)] })) } : null,
    });
    if (cell) {
      const fr = common(atoms, (i) => cartToFrac(s.pos(i), inv).map((x) => +x.toFixed(5)));
      add('Atom', 'FractionalXYZ', fr === MIXED ? MIXED : vec(fr), {
        tip: 'Position in fractions of the cell vectors a, b and c',
        edit: one ? { type: 'vec3', value: vec(fr), apply: (v) => this._edit(`Move atom ${i0}`, (st) => st.setPositions({ indices: [i0], positions: [fracToCart(parseVec(v), st.cell)] })) } : null,
      });
    }
    const cons = common(atoms, (i) => cname(flags[i]));
    add('Atom', 'Constraint', cons, {
      tip: 'Fixed atoms do not move in a relaxation (selective dynamics in POSCAR, fixed atoms in XSD)',
      edit: { type: 'enum', options: [['Free', 'Free'], ['Fixed', 'Fixed (a, b and c)'], ['FixC', 'Fixed along c only']], value: cons === 'Fixed' ? 'Fixed' : cons === 'Free' ? 'Free' : '', apply: (v) => {
        const row = v === 'Fixed' ? [false, false, false] : v === 'FixC' ? [true, true, false] : [true, true, true];
        this._edit(`${v === 'Free' ? 'Free' : 'Fix'} ${atoms.length} atom${atoms.length === 1 ? '' : 's'}`, (st) => { const f = moveFlags(st); for (const i of atoms) f[i] = row.slice(); setMoveFlags(st, f); });
      } },
    });
    const hid = common(atoms, (i) => !app.viewer.isVisible(i));
    add('Atom', 'IsHidden', hid === MIXED ? MIXED : yesNo(hid), {
      tip: 'Hidden atoms are not drawn (View › Visibility); View › Visibility › Show All Atoms brings them back',
      edit: { type: 'bool', value: hid === true, apply: (v) => setHiddenAtoms(app, atoms, !!v) },
    });
    if (one) {
      const m = app.viewer.model;
      let d = -1;
      if (m?.src) for (let k = 0; k < m.n; k++) if (m.src[k] === i0) { d = k; break; }
      const info = d >= 0 ? app.viewer.atomInfo(d) : null;
      if (info) add('Atom', 'NumBonds', info.cn, { tip: 'Bonds drawn to this atom' });
      for (const r of atomInfoRows(app, i0, 'card')) add('Atom', pascal(r.label), r.value);
    }
    for (const [k, col] of Object.entries(s.props)) {
      if (SKIP_PROPS.has(k) || !Array.isArray(col)) continue;
      const v = common(atoms, (i) => col[i]);
      const show = v === MIXED ? MIXED : Array.isArray(v) ? vec(v.map(Number), 4) : typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(5)) : String(v);
      add('Atom', pascal(k), show, { tip: `Per-atom property “${k}” read from the file` });
    }
  }

  _physical(add, ctx, s) {
    const app = this.app, e = ctx.entry;
    add('Physical System', 'Name', e.name, { tip: 'The document’s name (also in the Project explorer, F2 there)', edit: { type: 'text', value: e.name, apply: (v) => app.renameStructure(e.id, String(v).trim() || e.name) } });
    add('Physical System', 'Formula', s.formula());
    if (s.periodic) add('Physical System', 'FormulaUnit', s.formula({ reduce: true }), { tip: 'The formula reduced to its smallest whole numbers' });
    add('Physical System', 'NumAtoms', s.length.toLocaleString());
    const comp = s.composition();
    add('Physical System', 'NumElements', Object.keys(comp).length);
    const mass = s.symbols.reduce((t, sym) => t + element(sym).mass, 0);
    add('Physical System', 'Mass', `${mass.toFixed(4)} amu`);
    add('Physical System', 'IsPeriodic', yesNo(s.periodic));
    if (s.cell) add('Physical System', 'Periodicity', s.pbc.map((b) => (b ? 'T' : 'F')).join(' '), { tip: 'Whether the structure repeats along a, b and c' });
    if (s.nFrames > 1) {
      add('Physical System', 'NumFrames', s.nFrames);
      add('Physical System', 'CurrentFrame', s.frame + 1, { tip: 'The frame shown (1 = the first)', edit: ctx.active ? { type: 'number', value: s.frame + 1, apply: (v) => app.viewer.setFrame(Math.round(parseNum(v, { min: 1, max: s.nFrames, what: 'frame' })) - 1) } : null });
    }
    const cs = constraintSummary(s);
    add('Physical System', 'NumFixedAtoms', cs.fixed + cs.partial, { tip: 'Atoms with a constraint (fixed or partly fixed)' });
    if (ctx.active) {
      add('Physical System', 'NumSelectedAtoms', app.selection.length.toLocaleString());
      add('Physical System', 'NumHiddenAtoms', (app.viewer.hiddenCount ?? 0).toLocaleString());
      const m = app.viewer.model;
      if (m) add('Physical System', 'NumBonds', m.bondsSkipped ? 'not drawn (too many atoms)' : (m.bonds?.count ?? 0).toLocaleString());
      add('Physical System', 'NumMeasurements', (app.viewer.measurements?.length ?? 0));
    }
    let c = [0, 0, 0];
    for (let i = 0; i < s.length; i++) { const p = s.pos(i); c = [c[0] + p[0], c[1] + p[1], c[2] + p[2]]; }
    if (s.length) add('Physical System', 'Centroid', vec(c.map((x) => x / s.length), 4), { tip: 'Mean position of the atoms (Å)' });
    if (s.info.source) add('Physical System', 'SourceFormat', s.info.source);
    if (s.info.comment) add('Physical System', 'Comment', s.info.comment);
    if (s.info.note) add('Physical System', 'Note', s.info.note);
    if (s.info.surface) {
      const sf = s.info.surface;
      if (sf.hkl ?? sf.miller) add('Physical System', 'SurfacePlane', `(${(sf.hkl ?? sf.miller).join(' ')})`, { tip: 'The Miller plane the slab was cleaved along' });
    }
  }

  _lattice(add, ctx, s) {
    const cp = s.cellParams();
    const editable = ctx.active && s.nFrames <= 1;
    const set = (key, label, what, lim) => ({ type: 'number', value: f5(cp[key]), apply: (v) => setLatticeParameters(this.app, { [key]: parseNum(v, { ...lim, what }) }, { label }) });
    const len = { min: 0.01, max: 10000 };
    const ang = { min: 1, max: 179 };
    add('Lattice 3D', 'A', f5(cp.a), { tip: 'Length of cell vector a (Å); the atoms keep their fractional positions', edit: editable ? set('a', 'Set lattice parameter a', 'length a', len) : null });
    add('Lattice 3D', 'B', f5(cp.b), { tip: 'Length of cell vector b (Å)', edit: editable ? set('b', 'Set lattice parameter b', 'length b', len) : null });
    add('Lattice 3D', 'C', f5(cp.c), { tip: 'Length of cell vector c (Å)', edit: editable ? set('c', 'Set lattice parameter c', 'length c', len) : null });
    add('Lattice 3D', 'Alpha', f5(cp.alpha), { tip: 'Angle between b and c (°)', edit: editable ? set('alpha', 'Set lattice angle α', 'angle α', ang) : null });
    add('Lattice 3D', 'Beta', f5(cp.beta), { tip: 'Angle between a and c (°)', edit: editable ? set('beta', 'Set lattice angle β', 'angle β', ang) : null });
    add('Lattice 3D', 'Gamma', f5(cp.gamma), { tip: 'Angle between a and b (°)', edit: editable ? set('gamma', 'Set lattice angle γ', 'angle γ', ang) : null });
    add('Lattice 3D', 'CellVolume', `${s.volume().toFixed(5)} Å³`);
    add('Lattice 3D', 'Density', `${s.density().toFixed(5)} g/cm³`);
    const [A, B, C] = s.cell;
    add('Lattice 3D', 'VectorA', vec(A, 4)); add('Lattice 3D', 'VectorB', vec(B, 4)); add('Lattice 3D', 'VectorC', vec(C, 4));
    if (s.info.supercell) add('Lattice 3D', 'Supercell', s.info.supercell.join(' × '), { tip: 'How many times the original cell was repeated along a, b and c' });
  }

  _reciprocal(add, s) {
    let R;
    try { R = reciprocalCell(s.cell); } catch { return; }
    const rp = cellParams(R);
    // reciprocalCell may or may not include 2π; the lengths are shown as computed, in 1/Å
    add('Reciprocal Lattice 3D', 'A*', f5(rp.a), { tip: 'Length of the reciprocal vector a* (1/Å)' });
    add('Reciprocal Lattice 3D', 'B*', f5(rp.b));
    add('Reciprocal Lattice 3D', 'C*', f5(rp.c));
    add('Reciprocal Lattice 3D', 'Alpha*', f5(rp.alpha));
    add('Reciprocal Lattice 3D', 'Beta*', f5(rp.beta));
    add('Reciprocal Lattice 3D', 'Gamma*', f5(rp.gamma));
  }

  _symmetry(add, s) {
    const cp = s.cellParams();
    add('Symmetry System', 'SpaceGroup', s.info.spacegroup ?? 'P1 (not known)', { tip: 'The space group read from the file or set by the builder; edits that break the symmetry remove it' });
    if (s.info.spacegroupNumber) add('Symmetry System', 'SpaceGroupNumber', s.info.spacegroupNumber);
    add('Symmetry System', 'LatticeSystem', latticeSystem(cp), { tip: 'The crystal family the cell parameters fit (a cell’s shape, not its full symmetry)' });
    let hex = false;
    try { hex = isHexagonalCell(s.cell); } catch { /* not decided */ }
    add('Symmetry System', 'IsHexagonalSetting', yesNo(hex), { tip: 'a = b and γ = 120°: Miller–Bravais indices (h k i l) are offered' });
  }

  _display(add) {
    const app = this.app, sc = app.scene;
    const opts = (reg) => [...reg.list()].map((x) => [x.id, x.name ?? x.id]);
    add('Display', 'DisplayStyle', styles.get(sc.style?.rep)?.name ?? sc.style?.rep, { tip: 'How atoms and bonds are drawn (View › Display Style)', edit: { type: 'enum', options: opts(styles), value: sc.style?.rep, apply: (v) => app.setRepresentation(v) } });
    add('Display', 'Look', looks.get(sc.look)?.name ?? 'Custom', { tip: 'A complete style: materials, lighting and effects', edit: { type: 'enum', options: opts(looks), value: sc.look ?? '', apply: (v) => app.applyLook(v) } });
    const lp = typeof lightingPresets?.list === 'function' ? opts(lightingPresets) : Object.entries(lightingPresets ?? {}).map(([id, p]) => [id, p?.name ?? id]);
    add('Display', 'Lighting', lp.find(([id]) => id === sc.lighting?.preset)?.[1] ?? sc.lighting?.preset ?? 'Custom', { tip: 'The lighting preset (View › Lighting)', edit: lp.length ? { type: 'enum', options: lp, value: sc.lighting?.preset ?? '', apply: (v) => app.setLightingPreset(v) } : null });
    add('Display', 'Labels', { none: 'None', element: 'Element', index: 'Index', both: 'Element and index' }[sc.display?.labels ?? 'none'], { edit: { type: 'enum', options: [['none', 'None'], ['element', 'Element'], ['index', 'Index'], ['both', 'Element and index']], value: sc.display?.labels ?? 'none', apply: (v) => app.set('display.labels', v) } });
    add('Display', 'ShowUnitCell', yesNo(!!sc.display?.cell?.show), { edit: { type: 'bool', value: !!sc.display?.cell?.show, apply: (v) => app.set('display.cell.show', !!v) } });
    add('Display', 'Projection', sc.display?.projection === 'orthographic' ? 'Orthographic' : 'Perspective', { edit: { type: 'enum', options: [['perspective', 'Perspective'], ['orthographic', 'Orthographic']], value: sc.display?.projection ?? 'perspective', apply: (v) => app.set('display.projection', v) } });
    add('Display', 'Turntable', yesNo(!!sc.display?.turntable), { edit: { type: 'bool', value: !!sc.display?.turntable, apply: (v) => app.set('display.turntable', !!v) } });
    const rep = sc.display?.supercell ?? [1, 1, 1];
    add('Display', 'DisplayRepeat', rep.join(' × '), { tip: 'Draw the cell repeated along a, b and c (the document itself does not change)', edit: { type: 'text', value: rep.join(' '), apply: (v) => {
      const n = String(v).split(/[\s,×x*]+/).filter(Boolean).map(Number);
      if (n.length !== 3 || !n.every((k) => Number.isInteger(k) && k >= 1 && k <= 20)) throw new Error('Type three whole numbers from 1 to 20, like 2 2 1.');
      app.set('display.supercell', n);
    } } });
    for (const [path, name] of [['post.ao.enabled', 'AmbientOcclusion'], ['post.outline.enabled', 'Outlines'], ['lighting.shadows.enabled', 'Shadows'], ['post.fog.enabled', 'DepthCueing']]) {
      const on = !!app.get(path);
      add('Display', name, yesNo(on), { edit: { type: 'bool', value: on, apply: (v) => app.set(path, !!v) } });
    }
    add('Display', 'HiddenElements', (sc.display?.hiddenElements ?? []).join(', ') || 'None', { tip: 'Elements not drawn (Display Style › Colour & size per element)' });
  }

  /** An edit of the active document as one undo step; errors become a toast. */
  _edit(label, fn, opts = {}) {
    try { this.app.editActive(label, fn, opts); } catch (e) { toast(e.message, { type: 'error' }); }
  }

  // ---------------------------------------------------------------- drawing
  render() {
    const ctx = this.context();
    const rows = this.collect(ctx);
    const cats = CATEGORIES.filter((c) => rows.some((r) => r.category === c));
    for (const r of rows) if (!cats.includes(r.category)) cats.push(r.category);
    // the filter: the user's choice while it applies, else what is in focus (atoms, the project, the document)
    const want = this._userFilter && (this._userFilter === 'All' || cats.includes(this._userFilter)) ? this._userFilter
      : ctx.atoms.length ? 'Atom' : ctx.kind === 'project' ? 'Project' : cats.includes('Physical System') ? 'Physical System' : cats[0] ?? 'All';
    if (ctx.atoms.length && this._lastAtoms === 0 && this._userFilter !== 'All') this._userFilter = null;   // a new selection shows its atoms
    this._lastAtoms = ctx.atoms.length;
    this.filter = this._userFilter && (this._userFilter === 'All' || cats.includes(this._userFilter)) ? this._userFilter : (ctx.atoms.length ? 'Atom' : want);
    this.filterSel.replaceChildren(...['All', ...cats].map((c) => h('option', { value: c, selected: c === this.filter }, c)));
    const shown = rows.filter((r) => this.filter === 'All' || r.category === this.filter).sort((a, b) => a.name.localeCompare(b.name));
    const scroll = this.grid.scrollTop, had = this.grid.contains(document.activeElement);
    this.grid.replaceChildren();
    if (!shown.length) {
      this.grid.append(h('div.pempty', ctx.kind === 'document' && !ctx.structure ? 'Nothing selected.' : 'No properties to show.'));
    }
    for (const r of shown) {
      const ro = !r.edit;
      const row = h('div.pr', { role: 'row', tabindex: '-1', 'aria-selected': String(this.focused === r.name), 'aria-readonly': String(ro), dataset: { name: r.name } },
        h('div.pn', { role: 'rowheader', title: r.name }, r.name),
        h('div.pv', { role: 'gridcell', title: r.value }, r.value));
      row._row = r;
      row.addEventListener('click', (e) => { this._focusRow(r, row); if (!ro && e.target.closest('.pv')) this._startEdit(r, row); });
      row.addEventListener('dblclick', () => { if (!ro) this._startEdit(r, row); });
      this.grid.append(row);
    }
    this.grid.scrollTop = scroll;
    const f = shown.find((r) => r.name === this.focused);
    this._describe(f ?? null, ctx);
    if (had) (this.grid.querySelector('.pr[aria-selected="true"]') ?? this.grid).focus({ preventScroll: true });
  }

  _focusRow(r, row) {
    this.focused = r.name;
    for (const x of this.grid.querySelectorAll('.pr')) x.setAttribute('aria-selected', String(x === row));
    row.focus({ preventScroll: true });
    this._describe(r, this.context());
  }

  _describe(r, ctx) {
    if (!r) {
      const what = ctx.kind === 'project' ? 'the project' : ctx.atoms.length ? `${ctx.atoms.length} selected atom${ctx.atoms.length === 1 ? '' : 's'} of ${ctx.entry?.name}` : ctx.entry ? ctx.entry.name : 'nothing';
      // (Materials Studio says "black values"; in a dark interface the values that can be changed are light)
      this.desc.replaceChildren(h('b', 'Properties'), h('span', ` of ${what}. Grey values are read-only; click any other value to change it.`));
      return;
    }
    this.desc.replaceChildren(h('b', r.name), h('span', ` · ${r.category}${r.edit ? '' : ' · read-only'}`), r.tip ? h('div', r.tip) : null);
  }

  _key(e) {
    if (e.target.closest('.pedit')) return;
    const rows = [...this.grid.querySelectorAll('.pr')];
    if (!rows.length) return;
    let i = rows.findIndex((r) => r.getAttribute('aria-selected') === 'true');
    if (e.key === 'ArrowDown') i = Math.min(rows.length - 1, i + 1);
    else if (e.key === 'ArrowUp') i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = rows.length - 1;
    else if ((e.key === 'Enter' || e.key === 'F2') && i >= 0 && rows[i]._row.edit) { e.preventDefault(); this._startEdit(rows[i]._row, rows[i]); return; }
    else return;
    e.preventDefault();
    const row = rows[Math.max(0, i)];
    this._focusRow(row._row, row);
    row.scrollIntoView({ block: 'nearest' });
  }

  _startEdit(r, row) {
    const ed = r.edit;
    if (!ed || this.editing) return;
    const cell = row.querySelector('.pv');
    this.editing = r.name;
    let input;
    if (ed.type === 'enum' || ed.type === 'bool') {
      const options = ed.type === 'bool' ? [['true', 'Yes'], ['false', 'No']] : ed.options;
      const cur = ed.type === 'bool' ? String(!!ed.value) : String(ed.value ?? '');
      input = h('select.pedit', { 'aria-label': r.name }, ...(options.some(([v]) => String(v) === cur) ? [] : [h('option', { value: '', disabled: true, selected: true }, '')]), ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === cur }, l)));
    } else input = h('input.pedit', { value: String(ed.value ?? ''), 'aria-label': r.name, spellcheck: false, inputmode: ed.type === 'number' ? 'decimal' : null });
    cell.replaceChildren(input);
    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      const raw = input.value;
      this.editing = null;
      if (apply && raw !== '' && !(ed.type !== 'enum' && ed.type !== 'bool' && raw === String(ed.value ?? ''))) {
        try {
          const v = ed.type === 'bool' ? raw === 'true' : raw;
          const out = ed.apply(v);
          out?.catch?.((e) => toast(e.message, { type: 'error' }));
        } catch (e) { toast(e.message, { type: 'error' }); }
      }
      this.render();
      this.grid.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
    if (input.tagName === 'SELECT') input.addEventListener('change', () => finish(true));
    input.focus();
    input.select?.();
  }
}

