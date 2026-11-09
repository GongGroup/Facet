// Measurement references v2 (F0-A §3.9, ledger L-F0-44): core/measure.js, the viewer's Float64 values and its
// exact / floating / hidden drawing, the migration of the keys of older projects, the remapping after edits and the
// session-stable ids in the app (E-46, E-53).
// Run: node --test tests/js/measure.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../crystallume/web/vendor/three/three.module.js';
import { Structure } from '../../crystallume/web/js/core/structure.js';
import { parseStructure } from '../../crystallume/web/js/io/index.js';
import { makeScene } from '../../crystallume/web/js/render/settings.js';
import { buildDisplayModel, keyOf, storedImage } from '../../crystallume/web/js/render/display.js';
import { Viewer } from '../../crystallume/web/js/render/viewer.js';
import { App } from '../../crystallume/web/js/app.js';
import {
  parseRef, formatRef, normalizeRefs, measurementPoints, migrateMeasurementKeys, cleanMeasurementList,
  remapMeasurementList, measurementsRemovedNote, newMeasurementId, wholeCellShifts,
} from '../../crystallume/web/js/core/measure.js';
import { fake2d } from './fake2d.mjs';
import { repoPath } from './helpers.mjs';

const DISPLAY = makeScene().display;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const dist = (P, i = 0, j = 1) => Math.hypot(P[3 * j] - P[3 * i], P[3 * j + 1] - P[3 * i + 1], P[3 * j + 2] - P[3 * i + 2]);
const contcar = () => parseStructure(readFileSync(repoPath('tests/data/surface/contcar_pt111.vasp'), 'utf8'), 'CONTCAR');

/** A viewer without a renderer: the measurement and model code with stubs for lights, floor and theme. */
function bareViewer(s, display = DISPLAY) {
  const v = Object.create(Viewer.prototype);
  v._h = new Map();
  Object.assign(v, { root: new THREE.Group(), selection: new Set(), measurements: [], settings: makeScene({ display }), structure: s, _dirty: false, lights: { setBounds() {} } });
  v._updateFloor = () => {};
  v._cssTheme = () => ({ accent: '#e8a33d', accentStrong: '#c27c12', font: 'sans-serif' });
  v.applySettings = function applySettings(settings) { this.settings = settings; this._buildModel(); this._buildMeasurements(); };
  v.resetView = () => {};
  v._buildModel();
  return v;
}

/** What drawOverlay needs besides the model: a 400 × 300 canvas, no cell letters, stub overlay layers. */
function overlayReady(v) {
  Object.assign(v, { width: 400, height: 300, overlays: { drawCanvas() {}, legendItems: () => [] }, _occupancy: () => null });
  v.settings.display.cell = { ...v.settings.display.cell, show: false };
}

describe('references', () => {
  test('parseRef and formatRef', () => {
    assert.deepEqual(parseRef('12:0,-1,3'), { atom: 12, image: [0, -1, 3] });
    assert.deepEqual(parseRef('0:-0,0,0'), { atom: 0, image: [0, 0, 0] });
    assert.ok(Object.is(parseRef('0:-0,0,0').image[0], 0), 'no negative zero');
    for (const bad of ['', '1', '1:0,0', '1:0,0,0,0', '-1:0,0,0', '1:0.5,0,0', 'a:0,0,0', ' 1:0,0,0', null, 3, ['1:0,0,0']]) assert.equal(parseRef(bad), null, String(bad));
    assert.equal(formatRef(3, [1, -2, 0]), '3:1,-2,0');
    assert.equal(formatRef(0, [-0, 0, 0]), '0:0,0,0');
    assert.throws(() => formatRef(-1, [0, 0, 0]), TypeError);
    assert.throws(() => formatRef(1.5, [0, 0, 0]), TypeError);
    assert.throws(() => formatRef(1, [0, 0.5, 0]), TypeError);
    assert.throws(() => formatRef(1, [0, 0]), TypeError);
  });

  test('normalizeRefs puts the first reference at image 0,0,0', () => {
    assert.deepEqual(normalizeRefs(['4:1,0,-1', '7:1,1,-1', '2:0,0,0']), ['4:0,0,0', '7:0,1,0', '2:-1,0,1']);
    assert.deepEqual(normalizeRefs(['4:0,0,0']), ['4:0,0,0']);
    assert.equal(normalizeRefs(['4:0,0,0', 'x']), null);
    assert.equal(normalizeRefs([]), null);
  });

  test('measurementPoints: stored positions plus whole cells, Float64; null when a reference cannot be placed', () => {
    const s = new Structure({ symbols: ['O', 'H'], positions: [[0.1, 0.2, 0.3], [1.123456789012, 2, 3]], cell: [[10, 0, 0], [0, 10, 0], [1, 0, 20]], pbc: [true, true, true] });
    const P = measurementPoints(s, ['0:0,0,0', '1:-1,0,1']);
    assert.ok(P instanceof Float64Array);
    assert.deepEqual(Array.from(P), [0.1, 0.2, 0.3, 1.123456789012 - 10 + 1, 2, 23]);
    assert.equal(measurementPoints(s, ['0:0,0,0', '2:0,0,0']), null, 'no atom 2');
    assert.equal(measurementPoints(s, ['0:0,0,0', 'bad']), null);
    const moved = Float64Array.from([0, 0, 0, 1, 1, 1]);
    assert.deepEqual(Array.from(measurementPoints(s, ['1:0,0,0'], { positions: moved })), [1, 1, 1], 'preview positions');
    const mol = new Structure({ symbols: ['O', 'H'], positions: [[0, 0, 0], [1, 0, 0]] });
    assert.deepEqual(Array.from(measurementPoints(mol, ['0:0,0,0', '1:0,0,0'])), [0, 0, 0, 1, 0, 0]);
    assert.equal(measurementPoints(mol, ['0:0,0,0', '1:1,0,0']), null, 'an image needs a cell');
  });

  test('ids are new for every measurement; the removal note', () => {
    const a = newMeasurementId(), b = newMeasurementId();
    assert.notEqual(a, b);
    assert.match(a, /^m\d+$/);
    assert.equal(measurementsRemovedNote(0), '');
    assert.equal(measurementsRemovedNote(1), '1 measurement was removed.');
    assert.equal(measurementsRemovedNote(3), '3 measurements were removed.');
  });
});

describe('migrating the keys of older projects', () => {
  // keys were relative to the copy the view drew inside the cell: f − floor(f), 0 just below an integer
  const s = new Structure({
    symbols: ['Pt', 'Pt', 'Pt', 'Pt'], positions: [[1, 1, 1], [1, 1, 11.5], [1, 1, -2], [1, 1, 9.99999999]],
    cell: [[10, 0, 0], [0, 10, 0], [0, 0, 10]], pbc: [true, true, true],
  });
  test('images move by the cells the old wrapping moved each atom by, then the first goes to 0,0,0', () => {
    assert.deepEqual(migrateMeasurementKeys(s, ['0:0,0,0', '1:0,0,0']), ['0:0,0,0', '1:0,0,-1']);
    // atom 1 (f = 1.15) was drawn at 0.15 + 1, atom 2 (f = −0.2) at 0.8: the pair 1.15 / 0.8 in stored terms
    assert.deepEqual(migrateMeasurementKeys(s, ['1:0,0,1', '2:0,0,0']), ['1:0,0,0', '2:0,0,1']);
    assert.deepEqual(migrateMeasurementKeys(s, ['0:0,0,0', '3:0,0,0']), ['0:0,0,0', '3:0,0,-1'], 'f = 0.999999999 was drawn at 0');
  });
  test('wrapping off, non-periodic axes and atoms the structure does not have keep their images', () => {
    assert.deepEqual(migrateMeasurementKeys(s, ['0:0,0,0', '1:0,0,0'], { wrap: false }), ['0:0,0,0', '1:0,0,0']);
    const ttf = new Structure({ symbols: s.symbols, positions: Array.from({ length: 4 }, (_, i) => s.pos(i)), cell: s.cell, pbc: [true, true, false] });
    assert.deepEqual(migrateMeasurementKeys(ttf, ['0:0,0,0', '1:0,0,0']), ['0:0,0,0', '1:0,0,0']);
    assert.deepEqual(migrateMeasurementKeys(s, ['0:0,0,0', '9:1,0,0']), ['0:0,0,0', '9:1,0,0']);
    assert.equal(migrateMeasurementKeys(s, ['0:0,0,0', 'x']), null);
  });
  test('400 nearest-neighbour measurements of the old display all land on matching drawn copies of the U1 display', () => {
    // a CONTCAR-like slab (bottom layer partly at 0.99999) with completed coordination shells: measurements on far-face
    // copies and bonded images, made with the old [0, 1) wrapping (cuts: false), as projects of 0.3 saved them
    const s = contcar();
    const d = { ...DISPLAY, completeBonds: true };
    const old = buildDisplayModel(s, d, { cuts: false });
    const picks = [];
    for (let a = 0; a < old.n && picks.length < 400; a++) for (let b = a + 1; b < old.n && picks.length < 400; b++) {
      const r = Math.hypot(old.positions[3 * a] - old.positions[3 * b], old.positions[3 * a + 1] - old.positions[3 * b + 1], old.positions[3 * a + 2] - old.positions[3 * b + 2]);
      if (r > 2.6 && r < 2.95) picks.push({ keys: [keyOf(old, a), keyOf(old, b)], r });
    }
    assert.equal(picks.length, 400);
    const v = bareViewer(s, d);
    v.measurements = picks.map(({ keys }, k) => ({ id: `t${k}`, type: 'distance', refs: migrateMeasurementKeys(s, keys) }));
    v._buildMeasurements();
    const lost = picks.filter((p) => !p.keys.every((k) => v.model.keys.get(k) !== undefined)).length;
    assert.ok(lost > 0, `the old keys miss copies of the U1 display (${lost})`);
    let maxErr = 0;
    v.measurements.forEach((ms, k) => {
      assert.equal(ms.drawn, 'exact', `measurement ${k}`);
      maxErr = Math.max(maxErr, Math.abs(ms.value - picks[k].r));
    });
    assert.ok(maxErr <= 2e-6, `values within 2e-6 Å of the old Float32 values (${maxErr})`);
  });
});

describe('cleaning and remapping lists', () => {
  const s = new Structure({ symbols: ['O', 'O', 'O'], positions: [[0, 0, 0], [0, 0, 9.5], [5, 5, 5]], cell: [[10, 0, 0], [0, 10, 0], [0, 0, 10]], pbc: [true, true, true] });
  test('cleanMeasurementList: refs normalised, keys migrated, others dropped; ids kept, new or made unique', () => {
    const list = [
      { id: 'a', type: 'distance', refs: ['1:0,0,1', '0:0,0,1'] },
      { id: 'a', type: 'angle', refs: ['0:0,0,0', '1:0,0,0', '2:0,0,0'] },
      { type: 'distance', keys: ['0:0,0,0', '1:0,0,-1'] },
      { type: 'distance', refs: ['0:0,0,0'] }, { type: 'torsion', refs: ['0:0,0,0', '1:0,0,0'] }, { type: 'distance', refs: ['0:0,0,0', 'x'] }, null, 'x',
    ];
    const out = cleanMeasurementList(list, s);
    assert.deepEqual(out.map((m) => [m.type, m.refs]), [['distance', ['1:0,0,0', '0:0,0,0']], ['angle', ['0:0,0,0', '1:0,0,0', '2:0,0,0']], ['distance', ['0:0,0,0', '1:0,0,-1']]]);
    assert.equal(out[0].id, 'a');
    assert.notEqual(out[1].id, 'a', 'a repeated id gets a new one');
    assert.ok(out[2].id);
    const fresh = cleanMeasurementList(list.slice(0, 1), s, { newIds: true });
    assert.notEqual(fresh[0].id, 'a');
  });

  test('remapMeasurementList: removed atoms, lattice changes (old images), whole-cell shifts, in that order', () => {
    const list = [
      { id: 'x', type: 'distance', refs: ['0:0,0,0', '1:0,0,-1'] },
      { id: 'y', type: 'distance', refs: ['1:0,0,0', '2:0,0,0'] },
      { id: 'z', type: 'angle', refs: ['2:0,0,0', '0:0,0,0', '1:0,0,0'] },
    ];
    const map = Int32Array.from([0, 2, -1]);   // atom 1 → 2, atom 2 deleted
    const del = remapMeasurementList(list, map);
    assert.deepEqual(del.list.map((m) => [m.id, m.refs]), [['x', ['0:0,0,0', '2:0,0,-1']]]);
    assert.equal(del.removed, 2);
    const ident = [0, 1, 2];
    const lat = remapMeasurementList(list, ident, { latticeChanged: true });
    assert.deepEqual(lat.list.map((m) => m.id), ['y', 'z']);
    assert.equal(lat.removed, 1);
    // atom 1 wrapped down by one cell (r' = r − c): its image grows by one
    const shift = remapMeasurementList(list, ident, { imageShift: (i) => (i === 1 ? [0, 0, -1] : null) });
    assert.deepEqual(shift.list.map((m) => m.refs), [['0:0,0,0', '1:0,0,0'], ['1:0,0,0', '2:0,0,-1'], ['2:0,0,0', '0:0,0,0', '1:0,0,1']]);
    // ② judges the images before ③ rewrites them: x has a non-zero image before the shift (and none after)
    const both = remapMeasurementList(list, ident, { latticeChanged: true, imageShift: (i) => (i === 1 ? [0, 0, -1] : null) });
    assert.deepEqual(both.list.map((m) => m.id), ['y', 'z']);
    assert.throws(() => remapMeasurementList(list, ident, { imageShift: () => [0.5, 0, 0] }), TypeError);
    const kept = remapMeasurementList([{ id: 'old', type: 'distance', keys: ['0:0,0,0', '1:0,0,0'] }], map);
    assert.deepEqual(kept.list.map((m) => m.id), ['old'], 'entries without refs are kept as they are');
  });

  test('wholeCellShifts reads whole-cell moves off two structures with the same cell', () => {
    const after = s.clone();
    after.positions[3 * 1 + 2] -= 10;            // atom 1 wrapped down by c
    after.positions[3 * 2] += 0.3;               // atom 2 moved a little
    const k = wholeCellShifts(s, after, [0, 1, 2]);
    assert.deepEqual([k(0), k(1), k(2)], [null, [0, 0, -1], null]);
    const sorted = wholeCellShifts(s, after, [2, 1, 0]);
    assert.equal(sorted(2), null, 'atom 2 → 0 did not move by whole cells');
    assert.equal(wholeCellShifts(s, s, [0, 1, 2]), null, 'the same object: nothing to compare');
    const strained = s.clone();
    strained.cell = [[10.1, 0, 0], [0, 10, 0], [0, 0, 10]];
    assert.equal(wholeCellShifts(s, strained, [0, 1, 2]), null, 'another cell');
  });
});

describe('the viewer: values from stored coordinates, exact / floating / hidden lines', () => {
  test('a measurement made on drawn copies keeps the atoms and stored images; its value is Float64', () => {
    const s = contcar();
    const v = bareViewer(s);
    const m = v.model;
    // the bottom-layer atom VASP stored at z = 21.79 (row 4) and its neighbour above it in the second layer
    const d3 = m.homeIndex[3];
    let best = -1, bd = Infinity;
    for (let d = 0; d < m.n; d++) {
      if (m.src[d] < 9 || m.src[d] >= 18) continue;
      const r = Math.hypot(...[0, 1, 2].map((k) => m.positions[3 * d + k] - m.positions[3 * d3 + k]));
      if (r < bd) { bd = r; best = d; }
    }
    const ms = v.addMeasurement('distance', [d3, best]);
    assert.match(ms.id, /^m\d+$/);
    assert.equal(ms.refs[0], '3:0,0,0');
    const I = storedImage(m, best), J = storedImage(m, d3);
    assert.equal(ms.refs[1], `${m.src[best]}:${I.map((x, k) => x - J[k]).join(',')}`);
    assert.equal(ms.drawn, 'exact');
    assert.deepEqual(ms.idx, [d3, best]);
    const P = measurementPoints(s, ms.refs);
    assert.equal(ms.value, dist(P), 'the Float64 value of the stored coordinates');
    assert.ok(ms.value > 2.7 && ms.value < 2.8);
    assert.ok(Math.abs(ms.value - bd) < 1e-5 && ms.value !== bd, 'not the Float32 drawing');
    // the label sits on the drawn line
    v.camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 500); v.camera.position.set(0, 0, 80); v.camera.lookAt(0, 0, 0);
    overlayReady(v);
    const g = fake2d(); g.canvas = { width: 400, height: 300 };
    v.drawOverlay(g, 1, 400, 300);
    assert.ok(g.calls.some((c) => c[0] === 'fillText' && c[1] === `${ms.value.toFixed(3)} Å`));
  });

  test('no matching set of drawn copies: the line floats from the first atom’s home copy; its label is still drawn', () => {
    const s = contcar();
    const v = bareViewer(s);
    v.measurements = [{ id: 'f', type: 'distance', refs: ['0:0,0,0', '1:0,0,3'] }];
    v._buildMeasurements();
    const [ms] = v.measurements;
    assert.equal(ms.drawn, 'floating');
    assert.equal(ms.idx[0], v.model.homeIndex[0]);
    assert.equal(ms.idx[1], -1);
    const P = measurementPoints(s, ms.refs);
    assert.ok(near(ms.value, dist(P), 1e-12));
    const h = v.model.homeIndex[0];
    for (let k = 0; k < 3; k++) assert.ok(near(ms.points[3 + k] - ms.points[k], P[3 + k] - P[k], 1e-9));
    assert.ok(near(ms.points[0], v.model.positions[3 * h], 1e-12));
    v.camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 500); v.camera.position.set(0, 0, 150); v.camera.lookAt(0, 0, 0);
    overlayReady(v);
    const g = fake2d(); g.canvas = { width: 400, height: 300 };
    v.drawOverlay(g, 1, 400, 300);
    assert.ok(g.calls.some((c) => c[0] === 'fillText' && c[1] === `${ms.value.toFixed(3)} Å`));
  });

  test('a hidden atom: no line, the value stays; an atom the structure lacks: not valid', () => {
    const s = contcar();
    const v = bareViewer(s);
    v.measurements = [{ id: 'h', type: 'distance', refs: ['0:0,0,0', '1:0,0,0'] }, { id: 'n', type: 'distance', refs: ['0:0,0,0', '99:0,0,0'] }];
    v.setVisibility('test', { hide: [1] });
    const [ms, gone] = v.measurements;
    assert.equal(ms.drawn, 'hidden');
    assert.ok(ms.valid && near(ms.value, dist(measurementPoints(s, ms.refs)), 1e-12));
    assert.equal(ms.points, null);
    assert.equal(gone.valid, false);
    assert.equal(gone.value, undefined);
    assert.equal(gone.drawn, null);
    // hidden by element as well
    const v2 = bareViewer(s, { ...DISPLAY, hiddenElements: ['Pt'] });
    v2.measurements = [{ id: 'e', type: 'distance', refs: ['0:0,0,0', '1:0,0,0'] }];
    v2._buildMeasurements();
    assert.equal(v2.measurements[0].drawn, 'hidden');
  });

  test('legacy {keys} entries are migrated when drawn; a moved atom keeps its measurement on the same pair', () => {
    const s = contcar();
    const v = bareViewer(s);
    v.measurements = [{ id: 'k', type: 'distance', keys: ['3:0,0,0', '12:0,0,0'] }];
    v._buildMeasurements();
    assert.deepEqual(v.measurements[0].refs, migrateMeasurementKeys(s, ['3:0,0,0', '12:0,0,0']));
    assert.equal(v.measurements[0].keys, undefined);
    // drag atom 12 upward through the vacuum, past the middle of the cut, and redraw: the same pair, the same images
    const before = v.measurements[0].refs.slice();
    s.positions[3 * 12 + 2] += 9;
    v._buildModel(); v._buildMeasurements();
    assert.deepEqual(v.measurements[0].refs, before);
    assert.ok(near(v.measurements[0].value, dist(measurementPoints(s, before)), 1e-12));
  });
});

describe('the app: entries keep {id, type, refs}; projects save {type, refs} and migrate keys', () => {
  function stubViewer() {
    return {
      selection: new Set(), measurements: [], structure: null, model: null, settings: null, builds: 0,
      setStructure(st, { resetCamera = true } = {}) { this.structure = st; this.model = { n: st.length }; if (resetCamera) { this.measurements = []; this.selection.clear(); } },
      applySettings(sc) { this.settings = sc; }, setSelection(idx) { this.selection = new Set(idx); },
      getCameraState: () => null, setCameraState() {}, requestRender() {}, _disposeObject() {}, _buildMeasurements() {},
    };
  }
  function makeApp() {
    const app = Object.create(App.prototype);
    app._h = new Map();
    app.prefs = { autosave: false };
    app.viewer = stubViewer();
    app.project = { id: 'p1', name: 'Test', description: '', tags: [], created: '', updated: null, structures: [], activeStructure: null, scene: makeScene(), location: null, thumbnail: null };
    Object.assign(app, { structure: null, dirty: false, saveState: 'idle', saveDetail: '', busy: false, tool: 'select', measureType: 'distance', measurePicks: [] });
    Object.assign(app, { _rev: 0, _sceneBefore: null, _sceneLabel: null, _tx: null, _measGuard: 0, _busyOps: [] });
    app._commitScene = Object.assign(() => {}, { flush() {}, cancel() {}, pending: () => false });
    app._autosave = Object.assign(() => {}, { flush() {}, cancel() {}, pending: () => false });
    app.history = app._newHistory({ maxSteps: 80, maxBytes: 64 * 2 ** 20 });
    return app;
  }
  const slab = () => new Structure({ name: 'S', symbols: ['Pt', 'Pt', 'O'], positions: [[0, 0, 0], [0, 0, 9.5], [5, 5, 5]], cell: [[10, 0, 0], [0, 10, 0], [0, 0, 10]], pbc: [true, true, true] });

  test('an opened 0.3 project: keys become refs against the structure and the project’s wrapping; saving writes refs, no ids', () => {
    const app = makeApp();
    const doc = {
      schema: 'crystallume.project/1', id: 'p2', name: 'Old', structures: [{ id: 's1', name: 'S', structure: slab().toJSON(), measurements: [{ type: 'distance', keys: ['0:0,0,0', '1:0,0,-1'] }, { type: 'distance', keys: ['0:0'] }] }],
      activeStructure: 's1', scene: { display: { wrap: true } },
    };
    app.loadProjectJSON(doc);
    const e = app.project.structures[0];
    assert.deepEqual(e.measurements.map((m) => [m.type, m.refs]), [['distance', ['0:0,0,0', '1:0,0,-1']]]);
    assert.match(e.measurements[0].id, /^m\d+$/);
    assert.deepEqual(app.viewer.measurements.map((m) => m.id), [e.measurements[0].id], 'the viewer shows the same ids');
    // keys made with the wrapping off keep their images: atom 1 is stored at 9.5, so the old rule moved nothing either way
    const doc2 = { ...doc, structures: [{ ...doc.structures[0], measurements: [{ type: 'distance', keys: ['0:0,0,0', '1:0,0,-1'] }] }], scene: { display: { wrap: false } } };
    app.loadProjectJSON(doc2);
    assert.deepEqual(app.project.structures[0].measurements[0].refs, ['0:0,0,0', '1:0,0,-1']);
    const out = app.projectToJSON({ thumbnail: false });
    assert.deepEqual(out.structures[0].measurements, [{ type: 'distance', refs: ['0:0,0,0', '1:0,0,-1'] }]);
  });

  test('Wrap into cell (a structure swapped in) keeps a measurement across the cell face on the same atoms and value', () => {
    const app = makeApp(), s = slab();
    s.positions[3 * 1 + 2] = 10.4;   // atom 1 stored above the top face
    const e = app._newEntry(s);
    app.project.structures.push(e);
    e.measurements = [{ id: 'w', type: 'distance', refs: ['0:0,0,0', '1:0,0,0'] }];
    app._activate(e.id);
    const before = dist(measurementPoints(s, e.measurements[0].refs));
    const c = s.clone(); c.wrap();
    assert.ok(Math.abs(c.pos(1)[2] - 0.4) < 1e-9);
    app.replaceActiveStructure(c);
    assert.deepEqual(e.measurements[0].refs, ['0:0,0,0', '1:0,0,1']);
    assert.ok(near(dist(measurementPoints(c, e.measurements[0].refs)), before, 1e-9));
    assert.equal(e.measurements[0].id, 'w');
  });

  test('ids survive _showMeasurements and _remapMeasurements; the count of removed measurements comes back', () => {
    const app = makeApp(), s = slab();
    const e = app._newEntry(s);
    app.project.structures.push(e);
    e.measurements = [{ id: 'm-a', type: 'distance', refs: ['0:0,0,0', '1:0,0,-1'] }, { id: 'm-b', type: 'distance', refs: ['1:0,0,0', '2:0,0,0'] }];
    app._activate(e.id);
    assert.deepEqual(app.viewer.measurements.map((m) => m.id), ['m-a', 'm-b']);
    assert.notEqual(app.viewer.measurements[0], e.measurements[0], 'the viewer gets copies');
    const removed = app._remapMeasurements(Int32Array.from([0, -1, 1]));
    assert.equal(removed, 2, 'both measurements used atom 1');
    assert.deepEqual(e.measurements, []);
    e.measurements = [{ id: 'm-c', type: 'distance', refs: ['0:0,0,0', '2:0,0,0'] }];
    app._showMeasurements(e);
    assert.equal(app._remapMeasurements([0, 1, 2], { imageShift: (i) => (i === 2 ? [1, 0, 0] : null) }), 0);
    assert.deepEqual(e.measurements, [{ id: 'm-c', type: 'distance', refs: ['0:0,0,0', '2:-1,0,0'] }]);
    assert.equal(app._remapMeasurements([0, 1, 2], { latticeChanged: true }), 1);
    // an entry record without an id gets one, written back so that the viewer and the entry agree
    e.measurements = [{ type: 'distance', refs: ['0:0,0,0', '2:0,0,0'] }];
    app._showMeasurements(e);
    assert.ok(e.measurements[0].id && e.measurements[0].id === app.viewer.measurements[0].id);
  });
});
