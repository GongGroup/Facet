// The viewer's named highlights, halo bookkeeping, colour dependencies and ghost drawing (F0-A §3.10, §3.7.3, B13),
// run on a Viewer prototype instance holding only what these methods use (the constructor needs WebGL).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../crystallume/web/vendor/three/three.module.js';
import { Viewer } from '../../crystallume/web/js/render/viewer.js';
import { Overlays, haloMaterial, cellOutlineLayer, HALO_ORDER_BASE } from '../../crystallume/web/js/render/overlays.js';
import { colorSchemes } from '../../crystallume/web/js/render/colors.js';
import { makeScene } from '../../crystallume/web/js/render/settings.js';
import { buildAtoms, buildBonds, buildLines, buildPolyhedra, atomRadius, segmentsFor } from '../../crystallume/web/js/render/styles.js';
import { Structure } from '../../crystallume/web/js/core/structure.js';

/**
 * A viewer without a renderer: 3 structure atoms drawn as 5 (atom 0 three times, as periodic images are),
 * selection and hover halos, overlays.
 */
function bareViewer() {
  const v = Object.create(Viewer.prototype);
  v._h = new Map();   // Emitter
  Object.assign(v, {
    root: new THREE.Group(), _haloGeo: new THREE.SphereGeometry(1, 8, 6), selection: new Set(), hoverIndex: -1, overlayDark: false, _dirty: false,
    model: { n: 5, src: Int32Array.from([0, 1, 2, 0, 0]), positions: Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 0, 3, 0]), symbols: ['O', 'Pt', 'Pt', 'O', 'O'] },
    radii: Float32Array.from([0.5, 1, 1, 0.5, 0.5]),
    settings: makeScene(), resolution: new THREE.Vector2(400, 300), container: { appendChild() {} },
    helpers: { buildAtoms, buildBonds, buildLines, buildPolyhedra, atomRadius, segmentsFor },
  });
  v._halo = { select: v._makeHalo(haloMaterial({ contrast: false }), { name: 'select', themed: true, grow: 1.25 }), hover: v._makeHalo(haloMaterial({ contrast: false }), { name: 'hover', themed: true, grow: 1.32 }) };
  v._haloHidden = new Set();
  v._highlights = new Map();
  v.overlays = new Overlays(v);
  v._orderHalos();
  return v;
}
const shown = (mesh) => {
  const out = [], m = new THREE.Matrix4();
  for (let k = 0; k < mesh.count; k++) { mesh.getMatrixAt(k, m); const s = new THREE.Vector3().setFromMatrixScale(m).x; if (s > 0) out.push([new THREE.Vector3().setFromMatrixPosition(m).toArray(), +s.toFixed(4)]); }
  return out;
};
const hex = (mesh, u = 'color') => `#${mesh.material.uniforms[u].value.getHexString()}`;

describe('named highlights', () => {
  test('a halo around every drawn image of the atoms, its own colour, never the accent', () => {
    const v = bareViewer();
    v.setHighlight('fixed', [0], { color: { light: '#2563eb', dark: '#7aa2ff' }, grow: 1.12 });
    const mesh = v._halo.fixed;
    assert.ok(mesh, 'created on first use');
    assert.equal(mesh.parent, v.root);
    assert.equal(mesh.userData.themed, false);
    assert.equal(mesh.userData.export, 'marker');
    assert.deepEqual(shown(mesh).map(([p]) => p), [[0, 0, 0], [3, 0, 0], [0, 3, 0]], 'all three images of atom 0');
    assert.equal(shown(mesh)[0][1], +(0.5 * 1.12 + 0.05).toFixed(4));
    const share = new THREE.Color();
    mesh.getColorAt(0, share);
    assert.ok(Math.abs(share.r - 0.5 / (0.5 * 1.12 + 0.05)) < 1e-6, "instanceColor.r: the atom's share of the halo radius");
    assert.equal(hex(mesh), '#2563eb');
    assert.equal(hex(mesh, 'edge'), '#14171b');
    assert.deepEqual(v.highlightNames(), ['fixed']);
    // the background turns dark: the dark colour and a black inner line
    v.overlayDark = true;
    v._themeOverlays();
    assert.equal(hex(mesh), '#7aa2ff');
    assert.equal(hex(mesh, 'edge'), '#000000');
  });

  test('options: every call starts from the defaults; uniforms and policy follow', () => {
    const v = bareViewer();
    v.setHighlight('q', [1, 2], { color: '#0f9d8a', strength: 0.7, opacity: 0.5, contrast: false, export: 'always', grow: 1.18 });
    const u = v._halo.q.material.uniforms;
    assert.deepEqual([u.strength.value, u.opacity.value, u.contrast.value], [0.7, 0.5, 0]);
    assert.equal(v._halo.q.userData.export, 'always');
    v.setHighlight('q', [1]);
    assert.deepEqual([u.strength.value, u.opacity.value, u.contrast.value], [1.4, 1, 1]);
    assert.equal(v._halo.q.userData.export, 'marker');
    assert.equal(v._halo.q.userData.grow, 1.15);
    assert.equal(shown(v._halo.q).length, 1);
  });

  test('bad calls throw before anything changes', () => {
    const v = bareViewer();
    assert.throws(() => v.setHighlight('select', [0]), /viewer's own halo/);
    assert.throws(() => v.setHighlight('hover', [0]), /viewer's own halo/);
    assert.throws(() => v.setHighlight('f', [0], { color: 'ish' }), /color must be a CSS colour/);
    assert.throws(() => v.setHighlight('f', [-1]), /whole numbers ≥ 0/);
    assert.throws(() => v.setHighlight('f', 3), /pass atom indices as an array/);
    assert.deepEqual(v.highlightNames(), []);
    assert.equal(v._halo.f, undefined);
  });

  test('clearing keeps the halo kind for the next time; indices null clears too', () => {
    const v = bareViewer();
    v.setHighlight('layer', [1]);
    const mesh = v._halo.layer;
    v.clearHighlight('layer');
    assert.deepEqual(v.highlightNames(), []);
    assert.equal(v._halo.layer, mesh);
    assert.deepEqual(shown(mesh), []);
    v.setHighlight('layer', [2]);
    assert.equal(v._halo.layer, mesh, 'the same mesh and material again');
    v.setHighlight('layer', null);
    assert.deepEqual(v.highlightNames(), []);
    v.clearHighlight('never-set');
  });

  test('draw order by grow, the selection and hover halos included', () => {
    const v = bareViewer();
    v.setHighlight('query', [0], { grow: 1.18 });
    v.setHighlight('fixed', [1], { grow: 1.12 });
    v.setHighlight('ring', [2], { grow: 1.4 });
    const order = Object.fromEntries(Object.entries(v._halo).map(([k, m]) => [k, m.renderOrder]));
    const sorted = Object.keys(order).sort((a, b) => order[a] - order[b]);
    assert.deepEqual(sorted, ['fixed', 'query', 'select', 'hover', 'ring']);
    assert.equal(order.fixed, HALO_ORDER_BASE);
    v.clearHighlight('fixed');
    assert.equal(v._halo.select.renderOrder < v._halo.ring.renderOrder, true);
  });

  test('more atoms than a halo mesh holds: a larger one replaces it, with its settings', () => {
    const v = bareViewer();
    const n = 40;
    v.model = { n, src: Int32Array.from({ length: n }, (_, i) => i), positions: new Float32Array(3 * n).map((_, k) => k), symbols: Array(n).fill('O') };
    v.radii = new Float32Array(n).fill(0.4);
    v.setHighlight('many', [...Array(n).keys()], { export: 'never', grow: 1.3 });
    const mesh = v._halo.many;
    assert.equal(mesh.count, n);
    assert.equal(mesh.userData.export, 'never');
    assert.equal(mesh.userData.grow, 1.3);
    assert.equal(mesh.parent, v.root);
    assert.equal(shown(mesh).length, n);
  });

  test('hover changes rewrite only the hover halo; a preview of other atoms hides selection and highlights', () => {
    const v = bareViewer();
    v.selection = new Set([1]);
    v.setHighlight('fixed', [0]);
    v._writeHalos();
    v.hoverIndex = 2;
    let touched = [];
    const orig = v._writeHalo.bind(v);
    v._writeHalo = (k, list) => { touched.push(k); orig(k, list); };
    v._writeHalos(['hover']);
    assert.deepEqual(touched, ['hover']);
    assert.deepEqual(shown(v._halo.hover).map(([p]) => p), [[2, 0, 0]]);
    touched = [];
    v._preview = { kind: 'structure', sameAtoms: false };
    v._writeHalos();
    assert.deepEqual(shown(v._halo.select), []);
    assert.deepEqual(shown(v._halo.fixed), []);
    v._preview = { kind: 'structure', sameAtoms: true };
    v._writeHalos();
    assert.equal(shown(v._halo.fixed).length, 3);
  });

  test('edits renumber highlights (remapIndexed), another structure drops them', () => {
    const v = bareViewer();
    v.setHighlight('fixed', [0, 2]);
    v._remapHighlights([-1, 0, 1]);   // atom 0 deleted
    assert.deepEqual([...v._highlights.get('fixed').set], [1]);
    v.overlays.add(cellOutlineLayer({ id: 'preview', cell: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }));
    v.overlays.add(cellOutlineLayer({ id: 'keep', cell: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], clearOnSwitch: false }));
    v.structureSwitched();
    assert.deepEqual(v.highlightNames(), []);
    assert.deepEqual(v.overlays.list().map((l) => l.id), ['keep']);
  });

  test('export scopes read the halo policies', () => {
    const v = bareViewer();
    v.setHighlight('fixed', [0]);                          // marker
    v.setHighlight('note', [1], { export: 'always' });
    v.setHighlight('quiet', [2], { export: 'never' });
    let restore = v.overlays.exportScope('png');
    assert.deepEqual([...v._haloHidden].sort(), ['fixed', 'hover', 'quiet']);
    restore();
    restore = v.overlays.exportScope('png', { markers: true, selection: false });
    assert.deepEqual([...v._haloHidden].sort(), ['hover', 'quiet', 'select']);
    restore();
    assert.equal(v._haloHidden.size, 0);
  });
});

describe('colour dependencies', () => {
  test('the colors signature holds the dependsOn values and the extras', (t) => {
    const v = bareViewer();
    const off = colorSchemes.register({ id: 'test-deps', name: 'Deps', group: 'Per atom', dependsOn: ['display.legend', 'display.nothing'], colorFor: () => '#ffffff' });
    t.after(off);
    const scene = makeScene({ style: { colorScheme: 'test-deps' } });
    const k0 = v._colorDeps(scene);
    assert.deepEqual(JSON.parse(k0), [['auto', null], {}]);
    v.extrasProvider = () => ({ layers: { tol: 0.3 } });
    const k1 = v._colorDeps(scene);
    assert.notEqual(k1, k0);
    assert.deepEqual(v._colorExtras, { layers: { tol: 0.3 } });
    scene.display.legend = 'none';
    assert.notEqual(v._colorDeps(scene), k1, 'a dependsOn value changed');
    v.extrasProvider = () => { throw new Error('no'); };
    const orig = console.error;
    console.error = () => {};
    try { assert.deepEqual(JSON.parse(v._colorDeps(scene)), [['none', null], {}]); } finally { console.error = orig; }
    const cyclic = {}; cyclic.self = cyclic;
    v.extrasProvider = () => cyclic;
    assert.equal(v._colorDeps(scene), '[]', 'extras JSON cannot hold are left out');
    assert.deepEqual(v._colorExtras, {});
    v.extrasProvider = null;
    assert.deepEqual(JSON.parse(v._colorDeps(makeScene())), [null, {}], 'a scheme without dependsOn');
  });
});

describe('ghosts', () => {
  test('buildGhost draws the structure in the current style, see-through', () => {
    const v = bareViewer();
    v.model = null;
    const co = new Structure({ name: 'CO', symbols: ['C', 'O'], positions: [[0, 0, 0], [0, 0, 1.15]] });
    const g = v.buildGhost(co, { opacity: 0.3 });
    assert.ok(g.isObject3D);
    assert.equal(g.name, 'ghost');
    const meshes = [];
    g.traverse((o) => { if (o.isInstancedMesh) meshes.push(o); });
    const atoms = meshes.find((o) => o.userData.role === 'atoms'), bonds = meshes.find((o) => o.userData.role === 'bonds');
    assert.equal(atoms.count, 2);
    assert.ok(bonds.count >= 1, 'the C–O bond');
    for (const m of [atoms.material, bonds.material]) {
      assert.equal(m.transparent, true);
      assert.equal(m.opacity, 0.3);
      assert.equal(m.depthWrite, true);
    }
    assert.equal(v.buildGhost(new Structure({ symbols: [] })), null);
    assert.equal(v.buildGhost(null), null);
  });
});
