/**
 * Commands of the workbench that Facet did not have, named and placed as in Materials Studio (ui/menumodel.js):
 *
 * - Edit: Cut, Copy, Paste (atoms between documents, and the clipboard as extended XYZ text), Atom Selection…
 * - Modify: Lattice Parameters…, Constraints…, Wrap Atoms into Cell, Element Properties…
 * - Build: Add Atoms…, Symmetry › Supercell…, Bonds…
 * - File: Open Project…, Save Project As…, Import URL…, Print…
 * - View: Display Style…, Display Options…, Lighting…, Effects…, Visibility (hide the selection, show only it),
 *   Status Bar, Explorers, Project Log, the info overlay
 * - Window: Tile Horizontally / Vertically, Cascade, Arrange Icons, Close, Close All, Windows…
 * - Tools: the Rotate, Zoom and Translate mouse modes of the 3D Viewer toolbar, Options…
 * - Statistics: Composition…, Measurements
 * - Animation: First and Last Frame
 *
 * installMsCommands(app, shell) registers them before main.js registers the fallbacks of the surface-tool commands, so
 * cell.parameters, cell.supercell, sel.query and constraints.edit are real commands here (registerFallback leaves them).
 */
import { h, btn } from './dom.js';
import { toast, dialog, promptDialog } from './overlays.js';
import { commands } from '../core/commands.js';
import { tools } from '../render/tools/index.js';
import { element, normalizeSymbol } from '../core/elements.js';
import { cellFromParams, inv3, fracToCart, cartToFrac } from '../core/util.js';
import { markEdited, Structure } from '../core/structure.js';
import { moveFlags, setMoveFlags } from '../core/constraints.js';
import { exportStructure } from '../io/index.js';
import { formulaHTML } from './shell.js';
import { deleteSelection } from './selectioncard.js';
import { TOOLBARS } from './workbench.js';

const HIDE_MASK = 'user';   // the visibility mask of View › Visibility and the IsHidden property
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const mul3 = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));

// ------------------------------------------------------------------------------------------------- edits
/**
 * Change lattice parameters of the active document (a, b, c in Å, alpha, beta, gamma in °; the others stay). The cell
 * keeps its orientation and the atoms their fractional positions (Materials Studio's default). One undo step.
 */
export function setLatticeParameters(app, p, { label = 'Lattice parameters' } = {}) {
  const s = app.structure;
  if (!s?.cell) throw new Error('This structure has no unit cell.');
  if (s.nFrames > 1) throw new Error('The lattice of a trajectory cannot be changed here.');
  const old = s.cellParams();
  const q = { ...old, ...p };
  for (const k of ['a', 'b', 'c']) if (!(q[k] > 0)) throw new Error(`Length ${k} must be greater than 0.`);
  for (const k of ['alpha', 'beta', 'gamma']) if (!(q[k] > 0 && q[k] < 180)) throw new Error(`Angle ${k} must be between 0° and 180°.`);
  const S0 = cellFromParams(old.a, old.b, old.c, old.alpha, old.beta, old.gamma);
  const S1 = cellFromParams(q.a, q.b, q.c, q.alpha, q.beta, q.gamma);
  const vol = (m) => Math.abs(m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]));
  if (!(vol(S1) > 1e-6) || S1.flat().some((x) => !Number.isFinite(x))) throw new Error('These angles do not make a cell (the vectors would lie in one plane).');
  // the cell is S0 turned by T (rows are the cell vectors): the new one is S1 turned the same way
  const T = mul3(inv3(S0), s.cell);
  const C1 = mul3(S1, T);
  const fr = s.fracPositions();
  const pos = new Float64Array(fr.length);
  for (let i = 0; i < s.length; i++) pos.set(fracToCart([fr[3 * i], fr[3 * i + 1], fr[3 * i + 2]], C1), 3 * i);
  return app.editActive(label, (st) => { st.writeFrame('current', { positions: pos, cell: C1 }); markEdited(st, 'cell'); }, { latticeChanged: true });
}

/** Hide (or show again) atoms of the active document with the View › Visibility mask. */
export function setHiddenAtoms(app, atoms, hide) {
  const v = app.viewer, n = app.structure?.length ?? 0;
  const cur = v._vis?.get(HIDE_MASK);
  const mask = cur && cur.length === n ? Uint8Array.from(cur) : new Uint8Array(n).fill(1);
  for (const i of atoms) if (i >= 0 && i < n) mask[i] = hide ? 0 : 1;
  v.setVisibility(HIDE_MASK, mask);
  if (hide) app.select(app.selection.filter((i) => mask[i]));
  app.emit('selection');
}
export const isUserHidden = (app, i) => { const m = app.viewer._vis?.get(HIDE_MASK); return !!m && m[i] === 0; };

// ------------------------------------------------------------------------------------------------- clipboard
/** What Edit › Copy put on the clipboard: its text (extended XYZ) and the atoms themselves. */
export const clip = { text: null, structure: null, whole: false };

function copyAtoms(app, { cut = false } = {}) {
  const s = app.structure;
  if (!s) throw new Error('Open a document first.');
  const sel = app.selection;
  const part = sel.length ? s.select({ indices: sel }) : s.clone();
  part.name = sel.length ? `${s.name} (${plural(sel.length, 'atom')})` : s.name;
  let text = '';
  try { text = exportStructure(part, part.cell ? 'extxyz' : 'xyz').text; } catch { text = ''; }
  Object.assign(clip, { text, structure: part, whole: !sel.length });
  navigator.clipboard?.writeText?.(text).catch(() => { /* the app's own clipboard still works */ });
  if (cut && sel.length) { deleteSelection(app); return; }
  toast(`${cut ? 'Cut' : 'Copied'} ${sel.length ? plural(sel.length, 'atom') : `the whole document (${plural(s.length, 'atom')})`}`);
}

/** Paste what Copy took: atoms into the active document (where they were), a whole document as a new one. */
function pasteAtoms(app, shell) {
  const src = clip.structure;
  if (src && app.structure && !clip.whole) {
    const n0 = app.structure.length, k = src.length;
    try {
      app.editActive(`Paste ${plural(k, 'atom')}`, (st) => { st.extend(src.clone()); });
      app.select(Array.from({ length: k }, (_, i) => n0 + i));
      toast(`Pasted ${plural(k, 'atom')} at their positions (now selected)`);
    } catch (e) { toast(e.message, { type: 'error' }); }
    return;
  }
  if (src) {
    const c = src.clone();
    c.name = `${src.name} (copy)`;
    try { app.addStructure(c, { replaceProject: app.project.structures.length ? false : 'auto', label: 'Paste document' }); } catch (e) { toast(e.message, { type: 'error' }); }
    return;
  }
  const read = navigator.clipboard?.readText?.();
  if (!read) { shell.pasteDialog(); return; }
  read.then((t) => (t?.trim() ? shell.pasteText(t) : shell.pasteDialog()), () => shell.pasteDialog());
}

// ------------------------------------------------------------------------------------------------- dialogs
const num = (value, { step = 'any', min = null, width = '92px', label } = {}) => h('input.field.mono', { type: 'number', step, min, value, 'aria-label': label, style: { width } });
const row = (label, ...ctl) => h('div.ctl.wide', h('label', label), h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, ...ctl));
const errBox = () => h('p.err-text', { hidden: true, role: 'alert' });
const fail = (err, e) => { err.hidden = false; err.textContent = e.message ?? String(e); return false; };

function latticeDialog(app) {
  const s = app.structure, cp = s.cellParams();
  const f = {};
  const mk = (k, lab, step = '0.0001') => (f[k] = num(+cp[k].toFixed(5), { step, label: lab }));
  const err = errBox();
  dialog({
    title: 'Lattice Parameters',
    body: h('div', { style: { display: 'grid', gap: '10px' } },
      h('p.hint', `${s.name}: the cell keeps its orientation and the atoms their fractional positions.`),
      h('div.lp-grid', h('span', 'a (Å)'), mk('a', 'a'), h('span', 'α (°)'), mk('alpha', 'alpha', '0.01'),
        h('span', 'b (Å)'), mk('b', 'b'), h('span', 'β (°)'), mk('beta', 'beta', '0.01'),
        h('span', 'c (Å)'), mk('c', 'c'), h('span', 'γ (°)'), mk('gamma', 'gamma', '0.01')),
      h('p.hint', `Volume now ${s.volume().toFixed(3)} Å³ · ${s.info.spacegroup ? `space group ${s.info.spacegroup} (changing the cell may lower it)` : 'space group not known'}`),
      err),
    actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, run: () => {
      try {
        const p = {};
        for (const k of Object.keys(f)) { const v = Number(f[k].value); if (!Number.isFinite(v)) throw new Error(`${k} must be a number.`); if (Math.abs(v - cp[k]) > 1e-9) p[k] = v; }
        if (!Object.keys(p).length) return true;
        setLatticeParameters(app, p);
        toast('Lattice parameters changed');
        return true;
      } catch (e) { return fail(err, e); }
    } }],
  });
}

function supercellDialog(app) {
  const s = app.structure;
  const f = ['a', 'b', 'c'].map((ax) => num(1, { step: 1, min: 1, width: '64px', label: `Repeat along ${ax}` }));
  const err = errBox();
  const info = h('p.hint');
  const upd = () => { const n = f.map((x) => Math.max(1, Math.round(+x.value || 1))); info.textContent = `${n.join(' × ')} → ${(s.length * n[0] * n[1] * n[2]).toLocaleString()} atoms`; };
  f.forEach((x) => x.addEventListener('input', upd)); upd();
  dialog({
    title: 'Supercell',
    body: h('div', { style: { display: 'grid', gap: '10px' } }, h('p.hint', 'Repeat the cell of the active document along a, b and c. The document is replaced by the supercell (Edit › Undo brings the cell back).'),
      row('Repeat a × b × c', f[0], h('span', '×'), f[1], h('span', '×'), f[2]), info, err),
    actions: [{ label: 'Cancel' }, { label: 'Create Supercell', primary: true, run: () => {
      try {
        const n = f.map((x) => Number(x.value));
        if (!n.every((k) => Number.isInteger(k) && k >= 1 && k <= 50)) throw new Error('Type whole numbers from 1 to 50.');
        if (n.every((k) => k === 1)) return true;
        const total = s.length * n[0] * n[1] * n[2];
        if (total > 2e6) throw new Error(`${total.toLocaleString()} atoms is too many.`);
        const r = s.repeat(...n);
        app.replaceActiveStructure(r, { label: `Supercell ${n.join('×')}`, latticeChanged: true });
        toast(`Built a ${n.join('×')} supercell: ${plural(r.length, 'atom')}`);
        return true;
      } catch (e) { return fail(err, e); }
    } }],
  });
}

function addAtomsDialog(app) {
  const s = app.structure;
  const sym = h('input.field', { value: app.prefs.addAtomElement ?? 'C', 'aria-label': 'Element', style: { width: '80px' }, autofocus: true });
  const frac = !!s?.cell;
  const mode = h('select.field', { 'aria-label': 'Coordinates', style: { width: 'auto' } }, h('option', { value: 'frac', selected: frac, disabled: !frac }, 'Fractional (a, b, c)'), h('option', { value: 'cart', selected: !frac }, 'Cartesian (x, y, z in Å)'));
  const xyz = [0, 1, 2].map((k) => num(frac ? 0.5 : 0, { width: '96px', label: ['first', 'second', 'third'][k] }));
  const err = errBox();
  const added = h('p.hint', s ? `Adds atoms to ${s.name}; each Add adds one and keeps the dialog open.` : 'There is no document yet: the first atom starts a new molecule document.');
  const add = () => {
    try {
      const z = normalizeSymbol(sym.value);
      if (z === 'X') throw new Error(`“${sym.value}” is not an element symbol.`);
      const v = xyz.map((x) => Number(x.value));
      if (!v.every(Number.isFinite)) throw new Error('Type three numbers for the position.');
      app.setPref('addAtomElement', z);
      if (!app.structure) {
        const st = new Structure({ name: 'New molecule', symbols: [z], positions: [v] });
        app.addStructure(st, { replaceProject: app.project.structures.length ? false : 'auto', name: 'New molecule' });
      } else {
        const cur = app.structure;
        const p = mode.value === 'frac' && cur.cell ? fracToCart(v, cur.cell) : v;
        let idx = -1;
        app.editActive(`Add ${z} atom`, (st) => { idx = st.addAtom(z, p); });
        if (idx >= 0) app.select([idx]);
      }
      err.hidden = true;
      added.textContent = `Added ${z} at ${v.map((x) => x.toFixed(4)).join(', ')}${mode.value === 'frac' ? ' (fractional)' : ' Å'}.`;
    } catch (e) { fail(err, e); }
    return false;
  };
  dialog({
    title: 'Add Atoms',
    body: h('div', { style: { display: 'grid', gap: '10px' } }, row('Element', sym), row('Coordinates', mode), row('Position', ...xyz), added, err),
    actions: [{ label: 'Close' }, { label: 'Add', primary: true, run: add }],
  });
  sym.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
}

/** Edit › Atom Selection…: select atoms by element, index, position, constraint or visibility. */
function atomSelectionDialog(app) {
  const s = app.structure;
  const props = [['element', 'Element'], ['index', 'Index'], ['x', 'Cartesian x (Å)'], ['y', 'Cartesian y (Å)'], ['z', 'Cartesian z (Å)'],
    ...(s.cell ? [['fa', 'Fractional a'], ['fb', 'Fractional b'], ['fc', 'Fractional c']] : []), ['fixed', 'Constraint'], ['hidden', 'Visibility']];
  const last = app.prefs.atomQuery ?? {};
  const prop = h('select.field', { 'aria-label': 'Property', style: { width: 'auto' } }, ...props.map(([v, l]) => h('option', { value: v, selected: v === (last.prop ?? 'element') }, l)));
  const text = h('input.field', { value: last.text ?? Object.keys(s.composition())[0] ?? '', 'aria-label': 'Elements', placeholder: 'e.g. O, Ti', style: { width: '160px' } });
  const neg = h('select.field', { 'aria-label': 'Is or is not', style: { width: 'auto' } }, h('option', { value: 'is' }, 'is'), h('option', { value: 'not' }, 'is not'));
  const lo = num(last.lo ?? 0, { label: 'From', width: '96px' }), hi = num(last.hi ?? 1, { label: 'To', width: '96px' });
  const cons = h('select.field', { 'aria-label': 'Constraint', style: { width: 'auto' } }, h('option', { value: 'fixed' }, 'fixed (any axis)'), h('option', { value: 'free' }, 'free'));
  const vis = h('select.field', { 'aria-label': 'Visibility', style: { width: 'auto' } }, h('option', { value: 'hidden' }, 'hidden'), h('option', { value: 'visible' }, 'visible'));
  const valueRow = h('div.row', { style: { gap: '6px', flexWrap: 'wrap', alignItems: 'center' } });
  const err = errBox();
  const count = h('p.hint');
  const draw = () => {
    const p = prop.value;
    if (p === 'element') valueRow.replaceChildren(neg, text);
    else if (p === 'fixed') valueRow.replaceChildren(h('span', 'is'), cons);
    else if (p === 'hidden') valueRow.replaceChildren(h('span', 'is'), vis);
    else valueRow.replaceChildren(h('span', 'from'), lo, h('span', 'to'), hi);
  };
  prop.addEventListener('change', draw); draw();
  const match = () => {
    const p = prop.value, n = s.length, out = [];
    const inv = s.cell ? inv3(s.cell) : null;
    const flags = p === 'fixed' ? moveFlags(s) : null;
    let want = null;
    if (p === 'element') {
      want = new Set(text.value.split(/[\s,;]+/).filter(Boolean).map(normalizeSymbol));
      if (!want.size || want.has('X')) throw new Error('Type element symbols, like O or Ti, Sr.');
    }
    const a = Number(lo.value), b = Number(hi.value);
    if (!['element', 'fixed', 'hidden'].includes(p) && !(Number.isFinite(a) && Number.isFinite(b))) throw new Error('Type two numbers.');
    const [L, H] = a <= b ? [a, b] : [b, a];
    for (let i = 0; i < n; i++) {
      let ok;
      if (p === 'element') ok = want.has(s.symbols[i]) !== (neg.value === 'not');
      else if (p === 'index') ok = i >= L && i <= H;
      else if (p === 'fixed') ok = flags[i].some((x) => !x) === (cons.value === 'fixed');
      else if (p === 'hidden') ok = !app.viewer.isVisible(i) === (vis.value === 'hidden');
      else {
        const q = s.pos(i);
        const v = p === 'x' ? q[0] : p === 'y' ? q[1] : p === 'z' ? q[2] : cartToFrac(q, inv)['abc'.indexOf(p[1])];
        ok = v >= L - 1e-9 && v <= H + 1e-9;
      }
      if (ok) out.push(i);
    }
    app.setPref('atomQuery', { prop: p, text: text.value, lo: a, hi: b });
    return out;
  };
  const go = (mode) => () => {
    try {
      const m = match();
      app.select(m, { mode });
      err.hidden = true;
      count.textContent = `${plural(m.length, 'atom')} matched · ${plural(app.selection.length, 'atom')} selected now.`;
    } catch (e) { fail(err, e); }
    return false;
  };
  dialog({
    title: 'Atom Selection',
    body: h('div', { style: { display: 'grid', gap: '10px' } }, h('p.hint', `Select atoms of ${s.name} by a property.`), row('Property', prop), row('Value', valueRow), count, err),
    actions: [{ label: 'Close' }, { label: 'Remove', run: go('remove') }, { label: 'Add', run: go('add') }, { label: 'Select', primary: true, run: go('replace') }],
  });
}

/** Modify › Constraints…: fix the selected atoms along a, b and c. */
function constraintsDialog(app) {
  const s = app.structure, sel = app.selection.length ? app.selection : null;
  const atoms = sel ?? s.symbols.map((_, i) => i);
  const flags = moveFlags(s);
  const box = ['a', 'b', 'c'].map((ax, k) => {
    const all = atoms.every((i) => !flags[i][k]);
    return h('input', { type: 'checkbox', checked: all, 'aria-label': `Fix along ${ax}` });
  });
  dialog({
    title: 'Constraints',
    body: h('div', { style: { display: 'grid', gap: '10px' } },
      h('p.hint', sel ? `Fix the ${plural(sel.length, 'selected atom')} of ${s.name} along the cell axes (fixed atoms do not move in a relaxation).` : `No atoms are selected: this applies to all ${plural(s.length, 'atom')} of ${s.name}.`),
      h('div.row', { style: { gap: '16px' } }, ...box.map((b, k) => h('label.row', { style: { gap: '6px' } }, b, `Fix ${'abc'[k]}${s.cell ? '' : ` (${'xyz'[k]})`}`))),
      h('p.hint', 'POSCAR writes these as selective dynamics, XSD as fixed atoms.')),
    actions: [{ label: 'Cancel' }, { label: 'Free All', run: () => apply([true, true, true]) }, { label: 'Apply', primary: true, run: () => apply(box.map((b) => !b.checked)) }],
  });
  function apply(row) {
    try {
      app.editActive(`Constraints on ${plural(atoms.length, 'atom')}`, (st) => { const f = moveFlags(st); for (const i of atoms) f[i] = row.slice(); setMoveFlags(st, f); });
      toast(row.every(Boolean) ? `Freed ${plural(atoms.length, 'atom')}` : `Fixed ${plural(atoms.length, 'atom')} along ${['a', 'b', 'c'].filter((_, k) => !row[k]).join(', ')}`);
    } catch (e) { toast(e.message, { type: 'error' }); }
  }
}

async function importUrl(app) {
  const url = await promptDialog({ title: 'Import URL', label: 'Address of a structure file (CIF, POSCAR, XYZ, PDB, XSD …)', confirm: 'Import', placeholder: 'https://…/structure.cif', value: app.prefs.lastImportUrl ?? '' });
  if (!url) return;
  let u;
  try { u = new URL(url, location.href); } catch { toast('That is not a web address.', { type: 'error' }); return; }
  if (!/^https?:$/.test(u.protocol)) { toast('Only http and https addresses can be imported.', { type: 'error' }); return; }
  app.setPref('lastImportUrl', u.href);
  const t = app.startTask?.(`Downloading ${u.pathname.split('/').pop() || u.host}…`);
  try {
    const r = await fetch(u.href);
    if (!r.ok) throw new Error(`The server answered ${r.status} ${r.statusText}`.trim());
    const text = await r.text();
    const name = decodeURIComponent(u.pathname.split('/').pop() || 'download');
    await app.importText(text, name);
    toast(`Imported ${name}`);
  } catch (e) {
    toast(`Could not import ${u.host}: ${e.message}${e instanceof TypeError ? ' (the site may not allow downloads from other pages; save the file and drop it here instead)' : ''}`, { type: 'error', timeout: 8000 });
  } finally { t?.end?.(); }
}

/** File › Print…: the view as an image on a page, through the browser's print dialog. */
async function printView(app) {
  let blob = null;
  try { blob = await app.viewer.screenshot({ scale: 2, selection: false }); } catch { blob = null; }
  let url;
  if (blob instanceof Blob) url = URL.createObjectURL(blob);
  else url = app.viewer.thumbnail(1600, Math.round(1600 * (app.viewer.height / Math.max(1, app.viewer.width))), 0.95);
  const s = app.structure;
  const frame = h('iframe', { style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' }, 'aria-hidden': 'true' });
  document.body.append(frame);
  const d = frame.contentDocument;
  d.open();
  d.write(`<!doctype html><title>${(s?.name ?? 'Facet').replace(/[<&]/g, '')}</title><style>body{margin:24px;font:13px system-ui}img{max-width:100%;display:block;margin:12px 0}</style><h3>${(s?.name ?? '').replace(/[<&]/g, '')}</h3><div>${formulaHTML(s?.formula() ?? '')}</div><img src="${url}">`);
  d.close();
  const img = d.querySelector('img');
  await new Promise((res) => { if (img.complete) res(); else { img.onload = res; img.onerror = res; } });
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => { frame.remove(); if (blob instanceof Blob) URL.revokeObjectURL(url); }, 60000);
}

// ------------------------------------------------------------------------------------------------- project log
/** View › Project Log: the messages and edits of this session. */
export const projectLog = [];
function logLine(kind, text) {
  projectLog.push({ t: new Date(), kind, text: String(text).trim() });
  if (projectLog.length > 500) projectLog.splice(0, projectLog.length - 500);
}
function watchLog(app) {
  if (typeof MutationObserver === 'function') {
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || !n.classList?.contains('toast')) continue;
        const msg = n.querySelector('.msg, span')?.textContent ?? n.textContent;
        if (msg?.trim()) logLine(n.classList.contains('error') || n.dataset?.type === 'error' ? 'error' : 'message', msg);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  let last = null;
  app.on('history', () => { const l = app.undoLabel?.(); if (l && l !== last) logLine('edit', l); last = l; });
  app.on('project', () => { if (app.project !== watchLog._p) { watchLog._p = app.project; logLine('project', `Project “${app.project.name}”`); } });
}
function logDialog() {
  const fmt = (d) => d.toLocaleTimeString();
  const list = h('div.log-list', ...(projectLog.length ? projectLog.slice().reverse().map((e) => h(`div.log-row.${e.kind}`, h('span.t.mono', fmt(e.t)), h('span.k', e.kind), h('span.m', e.text))) : [h('p.hint', 'Nothing has happened yet in this session.')]));
  dialog({
    title: 'Project Log', wide: true, body: list,
    actions: [
      { label: 'Copy', run: () => { navigator.clipboard?.writeText?.(projectLog.map((e) => `${fmt(e.t)}\t${e.kind}\t${e.text}`).join('\n')).then(() => toast('Log copied'), () => {}); return false; } },
      { label: 'Clear', run: () => { projectLog.length = 0; list.replaceChildren(h('p.hint', 'The log is empty.')); return false; } },
      { label: 'Close', primary: true },
    ],
  });
}

// ------------------------------------------------------------------------------------------------- options, statistics
function optionsDialog(app, shell) {
  const bench = shell.bench;
  const chk = (label, on, set, tip) => { const b = h('input', { type: 'checkbox', checked: !!on }); b.addEventListener('change', () => set(b.checked)); return h('label.row.opt', { 'data-tip': tip ?? null, style: { gap: '8px' } }, b, label); };
  const theme = h('select.field', { 'aria-label': 'Theme', style: { width: 'auto' } }, ...[['system', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('option', { value: v, selected: (app.prefs.theme ?? 'system') === v }, l)));
  theme.addEventListener('change', () => shell.setTheme(theme.value));
  dialog({
    title: 'Options',
    body: h('div.opts', { style: { display: 'grid', gap: '14px' } },
      h('section', h('h4', 'Interface'), row('Theme', theme),
        chk('Status bar', app.prefs.statusBar !== false, (v) => { app.setPref('statusBar', v); bench?.place(); }),
        chk('Structure info overlay in the view', !!app.prefs.infoCard, (v) => { app.setPref('infoCard', v); shell.updateInfo(); }),
        chk('Open new documents maximized (with tabs)', app.prefs.mdiMax !== false, (v) => bench?.mdi.setMax(v))),
      h('section', h('h4', 'Toolbars'), h('div.opt-grid', ...TOOLBARS.map(([id, l]) => chk(l, bench?.toolbarOn(id), (v) => bench?.setToolbar(id, v))))),
      h('section', h('h4', 'Saving'), chk('Autosave the project a few seconds after each change', app.prefs.autosave !== false, (v) => { app.setPref('autosave', v); shell.updateSaveChip(); })),
      h('section', h('h4', 'Images'),
        chk('Draw the selection highlight into PNG images', app.prefs.exportSelection !== false, (v) => app.setPref('exportSelection', v)),
        chk('Draw markers (sites, fixed atoms) into PNG images', app.prefs.exportMarkers === true, (v) => app.setPref('exportMarkers', v))),
      h('section', h('h4', 'Layout'), btn('Reset Window Layout', { cls: 'small', icon: 'reset', tip: 'Explorers, toolbars and tool windows back to where they start', on: () => {
        for (const k of ['toolWindows', 'dockWidth', 'dockSplit', 'explorers', 'toolbars']) delete app.prefs[k];
        app.setPref('mdiMax', true);
        bench?.applyDock(); bench?.applyToolbars(); bench?.place(); bench?.mdi.setMax(true);
        shell.renderDrawer(); shell.renderInspector();
        toast('Window layout reset');
      } }))),
    actions: [{ label: 'Close', primary: true }],
  });
}

function compositionDialog(app) {
  const s = app.structure, comp = s.composition();
  const total = s.length, mass = s.symbols.reduce((t, x) => t + element(x).mass, 0);
  const rows = Object.keys(comp).sort((a, b) => element(a).Z - element(b).Z).map((sym) => {
    const n = comp[sym], m = n * element(sym).mass;
    return h('tr', h('td', h('b', sym), ` ${element(sym).name}`), h('td.num', n.toLocaleString()), h('td.num', `${((100 * n) / total).toFixed(2)}`), h('td.num', `${((100 * m) / mass).toFixed(2)}`));
  });
  dialog({
    title: 'Composition',
    body: h('div', { style: { display: 'grid', gap: '10px' } },
      h('div', h('span.formula', { html: formulaHTML(s.formula()) }), h('span.muted', ` · ${plural(total, 'atom')} · ${mass.toFixed(3)} amu${s.cell ? ` · ${s.density().toFixed(3)} g/cm³` : ''}`)),
      h('table.comp-table', h('thead', h('tr', h('th', 'Element'), h('th', 'Atoms'), h('th', 'Atom %'), h('th', 'Mass %'))), h('tbody', ...rows))),
    actions: [{ label: 'Close', primary: true }],
  });
}

// ------------------------------------------------------------------------------------------------- mouse modes
/** Rotate, Zoom and Translate (the 3D Viewer toolbar): the left button turns, zooms or moves the view. */
function registerMouseModes() {
  const mode = (id, title, icon, tip, cursor, drag) => tools.register({
    id, title, icon, tip, order: 5, toolbar: true, nav: true, selects: false, cursor, touch: 'claim',
    hint: () => [`<b>Drag</b> ${tip.toLowerCase()}`, '<b>Esc</b> back to Select'],
    hud: () => null,
    handler: (app, viewer) => {
      let last = null;
      return {
        claims: () => true,
        down: (e) => { last = [e.clientX, e.clientY]; return true; },
        begin: (e) => { last ??= [e.clientX, e.clientY]; },
        move: (e) => { if (!last) return; const dx = e.clientX - last[0], dy = e.clientY - last[1]; last = [e.clientX, e.clientY]; drag(viewer, dx, dy, e); },
        up: () => { last = null; },
        cancel: () => { last = null; },
      };
    },
  });
  if (!tools.get('rotate')) mode('rotate', 'Rotate', 'rotate', 'Rotate the view', 'grab', (v, dx, dy, e) => {
    if (e.shiftKey) { v.rotateScreen('z', dx * 0.5, { animate: false }); return; }
    if (dx) v.rotateScreen('y', dx * 0.45, { animate: false });
    if (dy) v.rotateScreen('x', dy * 0.45, { animate: false });
  });
  if (!tools.get('zoom')) mode('zoom', 'Zoom', 'zoom', 'Zoom the view', 'ns-resize', (v, dx, dy) => { if (dy) v.zoomBy(Math.exp(-dy * 0.008)); });
  if (!tools.get('translate')) mode('translate', 'Translate', 'translate', 'Move the view', 'move', (v, dx, dy) => v.panBy(dx, dy));
}

// ------------------------------------------------------------------------------------------------- registration
export function installMsCommands(app, shell) {
  const R = (c) => { if (!commands.get(c.id) || commands.get(c.id).fallback) { if (commands.get(c.id)) commands.unregister(c.id); commands.register(c); } };
  const hasS = () => !!app.structure;
  const per = () => !!app.structure?.cell;
  const hasSel = () => hasS() && app.selection.length > 0;
  const traj = () => (app.structure?.nFrames ?? 1) > 1;
  const bench = () => shell.bench;
  const mdi = () => shell.bench?.mdi;
  const anyWin = () => (mdi()?.list().length ?? 0) > 0;
  const noCell = () => (app.structure ? 'This structure has no unit cell.' : null);
  registerMouseModes();
  watchLog(app);

  // Edit
  R({ id: 'edit.cut', title: 'Cut', category: 'Edit', kbd: 'mod+x', keywords: 'clipboard atoms', when: hasSel, whyNot: () => (app.structure ? 'Select atoms first.' : null), run: () => copyAtoms(app, { cut: true }) });
  R({ id: 'edit.copy', title: 'Copy', category: 'Edit', kbd: 'mod+c', keywords: 'clipboard atoms xyz', when: hasS, run: () => copyAtoms(app) });
  R({ id: 'edit.paste', title: 'Paste', category: 'Edit', kbd: 'mod+v', keywords: 'clipboard atoms insert', run: () => pasteAtoms(app, shell) });
  R({ id: 'sel.query', title: 'Atom selection…', category: 'Edit', aliases: ['Atom Selection', 'select by property'], ms: 'Edit › Atom Selection', keywords: 'select element index height fractional fixed', when: hasS, run: () => atomSelectionDialog(app) });
  // Modify
  R({ id: 'cell.parameters', title: 'Lattice parameters…', category: 'Cell', aliases: ['Lattice Parameters'], ms: 'Modify › Lattice Parameters', keywords: 'a b c alpha beta gamma cell edit', edits: true, when: per, whyNot: noCell, run: () => latticeDialog(app) });
  R({ id: 'constraints.edit', title: 'Modify constraints…', category: 'Edit', aliases: ['Modify Constraints', 'Edit Constraints'], ms: 'Modify › Constraints', keywords: 'fix freeze selective dynamics', edits: true, when: hasS, run: () => constraintsDialog(app) });
  R({ id: 'cell.wrap', title: 'Wrap atoms into cell', category: 'Cell', keywords: 'wrap periodic images inside', edits: true, when: () => !!app.structure?.periodic, whyNot: noCell, run: () => { app.editActive('Wrap atoms into cell', (st) => { st.wrap(); markEdited(st, 'positions'); }); toast('Atoms wrapped into the cell'); } });
  R({ id: 'modify.elementProps', title: 'Element properties…', category: 'Modify', keywords: 'colour radius size element', run: () => { shell.openInspector('style'); requestAnimationFrame(() => [...shell.inspector.querySelectorAll('h3, summary')].find((x) => /element/i.test(x.textContent))?.scrollIntoView({ block: 'start' })); } });
  // Build
  R({ id: 'build.addAtom', title: 'Add atoms…', category: 'Build', aliases: ['Add Atoms', 'insert atom'], ms: 'Build › Add Atoms', keywords: 'new atom place coordinates', run: () => addAtomsDialog(app) });
  R({ id: 'cell.supercell', title: 'Supercell…', category: 'Cell', aliases: ['Supercell', 'Create Supercell'], ms: 'Build › Symmetry › Supercell', keywords: 'repeat replicate expand', edits: true, when: per, whyNot: noCell, run: () => supercellDialog(app) });
  R({ id: 'view.bonds', title: 'Bonds…', category: 'Build', ms: 'Build › Bonds', keywords: 'bond tolerance calculate connectivity', run: () => { shell.openInspector('scene'); requestAnimationFrame(() => [...shell.inspector.querySelectorAll('h3, summary')].find((x) => /bond/i.test(x.textContent))?.scrollIntoView({ block: 'start' })); } });
  // File
  R({ id: 'project.open', title: 'Open project…', category: 'File', ms: 'File › Open Project', keywords: 'projects recent load', run: () => shell.openLeft('projects') });
  R({ id: 'project.saveAs', title: 'Save project as…', category: 'File', ms: 'File › Save As', keywords: 'copy duplicate', run: async () => {
    const name = await promptDialog({ title: 'Save Project As', label: 'Name of the copy', value: `${app.project.name} (copy)`, confirm: 'Save' });
    if (!name) return;
    await app.saveAsCopy();
    app.rename(name);
  } });
  R({ id: 'file.importUrl', title: 'Import URL…', category: 'File', ms: 'File › Import URL', keywords: 'download web link cod database', run: () => importUrl(app) });
  R({ id: 'file.print', title: 'Print…', category: 'File', key: 'mod+p', ms: 'File › Print', keywords: 'paper pdf', when: hasS, run: () => printView(app).catch((e) => toast(e.message, { type: 'error' })) });
  // View
  R({ id: 'view.displayStyle', title: 'Display style…', category: 'View', ms: 'View › Display Style', keywords: 'atom style ball stick looks colours', run: () => shell.openInspector('style') });
  R({ id: 'view.displayOptions', title: 'Display options…', category: 'View', ms: 'View › Display Options', keywords: 'background cell bonds labels camera', run: () => shell.openInspector('scene') });
  R({ id: 'view.lighting', title: 'Lighting…', category: 'View', ms: 'View › Lighting', keywords: 'light shadows exposure', run: () => shell.openInspector('light') });
  R({ id: 'view.effects', title: 'Effects…', category: 'View', keywords: 'ambient occlusion outline bloom depth', run: () => shell.openInspector('effects') });
  R({ id: 'view.hideSelected', title: 'Hide selected atoms', category: 'View', keywords: 'visibility invisible', when: hasSel, whyNot: () => (app.structure ? 'Select atoms first.' : null), run: () => { const n = app.selection.length; setHiddenAtoms(app, app.selection, true); toast(`Hid ${plural(n, 'atom')}`, { action: { label: 'Show all', run: () => app.viewer.showAll() } }); } });
  R({ id: 'view.showOnlySelected', title: 'Show only selected atoms', category: 'View', keywords: 'isolate visibility', when: hasSel, whyNot: () => (app.structure ? 'Select atoms first.' : null), run: () => { const keep = new Set(app.selection); setHiddenAtoms(app, app.structure.symbols.map((_, i) => i).filter((i) => !keep.has(i)), true); } });
  R({ id: 'view.statusBar', title: 'Status bar', category: 'View', run: () => { app.setPref('statusBar', app.prefs.statusBar === false); bench()?.place(); } });
  R({ id: 'view.infoCard', title: 'Structure info overlay', category: 'View', keywords: 'formula card corner', run: () => { app.setPref('infoCard', !app.prefs.infoCard); shell.updateInfo(); } });
  R({ id: 'view.projectLog', title: 'Project log', category: 'View', ms: 'View › Project Log', keywords: 'history messages', run: () => logDialog() });
  R({ id: 'view.explorer.project', title: 'Project explorer', category: 'View', keywords: 'tree documents', run: () => bench()?.setExplorer('project') });
  R({ id: 'view.explorer.properties', title: 'Properties explorer', category: 'View', keywords: 'property grid filter', run: () => bench()?.setExplorer('properties') });
  // Animation
  R({ id: 'traj.first', title: 'First frame', category: 'Trajectory', when: traj, run: () => app.viewer.setFrame(0) });
  R({ id: 'traj.last', title: 'Last frame', category: 'Trajectory', when: traj, run: () => app.viewer.setFrame(app.structure.nFrames - 1) });
  // Tools
  for (const [id, title] of [['rotate', 'Rotate tool'], ['zoom', 'Zoom tool'], ['translate', 'Translate tool']]) R({ id: `tool.${id}`, title, category: 'Tools', keywords: 'mouse mode 3d viewer', when: hasS, run: () => app.setTool(id) });
  R({ id: 'tools.options', title: 'Options…', category: 'Tools', ms: 'Tools › Options', keywords: 'preferences settings', run: () => optionsDialog(app, shell) });
  // Statistics
  R({ id: 'stats.composition', title: 'Composition…', category: 'Statistics', keywords: 'elements fraction mass percent', when: hasS, run: () => compositionDialog(app) });
  R({ id: 'stats.measurements', title: 'Measurements', category: 'Statistics', keywords: 'distances angles list', when: hasS, run: () => { shell.openLeft('structure'); requestAnimationFrame(() => [...shell.drawer.querySelectorAll('.section > h3')].find((x) => /^Measurements/.test(x.textContent.trim()))?.scrollIntoView({ block: 'start' })); } });
  // Window
  R({ id: 'window.tileH', title: 'Tile horizontally', category: 'Window', when: anyWin, run: () => mdi().tile('h') });
  R({ id: 'window.tileV', title: 'Tile vertically', category: 'Window', when: anyWin, run: () => mdi().tile('v') });
  R({ id: 'window.cascade', title: 'Cascade', category: 'Window', when: anyWin, run: () => mdi().cascade() });
  R({ id: 'window.arrange', title: 'Arrange icons', category: 'Window', when: () => (mdi()?.list().some((w) => w.state === 'min')) ?? false, run: () => mdi().arrange() });
  R({ id: 'window.maximize', title: 'Maximize windows', category: 'Window', when: anyWin, run: () => mdi().setMax(!mdi().max) });
  R({ id: 'window.close', title: 'Close window', category: 'Window', when: () => !!app.project.activeStructure, run: () => mdi().close(app.project.activeStructure) });
  R({ id: 'window.closeAll', title: 'Close all', category: 'Window', when: anyWin, run: () => mdi().closeAll() });
  R({ id: 'window.list', title: 'Windows…', category: 'Window', when: () => app.project.structures.length > 0, run: () => bench()?.windowsDialog() });

  // the clipboard keys: the browser's copy, cut and paste events (so text fields keep theirs)
  const textTarget = (e) => { const t = e.target; return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };
  const busy = () => !!document.querySelector('.scrim, .dialog');
  for (const type of ['copy', 'cut']) {
    document.addEventListener(type, (e) => {
      if (textTarget(e) || busy() || !app.structure || String(globalThis.getSelection?.() ?? '').length) return;
      if (type === 'cut' && !app.selection.length) return;
      e.preventDefault();
      try {
        copyAtoms(app, { cut: type === 'cut' });
        if (clip.text) e.clipboardData?.setData('text/plain', clip.text);
      } catch (err) { toast(err.message, { type: 'error' }); }
    });
  }
}

/** The paste event of the shell asks this first: true when the clipboard holds atoms Copy took (pasted here). */
export function pasteFromClip(app, shell, text) {
  if (!clip.structure || !clip.text || String(text).trim() !== clip.text.trim()) return false;
  pasteAtoms(app, shell);
  return true;
}
