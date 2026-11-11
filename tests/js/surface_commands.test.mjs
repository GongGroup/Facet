// The commands and API members of the cleave and slab modules (ui/panels/cleave.js, ui/panels/slab.js): what they
// register, what they refuse and what they do to an app. The geometry itself is covered by the shared cases
// (tests/data/surface/cleave, cases.test.mjs) and by tests/test_surface.py.
// Run: node --test tests/js/surface_commands.test.mjs (or through pytest: tests/test_js_unit.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commands, CommandError } from '../../facet/web/js/core/commands.js';
import { buildCrystal } from '../../facet/web/js/build/crystal.js';
import { loadOxidationStates, slabExtent } from '../../facet/web/js/build/surface.js';
import { constraintSummary } from '../../facet/web/js/core/constraints.js';
import { bootTasks } from '../../facet/web/js/core/boot.js';
import { cleaveAvailable, cleaveActive } from '../../facet/web/js/ui/panels/cleave.js';
import { applyVacuum, applyCenter, applyFlip, applyFix, applyFree, applyFixSelection } from '../../facet/web/js/ui/panels/slab.js';

await loadOxidationStates();

/** The part of the App the commands use: one active structure, edits applied in place, added structures collected. */
function fakeApp(structure) {
  const app = {
    structure, selection: [], busy: false, session: null, prefs: {}, added: [], toasts: [], edits: [],
    project: { activeStructure: 's1', structures: [] },
    addStructure(s, opts) { app.added.push([s, opts]); app.structure = s; return { entry: {}, historyEntry: { label: opts?.label } }; },
    toastUndo(message) { app.toasts.push(message); },
    editActive(label, fn, opts = {}) { fn(app.structure); app.edits.push([label, opts]); if (opts.toast) app.toasts.push(opts.toast); return { entry: { label }, value: undefined }; },
  };
  return app;
}
const pt = () => buildCrystal('fcc', { elements: ['Pt'], a: 3.92 });

test('the modules register the commands of the cleave flow in place of the fallbacks', () => {
  for (const id of ['surface.cleave', 'surface.vacuum', 'surface.setVacuum', 'surface.center', 'surface.flip', 'sel.fix', 'sel.free']) {
    const c = commands.get(id);
    assert.ok(c, id);
    assert.notEqual(c.fallback, true, `${id} is the real command`);
    assert.equal(c.edits, true);
  }
  assert.equal(commands.get('surface.cleave').ms, 'Build › Surfaces › Cleave Surface');
  assert.ok(commands.get('surface.cleave').aliases.includes('Cleave Surface'));
  assert.equal(commands.get('surface.vacuum').ms, 'Build › Crystals › Build Vacuum Slab');
  assert.ok(commands.get('surface.cleave').params.find((p) => p.name === 'vacuum').required, 'the vacuum has no default (U4)');
});

test('the oxidation states are a start-up task', async () => {
  const results = await bootTasks();
  assert.ok(results.some((r) => r.name === 'oxidation states' && r.state !== 'failed'));
});

test('Cleave surface with parameters adds the slab next to the bulk', () => {
  const app = fakeApp(pt());
  commands.setContext(app);
  commands.run('surface.cleave', { miller: [1, 1, 1], vacuum: 15, layers: 4, supercell: [[3, 0], [0, 3]], fixBottom: 2 });
  assert.equal(app.added.length, 1);
  const [slab, opts] = app.added[0];
  assert.equal(slab.name, 'Pt(111) p(3×3) 4L');
  assert.equal(slab.length, 36);
  assert.deepEqual(opts, { replaceProject: false, label: 'Cleave Pt(111) p(3×3) 4L' });
  assert.equal(constraintSummary(slab).fixed, 18);
  assert.deepEqual(app.toasts, ['Created Pt(111) p(3×3) 4L (36 atoms)']);
  // a named supercell and a termination label
  const app2 = fakeApp(buildCrystal('perovskite', { elements: ['Sr', 'Ti', 'O'], a: 3.905 }));
  commands.setContext(app2);
  commands.run('surface.cleave', { miller: [0, 0, 1], vacuum: 12, termination: 'SrO', wood: 'c(2×2)', periods: 2 });
  assert.equal(app2.added[0][0].name, 'SrTiO3(001) (√2×√2)R45° SrO/TiO2-term 4L');
});

test('Cleave surface refuses what the builder refuses, before anything is added', () => {
  const app = fakeApp(pt());
  commands.setContext(app);
  assert.throws(() => commands.run('surface.cleave', { miller: [1, 1, 1] }), (e) => e instanceof CommandError && e.message === 'Cleave surface: Vacuum: enter a value.');
  assert.throws(() => commands.run('surface.cleave', { miller: [0, 0, 0], vacuum: 15 }), /\(0 0 0\) is not a plane/);
  assert.throws(() => commands.run('surface.cleave', { miller: [1, 1, 1], vacuum: 2 }), /the vacuum \(2 Å\) is too small/);
  assert.throws(() => commands.run('surface.cleave', { miller: [1, 1, 1], vacuum: 15, termination: 'O' }), /unknown termination 'O' \(use Pt\)/);
  assert.equal(app.added.length, 0);
  // a molecule and a 2D sheet cannot be cleaved, and the section says why
  assert.equal(cleaveAvailable({ structure: null }), 'Load a structure first.');
  const sheet = buildCrystal('graphene', { elements: ['C'], a: 2.46, c: 15 });
  assert.match(cleaveAvailable({ structure: sheet }), /periodic along a, b and c; this one is periodic along a and b only\.$/);
  assert.throws(() => cleaveActive(fakeApp(sheet), { miller: [0, 0, 1], vacuum: 15 }), /periodic along a, b and c/);
  assert.equal(cleaveAvailable({ structure: pt() }), true);
});

test('the slab commands edit the active structure', () => {
  const app = fakeApp(pt());
  commands.setContext(app);
  commands.run('surface.cleave', { miller: [1, 1, 1], vacuum: 15, layers: 4, supercell: [[2, 0], [0, 2]] });
  const slab = app.structure;
  commands.run('surface.setVacuum', { vacuum: 20 });
  assert.ok(Math.abs(slabExtent(slab).gap - 20) < 1e-9);
  assert.deepEqual(app.edits.at(-1), ['Set vacuum to 20.0 Å', { latticeChanged: true, singleFrame: true, imageShift: app.edits.at(-1)[1].imageShift, toast: 'Vacuum set to 20.0 Å' }]);
  assert.throws(() => applyVacuum(app, 0), /a vacuum of 0 Å is only possible when cleaving/);
  assert.throws(() => commands.run('surface.vacuum', {}), /Vacuum: enter a value\./);
  applyFix(app, 2);
  assert.equal(constraintSummary(slab).fixed, 8);
  assert.equal(app.toasts.at(-1), 'Fixed 8 atoms (bottom 2 layers)');
  commands.run('surface.flip');
  assert.equal(slab.name, 'Pt(-1-1-1) p(2×2) 4L');
  commands.run('surface.center');
  assert.ok(Math.abs(slabExtent(slab).bottom - 10) < 1e-9);
  applyFree(app);
  assert.equal(constraintSummary(slab).present, false);
  app.selection = [0, 1, 2];
  commands.run('sel.fix');
  assert.equal(constraintSummary(slab).fixed, 3);
  app.selection = [0];
  commands.run('sel.free');
  assert.equal(constraintSummary(slab).fixed, 2);
  assert.equal(commands.available('sel.fix'), true);
  app.selection = [];
  assert.equal(commands.available('sel.fix'), false);
  assert.equal(commands.unavailableReason('sel.fix'), 'Select atoms first.');
  assert.throws(() => applyFixSelection(app), /Select atoms first\./);
  // a bulk crystal has no slab to flip or centre, and the command says what is missing
  const bulk = fakeApp(pt());
  commands.setContext(bulk);
  assert.equal(commands.available('surface.flip'), false);
  assert.match(commands.unavailableReason('surface.flip'), /vacuum/i);
  assert.equal(commands.available('surface.vacuum'), true, 'Build vacuum slab works on a bulk crystal');
  assert.throws(() => applyFlip(bulk), /flipping needs a slab/);
  applyCenter(app);
});
