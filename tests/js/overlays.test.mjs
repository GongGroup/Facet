// Overlay layers (crystallume/web/js/render/overlays.js): the registry, export policies and the pure helpers
// the viewer uses for named highlights (F0-A §3.10, §3.11; ledger L-F0-37, L-F0-39).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../crystallume/web/vendor/three/three.module.js';
import { LineSegments2 } from '../../crystallume/web/vendor/three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from '../../crystallume/web/vendor/three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from '../../crystallume/web/vendor/three/addons/lines/LineMaterial.js';
import {
  Overlays, TIERS, EXPORT_POLICIES, haloExported, layerExported, isPlainColor, isColorSpec, resolveColor, normalizeHighlight,
  checkHighlightName, highlightIndexSet, haloOrder, remapIndices, unionBounds, pointsBounds, pickSpheres, cellEdges,
  triangulatePolygon, legendRows, haloMaterial, prepareObject, disposeObject, DEFAULT_HIGHLIGHT_COLOR, HALO_ORDER_BASE, LEGEND_FALLBACK_COLOR,
} from '../../crystallume/web/js/render/overlays.js';
import { fake2d, quietErrors } from './fake2d.mjs';

/** What Overlays needs from a viewer: container, resolution, requestRender(), on('model'), halos. */
function stubViewer() {
  const handlers = new Map();
  return {
    container: { kids: [], appendChild(el) { this.kids.push(el); el.parentNode = this; } },
    resolution: new THREE.Vector2(640, 480),
    renders: 0,
    requestRender() { this.renders++; },
    on(type, fn) { handlers.set(type, fn); },
    emit(type, ...a) { handlers.get(type)?.(...a); },
    model: null,
    _halo: {},
    _haloHidden: new Set(),
  };
}
const element = () => ({ hidden: false, parentNode: null, removed: 0, remove() { this.removed++; this.parentNode = null; } });
const mesh = () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
/** Counts 'dispose' events of a material or geometry. */
const disposals = (thing) => { const box = { n: 0 }; thing.addEventListener('dispose', () => { box.n++; }); return box; };
const halo = (exp) => ({ userData: { export: exp } });

describe('export policies', () => {
  test('halos in PNG exports and thumbnails', () => {
    const png = (name, policy, opts) => haloExported('png', name, policy, opts);
    assert.equal(png('select', undefined, {}), true);                      // selection halo: in by default
    assert.equal(png('select', undefined, { selection: false }), false);
    assert.equal(png('hover', 'always', { markers: true }), false);         // hover: never
    assert.equal(png('fixed', 'marker', {}), false);                        // markers: off by default
    assert.equal(png('fixed', 'marker', { markers: true }), true);
    assert.equal(png('fixed', 'never', { markers: true }), false);
    assert.equal(png('fixed', 'always', {}), true);
    for (const [name, policy] of [['select', 'always'], ['hover', 'always'], ['fixed', 'always'], ['fixed', 'marker']]) {
      assert.equal(haloExported('thumbnail', name, policy, { selection: true, markers: true }), false, `${name} in a thumbnail`);
    }
  });

  test('layers in PNG exports and thumbnails', () => {
    assert.equal(layerExported('png', 'never', { markers: true }), false);
    assert.equal(layerExported('png', 'marker', {}), false);
    assert.equal(layerExported('png', 'marker', { markers: true }), true);
    assert.equal(layerExported('png', 'always', {}), true);
    assert.equal(layerExported('png'), false);                             // default policy 'never'
    for (const p of EXPORT_POLICIES) assert.equal(layerExported('thumbnail', p, { markers: true }), false);
  });
});

describe('Overlays registry', () => {
  test('a scene layer is mounted under the scene group and follows the tier A rules', () => {
    const v = stubViewer(), ov = new Overlays(v);
    const g = new THREE.Group(), m = mesh();
    m.castShadow = m.receiveShadow = true;
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(), new THREE.MeshStandardMaterial(), 4);
    const lg = new LineSegmentsGeometry();
    lg.setPositions([0, 0, 0, 1, 1, 1]);
    const line = new LineSegments2(lg, new LineMaterial({ linewidth: 2 }));
    g.add(m, inst, line);
    const h = ov.add({ id: 'a', tier: 'scene', object: g });
    assert.equal(g.parent, ov.sceneGroup);
    g.traverse((o) => { assert.equal(o.userData.noInk, true); assert.equal(o.castShadow, false); assert.equal(o.receiveShadow, false); });
    assert.equal(m.material.fog, false);
    assert.equal(inst.material.fog, false);
    assert.equal(inst.frustumCulled, false);
    assert.equal(line.material.resolution, v.resolution, 'fat lines share the view resolution');
    assert.ok(v.renders > 0);
    assert.equal(ov.get('a'), h);
    assert.equal(h.id, 'a');
    assert.equal(h.tier, 'scene');
    assert.equal(h.layer.object, g);
    assert.deepEqual(ov.list().map((l) => [l.id, l.tier, l.export, l.visible]), [['a', 'scene', 'never', true]]);
  });

  test('top layers: depth none over everything, depth atoms in the group after the depth pre-pass', () => {
    const ov = new Overlays(stubViewer());
    const a = mesh(), b = mesh();
    ov.add({ id: 'free', tier: 'top', object: a });
    const hb = ov.add({ id: 'hid', tier: 'top', object: b, depth: 'atoms' });
    assert.equal(a.parent, ov.topFree);
    assert.equal(b.parent, ov.topAtoms);
    assert.deepEqual(ov.topState(), { any: true, atoms: true });
    hb.set({ depth: 'none' });
    assert.equal(b.parent, ov.topFree);
    assert.deepEqual(ov.topState(), { any: true, atoms: false });
    ov.get('free').setVisible(false); hb.setVisible(false);
    assert.deepEqual(ov.topState(), { any: false, atoms: false });
    assert.equal(a.visible, false);
  });

  test('the same id replaces the old layer, which is disposed', () => {
    const ov = new Overlays(stubViewer());
    const first = mesh(), second = mesh();
    const gone = disposals(first.geometry), matGone = disposals(first.material);
    const h1 = ov.add({ id: 'x', tier: 'scene', object: first });
    const h2 = ov.add({ id: 'x', tier: 'scene', object: second });
    assert.equal(gone.n, 1);
    assert.equal(matGone.n, 1);
    assert.equal(first.parent, null);
    assert.equal(second.parent, ov.sceneGroup);
    assert.equal(h1.removed, true);
    assert.equal(h2.removed, false);
    h1.remove();                                   // a stale handle does not touch the new layer
    assert.equal(ov.get('x'), h2);
    assert.equal(ov.list().length, 1);
  });

  test('a layer dispose() replaces the default disposal', () => {
    const ov = new Overlays(stubViewer());
    const m = mesh(), gone = disposals(m.geometry);
    let custom = 0;
    ov.add({ id: 'c', tier: 'scene', object: m, dispose: () => { custom++; } });
    assert.equal(ov.remove('c'), true);
    assert.equal(custom, 1);
    assert.equal(gone.n, 0);
    assert.equal(m.parent, null, 'still taken out of the scene');
    assert.equal(ov.remove('c'), false);
  });

  test('removeOwner and switched', () => {
    const ov = new Overlays(stubViewer());
    ov.add({ id: 'a', tier: 'scene', object: mesh(), owner: 'm5-sites' });
    ov.add({ id: 'b', tier: 'scene', object: mesh(), owner: 'm5-sites' });
    ov.add({ id: 'c', tier: 'scene', object: mesh(), owner: 'm2' });
    ov.add({ id: 'keep', tier: 'canvas', draw() {}, clearOnSwitch: false });
    assert.equal(ov.removeOwner(null), 0);
    assert.equal(ov.removeOwner('m5-sites'), 2);
    assert.deepEqual(ov.list().map((l) => l.id), ['c', 'keep']);
    ov.switched();
    assert.deepEqual(ov.list().map((l) => l.id), ['keep']);
  });

  test('invalid layers are refused with a message', () => {
    const ov = new Overlays(stubViewer());
    const bad = [
      [null, /pass a layer object/],
      [{ tier: 'scene', object: mesh() }, /needs an id/],
      [{ id: ' ', tier: 'scene', object: mesh() }, /needs an id/],
      [{ id: 'a', tier: 'floor', object: mesh() }, /tier must be one of scene, top, canvas, dom, legend/],
      [{ id: 'a', tier: 'scene' }, /a scene layer needs a THREE.Object3D/],
      [{ id: 'a', tier: 'scene', object: {} }, /object must be a THREE.Object3D/],
      [{ id: 'a', tier: 'top', object: mesh(), depth: 'below' }, /depth must be 'none' or 'atoms'/],
      [{ id: 'a', tier: 'scene', object: mesh(), depth: 'atoms' }, /depth applies to top layers only/],
      [{ id: 'a', tier: 'canvas' }, /a canvas layer needs draw/],
      [{ id: 'a', tier: 'canvas', draw: 'x' }, /draw must be a function/],
      [{ id: 'a', tier: 'legend' }, /a legend layer needs items/],
      [{ id: 'a', tier: 'dom' }, /a dom layer needs an element/],
      [{ id: 'a', tier: 'dom', el: {} }, /el must be an element/],
      [{ id: 'a', tier: 'canvas', draw() {}, export: 'png' }, /export must be never, marker or always/],
      [{ id: 'a', tier: 'canvas', draw() {}, pickIn: 'move' }, /pickIn must be a list of tool ids/],
      [{ id: 'a', tier: 'canvas', draw() {}, order: 'first' }, /order must be a number/],
      [{ id: 'a', tier: 'canvas', draw() {}, bounds: 5 }, /bounds must be a function/],
    ];
    for (const [spec, re] of bad) assert.throws(() => ov.add(spec), re, JSON.stringify(spec));
    assert.equal(ov.list().length, 0, 'nothing was added');
  });

  test('handle.set changes fields; keys of another tier go to the building block', () => {
    const v = stubViewer(), ov = new Overlays(v);
    const a = mesh(), b = mesh();
    const h = ov.add({ id: 'a', tier: 'scene', object: a });
    h.set({ export: 'marker', order: 3, pickable: true, pickIn: ['site-pick'] });
    assert.deepEqual(ov.list()[0], { id: 'a', tier: 'scene', owner: null, export: 'marker', visible: true, depth: 'none', pickable: true, clearOnSwitch: true });
    const gone = disposals(a.geometry);
    h.set({ object: b });
    assert.equal(b.parent, ov.sceneGroup);
    assert.equal(a.parent, null);
    assert.equal(gone.n, 1);
    assert.equal(b.userData.noInk, true);
    assert.throws(() => h.set({ tier: 'top' }), /tier cannot change/);
    assert.throws(() => h.set({ polygons: [] }), /unknown field “polygons”/);
    assert.throws(() => h.set({ items: [] }), /unknown field “items”/, 'items is a legend field only');
    // a building block's own set() takes the other keys
    const seen = [];
    const hb = ov.add({ id: 'b', tier: 'canvas', draw() {}, set(p) { seen.push(p); } });
    hb.set({ items: [1], visible: false });
    assert.deepEqual(seen, [{ items: [1] }]);
    assert.equal(hb.visible, false);
  });

  test('building-block methods are forwarded by the handle with a redraw', () => {
    const v = stubViewer(), ov = new Overlays(v);
    let got = null;
    const h = ov.add({ id: 'b', tier: 'scene', object: mesh(), setPoints(p) { got = p; return 'ok'; }, attach() {}, onTheme() {} });
    const before = v.renders;
    assert.equal(h.setPoints([1]), 'ok');
    assert.deepEqual(got, [1]);
    assert.ok(v.renders > before);
    assert.equal(h.attach, undefined, 'hooks are not forwarded');
    assert.equal(h.onTheme, undefined);
  });

  test('dom layers: placed in the container, hidden with setVisible, never touched by exports', () => {
    const v = stubViewer(), ov = new Overlays(v);
    const e1 = element(), e2 = element();
    const h = ov.add({ id: 'd', tier: 'dom', el: e1 });
    assert.equal(e1.parentNode, v.container);
    h.setVisible(false);
    assert.equal(e1.hidden, true);
    h.setVisible(true);
    const restore = ov.exportScope('thumbnail');
    assert.equal(e1.hidden, false);
    restore();
    h.set({ el: e2 });
    assert.equal(e1.removed, 1);
    assert.equal(e2.parentNode, v.container);
    h.remove();
    assert.equal(e2.removed, 1);
  });

  test('exportScope hides halos and layers by policy and restores them', () => {
    const v = stubViewer(), ov = new Overlays(v);
    v._halo = { select: halo(), hover: halo(), fixed: halo('marker'), note: halo('always'), quiet: halo('never') };
    v._haloHidden.add('quiet');   // already hidden before the export: stays hidden after it
    const objs = Object.fromEntries(['never', 'marker', 'always'].map((p) => [p, mesh()]));
    for (const [p, o] of Object.entries(objs)) ov.add({ id: p, tier: 'top', object: o, export: p });
    const draws = [];
    ov.add({ id: 'cv', tier: 'canvas', export: 'marker', draw: () => draws.push('cv') });
    ov.add({ id: 'lg', tier: 'legend', export: 'always', items: () => [{ label: 'Fixed (2)', swatch: { kind: 'halo', color: '#2563eb' } }] });
    const shown = () => Object.entries(objs).filter(([, o]) => o.visible).map(([p]) => p);

    let restore = ov.exportScope('png');
    assert.deepEqual([...v._haloHidden].sort(), ['fixed', 'hover', 'quiet']);
    assert.deepEqual(shown(), ['always']);
    ov.drawCanvas(fake2d(), {});
    assert.deepEqual(draws, []);
    assert.equal(ov.legendItems().length, 1);
    restore();
    assert.deepEqual([...v._haloHidden], ['quiet']);
    assert.deepEqual(shown(), ['never', 'marker', 'always']);

    restore = ov.exportScope('png', { selection: false, markers: true });
    assert.deepEqual([...v._haloHidden].sort(), ['hover', 'quiet', 'select']);
    assert.deepEqual(shown(), ['marker', 'always']);
    ov.drawCanvas(fake2d(), {});
    assert.deepEqual(draws, ['cv']);
    restore();
    restore();   // a second call does nothing

    restore = ov.exportScope('thumbnail', { selection: true, markers: true });
    assert.deepEqual([...v._haloHidden].sort(), ['fixed', 'hover', 'note', 'quiet', 'select']);
    assert.deepEqual(shown(), []);
    assert.equal(ov.legendItems().length, 0);
    restore();
    assert.deepEqual([...v._haloHidden], ['quiet']);
    assert.deepEqual(shown(), ['never', 'marker', 'always']);
    assert.throws(() => ov.exportScope('glb'), /kind must be 'png' or 'thumbnail'/);
  });

  test('a layer hidden by the user stays hidden after an export scope', () => {
    const ov = new Overlays(stubViewer());
    const o = mesh();
    const h = ov.add({ id: 'a', tier: 'scene', object: o, export: 'never' });
    h.setVisible(false);
    const restore = ov.exportScope('png');
    restore();
    assert.equal(o.visible, false);
    h.setVisible(true);
    assert.equal(o.visible, true);
  });

  test('canvas layers draw in order with their own canvas state; a failing one does not stop the others', () => {
    const ov = new Overlays(stubViewer());
    const seen = [];
    ov.add({ id: 'late', tier: 'canvas', order: 5, draw: (g, ctx) => seen.push(['late', ctx.markers]) });
    ov.add({ id: 'boom', tier: 'canvas', draw: () => { throw new Error('x'); } });
    ov.add({ id: 'early', tier: 'canvas', order: -1, draw: (g) => { g.save(); seen.push(['early']); } });   // unbalanced save
    ov.add({ id: 'off', tier: 'canvas', visible: false, draw: () => seen.push(['off']) });
    const g = fake2d();
    const [, errors] = quietErrors(() => ov.drawCanvas(g, { markers: true }));
    assert.deepEqual(seen, [['early'], ['late', true]]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /overlay “boom” failed to draw/);
    assert.equal(g.depth, 1, 'each layer runs between save() and restore()');
  });

  test('legend layers give cleaned rows in layer order', () => {
    const ov = new Overlays(stubViewer());
    ov.add({ id: 'b', tier: 'legend', order: 2, items: () => [{ label: 'Sites (54)', swatch: { kind: 'dot', color: '#e64980' } }] });
    ov.add({ id: 'a', tier: 'legend', order: 1, items: () => [{ label: 'Fixed (18)', swatch: { kind: 'halo', color: '#2563eb', opacity: 2 } }, { label: '' }, null] });
    ov.add({ id: 'c', tier: 'legend', items: () => { throw new Error('no'); } });
    ov.add({ id: 'd', tier: 'legend', items: () => null });
    const [rows] = quietErrors(() => ov.legendItems());
    assert.deepEqual(rows, [
      { label: 'Fixed (18)', swatch: { kind: 'halo', color: '#2563eb', opacity: 1, dashed: false } },
      { label: 'Sites (54)', swatch: { kind: 'dot', color: '#e64980', opacity: 1, dashed: false } },
    ]);
  });

  test('onModel runs once per new model, with the viewer', () => {
    const v = stubViewer(), ov = new Overlays(v);
    const calls = [];
    ov.add({ id: 'a', tier: 'canvas', draw() {}, onModel: (m, viewer) => calls.push([m.n, viewer === v]) });
    ov.add({ id: 'b', tier: 'canvas', draw() {}, onModel: () => { throw new Error('x'); } });
    const m1 = { n: 1 }, m2 = { n: 2 };
    const [, errors] = quietErrors(() => { v.emit('model', m1); v.emit('model', m1); v.emit('model', m2); });
    assert.deepEqual(calls, [[1, true], [2, true]]);
    assert.equal(errors.length, 2);
  });

  test('beforeRender reaches the visible layers only', () => {
    const ov = new Overlays(stubViewer());
    const seen = [];
    ov.add({ id: 'a', tier: 'top', object: mesh(), beforeRender: (ctx) => seen.push(['a', ctx.width]) });
    ov.add({ id: 'b', tier: 'top', object: mesh(), visible: false, beforeRender: () => seen.push(['b']) });
    ov.beforeRender({ width: 640 });
    assert.deepEqual(seen, [['a', 640]]);
  });

  test('clipping bounds hold the model and the visible layers', () => {
    const ov = new Overlays(stubViewer());
    const base = { center: new THREE.Vector3(0, 0, 0), radius: 5 };
    assert.equal(ov.clipBounds(base), base, 'no layer bounds: the model bounds as they are');
    ov.add({ id: 'far', tier: 'scene', object: mesh(), bounds: () => ({ center: [20, 0, 0], radius: 1 }) });
    ov.add({ id: 'none', tier: 'scene', object: mesh(), bounds: () => null });
    const b = ov.clipBounds(base);
    assert.ok(b.center.isVector3);
    assert.ok(Math.abs(b.radius - 13) < 1e-9);
    assert.ok(Math.abs(b.center.x - 8) < 1e-9);
    ov.get('far').setVisible(false);
    assert.equal(ov.clipBounds(base), base);
  });

  test('pickables: visible, pickable layers with a pick(), filtered by tool', () => {
    const ov = new Overlays(stubViewer());
    const pick = () => null;
    ov.add({ id: 'sites', tier: 'top', object: mesh(), pickable: true, pick, pickIn: ['site-pick'] });
    ov.add({ id: 'handles', tier: 'top', object: mesh(), pickable: true, pick });
    ov.add({ id: 'nopick', tier: 'top', object: mesh(), pickable: false, pick });
    ov.add({ id: 'nofn', tier: 'top', object: mesh(), pickable: true });
    assert.deepEqual(ov.pickables('select').map((p) => p.id), ['handles']);
    assert.deepEqual(ov.pickables('site-pick').map((p) => p.id), ['sites', 'handles']);
    ov.get('handles').setVisible(false);
    assert.deepEqual(ov.pickables('site-pick').map((p) => p.id), ['sites']);
    assert.equal(ov.pickables('site-pick')[0].handle, ov.get('sites'));
  });

  test('theme(dark) reaches the building blocks, also those added later', () => {
    const ov = new Overlays(stubViewer());
    const seen = [];
    ov.add({ id: 'a', tier: 'scene', object: mesh(), onTheme: ({ dark }) => seen.push(['a', dark]) });
    ov.theme(true);
    ov.add({ id: 'b', tier: 'scene', object: mesh(), onTheme: ({ dark }) => seen.push(['b', dark]) });
    assert.deepEqual(seen, [['a', true], ['b', true]]);
  });

  test('attach(viewer, handle) runs once the layer is added; dispose() empties the registry', () => {
    const v = stubViewer(), ov = new Overlays(v);
    let got = null;
    const h = ov.add({ id: 'a', tier: 'scene', object: mesh(), attach: (viewer, handle) => { got = [viewer, handle]; } });
    assert.deepEqual(got, [v, h]);
    ov.add({ id: 'b', tier: 'legend', items: () => [] });
    ov.dispose();
    assert.deepEqual(ov.list(), []);
  });

  test('the tiers', () => {
    assert.deepEqual([...TIERS], ['scene', 'top', 'canvas', 'dom', 'legend']);
  });
});

describe('highlight helpers', () => {
  test('colour specs', () => {
    for (const c of ['#abc', '#2563EB', 'rgb(37, 99, 235)', 'rgba(1,2,3,0.5)', 'hsl(220, 80%, 50%)', 'red', ' Navy ']) assert.equal(isPlainColor(c), true, c);
    for (const c of ['#ab', '#12345', 'blue-ish', '', 5, null, 'var(--accent)']) assert.equal(isPlainColor(c), false, String(c));
    for (const c of ['#c93636', 'var(--constraint)', 'var(--constraint, #2563eb)', { light: '#2563eb', dark: '#7aa2ff' }, { light: 'var(--a)' }]) assert.equal(isColorSpec(c), true, JSON.stringify(c));
    for (const c of [{}, { light: 3 }, { other: '#fff' }, 'var(--x, nope)', 'var(x)', ['#fff'], null]) assert.equal(isColorSpec(c), false, JSON.stringify(c));
  });

  test('resolveColor: {light, dark} by the background, tokens through the page CSS, else the fallback', () => {
    const css = (name) => ({ '--constraint': ' #2563eb ', '--empty': '', '--bad': 'calc(1px)' }[name] ?? '');
    const both = { light: '#2563eb', dark: '#7aa2ff' };
    assert.equal(resolveColor(both, { dark: false }), '#2563eb');
    assert.equal(resolveColor(both, { dark: true }), '#7aa2ff');
    assert.equal(resolveColor({ light: '#111111' }, { dark: true }), '#111111', 'one side only');
    assert.equal(resolveColor('var(--constraint)', { css }), '#2563eb');
    assert.equal(resolveColor('var(--empty, #abcdef)', { css }), '#abcdef');
    assert.equal(resolveColor('var(--bad)', { css, fallback: '#000000' }), '#000000');
    assert.equal(resolveColor('var(--constraint)', { css: () => { throw new Error('no DOM'); }, fallback: '#7a4fd6' }), '#7a4fd6');
    assert.equal(resolveColor({ light: 'var(--constraint)', dark: '#ffffff' }, { css }), '#2563eb');
    assert.equal(resolveColor('nonsense', { fallback: '#123456' }), '#123456');
    assert.equal(resolveColor(' rgb(1, 2, 3) '), 'rgb(1, 2, 3)');
  });

  test('normalizeHighlight: defaults per call, checked options', () => {
    assert.deepEqual(normalizeHighlight('fixed'), { color: DEFAULT_HIGHLIGHT_COLOR, grow: 1.15, opacity: 1, strength: 1.4, contrast: true, export: 'marker' });
    assert.deepEqual(normalizeHighlight('q', { color: 'var(--q)', grow: 1.18, opacity: 0.5, strength: 0.7, contrast: false, export: 'never' }),
      { color: 'var(--q)', grow: 1.18, opacity: 0.5, strength: 0.7, contrast: false, export: 'never' });
    assert.throws(() => normalizeHighlight('f', { color: 'blueish' }), /Highlight “f”: color must be a CSS colour/);
    assert.throws(() => normalizeHighlight('f', { grow: 0 }), /grow must be a number above 0/);
    assert.throws(() => normalizeHighlight('f', { grow: '1.2' }), /grow must be a number above 0/);
    assert.throws(() => normalizeHighlight('f', { opacity: 1.5 }), /opacity must be between 0 and 1/);
    assert.throws(() => normalizeHighlight('f', { strength: -1 }), /strength must be 0 or more/);
    assert.throws(() => normalizeHighlight('f', { export: 'png' }), /export must be never, marker or always/);
  });

  test('names and indices', () => {
    assert.equal(checkHighlightName('fixed'), 'fixed');
    assert.throws(() => checkHighlightName('select'), /viewer's own halo/);
    assert.throws(() => checkHighlightName('hover'), /viewer's own halo/);
    assert.throws(() => checkHighlightName(''), /needs a name/);
    assert.throws(() => checkHighlightName(3), /needs a name/);
    assert.deepEqual([...highlightIndexSet('f', [3, 1, 3])], [3, 1]);
    assert.deepEqual([...highlightIndexSet('f', new Set([2]))], [2]);
    assert.deepEqual([...highlightIndexSet('f', new Int32Array([5, 0]))], [5, 0]);
    assert.throws(() => highlightIndexSet('f', [1, -1]), /whole numbers ≥ 0 \(got -1\)/);
    assert.throws(() => highlightIndexSet('f', [1.5]), /whole numbers ≥ 0/);
    assert.throws(() => highlightIndexSet('f', ['1']), /got string/);
    assert.throws(() => highlightIndexSet('f', 4), /pass atom indices as an array/);
    assert.throws(() => highlightIndexSet('f', '12'), /pass atom indices as an array/);
  });

  test('halo order: the smallest grow first, ties by name, before the measurement lines', () => {
    const order = haloOrder([{ name: 'hover', grow: 1.32 }, { name: 'select', grow: 1.25 }, { name: 'query', grow: 1.18 }, { name: 'layer', grow: 1.18 }, { name: 'fixed', grow: 1.12 }]);
    assert.deepEqual([...order.keys()], ['fixed', 'layer', 'query', 'select', 'hover']);
    assert.equal(order.get('fixed'), HALO_ORDER_BASE);
    assert.ok([...order.values()].every((v, k, a) => k === 0 || v > a[k - 1]));
    const many = haloOrder(Array.from({ length: 150 }, (_, k) => ({ name: `h${k}`, grow: 1 + k / 1000 })));
    assert.ok(Math.max(...many.values()) < 20, 'measurement lines (20) stay on top');
  });

  test('remapIndices after an edit', () => {
    // atoms 0..4; atom 2 deleted, the rest shifted down
    const map = [0, 1, -1, 2, 3];
    assert.deepEqual([...remapIndices(new Set([1, 2, 4]), map)], [1, 3]);
    assert.deepEqual([...remapIndices([0, 3], Int32Array.from([4, -1, 0, 0]))], [4, 0]);
    assert.deepEqual([...remapIndices([0, 1, 9], [null, undefined])], []);
  });

  test('haloMaterial: a back-face rim with the two-colour switch', () => {
    const m = haloMaterial({ strength: 0.7, contrast: false, opacity: 0.5 });
    assert.equal(m.side, THREE.BackSide);
    assert.equal(m.transparent, true);
    assert.equal(m.depthWrite, false);
    assert.equal(m.uniforms.strength.value, 0.7);
    assert.equal(m.uniforms.contrast.value, 0);
    assert.equal(m.uniforms.opacity.value, 0.5);
    assert.equal(m.uniforms.edgeAlpha.value, 0.65);
    assert.match(m.vertexShader, /instanceColor\.r/);
    assert.equal(haloMaterial().uniforms.contrast.value, 1);
  });
});

describe('geometry helpers', () => {
  test('unionBounds and pointsBounds', () => {
    assert.equal(unionBounds([]), null);
    assert.deepEqual(unionBounds([{ center: [0, 0, 0], radius: 5 }, { center: [1, 0, 0], radius: 1 }]), { center: [0, 0, 0], radius: 5 });
    assert.deepEqual(unionBounds([{ center: [1, 0, 0], radius: 1 }, { center: { x: 0, y: 0, z: 0 }, radius: 5 }]), { center: [0, 0, 0], radius: 5 });
    // from x = −1 to x = 12
    const u = unionBounds([{ center: [0, 0, 0], radius: 1 }, { center: [10, 0, 0], radius: 2 }, { center: [NaN, 0, 0], radius: 1 }, null]);
    assert.ok(Math.abs(u.radius - 6.5) < 1e-12);
    assert.ok(Math.abs(u.center[0] - 5.5) < 1e-12);
    assert.equal(pointsBounds([]), null);
    const b = pointsBounds(Float32Array.from([0, 0, 0, 2, 0, 0, 0, 2, 0]), 0.5);
    assert.deepEqual(b.center, [1, 1, 0]);
    assert.ok(Math.abs(b.radius - (Math.SQRT2 + 0.5)) < 1e-6);
  });

  test('pickSpheres: the nearest sphere in front of the ray', () => {
    const ray = new THREE.Ray(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
    const pts = Float32Array.from([0, 0, 0, 0, 0, 5, 3, 0, 0, 0, 0, 20]);
    assert.deepEqual(pickSpheres(ray, pts, 0.5), { t: 4.5, index: 1 });
    assert.equal(pickSpheres(ray, [[3, 0, 0]], 0.5), null);
    assert.equal(pickSpheres(ray, [[0, 0, 20]], 0.5), null, 'behind the ray origin');
    const inside = pickSpheres(new THREE.Ray(new THREE.Vector3(0, 0, 0.1), new THREE.Vector3(0, 0, -1)), [[0, 0, 0]], 0.5);
    assert.ok(Math.abs(inside.t - 0.6) < 1e-12, 'from inside: where the ray leaves the sphere');
    assert.deepEqual(pickSpheres(ray, [[0.8, 0, 0], [0, 0, -3]], 0.5, (i) => (i === 0 ? 2 : 1)).index, 0);
  });

  test('cellEdges: the 12 edges of the unit cell', () => {
    const cell = [[3, 0, 0], [1, 2, 0], [0, 0, 4]];
    const e = cellEdges(cell, [1, 1, 1]);
    assert.equal(e.length, 72);
    assert.deepEqual([...e.slice(0, 6)], [1, 1, 1, 4, 1, 1]);
    const lengths = [];
    for (let k = 0; k < 72; k += 6) lengths.push(Math.hypot(e[k + 3] - e[k], e[k + 4] - e[k + 1], e[k + 5] - e[k + 2]));
    assert.deepEqual(lengths.map((l) => +l.toFixed(6)).sort(), [3, 3, 3, 3, 4, 4, 4, 4, Math.sqrt(5), Math.sqrt(5), Math.sqrt(5), Math.sqrt(5)].map((l) => +l.toFixed(6)).sort());
  });

  test('triangulatePolygon: convex and concave polygons in any plane', () => {
    const area = ({ positions: p, index }) => {
      let a = 0;
      for (let k = 0; k < index.length; k += 3) {
        const [i, j, l] = index.slice(k, k + 3).map((v) => new THREE.Vector3(p[3 * v], p[3 * v + 1], p[3 * v + 2]));
        a += new THREE.Vector3().subVectors(j, i).cross(new THREE.Vector3().subVectors(l, i)).length() / 2;
      }
      return a;
    };
    const tri = triangulatePolygon([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    assert.equal(tri.index.length, 3);
    const quad = triangulatePolygon([[0, 0, 2], [2, 0, 2], [2, 0, 5], [0, 0, 5]]);   // in the xz plane
    assert.equal(quad.index.length, 6);
    assert.ok(Math.abs(area(quad) - 6) < 1e-6);
    const L = triangulatePolygon([[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]]);
    assert.equal(L.index.length, 12);
    assert.ok(Math.abs(area(L) - 3) < 1e-6);
    assert.deepEqual(triangulatePolygon([[0, 0, 0], [1, 1, 1], [2, 2, 2]]).index, [], 'collinear: no triangles');
  });

  test('legendRows cleans swatches', () => {
    assert.deepEqual(legendRows([{ label: 7, swatch: { kind: 'star', color: 'bad', opacity: -1 } }, { label: 'L', swatch: { kind: 'line', color: '#fff', dashed: 1 } }]), [
      { label: '7', swatch: { kind: 'dot', color: LEGEND_FALLBACK_COLOR, opacity: 0, dashed: false } },
      { label: 'L', swatch: { kind: 'line', color: '#fff', opacity: 1, dashed: true } },
    ]);
    assert.deepEqual(legendRows('nope'), []);
    assert.equal(LEGEND_FALLBACK_COLOR, '#9aa0a6');
  });

  test('legendRows takes the colour specs highlights take: {light, dark} by the background, tokens through css', () => {
    const css = (name) => ({ '--constraint': '#2563eb' })[name] ?? '';
    const colors = (opts) => legendRows([
      { label: 'Fixed', swatch: { kind: 'halo', color: { light: '#2563eb', dark: '#7aa2ff' } } },
      { label: 'Token', swatch: { kind: 'halo', color: ' var(--constraint) ' } },
      { label: 'Token with a fallback', swatch: { kind: 'dot', color: 'var(--unset, #0f9d8a)' } },
      { label: 'Both', swatch: { kind: 'line', color: { light: 'var(--constraint)', dark: '#ffffff' } } },
      { label: 'No colour', swatch: { kind: 'line' } },
    ], opts).map((r) => r.swatch.color);
    assert.deepEqual(colors(), ['#2563eb', '#9aa0a6', '#0f9d8a', '#9aa0a6', '#9aa0a6'], 'without a css reader tokens cannot be read');
    assert.deepEqual(colors({ css }), ['#2563eb', '#2563eb', '#0f9d8a', '#2563eb', '#9aa0a6']);
    assert.deepEqual(colors({ dark: true, css }), ['#7aa2ff', '#2563eb', '#0f9d8a', '#ffffff', '#9aa0a6']);
  });

  test('legend layers resolve swatch colours with the viewer’s background and CSS reader unless given others', () => {
    const v = stubViewer();
    v._cssToken = (name) => (name === '--constraint' ? '#2563eb' : '');
    const ov = new Overlays(v);
    ov.add({ id: 'k', tier: 'legend', items: () => [{ label: 'Fixed (2)', swatch: { kind: 'halo', color: { light: 'var(--constraint)', dark: '#7aa2ff' } } }] });
    const color = (opts) => ov.legendItems(opts)[0].swatch.color;
    assert.equal(color(), '#2563eb');
    v.overlayDark = true;
    assert.equal(color(), '#7aa2ff');
    assert.equal(color({ dark: false, css: () => '#123456' }), '#123456');
    delete v._cssToken;
    assert.equal(color({ dark: false }), LEGEND_FALLBACK_COLOR, 'no reader: the fallback');
  });

  test('prepareObject and disposeObject', () => {
    const g = new THREE.Group(), m = mesh();
    m.castShadow = true;
    g.add(m);
    const res = new THREE.Vector2(10, 10);
    const lg = new LineSegmentsGeometry();
    lg.setPositions([0, 0, 0, 1, 0, 0]);
    const line = new LineSegments2(lg, new LineMaterial());
    g.add(line);
    prepareObject(g, res);
    assert.equal(m.castShadow, false);
    assert.equal(line.material.resolution, res);
    assert.equal(line.frustumCulled, false);
    const parent = new THREE.Group();
    parent.add(g);
    const shared = new THREE.MeshBasicMaterial(), sharedGone = disposals(shared);
    const s = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    s.userData.sharedMaterial = true;
    g.add(s);
    const gone = disposals(m.material);
    disposeObject(g);
    assert.equal(g.parent, null);
    assert.equal(gone.n, 1);
    assert.equal(sharedGone.n, 0, 'shared materials are left alone');
  });
});
