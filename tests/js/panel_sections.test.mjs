// Panel sections and the Surface panel (crystallume/web/js/ui/sections.js, ui/panels/surface.js; F0-A §3.17, §5.2, §5.3,
// ledger L-F0-49). The drawing itself needs a browser; these tests cover the registry, the reasons and the refresh rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const web = (rel) => new URL(`../../crystallume/web/js/${rel}`, import.meta.url);
const S = await import(web('ui/sections.js'));
const { SURFACE_SECTIONS, surfaceSignature } = await import(web('ui/panels/surface.js'));
const { leftPanels, Shell } = await import(web('ui/shell.js'));
const { registerBootTask, bootTasks } = await import(web('core/boot.js'));

const cell = [[3.92, 0, 0], [0, 3.92, 0], [0, 0, 3.92]];
const crystal = (over = {}) => ({ name: 'Pt', symbols: ['Pt'], positions: new Float64Array([0, 0, 0]), cell, pbc: [true, true, true], nFrames: 1, frame: 0, length: 1, info: {}, ...over });
const makeApp = (structure = crystal(), prefs = {}) => ({ structure, prefs, project: { activeStructure: 's1' }, setPref(k, v) { this.prefs[k] = v; } });
const render = () => {};
const keys = (list) => list.map((s) => s.key);
const quiet = (fn) => { const orig = console.warn, logged = []; console.warn = (...a) => logged.push(a); try { fn(); } finally { console.warn = orig; } return logged; };

test('the Surface panel is the fifth rail panel and always has Cleave, Slab, Layers, Adsorbates and Interface', () => {
  const p = leftPanels.get('surface');
  assert.ok(p, 'registered');
  assert.deepEqual([p.title, p.short, p.icon, p.tip], ['Surface', 'Surface', 'surface', 'Cleave surfaces, set the vacuum, fix layers and place adsorbates']);
  assert.deepEqual(p.refreshOn, ['project', 'structure']);
  assert.equal(p.signature, surfaceSignature);
  assert.deepEqual(SURFACE_SECTIONS.map((s) => [s.id, s.title, s.order, s.defaultOpen]), [
    ['cleave', 'Cleave', 10, true], ['slab', 'Slab', 20, true], ['layers', 'Layers', 30, false], ['adsorbates', 'Adsorbates', 40, false], ['interface', 'Interface', 50, false],
  ]);
  const shown = S.panelSections('surface');
  assert.deepEqual(keys(shown), ['surface.cleave', 'surface.slab', 'surface.layers', 'surface.adsorbates', 'surface.interface']);
  assert.ok(shown.every((s) => s.placeholder && s.slot === 'main'));
  const app = makeApp();
  // placeholders until a module registers them; the same for every structure (U1), with no badge
  for (const s of shown) {
    assert.deepEqual(S.sectionAvailability(s, app), { reason: 'Not available in this build yet.' });
    assert.equal(S.sectionBadge(s, app), '');
  }
  assert.deepEqual(S.panelSections('surface').map((s) => S.sectionOpen(app, s)), [true, true, false, false, false]);
});

test('registerPanelSection checks the section', () => {
  const bad = [
    [['', { id: 'x', title: 'X', render }], TypeError, "registerPanelSection: expected a panel id ('surface' or 'structure')"],
    [['surface', null], TypeError, 'registerPanelSection: expected a section object'],
    [['surface', { title: 'X', render }], TypeError, 'registerPanelSection: missing id'],
    [['surface', { id: 'x', render }], TypeError, 'registerPanelSection: “surface.x” needs a title'],
    [['surface', { id: 'x', title: 'X' }], TypeError, 'registerPanelSection: “surface.x” needs render(app, el, shell, ctx)'],
    [['surface', { id: 'x', title: 'X', render, available: 'always' }], TypeError, 'registerPanelSection: “surface.x”: available must be a function of the app'],
    [['surface', { id: 'x', title: 'X', render, order: '10' }], TypeError, 'registerPanelSection: “surface.x”: order must be a number'],
    [['surface', { id: 'x', title: 'X', render, refreshOn: 'selection' }], TypeError, 'registerPanelSection: “surface.x”: refreshOn must be a list of event names'],
    [['structure', { id: 'x', title: 'X', render }], Error, 'registerPanelSection: the structure panel has no slot “main” (use cell or transform)'],
    [['surface', { id: 'x', title: 'X', render, slot: 'cell' }], Error, 'registerPanelSection: the surface panel has no slot “cell” (use main)'],
  ];
  for (const [args, name, message] of bad) assert.throws(() => S.registerPanelSection(...args), { name: name.name, message });
});

test('a registered section takes its placeholder’s place; order, slot and defaultOpen fall back to the reservation', () => {
  const offs = [
    S.registerPanelSection('surface', { id: 'layers', title: 'Layers', render }),                                   // no order: the reserved 30
    S.registerPanelSection('surface', { id: 'cleave', title: 'Cleave', order: 10, defaultOpen: false, render }),   // its own defaultOpen wins
    S.registerPanelSection('surface', { id: 'plugin', title: 'Plugin tools', order: 45, render }),
    S.registerPanelSection('structure', { id: 'constraints', title: 'Constraints', slot: 'transform', order: 20, render }),
    S.registerPanelSection('structure', { id: 'transform', title: 'Transform', slot: 'transform', order: 10, render }),
    S.registerPanelSection('structure', { id: 'cell', title: 'Cell', slot: 'cell', order: 10, render }),
  ];
  try {
    const app = makeApp();
    const surface = S.panelSections('surface');
    assert.deepEqual(keys(surface), ['surface.cleave', 'surface.slab', 'surface.layers', 'surface.adsorbates', 'surface.plugin', 'surface.interface']);
    assert.deepEqual(surface.map((s) => s.placeholder), [false, true, false, true, false, true]);
    assert.deepEqual(surface.map((s) => s.order), [10, 20, 30, 40, 45, 50]);
    assert.deepEqual(surface.map((s) => S.sectionOpen(app, s)), [false, true, false, false, true, false]);
    assert.deepEqual(surface[0].refreshOn, ['project', 'structure'], 'default refreshOn');
    assert.deepEqual(keys(S.panelSections('structure', { slot: 'cell' })), ['structure.cell']);
    assert.deepEqual(keys(S.panelSections('structure', { slot: 'transform' })), ['structure.transform', 'structure.constraints']);
    assert.deepEqual(keys(S.panelSections('structure')), ['structure.cell', 'structure.transform', 'structure.constraints']);
    assert.deepEqual(S.panelSections('structure', { slot: 'main' }), []);
  } finally { offs.forEach((off) => off()); }
  assert.ok(S.panelSections('surface').every((s) => s.placeholder));
  assert.deepEqual(S.panelSections('structure'), []);
});

test('a section with the id of another replaces it until it is removed', () => {
  const a = S.registerPanelSection('surface', { id: 'slab', title: 'Slab', order: 20, badge: () => 'A', render });
  let b;
  const warned = quiet(() => { b = S.registerPanelSection('surface', { id: 'slab', title: 'Slab', order: 20, badge: () => 'B', render }); });
  assert.match(String(warned[0]?.[0]), /“surface\.slab” already exists and is replaced/);
  assert.equal(quiet(() => S.registerPanelSection('surface', { id: 'slab', title: 'Slab', render }, { replace: true })()).length, 0);
  const badge = () => S.sectionBadge(S.panelSections('surface').find((s) => s.id === 'slab'), makeApp());
  assert.equal(badge(), 'B');
  b();
  b();
  assert.equal(badge(), 'A');
  a();
  assert.equal(S.panelSections('surface').find((s) => s.id === 'slab').placeholder, true);
});

test('availability, signature and badge of a section', () => {
  const app = makeApp();
  const sec = (src) => ({ key: 'surface.t', src, placeholder: false });
  assert.deepEqual(S.sectionAvailability(sec({ render }), app), { ok: true });
  assert.deepEqual(S.sectionAvailability(sec({ render, available: () => true }), app), { ok: true });
  assert.deepEqual(S.sectionAvailability(sec({ render, available: () => undefined }), app), { ok: true });
  assert.deepEqual(S.sectionAvailability(sec({ render, available: () => 'Load a structure first.' }), app), { reason: 'Load a structure first.' });
  assert.deepEqual(S.sectionAvailability(sec({ render, available: () => false }), app), { reason: 'Not available right now.' });
  const err = S.sectionAvailability(sec({ render, available: () => { throw new Error('boom'); } }), app);
  assert.equal(err.error.message, 'boom');
  assert.equal(S.sectionSignature(sec({ signature: (a) => `${a.structure.length}` }), app), '1');
  const none = sec({});
  assert.notEqual(S.sectionSignature(none, app), S.sectionSignature(none, app), 'no signature: always redrawn on its events');
  const throws = sec({ signature: () => { throw new Error('x'); } });
  assert.notEqual(S.sectionSignature(throws, app), S.sectionSignature(throws, app));
  assert.equal(S.sectionBadge(sec({ badge: () => '(1 1 1)' }), app), '(1 1 1)');
  assert.equal(S.sectionBadge(sec({ badge: () => null }), app), '');
  assert.equal(S.sectionBadge(sec({ badge: () => { throw new Error('x'); } }), app), '');
});

test('the open state comes from the sections preference, else defaultOpen', () => {
  const sec = { key: 'surface.layers', defaultOpen: false };
  assert.equal(S.sectionOpen(makeApp(crystal(), {}), sec), false);
  assert.equal(S.sectionOpen(makeApp(crystal(), { sections: { 'surface.layers': true } }), sec), true);
  assert.equal(S.sectionOpen(makeApp(crystal(), { sections: { 'surface.cleave': false } }), { key: 'surface.cleave', defaultOpen: true }), false);
  assert.equal(S.sectionOpen(null, { key: 'x', defaultOpen: null }), true);
});

test('requireCell', () => {
  assert.equal(S.requireCell(makeApp(null)), 'Load a structure first.');
  assert.equal(S.requireCell(makeApp(crystal({ cell: null, pbc: [false, false, false] }))), 'This structure has no unit cell. Surface tools work on crystals and slabs with a unit cell.');
  assert.equal(S.requireCell(makeApp()), true);
});

test('requireVacuumGap says what vacuumGapHint says, as a sentence', () => {
  const vac = (surface, hint) => ({ surfaceNormal: () => ({ surface, axis: 2 }), vacuumGapHint: () => hint });
  const app = makeApp();
  assert.equal(S.requireVacuumGap(app, vac(true, null)), true);
  assert.equal(S.requireVacuumGap(app, vac(false, 'no vacuum gap of 5 Å or more along a cell vector (the widest is 4.4 Å along c); add vacuum first')),
    'No vacuum gap of 5 Å or more along a cell vector (the widest is 4.4 Å along c); add vacuum first.');
  assert.equal(S.requireVacuumGap(app, vac(false, 'vacuum gaps along b and c: surface tools need a vacuum gap along one cell vector only')),
    'Vacuum gaps along b and c: surface tools need a vacuum gap along one cell vector only.');
  assert.equal(S.requireVacuumGap(app, { surfaceNormal: () => null, vacuumGapHint: () => 'the structure has no unit cell, so it has no vacuum gap' }),
    'The structure has no unit cell, so it has no vacuum gap.');
  assert.equal(S.requireVacuumGap(app, vac(false, null)), 'No vacuum gap found.');
  assert.equal(S.requireVacuumGap(makeApp(null), vac(true, null)), 'Load a structure first.');
  assert.equal(S.requireVacuumGap(app, null), true, 'without the vacuum module it cannot tell, so it does not block');
  // no slab/bulk wording anywhere (U1)
  assert.doesNotMatch(S.requireVacuumGap(app, vac(false, 'vacuum gaps along b and c: surface tools need a vacuum gap along one cell vector only')), /\b(slab|bulk)\b/i);
});

test('requireNoPreview blocks while another module previews', () => {
  const app = makeApp();
  assert.equal(S.requireNoPreview(app), true);
  app.session = { active: true, owner: 'cleave', kind: 'structure' };
  assert.equal(S.requireNoPreview(app), 'Apply or cancel the current preview first.');
  assert.equal(S.requireNoPreview(app, { owner: 'slab' }), 'Apply or cancel the current preview first.');
  assert.equal(S.requireNoPreview(app, { owner: 'cleave' }), true);
  app.session.active = false;
  assert.equal(S.requireNoPreview(app), true);
});

test('requireBootTask names the section whose data failed to load', async () => {
  registerBootTask('test data ok', async () => {});
  registerBootTask('test data broken', async () => { throw new Error('404'); });
  const orig = console.error;
  console.error = () => {};
  try { await bootTasks({ timeout: 1000 }); } finally { console.error = orig; }
  assert.equal(S.requireBootTask('test data ok', 'Cleave'), true);
  assert.equal(S.requireBootTask('test data broken', 'Cleave'), 'Cleave needs data that failed to load; reload the page.');
  assert.equal(S.requireBootTask('test data broken'), 'This section needs data that failed to load; reload the page.');
  assert.equal(S.requireBootTask('unknown', 'Cleave'), true);
});

test('the Surface panel is drawn again as a whole for a structure edit or a change of availability, not for a selection', () => {
  let ok = true;
  const off = S.registerPanelSection('surface', { id: 'cleave', title: 'Cleave', order: 10, available: () => (ok ? true : 'Not now.'), render });
  try {
    const app = makeApp();
    const sig0 = surfaceSignature(app);
    app.selection = [0];
    assert.equal(surfaceSignature(app), sig0, 'the selection is not part of it');
    ok = false;
    const sig1 = surfaceSignature(app);
    assert.notEqual(sig1, sig0);
    app.structure.positions[0] = 0.5;   // an edit in place
    assert.notEqual(surfaceSignature(app), sig1);
    assert.notEqual(surfaceSignature(makeApp(null)), sig0);
  } finally { off(); }
});

test('panelState: sections refresh one by one unless the shell redraws the panel', () => {
  const app = makeApp();
  const shell = { leftOpen: true, leftId: 'surface', _drawerPanel: 'surface', drawerBody: { isConnected: true }, _drawerStale: false, _drawerPending: false, _drawerSig: surfaceSignature(app), app };
  const state = (reasons, over = {}) => Shell.prototype.panelState.call({ ...shell, ...over }, 'surface', reasons);
  assert.equal(state(['selection']), 'current');
  assert.equal(state(['structure']), 'current', 'same signature: the shell keeps the panel');
  assert.equal(state([]), 'current');
  assert.equal(state(['structure'], { _drawerSig: 'old' }), 'rebuild');
  assert.equal(state(['selection', 'project'], { _drawerSig: 'old' }), 'rebuild');
  assert.equal(state(['selection'], { _drawerSig: 'old' }), 'current', 'an event the panel does not follow');
  assert.equal(state(['selection'], { _drawerPending: true }), 'rebuild');
  assert.equal(state(['selection'], { leftOpen: false }), 'hidden');
  assert.equal(state(['selection'], { leftId: 'library' }), 'hidden');
  assert.equal(state(['selection'], { drawerBody: { isConnected: false } }), 'hidden');
  assert.equal(Shell.prototype.panelState.call(shell, 'nonexistent', []), 'hidden');
});

test('openSection needs the shell', () => {
  assert.equal(S.openSection('surface', 'cleave'), false);
});
