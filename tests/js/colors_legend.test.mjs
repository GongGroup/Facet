// Colour-scheme context and legends (F0-A B13, B14; ledger L-F0-51): ctx.structure/scene/extras, dependsOn scene paths,
// category legends, app.registerColorExtra's values, the "Property" scheme's default property, overlay legend rows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { colorSchemes, computeColors, defaultPropertyName, PROPERTY_SKIP, colorExtrasFrom, offeredSchemes, srgbToLinear, hexToRgb } from '../../crystallume/web/js/render/colors.js';
import { drawLegends } from '../../crystallume/web/js/render/legend.js';
import { scenePathValues, makeScene } from '../../crystallume/web/js/render/settings.js';
import { fake2d, quietErrors } from './fake2d.mjs';

const model = (symbols) => ({
  n: symbols.length, symbols, positions: Float32Array.from(symbols.flatMap((_, i) => [i, 0, i])), src: Int32Array.from(symbols.keys()),
});
const linear = (hex) => hexToRgb(hex).map(srgbToLinear);
const rgbAt = (colors, i) => [colors[3 * i], colors[3 * i + 1], colors[3 * i + 2]];
const near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 1e-6);

describe('"Property" colours', () => {
  test('the default property skips layer tags and adsorbate ids', () => {
    assert.deepEqual([...PROPERTY_SKIP], ['tags', 'adsorbate_id']);
    assert.equal(defaultPropertyName({ tags: [1, 2], charges: [0.1, -0.1] }), 'charges');
    assert.equal(defaultPropertyName({ adsorbate_id: [0, 1], tags: [1, 0] }), undefined);
    assert.equal(defaultPropertyName({ selective_dynamics: [[true, true, false]], tags: [1, 2] }), undefined);
    assert.equal(defaultPropertyName(null), undefined);
  });

  test('after a cleave (tags first) the scheme still colours by the file’s property; tags only when asked for', () => {
    const s = { length: 2, props: { tags: [1, 2], adsorbate_id: [0, 0], charges: [0.5, -0.5] } };
    const m = model(['O', 'Pt']);
    const byDefault = computeColors(m, s, { colorScheme: 'property' }, null);
    assert.equal(byDefault.legend.label, 'charges');
    const byTags = computeColors(m, s, { colorScheme: 'property', property: 'tags' }, null);
    assert.equal(byTags.legend.label, 'tags');
    const onlyTags = computeColors(m, { length: 2, props: { tags: [1, 2] } }, { colorScheme: 'property' }, null);
    assert.equal(onlyTags.legend, null);
    assert.ok(near(rgbAt(onlyTags, 0), linear('#9aa0a6')), 'no property: neutral grey');
  });

  test('the scheme is offered only when there is a property to colour by', () => {
    const scheme = colorSchemes.get('property');
    assert.equal(scheme.available({ props: { tags: [1, 2], adsorbate_id: [0, 1] } }), false);
    assert.equal(scheme.available({ props: { tags: [1, 2], magmom: [0.6, 0.6] } }), true);
    assert.equal(scheme.available(null), false);
  });

  test('a scheme picker always lists the scheme in use, e.g. "Property" a script set to colour by tags', (t) => {
    const ids = (s, active) => offeredSchemes(s, active).map((c) => c.id);
    const slab = { props: { tags: [1, 2] } };
    const all = colorSchemes.list().map((c) => c.id);
    assert.deepEqual(ids(slab, 'jmol'), all.filter((id) => id !== 'property'), 'a cleaved slab: nothing to colour by by default');
    assert.deepEqual(ids(slab, 'property'), all, 'the scheme in use stays listed, in its place');
    assert.deepEqual(ids({ props: { charges: [0.1, -0.1] } }), all);
    assert.ok(ids(null).includes('jmol'), 'schemes without available() are always offered');
    const off = colorSchemes.register({ id: 'test-broken', name: 'Broken', group: 'Per atom', available() { throw new Error('no'); }, colorFor: () => '#ffffff' });
    t.after(off);
    assert.ok(!ids(slab, 'jmol').includes('test-broken'), 'an available() that throws: not offered');
    assert.ok(ids(slab, 'test-broken').includes('test-broken'));
    // what the atoms then look like: tags on the coolwarm map and their legend
    const c = computeColors(model(['Pt', 'Pt']), { length: 2, ...slab }, { colorScheme: 'property', property: 'tags' }, null);
    assert.equal(c.legend.label, 'tags');
  });
});

describe('colour-scheme context', () => {
  test('ctx carries the structure, the scene and a frozen copy of the extras; a scheme may return categories', (t) => {
    let seen = null;
    const off = colorSchemes.register({
      id: 'test-layers', name: 'Layer (top = 1)', group: 'Per atom', dependsOn: ['display.legend'],
      colorFor(sym, i, ctx) { seen = ctx; return ['#E69F00', '#56B4E9'][i % 2]; },
      legend: (ctx) => ({ kind: 'categories', label: ctx.extras.layers ? 'Layer (top = 1)' : null, items: [{ label: 1, color: '#E69F00' }, { label: '2', color: '#56B4E9' }, { label: 'bad', color: 5 }, null] }),
    });
    t.after(off);
    const s = { length: 2, props: {} }, scene = makeScene(), extras = { layers: { tolerance: 0.3 } };
    const c = computeColors(model(['Pt', 'Pt']), s, { colorScheme: 'test-layers' }, null, { scene, extras });
    assert.equal(seen.structure, s);
    assert.equal(seen.scene, scene);
    assert.deepEqual(seen.extras, extras);
    assert.notEqual(seen.extras, extras, 'a copy');
    assert.ok(Object.isFrozen(seen.extras));
    assert.ok(near(rgbAt(c, 1), linear('#56B4E9')));
    assert.deepEqual(c.legend, { kind: 'categories', scheme: 'test-layers', label: 'Layer (top = 1)', items: [{ label: '1', color: '#E69F00' }, { label: '2', color: '#56B4E9' }] });
    // without the options (older callers): no scene, empty extras
    computeColors(model(['Pt']), s, { colorScheme: 'test-layers' }, null);
    assert.equal(seen.scene, null);
    assert.deepEqual(seen.extras, {});
    assert.equal(computeColors(model(['Pt']), s, { colorScheme: 'test-layers' }, null).legend.label, null);
    assert.deepEqual(scenePathValues(scene, colorSchemes.get('test-layers').dependsOn), ['auto']);
  });

  test('element and gradient legends are unchanged', () => {
    const s = { length: 2, props: {} };
    assert.equal(computeColors(model(['O', 'Pt']), s, { colorScheme: 'jmol' }, null).legend.kind, 'elements');
    const g = computeColors(model(['O', 'Pt']), s, { colorScheme: 'height' }, null).legend;
    assert.equal(g.kind, 'gradient');
    assert.equal(g.label, 'Height z (Å)');
  });

  test('colorExtrasFrom: JSON copies of the values providers give', () => {
    const src = { tolerance: 0.3, axis: [0, 0, 1] };
    const providers = new Map([
      ['layers', (app) => (app.ok ? src : undefined)],
      ['none', () => undefined],
      ['boom', () => { throw new Error('no structure'); }],
      ['big', () => 10n],
      ['fn', () => () => 1],
      ['notfn', 5],
    ]);
    const [out, errors] = quietErrors(() => colorExtrasFrom(providers, { ok: true }));
    assert.deepEqual(out, { layers: { tolerance: 0.3, axis: [0, 0, 1] } });
    assert.equal(errors.length, 2, 'the throwing provider and the BigInt are logged');
    src.axis[2] = -1;
    assert.equal(out.layers.axis[2], 1, 'a copy, not the provider’s object');
    assert.deepEqual(colorExtrasFrom({ a: () => 1, b: () => null }, {}), { a: 1, b: null });
    assert.deepEqual(colorExtrasFrom(undefined, {}), {});
  });

  test('scenePathValues', () => {
    const scene = makeScene();
    assert.deepEqual(scenePathValues(scene, ['display.legend', 'style.colorScheme', 'display.nothing.here', 7]), ['auto', 'jmol', null, null]);
    assert.equal(scenePathValues(scene, []), null);
    assert.equal(scenePathValues(scene, undefined), null);
    assert.deepEqual(scenePathValues(scene, ['__proto__.polluted']), [null]);
  });
});

describe('legend stack', () => {
  const opts = (g, extra = {}) => drawLegends(g, { width: 800, height: 600, scale: 1, font: 'sans-serif', ...extra });
  const yOf = (g, text) => g.calls.find((c) => c[0] === 'fillText' && c[1] === text)?.[3];

  test('category legends: title and chips', () => {
    const g = fake2d();
    const used = opts(g, { legend: { kind: 'categories', label: 'Layer (top = 1)', items: [{ label: '1 (top)', color: '#E69F00' }, { label: '2', color: '#56B4E9' }] } });
    assert.ok(used > 0);
    assert.deepEqual(g.texts(), ['Layer (top = 1)', '1 (top)', '2']);
    assert.ok(g.calls.some((c) => c[0] === 'fill' && c[1] === '#E69F00'));
    assert.ok(yOf(g, 'Layer (top = 1)') < yOf(g, '1 (top)'), 'the title above the chips');
  });

  test('overlay legend rows sit above the colour legend, which sits above the scale bar', () => {
    const g = fake2d();
    opts(g, {
      legend: { kind: 'gradient', colormap: 'viridis', min: 0, max: 1, label: 'Height z (Å)' },
      items: [
        { label: 'Fixed (18)', swatch: { kind: 'halo', color: '#2563eb', opacity: 1 } },
        { label: 'Sites (54)', swatch: { kind: 'dot', color: '#e64980', opacity: 0.5 } },
        { label: 'Plane', swatch: { kind: 'line', color: '#3b82f6', opacity: 1, dashed: true } },
      ],
      pxPerAngstrom: 30,
    });
    const texts = g.texts();
    for (const t of ['Fixed (18)', 'Sites (54)', 'Plane', 'Height z (Å)', '2 Å']) assert.ok(texts.includes(t), t);
    assert.ok(yOf(g, 'Plane') < yOf(g, 'Height z (Å)'));
    assert.ok(yOf(g, 'Height z (Å)') < yOf(g, '2 Å'));
    assert.ok(yOf(g, 'Fixed (18)') < yOf(g, 'Sites (54)'));
    // swatches: the halo is a coloured ring around a dark line, the dot is filled at its opacity, the line is dashed
    assert.ok(g.calls.some((c) => c[0] === 'stroke' && c[1] === '#2563eb'));
    assert.ok(g.calls.some((c) => c[0] === 'stroke' && c[1] === '#14171b'));
    assert.ok(g.calls.some((c) => c[0] === 'fill' && c[1] === '#e64980' && c[2] === 0.5));
    assert.ok(g.calls.some((c) => c[0] === 'setLineDash' && c[1].length === 2));
    assert.equal(g.depth, 0, 'every save() restored');
  });

  test('long lists and long labels are shortened', () => {
    const g = fake2d();
    const items = Array.from({ length: 15 }, (_, k) => ({ label: k ? `Row ${k}` : 'A very long legend label that does not fit the box at all, really', swatch: { kind: 'dot', color: '#000000' } }));
    opts(g, { items });
    const texts = g.texts();
    assert.equal(texts.length, 13);
    assert.equal(texts.at(-1), '+3 more');
    assert.ok(texts[0].endsWith('…'));
    assert.equal(opts(fake2d(), {}), 0, 'nothing to draw');
  });

  test('dark backgrounds draw the halo swatch with a black inner line', () => {
    const g = fake2d();
    opts(g, { dark: true, items: [{ label: 'Fixed', swatch: { kind: 'halo', color: '#7aa2ff' } }] });
    assert.ok(g.calls.some((c) => c[0] === 'stroke' && c[1] === '#000000'));
  });
});
