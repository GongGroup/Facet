// The merged pick, the ray tools and the overlay pointer events (F0-A §3.12.1–3.12.2, §3.11.5; ledger L-F0-40):
// pure geometry on a Viewer prototype instance with a real camera and a hand-made drawn model (the constructor needs
// WebGL, these methods do not).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../crystallume/web/vendor/three/three.module.js';
import { Viewer } from '../../crystallume/web/js/render/viewer.js';
import { Overlays, markerLayer, pickSpheres, PICK_SLACK } from '../../crystallume/web/js/render/overlays.js';
import { makeScene } from '../../crystallume/web/js/render/settings.js';
import { buildDisplayModel } from '../../crystallume/web/js/render/display.js';
import { Structure } from '../../crystallume/web/js/core/structure.js';
import { EVENTS } from '../../crystallume/web/js/api/public.js';
import { quietErrors } from './fake2d.mjs';

/** The canvas: 400 × 300 CSS px at (30, 20) on the page. */
const W = 400, H = 300, LEFT = 30, TOP = 20;
const CX = LEFT + W / 2, CY = TOP + H / 2;   // its centre, where the camera looks
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const nearVec = (v, w, eps = 1e-9) => near(v.x, w[0], eps) && near(v.y, w[1], eps) && near(v.z, w[2], eps);

/**
 * A viewer without a renderer: a camera 20 Å from the origin on +z looking down −z (perspective, fov 30°, or
 * orthographic with a half height of 10 Å), the selection and hover halos, overlays, and the drawn atoms `atoms`
 * [[x, y, z, radius], …] (model.src = `src`, default 0…n−1).
 */
function bareViewer({ ortho = false, atoms = [[0, 0, 0, 0.5]], src = null, tool = 'select' } = {}) {
  const v = Object.create(Viewer.prototype);
  v._h = new Map();   // Emitter
  const rect = { left: LEFT, top: TOP, width: W, height: H, right: LEFT + W, bottom: TOP + H, x: LEFT, y: TOP };
  const cam = ortho ? new THREE.OrthographicCamera((-10 * W) / H, (10 * W) / H, 10, -10, 0.1, 100) : new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  cam.position.set(0, 0, 20);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const n = atoms.length;
  Object.assign(v, {
    renderer: { domElement: { getBoundingClientRect: () => rect } },
    container: { getBoundingClientRect: () => rect, appendChild() {} },
    camera: cam, controls: { target: new THREE.Vector3() }, width: W, height: H,
    root: new THREE.Group(), selection: new Set(), hoverIndex: -1, settings: makeScene(),
    gizmo: { size: 80, pick: () => null }, _tool: tool,
    model: n ? { n, positions: Float32Array.from(atoms.flatMap((a) => a.slice(0, 3))), src: Int32Array.from(src ?? atoms.map((_, i) => i)), symbols: atoms.map(() => 'Pt') } : null,
    radii: Float32Array.from(atoms.map((a) => a[3] ?? 0.5)),
  });
  v._setupHalos();   // as the constructor does (hovering writes the hover halo)
  v.overlays = new Overlays(v);
  return v;
}

/** The page coordinates where world point p is drawn. */
function clientOf(v, p) {
  const [x, y] = v.project(p[0], p[1], p[2], W, H);
  return [LEFT + x, TOP + y];
}

/** A tier A or B layer whose pick reports a hit at distance t on every ray (index 3, item 'x' unless given). */
const fixedLayer = (id, tier, t, extra = {}) => ({ id, tier, object: new THREE.Group(), pickable: true, pick: () => ({ t, index: 3, item: 'x' }), ...extra });

/** A pointer event at page point (x, y). */
const ev = (x, y, mods = {}) => ({ clientX: x, clientY: y, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });

/** Record the events `names` of viewer v as [name, payload]. */
function record(v, names) {
  const log = [];
  for (const name of names) v.on(name, (p) => log.push([name, p]));
  return log;
}

/** Shadow a getter (or a later one) on one instance, e.g. the input lock of a P-swap preview. */
const setOwn = (v, key, value) => Object.defineProperty(v, key, { value, configurable: true, writable: true });

describe('ray: a point of the page to a pick ray', () => {
  test('perspective: from the camera, through the point drawn at that pixel, unit direction', () => {
    const v = bareViewer();
    const r = v.ray(CX, CY);
    assert.ok(r instanceof THREE.Ray);
    assert.ok(nearVec(r.origin, [0, 0, 20]), 'it starts at the camera');
    assert.ok(nearVec(r.direction, [0, 0, -1]), 'the centre of the view looks down −z');
    for (const p of [[2, -1, 3], [-4, 2.5, -6], [0.3, 0.2, 9]]) {
      const [x, y] = clientOf(v, p);
      const q = v.ray(x, y);
      assert.ok(near(q.direction.length(), 1, 1e-12));
      assert.ok(q.distanceToPoint(new THREE.Vector3(...p)) < 1e-9, `the ray through the pixel of ${p} passes through it`);
    }
  });

  test('orthographic: parallel rays from the plane of the camera, each through the point drawn at its pixel', () => {
    const v = bareViewer({ ortho: true });
    const c = v.ray(CX, CY);
    assert.ok(nearVec(c.origin, [0, 0, 20]), 'from the camera position');
    assert.ok(nearVec(c.direction, [0, 0, -1]));
    const p = [3, -2, 1];
    const [x, y] = clientOf(v, p);
    const q = v.ray(x, y);
    assert.ok(nearVec(q.direction, [0, 0, -1]), 'every ray is parallel to the view direction');
    assert.ok(nearVec(q.origin, [3, -2, 20]), 'on the plane through the camera that faces the view');
    v.camera.zoom = 2;
    v.camera.updateProjectionMatrix();
    assert.ok(v.ray(...clientOf(v, p)).distanceToPoint(new THREE.Vector3(...p)) < 1e-9, 'zoom included');
  });

  test('follows the camera without a render in between, and a canvas of no size uses the view size', () => {
    const v = bareViewer();
    v.camera.position.set(20, 0, 0);
    v.camera.lookAt(0, 0, 0);   // no updateMatrixWorld: ray() brings the matrices up to date
    const r = v.ray(CX, CY);
    assert.ok(nearVec(r.origin, [20, 0, 0]) && nearVec(r.direction, [-1, 0, 0]));
    v.renderer.domElement.getBoundingClientRect = () => ({ left: LEFT, top: TOP, width: 0, height: 0, right: LEFT, bottom: TOP });
    const q = v.ray(CX, CY);
    assert.ok([q.origin.x, q.direction.x, q.direction.y, q.direction.z].every(Number.isFinite));
    assert.ok(nearVec(q.direction, [-1, 0, 0]));
  });
});

describe('pickAtomHit and pickAtom', () => {
  test('the nearest drawn atom and the distance to the front of its sphere', () => {
    const v = bareViewer({ atoms: [[0, 0, 0, 0.5], [0, 0, 3, 0.4], [3, 0, 0, 0.5]] });
    const hit = v.pickAtomHit(CX, CY);
    assert.equal(hit.index, 1, 'the atom nearer to the camera');
    assert.ok(near(hit.t, 20 - 3 - 0.4, 1e-6), 'the drawn radius (Float32)');
    const side = v.pickAtomHit(...clientOf(v, [3, 0, 0]));
    assert.equal(side.index, 2);
    assert.ok(near(side.t, Math.hypot(3, 20) - 0.5, 1e-6), 'along a slanted ray: centre distance minus the radius');
    assert.equal(v.pickAtomHit(...clientOf(v, [-3, 0, 0])), null, 'empty space');
    assert.equal(v.pickAtom(CX, CY), 1);
    assert.equal(v.pickAtom(...clientOf(v, [-3, 0, 0])), -1);
  });

  test('a ray of its own; spheres at least 0.22 Å; behind the origin and without a model nothing is hit', () => {
    const v = bareViewer({ atoms: [[0, 0, 0, 0.1]] });
    const ray = new THREE.Ray(new THREE.Vector3(0.2, 0, 5), new THREE.Vector3(0, 0, -1));
    const hit = v.pickAtomHit(0, 0, ray);
    assert.equal(hit.index, 0, 'a small atom is hit within 0.22 Å of its centre');
    assert.ok(near(hit.t, 5 - Math.sqrt(0.22 ** 2 - 0.2 ** 2), 1e-7));
    assert.equal(v.pickAtomHit(0, 0, new THREE.Ray(new THREE.Vector3(0.23, 0, 5), new THREE.Vector3(0, 0, -1))), null);
    assert.equal(v.pickAtomHit(0, 0, new THREE.Ray(new THREE.Vector3(0, 0, -5), new THREE.Vector3(0, 0, -1))), null, 'behind the ray origin');
    v.model = null;
    assert.equal(v.pickAtomHit(CX, CY), null);
    assert.equal(v.pickAtom(CX, CY), -1);
  });

  test('pickAtom is −1 while a preview locks the input; pickAtomHit itself does not look at the lock', () => {
    const v = bareViewer();
    setOwn(v, 'inputLocked', true);
    assert.equal(v.pickAtom(CX, CY), -1);
    assert.equal(v.pick(CX, CY).kind, 'none');
    assert.equal(v.pickAtomHit(CX, CY).index, 0);
  });
});

describe('pick: atoms and overlay layers', () => {
  test('an atom hit: drawn index, the structure atom it draws (model.src), t, point and ray', () => {
    // drawn atom 2 is a periodic image of structure atom 0 (the display's own wrapping and copies, U1)
    const v = bareViewer({ atoms: [[0, 0, 0, 0.5], [2, 0, 0, 0.5], [0, 2.5, 0, 0.5]], src: [0, 1, 0] });
    const hit = v.pick(...clientOf(v, [0, 2.5, 0]));
    assert.equal(hit.kind, 'atom');
    assert.deepEqual([hit.atom.index, hit.atom.src], [2, 0]);
    assert.equal(hit.t, hit.atom.t);
    assert.ok(hit.ray instanceof THREE.Ray);
    assert.ok(hit.point.distanceTo(hit.ray.at(hit.t, new THREE.Vector3())) < 1e-12);
    assert.ok(near(hit.point.distanceTo(new THREE.Vector3(0, 2.5, 0)), 0.5, 1e-6), 'on the sphere of the drawn copy');
    assert.equal(hit.overlay, null);
    const none = v.pick(...clientOf(v, [-3, -3, 0]));
    assert.deepEqual([none.kind, none.t, none.point, none.atom, none.overlay], ['none', Infinity, null, null, null]);
    assert.ok(none.ray instanceof THREE.Ray);
  });

  test('a display model: every drawn copy is picked where it is drawn and maps to the atom it draws', () => {
    // one layer of a periodic structure, seen from above: the boundary copies are drawn next to each other
    const s = new Structure({ symbols: ['Pt', 'Pt'], positions: [[0, 0, 7], [1.4, 1.4, 7]], cell: [[2.8, 0, 0], [0, 2.8, 0], [0, 0, 15]], pbc: [true, true, true] });
    const v = bareViewer({ atoms: [] });
    v.model = buildDisplayModel(s, makeScene().display);
    v.radii = new Float32Array(v.model.n).fill(0.3);
    const m = v.model;
    assert.ok(new Set(m.src).size < m.n, 'some atom is drawn more than once');
    for (let d = 0; d < m.n; d++) {
      const p = [m.positions[3 * d], m.positions[3 * d + 1], m.positions[3 * d + 2]];
      const hit = v.pick(...clientOf(v, p));
      assert.deepEqual([hit.kind, hit.atom.index, hit.atom.src], ['atom', d, m.src[d]], `drawn atom ${d}`);
    }
  });

  test('tier B wins over the atom, even from behind it; the nearest B hit first', () => {
    const v = bareViewer();   // the atom's front is 19.5 Å from the camera
    v.overlays.add(fixedLayer('handles', 'top', 25));
    const hit = v.pick(CX, CY);
    assert.equal(hit.kind, 'overlay');
    assert.deepEqual(hit.overlay, { layer: 'handles', index: 3, item: 'x', t: 25, tier: 'top' });
    assert.equal(hit.t, 25);
    assert.ok(nearVec(hit.point, [0, 0, -5]));
    assert.equal(hit.atom, null, 'atom is set for atom hits only');
    v.overlays.add(fixedLayer('nearer', 'top', 22));
    assert.equal(v.pick(CX, CY).overlay.layer, 'nearer');
  });

  test("depth 'atoms': hidden behind an atom unless within 0.05 Å of its front; kept where no atom is hit", () => {
    assert.equal(PICK_SLACK, 0.05);
    const v = bareViewer();
    const h = v.overlays.add(fixedLayer('sites', 'top', 25, { depth: 'atoms' }));
    assert.equal(v.pick(CX, CY).kind, 'atom', 'behind the atom: the atom');
    h.set({ pick: () => ({ t: 19.5 + 0.04, index: 0 }) });
    assert.equal(v.pick(CX, CY).kind, 'overlay', 'within 0.05 Å of its front');
    h.set({ pick: () => ({ t: 19.5 + 0.06, index: 0 }) });
    assert.equal(v.pick(CX, CY).kind, 'atom', 'beyond 0.05 Å');
    h.set({ pick: () => ({ t: 25, index: 1 }) });
    const away = v.pick(...clientOf(v, [-3, 0, 0]));
    assert.deepEqual([away.kind, away.overlay?.index], ['overlay', 1], 'no atom on the ray: the hit counts');
    assert.equal(v.pick(CX, CY, { atoms: false }).kind, 'overlay', 'atoms left out of the pick');
  });

  test("a depth 'none' layer is drawn over depth 'atoms' layers, so it wins even from farther away", () => {
    const v = bareViewer({ atoms: [] });
    v.overlays.add(fixedLayer('sites', 'top', 10, { depth: 'atoms' }));
    v.overlays.add(fixedLayer('handles', 'top', 12));
    assert.equal(v.pick(CX, CY).overlay.layer, 'handles');
  });

  test('tier A: wins when no farther than 0.05 Å behind the front of the atom; tier B before tier A', () => {
    const v = bareViewer();
    const h = v.overlays.add(fixedLayer('plane', 'scene', 19.5 + 0.04));
    let hit = v.pick(CX, CY);
    assert.deepEqual([hit.kind, hit.overlay.tier], ['overlay', 'scene'], 'a marker on the surface of the atom');
    h.set({ pick: () => ({ t: 19.5 + 0.06 }) });
    assert.equal(v.pick(CX, CY).kind, 'atom');
    h.set({ pick: () => ({ t: 8 }) });
    assert.equal(v.pick(CX, CY).kind, 'overlay', 'in front of the atom');
    h.set({ pick: () => ({ t: 40 }) });
    assert.equal(v.pick(...clientOf(v, [-3, 0, 0])).overlay.layer, 'plane', 'no atom: any distance');
    v.overlays.add(fixedLayer('second', 'scene', 30));
    assert.equal(v.pick(...clientOf(v, [-3, 0, 0])).overlay.layer, 'second', 'the nearest tier A hit');
    h.set({ pick: () => ({ t: 5 }) });
    v.overlays.add(fixedLayer('top', 'top', 35));
    hit = v.pick(CX, CY);
    assert.deepEqual([hit.overlay.layer, hit.overlay.tier], ['top', 'top'], 'a tier B hit before a nearer tier A one');
  });

  test('a real marker layer: analytic ray–sphere hits through pick, with the marker position as item', () => {
    const v = bareViewer();
    v.overlays.add(markerLayer({ id: 'sites', points: [[3, 0, 0], [0, 0, 0.5]], radius: 0.25, tier: 'scene' }));
    const hit = v.pick(...clientOf(v, [3, 0, 0]));
    assert.deepEqual([hit.kind, hit.overlay.layer, hit.overlay.index, hit.overlay.item], ['overlay', 'sites', 0, [3, 0, 0]]);
    const onAtom = v.pick(CX, CY);
    assert.deepEqual([onAtom.kind, onAtom.overlay?.index], ['overlay', 1], 'a marker on the atom, in front of its surface');
    assert.ok(near(onAtom.t, 20 - 0.75, 1e-6));
  });

  test('pickIn: a layer pickable in some tools only; the tool comes from toolProvider when set', () => {
    const v = bareViewer();
    v.overlays.add(fixedLayer('sites', 'top', 25, { pickIn: ['site-pick'] }));
    assert.equal(v.pick(CX, CY).kind, 'atom', 'Select: the sites are not pickable');
    v.tool = 'site-pick';
    assert.equal(v.pick(CX, CY).overlay.layer, 'sites');
    v.toolProvider = () => 'measure';
    assert.equal(v.pick(CX, CY).kind, 'atom');
    v.toolProvider = () => 'site-pick';
    assert.equal(v.pick(CX, CY).kind, 'overlay');
  });

  test('hidden, unpickable and pick-less layers, and overlays: false, are left out; the input lock keeps the overlays', () => {
    const v = bareViewer();
    const a = v.overlays.add(fixedLayer('a', 'top', 25, { visible: false }));
    v.overlays.add(fixedLayer('b', 'top', 25, { pickable: false }));
    v.overlays.add({ id: 'c', tier: 'top', object: new THREE.Group(), pickable: true });
    v.overlays.add({ id: 'd', tier: 'canvas', draw() {}, pickable: true, pick: () => ({ t: 1 }) });
    assert.equal(v.pick(CX, CY).kind, 'atom', 'only visible scene and top layers with pickable and a pick() take part');
    a.setVisible(true);
    assert.equal(v.pick(CX, CY).overlay.layer, 'a');
    const restore = v.overlays.exportScope('thumbnail');
    assert.equal(v.pick(CX, CY).kind, 'atom', 'not while an export hides it');
    restore();
    assert.equal(v.pick(CX, CY, { overlays: false }).kind, 'atom');
    setOwn(v, 'inputLocked', true);
    assert.equal(v.pick(CX, CY).overlay.layer, 'a');
  });

  test("a layer's results are checked: no t ≥ 0, no hit; index 0 and item null by default; a failing pick is reported once", () => {
    const v = bareViewer();
    const h = v.overlays.add(fixedLayer('l', 'top', 25));
    for (const bad of [null, {}, { t: NaN }, { t: -1 }, { t: '5' }, { t: Infinity }]) {
      h.set({ pick: () => bad });
      assert.equal(v.pick(CX, CY).kind, 'atom', JSON.stringify(bad));
    }
    h.set({ pick: () => ({ t: 21, index: -2 }) });
    assert.deepEqual(v.pick(CX, CY).overlay, { layer: 'l', index: 0, item: null, t: 21, tier: 'top' });
    h.set({ pick: () => { throw new Error('boom'); } });
    const [kinds, errors] = quietErrors(() => [v.pick(CX, CY).kind, v.pick(CX, CY).kind]);
    assert.deepEqual(kinds, ['atom', 'atom']);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /overlay “l” pick failed/);
    h.set({ pick: () => { throw new Error('again'); } });
    assert.equal(quietErrors(() => v.pick(CX, CY))[1].length, 1, 'a new pick() is reported again');
  });

  test("a layer's pick gets the ray and ctx {viewer, tool, camera, client and view coordinates, project, worldPerPixel}", () => {
    const v = bareViewer();
    let got = null;
    v.overlays.add({ id: 'probe', tier: 'top', object: new THREE.Group(), pickable: true, pick: (ray, ctx) => { got = { ray, ctx }; return null; } });
    const [x, y] = clientOf(v, [1, 1, 0]);
    const hit = v.pick(x, y);
    assert.equal(got.ray, hit.ray);
    const c = got.ctx;
    assert.deepEqual([c.viewer, c.tool, c.camera, c.clientX, c.clientY, c.width, c.height], [v, 'select', v.camera, x, y, W, H]);
    assert.ok(near(c.x, x - LEFT) && near(c.y, y - TOP));
    const [px, py] = c.project(1, 1, 0);
    assert.ok(near(px, x - LEFT, 1e-9) && near(py, y - TOP, 1e-9), 'project gives view pixels');
    assert.equal(c.worldPerPixel([0, 0, -5]), v.worldPerPixel([0, 0, -5]));
  });

  test('pickSpheres ignores a ray that is not a number (it used to return t NaN)', () => {
    const ray = new THREE.Ray(new THREE.Vector3(0, 0, 5), new THREE.Vector3(NaN, NaN, NaN));
    assert.equal(pickSpheres(ray, [[0, 0, 0]], 0.5), null);
  });
});

describe('pointOnPlane', () => {
  test('the point of the plane under the pointer, whatever the length of the normal', () => {
    const v = bareViewer();
    assert.ok(nearVec(v.pointOnPlane(CX, CY, [0, 0, 0], [0, 0, 1]), [0, 0, 0]));
    const [x, y] = clientOf(v, [2, -1.5, 1]);
    const q = v.pointOnPlane(x, y, new THREE.Vector3(5, 5, 1), { x: 0, y: 0, z: 5 });
    assert.ok(q instanceof THREE.Vector3);
    assert.ok(nearVec(q, [2, -1.5, 1], 1e-9));
    const slanted = v.pointOnPlane(x, y, [0, 0, 0], [1, 1, 1]);
    assert.ok(near(slanted.x + slanted.y + slanted.z, 0, 1e-9), 'on a slanted plane');
    const [sx, sy] = clientOf(v, slanted.toArray());
    assert.ok(near(sx, x, 1e-7) && near(sy, y, 1e-7), 'drawn under the pointer');
  });

  test('null for a plane seen edge-on (|n·d| < 1e-6) and for one behind the camera', () => {
    const v = bareViewer();
    assert.equal(v.pointOnPlane(CX, CY, [0, 0, 0], [1, 0, 0]), null, 'side view');
    assert.equal(v.pointOnPlane(CX, CY, [0, 0, 0], [1, 0, 5e-7]), null, 'within 1e-6 of parallel');
    assert.ok(v.pointOnPlane(CX, CY, [0, 0, 0], [1, 0, 1e-5]) instanceof THREE.Vector3, 'just beyond');
    assert.equal(v.pointOnPlane(CX, CY, [0, 0, 30], [0, 0, 1]), null, 'behind the camera');
    assert.ok(nearVec(v.pointOnPlane(CX, CY, [0, 0, 19], [0, 0, -1]), [0, 0, 19]), 'just in front of it');
  });

  test('orthographic camera, and bad arguments', () => {
    const v = bareViewer({ ortho: true });
    const [x, y] = clientOf(v, [3, 2, 0]);
    assert.ok(nearVec(v.pointOnPlane(x, y, [0, 0, -2], [0, 0, 1]), [3, 2, -2]));
    assert.equal(v.pointOnPlane(x, y, [0, 0, 0], [0, 1, 0]), null);
    assert.throws(() => v.pointOnPlane(x, y, [0, 0, 0], [0, 0, 0]), /normal must not be zero/);
    assert.throws(() => v.pointOnPlane(x, y, [0, 0], [0, 0, 1]), /point must be three numbers/);
    assert.throws(() => v.pointOnPlane(x, y, null, [0, 0, 1]), TypeError);
    assert.throws(() => v.pointOnPlane(x, y, [0, 0, 0], { x: 0, y: 0 }), /normal must be three numbers/);
  });
});

describe('pointOnLine', () => {
  test('dragging along an axis: s is the position on the line under the pointer', () => {
    const v = bareViewer();
    const [x, y] = clientOf(v, [1.5, 0, 0]);
    const q = v.pointOnLine(x, y, [0, 0, 0], [1, 0, 0]);
    assert.ok(near(q.s, 1.5, 1e-9));
    assert.ok(nearVec(q.point, [1.5, 0, 0], 1e-9));
    const twice = v.pointOnLine(x, y, [0, 0, 0], [2, 0, 0]);
    assert.ok(near(twice.s, 0.75, 1e-9) && nearVec(twice.point, [1.5, 0, 0], 1e-9), 's in units of |dir|');
  });

  test('off the line: the closest point, where the connecting segment is perpendicular to line and ray', () => {
    const v = bareViewer();
    const [x, y] = clientOf(v, [1.5, 0.8, -2]);
    const origin = new THREE.Vector3(0.5, -0.2, 0), dir = new THREE.Vector3(1, 0.3, 0.2);
    const q = v.pointOnLine(x, y, origin, dir);
    assert.ok(q.point.distanceTo(origin.clone().addScaledVector(dir, q.s)) < 1e-12);
    const ray = v.ray(x, y);
    const onRay = ray.closestPointToPoint(q.point, new THREE.Vector3());
    const gap = q.point.clone().sub(onRay);
    assert.ok(Math.abs(gap.dot(dir)) < 1e-9 && Math.abs(gap.dot(ray.direction)) < 1e-9);
    const o = bareViewer({ ortho: true });
    const p = o.pointOnLine(...clientOf(o, [2, 0.5, 0]), [0, 0, 0], [1, 0, 0]);
    assert.ok(near(p.s, 2, 1e-9), 'orthographic: straight down onto the axis');
  });

  test('null when the line runs parallel to the ray; bad arguments', () => {
    const v = bareViewer();
    assert.equal(v.pointOnLine(CX, CY, [0, 0, 0], [0, 0, 1]), null);
    assert.equal(v.pointOnLine(CX, CY, [1, 1, 0], [0, 0, -3]), null, 'parallel and apart');
    assert.ok(v.pointOnLine(CX, CY, [0, 0, 0], [1e-5, 0, 1]), 'just off parallel');
    assert.throws(() => v.pointOnLine(CX, CY, [0, 0, 0], [0, 0, 0]), /dir must not be zero/);
    assert.throws(() => v.pointOnLine(CX, CY, 'origin', [1, 0, 0]), /origin must be three numbers/);
  });
});

describe('worldPerPixel', () => {
  test('perspective: 2 · depth · tan(fov / 2) / height, at the target by default', () => {
    const v = bareViewer();
    const expect = (d) => (2 * d * Math.tan((15 * Math.PI) / 180)) / H;
    assert.ok(near(v.worldPerPixel(), expect(20), 1e-12));
    assert.ok(near(v.worldPerPixel([0, 0, -10]), expect(30), 1e-12));
    assert.ok(near(v.worldPerPixel([4, -3, -10]), expect(30), 1e-12), 'the depth along the view, not the distance');
    assert.ok(near(v.worldPerPixel(new THREE.Vector3(0, 0, 5)), expect(15), 1e-12));
  });

  test('it matches what is drawn: 1 Å across the view spans 1 / worldPerPixel pixels; the inverse of the overlay scale', () => {
    for (const ortho of [false, true]) {
      const v = bareViewer({ ortho });
      for (const z of [-6, 0, 7]) {
        const a = v.project(1, 0, z, W, H), b = v.project(2, 0, z, W, H);
        assert.ok(near(b[0] - a[0], 1 / v.worldPerPixel([1, 0, z]), 1e-7), `${ortho ? 'orthographic' : 'perspective'}, z ${z}`);
        assert.ok(near(v.worldPerPixel([0, 0, z]) * v._pxPerAAt([0, 0, z]), 1, 1e-12));
      }
    }
  });

  test('orthographic: (top − bottom) / zoom / height at every depth', () => {
    const v = bareViewer({ ortho: true });
    assert.ok(near(v.worldPerPixel(), 20 / H, 1e-12));
    v.camera.zoom = 2.5;
    v.camera.updateProjectionMatrix();
    assert.ok(near(v.worldPerPixel([0, 0, -40]), 20 / 2.5 / H, 1e-12));
  });
});

describe('pointer events: overlay items instead of atoms', () => {
  /** An atom at the origin, a pickable marker at x = 3 (tier B) and one at y = 3 (another layer). */
  function scene() {
    const v = bareViewer();
    v.overlays.add(markerLayer({ id: 'sites', points: [[3, 0, 0], [3, -2.5, 0]], radius: 0.4 }));
    v.overlays.add(markerLayer({ id: 'handles', points: [[0, 3, 0]], radius: 0.4 }));
    const at = { atom: [CX, CY], site: clientOf(v, [3, 0, 0]), site1: clientOf(v, [3, -2.5, 0]), handle: clientOf(v, [0, 3, 0]), empty: clientOf(v, [-3, -3, 0]) };
    return { v, at };
  }
  const NAMES = ['hover', 'overlayhover', 'atomclick', 'overlayclick', 'atomdblclick', 'overlaydblclick', 'atomcontext', 'overlaycontext'];

  test("click: 'overlayclick' {layer, index, item, x, y, mode} on an overlay item and no 'atomclick'", () => {
    const { v, at } = scene();
    const log = record(v, NAMES);
    const [x, y] = at.site;
    const hit = v._click(ev(x, y, { shiftKey: true }));
    assert.equal(hit.kind, 'overlay');
    assert.deepEqual(log, [['overlayclick', { layer: 'sites', index: 0, item: [3, 0, 0], x: x - LEFT, y: y - TOP, mode: 'add' }]]);
    log.length = 0;
    v._click(ev(...at.atom));
    assert.deepEqual(log, [['atomclick', { index: 0, mode: 'replace', shiftKey: false, x: W / 2, y: H / 2 }]]);
    log.length = 0;
    v._click(ev(...at.empty, { ctrlKey: true }));
    assert.deepEqual(log.map(([n, p]) => [n, p.index, p.mode]), [['atomclick', -1, 'toggle']]);
  });

  test('a layer pickable in another tool only does not take the click', () => {
    const v = bareViewer();
    v.overlays.add(markerLayer({ id: 'sites', points: [[0, 0, 0.6]], pickIn: ['site-pick'] }));
    const log = record(v, NAMES);
    v._click(ev(CX, CY));
    assert.deepEqual(log.map(([n]) => n), ['atomclick']);
    v.tool = 'site-pick';
    v._click(ev(CX, CY));
    assert.deepEqual(log.map(([n]) => n), ['atomclick', 'overlayclick']);
  });

  test("double-click: 'overlaydblclick' on an overlay item, 'atomdblclick' on an atom, nothing on empty space", () => {
    const { v, at } = scene();
    const log = record(v, NAMES);
    v._tap(ev(...at.site));
    v._tap(ev(...at.site));
    const [x, y] = at.site;
    assert.deepEqual(log.map(([n]) => n), ['overlayclick', 'overlayclick', 'overlaydblclick']);
    assert.deepEqual(log[2][1], { layer: 'sites', index: 0, item: [3, 0, 0], x: x - LEFT, y: y - TOP, mode: 'replace' });
    log.length = 0;
    v._tap(ev(...at.atom));
    v._tap(ev(...at.atom, { altKey: true }));
    assert.deepEqual(log.map(([n]) => n), ['atomclick', 'atomclick', 'atomdblclick']);
    assert.deepEqual(log[2][1], { index: 0, mode: 'replace', altKey: true, x: W / 2, y: H / 2 });
    log.length = 0;
    v._tap(ev(...at.empty));
    v._tap(ev(...at.empty));
    assert.deepEqual(log.map(([n]) => n), ['atomclick', 'atomclick']);
  });

  test("right click: 'overlaycontext' (with clientX, clientY) on an overlay item, else 'atomcontext'", () => {
    const { v, at } = scene();
    const log = record(v, NAMES);
    const [x, y] = at.handle;
    v._context(ev(x, y));
    assert.deepEqual(log, [['overlaycontext', { layer: 'handles', index: 0, item: [0, 3, 0], x: x - LEFT, y: y - TOP, mode: 'replace', clientX: x, clientY: y }]]);
    log.length = 0;
    v._context(ev(...at.atom));
    v._context(ev(...at.empty));
    assert.deepEqual(log, [
      ['atomcontext', { index: 0, x: W / 2, y: H / 2, clientX: CX, clientY: CY }],
      ['atomcontext', { index: -1, x: at.empty[0] - LEFT, y: at.empty[1] - TOP, clientX: at.empty[0], clientY: at.empty[1] }],
    ]);
  });

  test("hover: 'overlayhover' on every move over an item, index −1 once the pointer leaves the layer; atoms hover as before", () => {
    const { v, at } = scene();
    const log = record(v, ['hover', 'overlayhover']);
    const names = () => log.map(([n, p]) => `${n}:${p.layer ?? ''}:${p.index}`);
    const active = () => [v.overlays.get('sites').layer.active, v.overlays.get('handles').layer.active];
    v._hoverAt(ev(...at.atom));
    assert.equal(v.hoverIndex, 0);
    assert.equal(v._halo.hover.count, 1, 'the hover halo on the atom');
    v._hoverAt(ev(...at.site));
    assert.deepEqual(active(), [0, -1], 'the marker under the pointer is enlarged');
    v._hoverAt(ev(at.site[0] + 1, at.site[1]));
    assert.equal(v.hoverIndex, -1, 'an overlay item is not an atom hover');
    v._hoverAt(ev(...at.site1));
    assert.deepEqual(active(), [1, -1]);
    v._hoverAt(ev(...at.handle));
    assert.deepEqual(active(), [-1, 0]);
    v._hoverAt(ev(...at.empty));
    assert.deepEqual(active(), [-1, -1]);
    v._hoverAt(ev(...at.empty));
    v._hoverAt(ev(...at.site));
    v._clearHover(ev(...at.empty));
    assert.deepEqual(active(), [-1, -1]);
    assert.deepEqual(names(), [
      'hover::0',
      'overlayhover:sites:0', 'hover::-1',
      'overlayhover:sites:0',
      'overlayhover:sites:1',
      'overlayhover:sites:-1', 'overlayhover:handles:0',
      'overlayhover:handles:-1',
      'overlayhover:sites:0',
      'overlayhover:sites:-1',
    ]);
    const enter = log.find(([n]) => n === 'overlayhover')[1];
    assert.deepEqual(enter, { layer: 'sites', index: 0, item: [3, 0, 0], x: at.site[0] - LEFT, y: at.site[1] - TOP });
    assert.equal(log.find(([n, p]) => n === 'overlayhover' && p.index === -1)[1].item, null);
  });

  test('overlays.hover: a building block with onHover hears of each change; a failing hook is reported', () => {
    const v = bareViewer();
    const seen = [];
    v.overlays.add({ ...fixedLayer('a', 'top', 25), onHover: (i) => seen.push(i) });
    v.overlays.add(fixedLayer('plain', 'top', 26));
    v.overlays.hover('a', 2);
    v.overlays.hover('a', -1);
    v.overlays.hover('plain', 1);
    v.overlays.hover('missing', 0);
    assert.deepEqual(seen, [2, -1]);
    assert.equal(v.overlays.get('a').onHover, undefined, 'a hook, not a method of the handle');
    v.overlays.add({ ...fixedLayer('bad', 'top', 25), onHover: () => { throw new Error('nope'); } });
    const [, errors] = quietErrors(() => v.overlays.hover('bad', 0));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /overlay “bad” onHover failed/);
    // through the pointer: told once per change, not on every move
    seen.length = 0;
    v.overlays.remove('bad');
    v.overlays.remove('plain');
    v._hoverAt(ev(CX, CY));
    v._hoverAt(ev(CX + 1, CY));
    v._clearHover(ev(CX, CY));
    assert.deepEqual(seen, [3, -1]);
  });
});

test('EVENTS lists the overlay events of the viewer', () => {
  const byName = new Map(EVENTS.map((e) => [e.name, e]));
  for (const name of ['overlayhover', 'overlayclick', 'overlaydblclick', 'overlaycontext']) {
    const e = byName.get(name);
    assert.ok(e, name);
    assert.equal(e.source, 'viewer');
    assert.match(e.payload, /\{layer, index, item, x, y/);
    assert.ok(e.description.length > 10);
  }
  assert.match(byName.get('overlaycontext').payload, /clientX, clientY/);
  assert.match(byName.get('overlayclick').payload, /mode/);
});
