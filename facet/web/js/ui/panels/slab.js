/**
 * Surface panel › Slab (M2 §5.6): tools for an existing slab, each one undo step on the active structure — set the
 * vacuum (the total gap; Materials Studio's Build Vacuum Slab), centre the slab in its cell, turn it upside down, and
 * fix or free atomic layers (selective dynamics). The section works on any structure with a unit cell: a crystal
 * without a vacuum gap gets one along c. Registers the commands surface.vacuum, surface.setVacuum, surface.center,
 * surface.flip, sel.fix and sel.free, and the API members facet.edit.setVacuum / centerSlab / flipSlab / fixLayers /
 * freeAtoms and facet.surface.layers / extent.
 */
import { h, btn, seg, field } from '../dom.js';
import { registerPanelSection, openSection, requireCell, requireVacuumGap } from '../sections.js';
import { commands } from '../../core/commands.js';
import { structureKey } from '../../core/analyses.js';
import { SURFACE_DEFAULTS } from '../../core/defaults.js';
import { constraintSummary, moveFlags } from '../../core/constraints.js';
import { cellParams } from '../../core/lattice.js';
import * as vacuumGaps from '../../core/vacuum.js';
import { setVacuum, centerSlab, flipSlab, slabExtent, slabLayers, slabShifts, fixLayers, freeAtoms } from '../../build/surface.js';
import { numberInput } from '../inputs.js';
import { toast } from '../overlays.js';
import { defineApi } from '../../api/namespaces.js';

const AXES = 'abc';
const fmt = (x, d = 2) => Number(x).toFixed(d);
const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
const sentence = (t) => { const s = String(t ?? '').trim(); return s ? `${s[0].toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}` : s; };
/** The vacuum typed last in this session (never a default, U4), and the choices of the fix row. */
const form = { vacuum: null, position: 'center', fixN: 2, where: 'bottom' };

/** For editActive: the whole-cell moves the slab tools make when they put a slab in one piece. */
function imageShiftOf(s) {
  const r = slabShifts(s);
  if (!r) return null;
  const { axis, shifts } = r;
  return (i) => { if (!shifts[i]) return null; const v = [0, 0, 0]; v[axis] = shifts[i]; return v; };
}

export function applyVacuum(app, vacuum, { position = 'center', offset = 0, axis = null } = {}) {
  const s = app.structure;
  if (!s) throw new Error('Load a structure first.');
  // checked on a copy first, so that a refused value leaves no undo step
  setVacuum(s.clone(), vacuum, { position, offset, axis });
  return app.editActive(`Set vacuum to ${fmt(vacuum, 1)} Å`, (st) => { setVacuum(st, vacuum, { position, offset, axis }); },
    { latticeChanged: true, singleFrame: true, imageShift: imageShiftOf(s), toast: `Vacuum set to ${fmt(vacuum, 1)} Å` });
}

export function applyCenter(app) {
  const s = app.structure;
  if (!s) throw new Error('Load a structure first.');
  return app.editActive('Centre slab', (st) => { centerSlab(st); }, { singleFrame: true, imageShift: imageShiftOf(s), toast: 'Centred the slab in its cell' });
}

export function applyFlip(app) {
  const s = app.structure;
  if (!s) throw new Error('Load a structure first.');
  flipSlab(s.clone());
  const r = app.editActive('Flip slab', (st) => { flipSlab(st); }, { latticeChanged: true, singleFrame: true });
  const top = app.structure.info?.surface?.termination?.top;
  app.toastUndo(top && app.structure.info.surface.termination.count > 1 ? `Flipped the slab: ${top} is now on top` : 'Flipped the slab', { entry: r.entry });
  return r;
}

export function applyFix(app, n, { where = 'bottom', axes = 'abc' } = {}) {
  const s = app.structure;
  if (!s) throw new Error('Load a structure first.');
  const fixed = fixLayers(s.clone(), n, { where, axes });
  return app.editActive(`Fix ${where} ${plural(n, 'layer')}`, (st) => { fixLayers(st, n, { where, axes }); },
    { rebuild: 'appearance', toast: `Fixed ${plural(fixed, 'atom')} (${where} ${plural(n, 'layer')})` });
}

export function applyFree(app, indices = null) {
  const s = app.structure;
  if (!s) throw new Error('Load a structure first.');
  const freed = freeAtoms(s.clone(), indices);
  if (!freed) { toast('No atom is fixed.'); return null; }
  return app.editActive(indices ? 'Free selected atoms' : 'Free all atoms', (st) => { freeAtoms(st, indices); },
    { rebuild: 'appearance', toast: `Freed ${plural(freed, 'atom')}` });
}

export function applyFixSelection(app, { axes = 'abc' } = {}) {
  const s = app.structure, sel = app.selection ?? [];
  if (!s || !sel.length) throw new Error('Select atoms first.');
  const flag = [...'abc'].map((ax) => !axes.includes(ax));
  return app.editActive(`Fix ${plural(sel.length, 'atom')}`, (st) => {
    const flags = moveFlags(st).map((row) => [...row]);
    for (const i of sel) flags[i] = [...flag];
    st.setProp('selective_dynamics', flags);
  }, { rebuild: 'appearance', toast: `Fixed ${plural(sel.length, 'atom')}` });
}

function render(app, el) {
  const s = app.structure;
  const ext = slabExtent(s);
  if (!ext) { el.append(h('p.hint', 'This structure has no atoms.')); return; }
  let layers = null;
  try { layers = slabLayers(s); } catch { layers = null; }
  const cp = cellParams(s.cell);
  const gapLine = ext.vacuum
    ? `Vacuum gap ${fmt(ext.gap)} Å along ${AXES[ext.axis]} · ${fmt(ext.thickness)} Å of atoms${layers ? ` · ${plural(layers.count, 'layer')}` : ''}`
    : `No vacuum gap of ${SURFACE_DEFAULTS.vacuumGapMin} Å or more. Setting a vacuum cuts the crystal at its widest gap along ${AXES[ext.axis]} and opens it there.`;
  el.append(h('p.hint.slab-info', gapLine, h('br'), `Cell ${fmt(cp.a)} × ${fmt(cp.b)} × ${fmt(cp.c)} Å`));
  const rec = s.info?.surface;
  if (rec?.kind === 'cleave' && rec.termination) {
    const t = rec.termination;
    el.append(h('p.hint', t.count > 1 ? `Top: ${t.top} · bottom: ${t.bottom}` : `Termination: ${t.top}`));
  }

  // ---- vacuum
  let vacuum = form.vacuum;
  const err = h('p.err-text', { hidden: true, role: 'alert' });
  const apply = btn('Apply', { cls: 'small primary', tip: 'Set the vacuum (one undo step)', on: () => {
    if (vacuumIn.validate()) { vacuumIn.focus(); return; }
    try { err.hidden = true; applyVacuum(app, vacuum, { position: form.position }); }
    catch (e) { err.hidden = false; err.textContent = sentence(e?.message ?? e); }
  } });
  const vacuumIn = numberInput({ label: 'Vacuum', unit: 'Å', min: 0, max: SURFACE_DEFAULTS.maxVacuum, value: vacuum, required: true, key: 'slab:vacuum',
    onChange: (v) => { vacuum = v; if (v != null) form.vacuum = v; apply.disabled = v == null; }, onValidity: (ok) => { apply.disabled = !ok; },
    onCommit: () => {} });
  apply.disabled = vacuum == null;
  el.append(
    h('div.sub-h', ext.vacuum ? 'Set vacuum' : 'Build vacuum slab'),
    field('Vacuum', vacuumIn.el, 'Total gap between the slab and its periodic image, in Å (not per side)'),
    field('Position', seg([{ value: 'center', label: 'Centre' }, { value: 'bottom', label: 'Bottom' }], form.position, (v) => { form.position = v; }, { label: 'Slab position', key: 'slab:position' })),
    err,
    h('div.row', apply, h('span.hint', 'The atoms keep their distances; only c changes.')),
  );

  // ---- place
  const needGap = ext.vacuum ? null : 'Needs a vacuum gap: set a vacuum first.';
  const guarded = (fn) => () => { try { fn(app); } catch (e) { toast(sentence(e?.message ?? e), { type: 'error' }); } };
  el.append(h('div.sub-h', 'Slab'),
    h('div.sec-acts',
      btn('Centre slab', { cls: 'small', icon: 'fit', disabled: !ext.vacuum, on: guarded(applyCenter),
        tip: needGap ?? 'Move the slab to the middle of its cell (also joins a slab that crosses the cell edge)' }),
      btn('Flip slab', { cls: 'small', icon: 'reset', disabled: !ext.vacuum || ext.axis !== 2, on: guarded(applyFlip),
        tip: needGap ?? (ext.axis !== 2 ? 'Flipping needs the vacuum along c.' : 'Turn the slab upside down (a rotation, never a mirror image)') })));

  // ---- constraints
  const c = constraintSummary(s);
  const fixedCount = c.fixed + c.partial;
  const count = layers?.count ?? 0;
  const fixIn = numberInput({ label: 'Layers to fix', integer: true, min: 1, max: Math.max(1, count), value: Math.min(form.fixN, Math.max(1, count)), key: 'slab:fixN',
    onChange: (v) => { if (v != null) form.fixN = v; } });
  el.append(h('div.sub-h', 'Constraints'),
    h('p.hint', fixedCount ? `${plural(fixedCount, 'atom')} of ${s.length} fixed${c.partial ? ` (${c.partial} along some directions only)` : ''}.` : 'No atom is fixed.'),
    h('div.slab-fix',
      h('span', 'Fix'), fixIn.el,
      seg([{ value: 'bottom', label: 'bottom' }, { value: 'top', label: 'top' }], form.where, (v) => { form.where = v; }, { label: 'Which layers', key: 'slab:where' }),
      h('span', 'layers')),
    h('div.sec-acts',
      btn('Fix layers', { cls: 'small primary', disabled: !count, tip: 'Fixed atoms get selective dynamics F F F (kept in POSCAR, extended XYZ, XSD and Facet JSON)', on: () => {
        if (fixIn.validate()) { fixIn.focus(); return; }
        try { applyFix(app, form.fixN, { where: form.where }); } catch (e) { toast(sentence(e?.message ?? e), { type: 'error' }); }
      } }),
      btn('Free all', { cls: 'small', disabled: !fixedCount, tip: 'Remove every constraint', on: () => { try { applyFree(app); } catch (e) { toast(sentence(e?.message ?? e), { type: 'error' }); } } })));
}

registerPanelSection('surface', {
  id: 'slab', title: 'Slab', order: 20, defaultOpen: true,
  available: requireCell,
  refreshOn: ['project', 'structure'],
  signature: (app) => `${app.project?.activeStructure ?? ''}|${app.structure ? structureKey(app) : ''}`,
  badge: (app) => { try { const e = app.structure?.cell ? slabExtent(app.structure) : null; return e?.vacuum ? `${fmt(e.gap, 1)} Å` : ''; } catch { return ''; } },
  render,
});

// ------------------------------------------------------------------------------------------- commands and API
const VACUUM = { name: 'vacuum', type: 'float', label: 'Vacuum', unit: 'Å', min: 0, max: 1000, required: true,
  description: 'Total gap between the slab and its periodic image (Å).' };
const VACUUM_PARAMS = [VACUUM, { name: 'position', type: 'select', label: 'Position', options: ['center', 'bottom'] },
  { name: 'offset', type: 'float', label: 'Offset', unit: 'Å', min: 0, max: 1000 }];
const hasCell = (app) => !!app?.structure?.cell;
const noCell = (app) => (app?.structure && !app.structure.cell ? 'Build Vacuum Slab needs a unit cell.' : null);
const gapReason = (app) => requireVacuumGap(app, vacuumGaps);
const vacuumRun = (app, values) => {
  if (values === undefined) return openSection('surface', 'slab', { focus: 'slab:vacuum' });
  return applyVacuum(app, values.vacuum, { position: values.position ?? 'center', offset: values.offset ?? 0 });
};

commands.register({ id: 'surface.vacuum', title: 'Build vacuum slab…', category: 'Surface', aliases: ['Build Vacuum Slab', 'add vacuum'],
  ms: 'Build › Crystals › Build Vacuum Slab', edits: true, params: VACUUM_PARAMS, when: hasCell, whyNot: noCell, run: vacuumRun });
commands.register({ id: 'surface.setVacuum', title: 'Set vacuum…', category: 'Surface', aliases: ['Vacuum', 'change vacuum'], edits: true, params: VACUUM_PARAMS,
  when: (app) => hasCell(app) && gapReason(app) === true, whyNot: (app) => noCell(app) ?? (typeof gapReason(app) === 'string' ? gapReason(app) : null), run: vacuumRun });
commands.register({ id: 'surface.center', title: 'Centre slab', category: 'Surface', aliases: ['Center slab', 'join slab across the cell edge'], edits: true,
  when: (app) => hasCell(app) && gapReason(app) === true, whyNot: (app) => noCell(app) ?? (typeof gapReason(app) === 'string' ? gapReason(app) : null), run: (app) => applyCenter(app) });
commands.register({ id: 'surface.flip', title: 'Flip slab', category: 'Surface', aliases: ['swap top and bottom'], edits: true,
  when: (app) => hasCell(app) && gapReason(app) === true, whyNot: (app) => noCell(app) ?? (typeof gapReason(app) === 'string' ? gapReason(app) : null), run: (app) => applyFlip(app) });
const hasSel = (app) => !!app?.structure && (app.selection?.length ?? 0) > 0;
commands.register({ id: 'sel.fix', title: 'Fix selected atoms', category: 'Edit', aliases: ['Fix fractional position', 'constrain atoms', 'selective dynamics'], edits: true,
  when: hasSel, whyNot: (app) => (app?.structure ? 'Select atoms first.' : null), run: (app) => applyFixSelection(app) });
commands.register({ id: 'sel.free', title: 'Free selected atoms', category: 'Edit', aliases: ['unfix atoms', 'remove constraints'], edits: true,
  when: hasSel, whyNot: (app) => (app?.structure ? 'Select atoms first.' : null), run: (app) => applyFree(app, [...app.selection]) });

const theApp = () => { const a = globalThis.facet?.app; if (!a?.structure) throw new Error('Load a structure first.'); return a; };
defineApi('edit.setVacuum', (vacuum, opts = {}) => applyVacuum(theApp(), vacuum, opts), { owner: 'M2', sig: '(vacuum, { position, offset, axis }) → sets the total vacuum gap (Å) of the active slab' });
defineApi('edit.centerSlab', () => applyCenter(theApp()), { owner: 'M2', sig: '() → moves the slab to the middle of its cell' });
defineApi('edit.flipSlab', () => applyFlip(theApp()), { owner: 'M2', sig: '() → turns the slab upside down (180° about a)' });
defineApi('edit.fixLayers', (n, opts = {}) => applyFix(theApp(), n, opts), { owner: 'M2', sig: "(n, { where: 'bottom' | 'top' | 'middle', axes: 'abc' }) → fixes n atomic layers" });
defineApi('edit.freeAtoms', (indices = null) => applyFree(theApp(), indices), { owner: 'M2', sig: '(indices?) → frees the given atoms, or all' });
defineApi('surface.layers', (opts = {}, s = theApp().structure) => slabLayers(s, opts), { owner: 'M2', sig: '({ tolerance }, s?) → { count, layer (per atom, from the bottom), heights, sizes }' });
defineApi('surface.extent', (s = theApp().structure) => slabExtent(s), { owner: 'M2', sig: '(s?) → { axis, bottom, top, thickness, gap, vacuum } along the surface normal' });
