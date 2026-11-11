/**
 * Surface panel › Cleave (M2 §5.2): cleave the active crystal along a lattice plane and add the slab to the project
 * as a new structure, next to its bulk (one undo step). The section shows the plane (Miller indices of the current
 * cell), the smallest surface cell, the inequivalent terminations (with broken bonds and polarity), the thickness,
 * the vacuum (required, never prefilled: user decision U4), a surface supercell and a summary of the slab that
 * Create would make. Also registers the command `surface.cleave` (Materials Studio: Build › Surfaces › Cleave
 * Surface) and the API members facet.surface.analyze / terminations / cleave and facet.build.surface.
 *
 * Not in this version: the 3D preview of the cut planes and of the slab, the layer-stack diagram, the Conventional
 * cell switch of the indices and a free 2×2 supercell matrix (the API and the command take all of them).
 */
import { h, btn, toggle, seg, field } from '../dom.js';
import { registerPanelSection, openSection } from '../sections.js';
import { commands, checkAtoms, confirmAtoms } from '../../core/commands.js';
import { registerBootTask } from '../../core/boot.js';
import { structureKey } from '../../core/analyses.js';
import { SURFACE_DEFAULTS } from '../../core/defaults.js';
import { formatIndices, cellParams } from '../../core/lattice.js';
import { surfaceNormal } from '../../core/vacuum.js';
import { buildSurface, surfaceAnalysis, loadOxidationStates, estimateSurfaceAtoms, terminations } from '../../build/surface.js';
import { millerInput, numberInput } from '../inputs.js';
import { toast } from '../overlays.js';
import { defineApi } from '../../api/namespaces.js';

// the formal charges of the termination list are loaded while the app starts (the analysis then runs synchronously)
registerBootTask('oxidation states', () => loadOxidationStates());

const TITLE = 'Cleave surface';
const NO_CELL = 'Cleave needs a crystal with a unit cell.';
/** The vacuum the user typed last in this session: offered again, never a default (U4). */
let lastVacuum = null;
/** Form state per project entry (the bulk it cleaves). */
const states = new Map();
/** Analyses by structure key and options (a change of the indices is the only thing that needs a new one). */
const cache = new Map();
let radioGroups = 0;

function defaultMiller(s) {
  const p = s?.cell ? cellParams(s.cell) : null;
  if (!p) return [0, 0, 1];
  const near = (x, y, tol) => Math.abs(x - y) <= tol;
  const cubic = near(p.a, p.b, 1e-3 * p.a) && near(p.b, p.c, 1e-3 * p.b) && [p.alpha, p.beta, p.gamma].every((x) => near(x, 90, 0.1));
  return cubic ? [1, 1, 1] : [0, 0, 1];
}

function stateOf(app) {
  const id = app.project?.activeStructure ?? '';
  if (!states.has(id)) {
    states.set(id, { miller: defaultMiller(app.structure), primitive: true, termination: 0, layers: SURFACE_DEFAULTS.layers, symmetric: false,
      fix: false, fixN: 2, position: 'center', na: 1, nb: 1, layerTolerance: null, anyway: false });
    while (states.size > 40) states.delete(states.keys().next().value);
  }
  return states.get(id);
}

/** Why the active structure cannot be cleaved (a sentence), or true. */
export function cleaveAvailable(app) {
  const s = app?.structure;
  if (!s) return 'Load a structure first.';
  if (!s.cell) return NO_CELL;
  if (!s.pbc.every(Boolean)) {
    const on = [0, 1, 2].filter((k) => s.pbc[k]).map((k) => 'abc'[k]);
    return `Cleave needs a crystal that is periodic along a, b and c; this one is ${on.length ? `periodic along ${on.join(' and ')} only` : 'not periodic'}.`;
  }
  return true;
}

function analysisOf(app, st) {
  const key = `${structureKey(app)}|${st.miller.join(',')}|${st.primitive}|${st.layerTolerance ?? ''}`;
  if (!cache.has(key)) {
    let entry;
    try { entry = { an: surfaceAnalysis(app.structure, { miller: st.miller, primitive: st.primitive, layerTolerance: st.layerTolerance }) }; }
    catch (e) { entry = { error: e?.message ?? String(e) }; }
    cache.set(key, entry);
    while (cache.size > 24) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

/** A message of the builders as a sentence for the panel. */
const sentence = (t) => { const s = String(t ?? '').trim(); return s ? `${s[0].toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}` : s; };
const fmt = (x, d = 2) => Number(x).toFixed(d);
const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;

/** The options buildSurface gets from the form (vacuum included when it is filled in). */
function buildOptions(st, an, vacuum) {
  return {
    miller: st.miller, analysis: an, termination: Math.min(st.termination, an.terminations.length - 1), layers: st.layers, symmetric: st.symmetric,
    position: st.position, supercell: st.na === 1 && st.nb === 1 ? null : [st.na, st.nb], fixBottom: st.fix ? Math.min(st.fixN, st.layers) : 0,
    primitive: st.primitive, layerTolerance: st.layerTolerance, vacuum,
  };
}

/** Add the slab to the project next to its bulk and say so (with Undo). */
function addSlab(app, slab) {
  const { historyEntry } = app.addStructure(slab, { replaceProject: false, label: `Cleave ${slab.name}` });
  app.toastUndo(`Created ${slab.name} (${plural(slab.length, 'atom')})`, { entry: historyEntry });
  return slab;
}

function render(app, el, shell, ctx) {
  const s = app.structure;
  const st = stateOf(app);
  // a structure that already has a vacuum gap is most likely a slab: say so before offering to cleave it again
  const sn = surfaceNormal(s);
  if (sn?.surface && !st.anyway) {
    const from = s.info?.surface?.kind === 'cleave' ? s.info.surface.bulk?.name : null;
    const bulk = from ? app.project.structures.find((e) => e.name === from && e.structure !== s && e.structure.cell && e.structure.pbc.every(Boolean)) : null;
    el.append(h('p.hint', from ? `This slab was cleaved from ${from}.` : 'This structure already has a vacuum gap, so it is probably a slab. Its vacuum, layers and constraints are in the Slab section below.'),
      h('div.sec-acts',
        bulk ? btn('Cleave the bulk again', { icon: 'surface', cls: 'small primary', tip: `Go back to ${bulk.name} and cleave another surface`, on: () => app.setActiveStructure(bulk.id) }) : null,
        btn('Cleave this structure', { cls: 'small', tip: 'Treat this structure as a bulk crystal and cleave it', on: () => { st.anyway = true; shell.refreshPanel?.('surface'); shell.renderDrawer(); } })));
    return;
  }
  const dyn = h('div.cleave-dyn', { style: { display: 'grid', gap: '10px' } });
  const summary = h('div.callout.cleave-summary', { role: 'status', 'aria-live': 'polite' });
  let vacuum = lastVacuum;
  let current = null;   // the analysis shown
  const create = btn('Create slab', { icon: 'surface', cls: 'primary', on: () => onCreate() });

  const plane = millerInput({
    label: 'Plane', cell: s.cell, value: st.miller, app, required: true, key: 'cleave:plane',
    describe: () => { const a = analysisOf(app, st); return a.an ? `d = ${fmt(a.an.period / a.an.m, 3)} Å between layers` : null; },
    onChange: (v) => { if (v) { st.miller = v; st.termination = 0; update(); } },
    onValidity: () => update(),
  });
  const layersIn = numberInput({ label: 'Layers', integer: true, min: 1, max: SURFACE_DEFAULTS.maxLayers, value: st.layers, required: true, key: 'cleave:layers',
    onChange: (v) => { if (v != null) { st.layers = v; update(); } }, onValidity: () => update() });
  const vacuumIn = numberInput({ label: 'Vacuum', unit: 'Å', min: 0, max: SURFACE_DEFAULTS.maxVacuum, value: vacuum, required: true, key: 'cleave:vacuum',
    onChange: (v) => { vacuum = v; if (v != null) lastVacuum = v; update(); }, onValidity: (ok) => { if (!ok) vacuum = null; update(); } });
  const fixIn = numberInput({ label: 'Fixed layers', integer: true, min: 1, max: SURFACE_DEFAULTS.maxLayers, value: st.fixN, key: 'cleave:fixN',
    onChange: (v) => { if (v != null) { st.fixN = v; update(); } } });
  const fixRow = h('div.cleave-fix', { hidden: !st.fix }, field('Fixed layers', fixIn.el, 'Counted from the bottom; fixed atoms get selective dynamics F F F'));
  const rep = (key, label) => {
    const c = numberInput({ label, integer: true, min: 1, max: SURFACE_DEFAULTS.supercellMaxEntry, value: st[key], key: `cleave:${key}`,
      onChange: (v) => { if (v != null) { st[key] = v; update(); } } });
    return c.el;
  };
  const tolIn = numberInput({ label: 'Layer tolerance', unit: 'Å', min: 0.01, max: 2, value: st.layerTolerance, optional: true, placeholder: 'auto', key: 'cleave:tol',
    onChange: (v) => { st.layerTolerance = v; st.termination = 0; update(); } });
  const tolReadout = h('p.hint');

  const bulkLine = h('p.hint', h('b', 'Bulk: '), `${s.name || s.formula({ reduce: true })} · ${plural(s.length, 'atom')}${s.info?.spacegroup ? ` · ${s.info.spacegroup}` : ''}`);
  el.append(
    bulkLine,
    field('Plane', plane.el, 'Miller indices (h k l) of the current cell; a hexagonal cell takes (h k i l)'),
    toggle({ label: 'Minimal surface cell', sub: 'Reduce a conventional cell to its primitive cell first', checked: st.primitive, key: 'cleave:primitive',
      tip: 'Gives the smallest surface cell and the shortest stacking period. Turn off to keep the mesh of the input cell (as ASE does).',
      onChange: (v) => { st.primitive = v; st.termination = 0; update(); } }),
    dyn,
    field('Layers', layersIn.el, 'Number of atomic layers of the slab'),
    toggle({ label: 'Symmetric slab', sub: 'Same termination on top and bottom', checked: st.symmetric, key: 'cleave:symmetric',
      tip: 'Adds layers until the bottom face matches the top face. This can make the slab non-stoichiometric.', onChange: (v) => { st.symmetric = v; update(); } }),
    toggle({ label: 'Fix bottom layers', sub: 'Selective dynamics F F F for the lowest layers', checked: st.fix, key: 'cleave:fix',
      onChange: (v) => { st.fix = v; fixRow.hidden = !v; update(); } }),
    fixRow,
    field('Vacuum', vacuumIn.el, 'Total gap between the slab and its periodic image, in Å; 0 for none (the slab then repeats as in the bulk)'),
    h('p.hint.cleave-vac-hint', 'Total gap along the normal, not per side. 10–20 Å is usual for DFT.'),
    field('Position', seg([{ value: 'center', label: 'Centre' }, { value: 'bottom', label: 'Bottom' }], st.position, (v) => { st.position = v; update(); }, { label: 'Slab position', key: 'cleave:position' }),
      'Centre puts the slab in the middle of the cell; Bottom puts its lowest atoms at the bottom face'),
    h('div.ctl.wide', h('label', { 'data-tip': 'Repeat the surface cell along a and b' }, 'Supercell'), h('div.cleave-rep', rep('na', 'Supercell a'), h('span', { 'aria-hidden': 'true' }, '×'), rep('nb', 'Supercell b'))),
    summary,
    h('div.row', create),
    h('details.cleave-adv', h('summary', 'Advanced'), h('div', { style: { display: 'grid', gap: '8px', paddingTop: '8px' } },
      field('Layer tolerance', tolIn.el, 'Atoms closer than this along the normal share a layer; empty = automatic'), tolReadout)),
  );

  function terminationList(an) {
    const terms = an.terminations;
    const tasker = an.tasker === 1 ? 'Tasker type 1 surface: every layer is neutral.'
      : an.tasker === 2 ? 'Tasker type 2 surface: charged layers, with a cut that has no dipole.'
        : an.tasker === 3 ? 'Tasker type 3 surface: every cut leaves a dipole (polar).' : 'Formal charges are unknown for this compound.';
    const name = `cleave-term-${++radioGroups}`;
    const chosen = Math.min(st.termination, terms.length - 1);
    const items = terms.map((t) => {
      const input = h('input', { type: 'radio', name, value: String(t.index), checked: t.index === chosen, 'data-key': `cleave:term:${t.index}` });
      input.addEventListener('change', () => { if (input.checked) { st.termination = t.index; update(); } });
      const tag = t.polar === null ? 'Charge unknown' : t.polar ? 'Polar' : 'Non-polar';
      return h('label.cleave-term', input, h('b', t.label), h('span.meta', `${plural(t.brokenBonds, 'bond')}/cell`),
        h(`span.tag${t.polar ? '.warn' : ''}`, tag));
    });
    return h('div', { style: { display: 'grid', gap: '6px' } },
      h('div.sub-h', terms.length > 1 ? `Termination (${terms.length})` : 'Termination'),
      h('div.cleave-terms', { role: 'radiogroup', 'aria-label': 'Termination' }, items),
      an.chargesSource === 'metal' || an.chargesSource === 'element' ? null : h('p.hint', tasker));
  }

  function update() {
    create.disabled = true;
    const bad = plane.validate?.() ?? null;
    const a = plane.valid === false || bad ? { error: bad ?? 'Enter the plane.' } : analysisOf(app, st);
    current = a.an ?? null;
    if (!a.an) {
      dyn.replaceChildren(h('p.err-text', { role: 'alert' }, sentence(a.error)));
      summary.replaceChildren(h('span.hint', 'Enter a plane to see the slab.'));
      create.dataset.tip = 'Enter a valid plane first.';
      return;
    }
    const an = a.an;
    const mesh = an.mesh;
    dyn.replaceChildren(
      h('p.hint.cleave-info', h('b', 'Surface cell '), `${fmt(mesh.a, 3)} × ${fmt(mesh.b, 3)} Å, γ = ${fmt(mesh.gamma, 1)}° · ${fmt(mesh.area)} Å² (${mesh.type})`,
        h('br'), h('b', 'Stacking '), `${plural(an.m, 'layer')} per period of ${fmt(an.period, 3)} Å (${an.layers.map((L) => L.formula).join(' | ')})`),
      ...an.notes.filter((n) => !/^the \d+-atom input cell was reduced/.test(n)).map((n) => h('p.hint', sentence(n))),
      ...an.warnings.map((w) => h('p.hint.field-warn', sentence(w))),
      terminationList(an),
    );
    tolReadout.textContent = st.layerTolerance == null
      ? `Automatic: ${fmt(an.layerTolerance, 3)} Å${an.layerGrouping === 'merged' ? ' (rumpled layers merged)' : ''}`
      : `Layers are split where atoms are more than ${fmt(st.layerTolerance, 3)} Å apart along the normal.`;
    // the slab Create would make; without a vacuum the summary is built with a stand-in that only fills the name and sizes
    const layersBad = layersIn.validate?.() ?? null;
    if (layersBad) { summary.replaceChildren(h('span.err-text', layersBad)); create.dataset.tip = layersBad; return; }
    let slab = null, error = null;
    try {
      const n = estimateSurfaceAtoms(an, { layers: st.layers, supercell: [st.na, st.nb] });
      checkAtoms(n, { title: TITLE, app });
      slab = buildSurface(app.structure, buildOptions(st, an, vacuum ?? 30));
    } catch (e) { error = e?.message ?? String(e); }
    if (!slab) {
      summary.replaceChildren(h('span.err-text', { role: 'alert' }, sentence(error)));
      create.dataset.tip = sentence(error);
      return;
    }
    const rec = slab.info.surface;
    const cp = cellParams(slab.cell);
    const lines = [
      h('b', `${slab.name} — ${plural(slab.length, 'atom')}`),
      h('span', vacuum == null ? `${fmt(rec.thickness)} Å thick · vacuum not set`
        : vacuum === 0 ? `${fmt(rec.thickness)} Å thick · no vacuum (bulk stacking) · cell ${fmt(cp.a)} × ${fmt(cp.b)} × ${fmt(cp.c)} Å`
          : `${fmt(rec.thickness)} Å thick + ${fmt(vacuum, 1)} Å vacuum · cell ${fmt(cp.a)} × ${fmt(cp.b)} × ${fmt(cp.c)} Å, γ = ${fmt(cp.gamma, 1)}°`),
      h('span', [rec.asBuilt.stoichiometric ? 'Stoichiometric' : `Not stoichiometric (excess ${rec.asBuilt.excess})`,
        rec.asBuilt.polarity.polar === null ? 'charges unknown' : rec.asBuilt.polarity.polar ? 'polar' : 'non-polar',
        rec.layers !== st.layers ? `${rec.layers} layers (made symmetric)` : null].filter(Boolean).join(' · ')),
      ...(slab.info.warnings ?? []).filter((w) => vacuum != null || !/^the vacuum /.test(w)).map((w) => h('span.field-warn', sentence(w))),
      vacuum != null && vacuum > 0 && vacuum < SURFACE_DEFAULTS.dftVacuumHint ? h('span.hint', 'Most DFT slab studies use 10–20 Å of vacuum.') : null,
    ];
    summary.replaceChildren(...lines.filter(Boolean));
    if (vacuum == null) { create.dataset.tip = 'Enter the vacuum (total gap in Å; 0 for none).'; return; }
    create.disabled = false;
    create.dataset.tip = `Add ${slab.name} to the project as a new structure`;
  }

  async function onCreate() {
    if (!current || vacuum == null) { vacuumIn.validate(); vacuumIn.focus(); return; }
    try {
      const slab = buildSurface(app.structure, buildOptions(st, current, vacuum));
      checkAtoms(slab.length, { title: TITLE, app });
      if (!(await confirmAtoms(slab.length, { title: TITLE }))) return;
      addSlab(app, slab);
    } catch (e) { toast(sentence(e?.message ?? e), { type: 'error' }); }
  }

  update();
  if (ctx?.focus === 'plane') requestAnimationFrame(() => plane.focus?.());
}

registerPanelSection('surface', {
  id: 'cleave', title: 'Cleave', order: 10, defaultOpen: true,
  available: cleaveAvailable,
  refreshOn: ['project', 'structure'],
  signature: (app) => `${app.project?.activeStructure ?? ''}|${app.structure ? structureKey(app) : ''}`,
  badge: (app) => { const st = states.get(app.project?.activeStructure ?? ''); return st && cleaveAvailable(app) === true ? formatIndices(st.miller) : ''; },
  render,
});

// ------------------------------------------------------------------------------------------- command and API
const VACUUM = { name: 'vacuum', type: 'float', label: 'Vacuum', unit: 'Å', min: 0, max: 1000, required: true,
  description: 'Total gap between the slab and its periodic image (Å); 0 for none.' };
const PARAMS = [
  { name: 'miller', type: 'miller', label: 'Plane', required: true },
  { name: 'layers', type: 'int', label: 'Layers', min: 1, max: 1000 },
  { name: 'periods', type: 'int', label: 'Periods', min: 1, max: 1000 },
  { name: 'thickness', type: 'float', label: 'Thickness', unit: 'Å', min: 0, max: 500 },
  VACUUM,
  { name: 'termination', type: 'string', label: 'Termination' },
  { name: 'symmetric', type: 'bool', label: 'Symmetric slab' },
  { name: 'position', type: 'select', label: 'Position', options: ['center', 'bottom'] },
  { name: 'offset', type: 'float', label: 'Offset', unit: 'Å', min: 0, max: 1000 },
  { name: 'supercell', type: 'imatrix', size: 2, label: 'Surface supercell' },
  { name: 'wood', type: 'string', label: 'Surface supercell (name)' },
  { name: 'primitive', type: 'bool', label: 'Minimal surface cell' },
  { name: 'millerBasis', type: 'select', label: 'Indices', options: ['input', 'conventional'] },
  { name: 'fixBottom', type: 'int', label: 'Fixed bottom layers', min: 0, max: 1000 },
  { name: 'fixMiddle', type: 'int', label: 'Fixed middle layers', min: 0, max: 1000 },
  { name: 'fixAxes', type: 'string', label: 'Fixed directions' },
  { name: 'layerTolerance', type: 'float', label: 'Layer tolerance', unit: 'Å', min: 0.01, max: 2 },
  { name: 'name', type: 'string', label: 'Name' },
];

/** The options of buildSurface from a command's parameter values (null and absent values are left to the defaults). */
function optionsOf(values) {
  const o = {};
  for (const [k, v] of Object.entries(values ?? {})) if (v != null && v !== '') o[k] = v;
  if (o.wood != null) { if (o.supercell == null) o.supercell = o.wood; delete o.wood; }
  if (typeof o.termination === 'string' && /^\d+$/.test(o.termination)) o.termination = Number(o.termination);
  if (o.primitive == null) delete o.primitive;
  return o;
}

/** Cleave the active structure with `options` (buildSurface's) and add the slab to the project; returns the slab. */
export function cleaveActive(app, options) {
  const ok = cleaveAvailable(app);
  if (ok !== true) throw new Error(ok);
  const slab = buildSurface(app.structure, options);
  checkAtoms(slab.length, { title: TITLE, app });
  return addSlab(app, slab);
}

commands.register({
  id: 'surface.cleave', title: 'Cleave surface…', category: 'Surface',
  aliases: ['Cleave Surface', 'slab from bulk', 'miller plane', 'termination'], ms: 'Build › Surfaces › Cleave Surface',
  edits: true, params: PARAMS,
  when: (app) => !!app?.structure?.cell,
  whyNot: (app) => (app?.structure && !app.structure.cell ? NO_CELL : null),
  run(app, values) {
    if (values === undefined) return openSection('surface', 'cleave', { focus: 'cleave:plane' });
    return cleaveActive(app, optionsOf(values));
  },
});

const active = () => { const s = globalThis.facet?.structure; if (!s) throw new Error('Load a structure first.'); return s; };
const app = () => globalThis.facet?.app;
defineApi('surface.analyze', (opts = {}, s = active()) => surfaceAnalysis(s, opts).toJSON(),
  { owner: 'M2', sig: '({ miller, primitive, layerTolerance, charges }, s?) → the surface cell, layers, cuts and terminations of a plane' });
defineApi('surface.terminations', (opts = {}, s = active()) => terminations(s, opts),
  { owner: 'M2', sig: '({ miller, … }, s?) → the inequivalent terminations, best first' });
defineApi('surface.cleave', (opts = {}) => cleaveActive(app(), opts),
  { owner: 'M2', sig: '({ miller, vacuum, layers, termination, supercell, fixBottom, … }) → cleaves the active structure and adds the slab to the project' });
defineApi('build.surface', (s, opts = {}) => buildSurface(s, opts),
  { owner: 'M2', sig: '(bulk, { miller, vacuum, layers, termination, supercell, fixBottom, … }) → the slab as a new Structure (nothing is shown)' });
