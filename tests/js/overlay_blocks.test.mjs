// Overlay building blocks (F0-A §3.11.4, ledger L-F0-38): markerLayer, planeLayer, cellOutlineLayer, ghostLayer, textLayer.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../crystallume/web/vendor/three/three.module.js';
import { Overlays, markerLayer, planeLayer, cellOutlineLayer, ghostLayer, textLayer, drawTextItems, cellEdges } from '../../crystallume/web/js/render/overlays.js';
import { fake2d, quietErrors } from './fake2d.mjs';

function stubViewer(extra = {}) {
  const handlers = new Map();
  return {
    container: { appendChild() {} },
    resolution: new THREE.Vector2(800, 600),
    renders: 0,
    requestRender() { this.renders++; },
    on(type, fn) { handlers.set(type, fn); },
    emit(type, ...a) { handlers.get(type)?.(...a); },
    _halo: {},
    _haloHidden: new Set(),
    ...extra,
  };
}
const scaleOf = (mesh, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return new THREE.Vector3().setFromMatrixScale(m).x; };
const posOf = (mesh, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return new THREE.Vector3().setFromMatrixPosition(m).toArray(); };
const hexAt = (mesh, i) => { const c = new THREE.Color(); mesh.getColorAt(i, c); return `#${c.getHexString()}`; };
const close = (a, b, eps = 1e-5) => a.every((v, k) => Math.abs(v - b[k]) < eps);

describe('markerLayer', () => {
  test('one instanced sphere and outline per point, with colours', () => {
    const L = markerLayer({ id: 'sites', points: [[0, 0, 1], [2, 0, 1], [4, 0, 1]], colors: ['#e64980', 'nope', '#12b886'] });
    assert.equal(L.tier, 'top');
    assert.equal(L.export, 'marker');
    assert.equal(L.pickable, true);
    const [edge, fill] = L.object.children;
    assert.equal(fill.name, 'markers');
    assert.equal(edge.name, 'marker-outlines');
    assert.equal(fill.count, 3);
    assert.equal(edge.count, 3);
    assert.deepEqual(posOf(fill, 1), [2, 0, 1]);
    assert.ok(Math.abs(scaleOf(fill, 0) - 0.32) < 1e-6);
    assert.ok(Math.abs(scaleOf(edge, 0) - 0.32 * 1.18) < 1e-6, 'a thin outline around each marker');
    assert.equal(hexAt(fill, 0), '#e64980');
    assert.equal(hexAt(fill, 1), '#d6336c', 'an invalid colour falls back to the default');
    assert.equal(fill.material.toneMapped, false);
    assert.equal(fill.frustumCulled, false);
    L.setPoints([[1, 1, 1], [2, 2, 2]], '#fab005');
    assert.equal(fill.count, 2);
    assert.equal(hexAt(fill, 1), '#fab005');
    assert.deepEqual([...L.points], [1, 1, 1, 2, 2, 2]);
  });

  test('more points than the meshes hold: new, larger meshes', () => {
    const L = markerLayer({ id: 'm', points: [[0, 0, 0]] });
    const many = Array.from({ length: 40 }, (_, i) => [i, 0, 0]);
    L.setPoints(many);
    const [edge, fill] = L.object.children;
    assert.equal(L.object.children.length, 2);
    assert.equal(fill.count, 40);
    assert.ok(fill.instanceMatrix.count >= 40);
    assert.deepEqual(posOf(edge, 39), [39, 0, 0]);
  });

  test('setActive enlarges one marker 1.3 times', () => {
    const L = markerLayer({ id: 'm', points: [[0, 0, 0], [1, 0, 0]], radius: 0.4 });
    const fill = L.object.children[1];
    L.setActive(1);
    assert.equal(L.active, 1);
    assert.ok(Math.abs(scaleOf(fill, 1) - 0.52) < 1e-6);
    L.setActive(0);
    assert.ok(Math.abs(scaleOf(fill, 1) - 0.4) < 1e-6);
    assert.ok(Math.abs(scaleOf(fill, 0) - 0.52) < 1e-6);
    L.setActive(7);
    assert.equal(L.active, -1);
    assert.ok(Math.abs(scaleOf(fill, 0) - 0.4) < 1e-6);
  });

  test('pick: analytic ray–sphere hits, radius at least 0.25 Å', () => {
    const L = markerLayer({ id: 'm', points: [[0, 0, 0], [0, 0, 3], [5, 0, 0]], radius: 0.1 });
    const down = new THREE.Ray(new THREE.Vector3(0.2, 0, 10), new THREE.Vector3(0, 0, -1));
    const hit = L.pick(down);
    assert.equal(hit.index, 1, 'the nearest marker');
    assert.deepEqual(hit.item, [0, 0, 3]);
    assert.ok(Math.abs(hit.t - (7 - Math.sqrt(0.25 ** 2 - 0.2 ** 2))) < 1e-6);
    assert.equal(L.pick(new THREE.Ray(new THREE.Vector3(0.3, 0, 10), new THREE.Vector3(0, 0, -1))), null);
  });

  test('bounds, theme and validation', () => {
    const L = markerLayer({ id: 'm', points: [[0, 0, 0], [2, 0, 0]] });
    const b = L.bounds();
    assert.deepEqual(b.center, [1, 0, 0]);
    assert.ok(Math.abs(b.radius - (1 + 0.32 * 1.3)) < 1e-6);
    assert.equal(markerLayer({ id: 'e' }).bounds(), null);
    const edge = L.object.children[0];
    L.onTheme({ dark: true });
    assert.equal(`#${edge.material.color.getHexString()}`, '#f1f3f5');
    L.onTheme({ dark: false });
    assert.equal(`#${edge.material.color.getHexString()}`, '#14171b');
    assert.throws(() => markerLayer({ id: 'x', tier: 'canvas' }), /tier must be 'top' or 'scene'/);
    assert.throws(() => markerLayer({ id: 'x', radius: 0 }), /radius must be above 0/);
    assert.throws(() => markerLayer({ id: 'x', points: [[0, 0]] }), /point 0 is not \[x, y, z\]/);
    assert.throws(() => markerLayer({ id: 'x', points: Float32Array.from([1, 2]) }), /3 numbers per point/);
  });

  test('through Overlays: pickable under the given tools, methods redraw, disposal', () => {
    const v = stubViewer(), ov = new Overlays(v);
    const h = ov.add(markerLayer({ id: 'sites', owner: 'm5', points: [[0, 0, 0]], pickIn: ['site-pick'], depth: 'atoms' }));
    assert.equal(h.layer.object.parent, ov.topAtoms);
    assert.deepEqual(ov.pickables('select'), []);
    assert.equal(ov.pickables('site-pick')[0].id, 'sites');
    let before = v.renders;
    h.setPoints([[1, 1, 1], [2, 2, 2]]);
    assert.ok(v.renders > before, 'through the handle');
    before = v.renders;
    h.layer.setActive(1);
    assert.ok(v.renders > before, 'on the layer object itself, once added');
    const geo = h.layer.object.children[1].geometry;
    let gone = 0;
    geo.addEventListener('dispose', () => { gone++; });
    assert.equal(ov.removeOwner('m5'), 1);
    assert.equal(gone, 1);
    assert.equal(h.layer.object.parent, null);
  });
});

describe('planeLayer', () => {
  const square = (z, extra = {}) => ({ points: [[0, 0, z], [2, 0, z], [2, 2, z], [0, 2, z]], ...extra });

  test('a translucent fill and an outline per polygon', () => {
    const L = planeLayer({ id: 'hkl', polygons: [square(1, { color: '#ff0000' }), square(3, { opacity: 0.5, dashed: true }), square(5, { outline: false })] });
    assert.equal(L.tier, 'scene');
    assert.equal(L.export, 'never');
    const kinds = L.object.children.map((c) => c.name);
    assert.deepEqual(kinds, ['plane', 'plane-outline', 'plane', 'plane-outline', 'plane']);
    const [fill, outline, fill2, outline2] = L.object.children;
    assert.equal(`#${fill.material.color.getHexString()}`, '#ff0000');
    assert.equal(fill.material.opacity, 0.22);
    assert.equal(fill.material.side, THREE.DoubleSide);
    assert.equal(fill.material.depthWrite, false);
    assert.equal(fill.geometry.index.count, 6);
    assert.equal(fill2.material.opacity, 0.5);
    assert.equal(outline.material.dashed, false);
    assert.equal(outline2.material.dashed, true);
    assert.equal(outline.geometry.attributes.instanceStart.count, 4, 'four edges');
    L.object.traverse((o) => assert.equal(o.userData.noInk, true));
    assert.deepEqual(L.bounds().center, [1, 1, 3]);
  });

  test('set({polygons}) replaces them and frees the old ones; the resolution follows the view', () => {
    const v = stubViewer(), ov = new Overlays(v);
    const h = ov.add(planeLayer({ id: 'p', polygons: [square(0)] }));
    const old = h.layer.object.children[0];
    let gone = 0;
    old.geometry.addEventListener('dispose', () => { gone++; });
    h.set({ polygons: [square(1), square(2)], width: 3 });
    assert.equal(gone, 1);
    assert.equal(h.layer.object.children.length, 4);
    const outline = h.layer.object.children[1];
    assert.equal(outline.material.linewidth, 3);
    assert.equal(outline.material.resolution, v.resolution);
    assert.equal(h.layer.polygons.length, 2);
    h.set({ polygons: [] });
    assert.equal(h.layer.object.children.length, 0);
    assert.equal(h.layer.bounds(), null);
  });

  test('a fully transparent polygon draws only its outline; bad input is refused', () => {
    const L = planeLayer({ id: 'p', polygons: [square(0, { opacity: 0 })] });
    assert.deepEqual(L.object.children.map((c) => c.name), ['plane-outline']);
    assert.throws(() => planeLayer({ id: 'p', polygons: [{ points: [[0, 0, 0], [1, 0, 0]] }] }), /polygon 0 needs at least 3 points/);
    assert.throws(() => planeLayer({ id: 'p', polygons: [{ points: [[0, 0, 0], [1, 0, 0], [0, 'a', 0]] }] }), /polygon 0, point 2 is not \[x, y, z\]/);
    assert.throws(() => planeLayer({ id: 'p', polygons: [square(0, { color: 'blueish' })] }), /polygon 0 has no valid colour/);
    assert.throws(() => planeLayer({ id: 'p', polygons: [square(0, { opacity: 2 })] }), /opacity must be between 0 and 1/);
    assert.throws(() => planeLayer({ id: 'p', polygons: 'x' }), /polygons must be a list/);
    assert.throws(() => L.set({ colour: 'red' }), /unknown field “colour”/);
  });
});

describe('cellOutlineLayer', () => {
  test('the 12 cell edges from an origin, dashed by default', () => {
    const cell = [[4, 0, 0], [0, 5, 0], [0, 0, 6]];
    const L = cellOutlineLayer({ id: 'c', cell, origin: [1, 2, 3] });
    assert.equal(L.tier, 'scene');
    const line = L.object.children[0];
    assert.equal(line.material.dashed, true);
    assert.equal(line.material.linewidth, 1.6);
    const start = line.geometry.attributes.instanceStart, end = line.geometry.attributes.instanceEnd;
    assert.equal(start.count, 12);
    const want = cellEdges(cell, [1, 2, 3]);
    for (let k = 0; k < 12; k++) {
      assert.ok(close([start.getX(k), start.getY(k), start.getZ(k)], [...want.slice(6 * k, 6 * k + 3)]));
      assert.ok(close([end.getX(k), end.getY(k), end.getZ(k)], [...want.slice(6 * k + 3, 6 * k + 6)]));
    }
    assert.deepEqual(L.bounds().center, [3, 4.5, 6]);
  });

  test('set() moves, recolours and restyles it', () => {
    const L = cellOutlineLayer({ id: 'c', cell: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] });
    L.set({ origin: [10, 0, 0], color: '#00ff00', dashed: false, width: 2.5 });
    const line = L.object.children[0];
    assert.equal(L.object.children.length, 1);
    assert.equal(line.material.dashed, false);
    assert.equal(line.material.linewidth, 2.5);
    assert.equal(`#${line.material.color.getHexString()}`, '#00ff00');
    assert.equal(line.geometry.attributes.instanceStart.getX(0), 10);
    assert.throws(() => cellOutlineLayer({ id: 'c', cell: [[1, 0, 0], [0, 1, 0]] }), /cell must be three vectors/);
    assert.throws(() => L.set({ color: 'greenish' }), /color must be a CSS colour/);
    assert.throws(() => L.set({ cell: [[1, 0, 0], [0, 1, 0], [0, 0, 'z']] }), /cell must be three vectors/);
    assert.throws(() => L.set({ size: 2 }), /unknown field “size”/);
  });
});

describe('ghostLayer', () => {
  /** A viewer stand-in whose buildGhost draws one mesh per call and records the calls. */
  function ghostViewer() {
    const calls = [];
    const v = stubViewer({
      buildGhost(s, opts) {
        calls.push([s.name, opts.opacity]);
        const m = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshStandardMaterial({ transparent: true, opacity: opts.opacity }));
        m.castShadow = true;
        return m;
      },
    });
    return { v, calls };
  }

  test('draws the structure once added, never exported or picked, rebuilt on set() and on a new model', () => {
    const { v, calls } = ghostViewer(), ov = new Overlays(v);
    const L = ghostLayer({ id: 'preview-ghost', structure: { name: 'CO', length: 2 }, export: 'always', pickable: true });
    assert.equal(L.export, 'never');
    assert.equal(L.pickable, false);
    assert.equal(L.object.children.length, 0, 'nothing drawn before it has a viewer');
    const h = ov.add(L);
    assert.deepEqual(calls, [['CO', 0.45]]);
    const ghost = L.object.children[0];
    assert.equal(ghost.userData.noInk, true);
    assert.equal(ghost.castShadow, false);
    let gone = 0;
    ghost.geometry.addEventListener('dispose', () => { gone++; });
    h.set({ structure: { name: 'H2O', length: 3 }, opacity: 0.6 });
    assert.equal(gone, 1);
    assert.deepEqual(calls.at(-1), ['H2O', 0.6]);
    v.emit('model', { n: 4 });
    assert.equal(calls.length, 3, 'a new drawn model (cuts, style) redraws the ghost');
    h.set({ structure: null });
    assert.equal(L.object.children.length, 0);
    assert.throws(() => h.set({ opacity: 0 }), /opacity must be above 0 and at most 1/);
    assert.throws(() => h.set({ colour: 1 }), /unknown field “colour”/);
  });

  test("a failing drawing is logged, not thrown; the layer's own onModel still runs", () => {
    let mine = 0;
    const v = stubViewer({ buildGhost() { throw new Error('bad style'); } });
    const ov = new Overlays(v);
    const [, errors] = quietErrors(() => {
      ov.add(ghostLayer({ id: 'g', structure: { name: 'X', length: 1 }, onModel: () => { mine++; } }));
      v.emit('model', { n: 1 });
    });
    assert.equal(mine, 1);
    assert.ok(errors.some((e) => /ghostLayer “g” failed to draw/.test(e)));
  });
});

describe('textLayer', () => {
  /** A canvas context for drawTextItems: project = (x, y) × 10 px, everything in front of the camera unless z > 50. */
  function ctxFor(g, occupancy = null) {
    return {
      scale: 1, dark: false, font: 'sans-serif', occupancy,
      project: (x, y, z) => [x * 10, y * 10, z > 50 ? 2 : 0],
      text: (t, x, y, size, color, weight) => { g.font = `${weight} ${size}px sans-serif`; g.fillStyle = color; g.fillText(t, x, y); },
    };
  }
  /** A tiny occupancy grid (as Viewer._occupancy): boxes as a list. */
  function grid() {
    const boxes = [];
    return {
      boxes,
      free: (x0, y0, x1, y1) => boxes.every(([a0, b0, a1, b1]) => x1 < a0 || x0 > a1 || y1 < b0 || y0 > b1),
      mark: (x0, y0, x1, y1) => { boxes.push([x0, y0, x1, y1]); },
    };
  }

  test('text at projected points, clear of what is already placed', () => {
    const g = fake2d(), occ = grid();
    occ.mark(95, 95, 105, 105);   // an atom label at (100, 100)
    const placed = drawTextItems(g, ctxFor(g, occ), [
      { position: [10, 10, 0], text: 'x', color: '#ff0000', size: 12, weight: 600 },
      { position: [30, 10, 0], text: 'far', size: 12, weight: 600 },
      { position: [1, 1, 99], text: 'behind', size: 12, weight: 600 },
    ]);
    assert.deepEqual(placed.map((p) => p.text), ['x', 'far']);
    assert.notDeepEqual([placed[0].x, placed[0].y], [100, 100], 'nudged off the label');
    assert.ok(occ.boxes.length === 3, 'placed texts reserve their boxes');
    assert.deepEqual([placed[1].x, placed[1].y], [300, 100]);
    assert.deepEqual(g.texts(), ['x', 'far']);
    assert.equal(g.calls.find((c) => c[0] === 'fillText' && c[1] === 'far')[4], '#14171b', 'default colour: the overlay foreground');
  });

  test('with nowhere free it is drawn where it belongs', () => {
    const g = fake2d(), occ = grid();
    occ.mark(-1000, -1000, 1000, 1000);
    const placed = drawTextItems(g, ctxFor(g, occ), [{ position: [5, 5, 0], text: 'O', size: 12, weight: 600 }]);
    assert.deepEqual([placed[0].x, placed[0].y], [50, 50]);
  });

  test('the layer: canvas tier, export never by default, set({items})', () => {
    const v = stubViewer(), ov = new Overlays(v);
    const L = textLayer({ id: 'axes', items: [{ position: [0, 0, 0], text: 'x' }, { position: [1, 0, 0], text: '' }] });
    assert.equal(L.tier, 'canvas');
    assert.equal(L.export, 'never');
    assert.equal(L.items.length, 1, 'empty texts are dropped');
    const h = ov.add(L);
    const g = fake2d();
    ov.drawCanvas(g, ctxFor(g));
    assert.deepEqual(g.texts(), ['x']);
    const before = v.renders;
    h.set({ items: [{ position: [2, 2, 2], text: 'y', color: '#0000ff', size: 14 }] });
    assert.ok(v.renders > before);
    const g2 = fake2d();
    ov.drawCanvas(g2, ctxFor(g2));
    assert.deepEqual(g2.texts(), ['y']);
    assert.throws(() => textLayer({ id: 't', items: [{ position: [0, 0], text: 'a' }] }), /item 0 needs a position/);
    assert.throws(() => textLayer({ id: 't', items: [{ position: [0, 0, 0], text: 'a', color: 'reddish' }] }), /item 0 has no valid colour/);
    assert.throws(() => textLayer({ id: 't', items: 'abc' }), /items must be a list/);
    assert.throws(() => h.set({ font: 'x' }), /unknown field “font”/);
  });
});
