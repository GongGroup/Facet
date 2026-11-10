// The viewer's named highlights, halo bookkeeping, colour dependencies and ghost drawing (F0-A §3.10, §3.7.3, B13),
// run on a Viewer prototype instance holding only what these methods use (the constructor needs WebGL).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../facet/web/vendor/three/three.module.js';
import { Viewer } from '../../facet/web/js/render/viewer.js';
import { Overlays, cellOutlineLayer, HALO_ORDER_BASE } from '../../facet/web/js/render/overlays.js';
import { fake2d } from './fake2d.mjs';
import { colorSchemes } from '../../facet/web/js/render/colors.js';
import { makeScene } from '../../facet/web/js/render/settings.js';
import { buildAtoms, buildBonds, buildLines, buildPolyhedra, atomRadius, segmentsFor } from '../../facet/web/js/render/styles.js';
import { Structure } from '../../facet/web/js/core/structure.js';

/**
 * A viewer without a renderer: 3 structure atoms drawn as 5 (atom 0 three times, as periodic images are),
 * selection and hover halos, overlays.
 */
function bareViewer() {
  const v = Object.create(Viewer.prototype);
  v._h = new Map();   // Emitter
  Object.assign(v, {
    root: new THREE.Group(), selection: new Set(), hoverIndex: -1, overlayDark: false, _dirty: false,
    model: { n: 5, src: Int32Array.from([0, 1, 2, 0, 0]), positions: Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 0, 3, 0]), symbols: ['O', 'Pt', 'Pt', 'O', 'O'] },
    radii: Float32Array.from([0.5, 1, 1, 0.5, 0.5]),
    settings: makeScene(), resolution: new THREE.Vector2(400, 300), container: { appendChild() {} },
    helpers: { buildAtoms, buildBonds, buildLines, buildPolyhedra, atomRadius, segmentsFor },
  });
  v._setupHalos();   // as the constructor does
  v.overlays = new Overlays(v);
  return v;
}

/**
 * The page's CSS custom properties for cssVar (getComputedStyle on <html>), from `vars`, which the test may change;
 * the globals are put back after the test.
 */
function fakePageCss(t, vars) {
  const had = { document: Object.getOwnPropertyDescriptor(globalThis, 'document'), getComputedStyle: Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle') };
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = (el) => {
    assert.equal(el, globalThis.document.documentElement);
    return { getPropertyValue: (name) => vars[name] ?? '' };
  };
  t.after(() => {
    for (const [k, d] of Object.entries(had)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  });
}
const shown = (mesh) => {
  const out = [], m = new THREE.Matrix4();
  for (let k = 0; k < mesh.count; k++) { mesh.getMatrixAt(k, m); const s = new THREE.Vector3().setFromMatrixScale(m).x; if (s > 0) out.push([new THREE.Vector3().setFromMatrixPosition(m).toArray(), +s.toFixed(4)]); }
  return out;
};
const hex = (mesh, u = 'color') => `#${mesh.material.uniforms[u].value.getHexString()}`;

/**
 * Draw the overlay canvas as the view does (drawOverlay, 400 × 300) and give each overlay legend row's ring colour:
 * label → the colour of the last stroke before the label (a 'halo' swatch strokes the dark inner line, then the ring).
 */
function legendRings(v) {
  if (!v.camera) { v.camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.1, 100); v.camera.position.set(0, 0, 20); }
  Object.assign(v, { width: 400, height: 300, measurements: v.measurements ?? [] });
  const g = fake2d();
  g.canvas = { width: 400, height: 300 };
  v.drawOverlay(g, 1, 400, 300);
  const out = {};
  let ring = null;
  for (const c of g.calls) {
    if (c[0] === 'stroke') ring = c[1];
    else if (c[0] === 'fillText') { out[c[1]] = ring; ring = null; }
  }
  return out;
}

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

  test('any name works, Object.prototype keys too: the halo table has no prototype', () => {
    const v = bareViewer();
    assert.equal(Object.getPrototypeOf(v._halo), null);
    const names = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];
    names.forEach((name, k) => v.setHighlight(name, [k % 3], { color: '#0f9d8a', export: 'always' }));
    assert.deepEqual(v.highlightNames(), names);
    names.forEach((name, k) => {
      const mesh = v._halo[name];
      assert.ok(mesh?.isInstancedMesh, `${name}: a halo of its own`);
      assert.equal(mesh.userData.highlight, name);
      assert.equal(hex(mesh), '#0f9d8a');
      assert.equal(shown(mesh).length, k % 3 === 0 ? 3 : 1, `${name}: every drawn image of atom ${k % 3}`);
    });
    assert.deepEqual(Object.keys(v._halo).sort(), ['__proto__', 'constructor', 'hasOwnProperty', 'hover', 'select', 'toString']);
    const restore = v.overlays.exportScope('png');
    assert.deepEqual([...v._haloHidden], ['hover']);
    restore();
    v.setHighlight('constructor', [1]);   // set again: the same halo
    assert.equal(shown(v._halo.constructor).length, 1);
    for (const name of names) v.clearHighlight(name);
    assert.deepEqual(v.highlightNames(), []);
    for (const name of names) assert.deepEqual(shown(v._halo[name]), [], `${name} cleared`);
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

describe('theme changes', () => {
  const kinds = ['select', 'hover', 'fixed', 'plain', 'pair'];

  test('only the selection and hover halos take the accent; tokens are read again, other colours stay', (t) => {
    const vars = { '--accent': '#e8a33d', '--constraint': '#2563eb' };
    fakePageCss(t, vars);
    const v = bareViewer();
    v._updateHalos();   // the shell's first theme pass
    v.setHighlight('fixed', [0], { color: 'var(--constraint)' });
    v.setHighlight('plain', [1], { color: '#0f9d8a' });
    v.setHighlight('pair', [2], { color: { light: '#d97706', dark: '#fbbf24' } });
    const colors = () => Object.fromEntries(kinds.map((k) => [k, hex(v._halo[k])]));
    assert.deepEqual(colors(), { select: '#e8a33d', hover: '#e8a33d', fixed: '#2563eb', plain: '#0f9d8a', pair: '#d97706' });

    // another theme: a new accent and a new value of the token
    Object.assign(vars, { '--accent': '#3b82f6', '--constraint': '#dc2626' });
    v._updateHalos();
    const after = { select: '#3b82f6', hover: '#3b82f6', fixed: '#dc2626', plain: '#0f9d8a', pair: '#d97706' };
    assert.deepEqual(colors(), after);
    v._updateHalos();
    assert.deepEqual(colors(), after, 'a second pass changes nothing');
    assert.equal(shown(v._halo.fixed).length, 3, 'the halos are written again, still around every image');

    // the theme cache read afresh (as drawOverlay does after _updateHalos) recolours the themed kinds only
    v._css = null;
    vars['--accent'] = '#16a34a';
    v._cssTheme();
    assert.deepEqual(colors(), { ...after, select: '#16a34a', hover: '#16a34a' });

    // a dark background: {light, dark} takes its dark colour, the inner lines turn black; tokens and plain colours stay
    v.overlayDark = true;
    v._themeOverlays();
    assert.deepEqual(colors(), { ...after, select: '#16a34a', hover: '#16a34a', pair: '#fbbf24' });
    for (const k of ['fixed', 'plain', 'pair']) assert.equal(hex(v._halo[k], 'edge'), '#000000');
  });

  test('legend rows given a highlight’s colour spec draw the colour its halo has', (t) => {
    const vars = { '--accent': '#e8a33d', '--constraint': '#2563eb' };
    fakePageCss(t, vars);
    const v = bareViewer();
    v._updateHalos();
    const PAIR = { light: '#7c3aed', dark: '#c4b5fd' };
    v.setHighlight('fixed', [0], { color: 'var(--constraint)' });
    v.setHighlight('pair', [1], { color: PAIR });
    v.overlays.add({
      id: 'key', tier: 'legend', items: () => [
        { label: 'Fixed (1)', swatch: { kind: 'halo', color: 'var(--constraint)' } },
        { label: 'Pair (1)', swatch: { kind: 'halo', color: PAIR } },
        { label: 'Unset', swatch: { kind: 'halo', color: 'var(--nothing)' } },
      ],
    });
    const rings = () => legendRings(v);
    assert.deepEqual(rings(), { 'Fixed (1)': hex(v._halo.fixed), 'Pair (1)': hex(v._halo.pair), Unset: '#9aa0a6' });
    assert.deepEqual(rings(), { 'Fixed (1)': '#2563eb', 'Pair (1)': '#7c3aed', Unset: '#9aa0a6' });
    // a token changed without a theme pass is read by neither; the next pass gives both the new value
    vars['--constraint'] = '#dc2626';
    assert.equal(rings()['Fixed (1)'], '#2563eb');
    v._updateHalos();
    assert.equal(hex(v._halo.fixed), '#dc2626');
    assert.equal(rings()['Fixed (1)'], '#dc2626');
    // a dark background: the {light, dark} row and its halo both take the dark colour
    v.overlayDark = true;
    v._themeOverlays();
    assert.equal(hex(v._halo.pair), '#c4b5fd');
    assert.equal(rings()['Pair (1)'], '#c4b5fd');
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
