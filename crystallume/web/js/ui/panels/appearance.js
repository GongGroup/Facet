/** Inspector tabs: Style (looks, representation, colours, material, sizes), Light, Effects, Scene. */
import { h, ic, btn, slider, toggle, seg, select, colorInput, section, field } from '../dom.js';
import { looks } from '../../render/looks.js';
import { styles } from '../../render/styles.js';
import { colorSchemes, elementColorHex } from '../../render/colors.js';
import { materials } from '../../render/materials.js';
import { lightingPresets, presetToSettings, environmentMaps, DEFAULT_ENV_MAP } from '../../render/lighting.js';
import { DEFAULT_SCENE, makeScene } from '../../render/settings.js';
import { deepClone, deepMerge, getPath } from '../../core/util.js';
import { LOOK_KEYS, DARK_BG, DARK_CELL } from '../../app.js';
import { element } from '../../core/elements.js';
import { candidatePairs, bondPairStats } from '../../core/bonds.js';
import { smartPairDefault, estimateDisplayCount, MAX_DISPLAY_ATOMS } from '../../render/display.js';
import { AO_MAX_RADIUS } from '../../render/post.js';
import { registerInspectorTab } from '../shell.js';
import { confirmDialog, dialog } from '../overlays.js';
import { lightPad, litSphereURL } from '../lightpad.js';

const f2 = (v) => (+v).toFixed(2), f1 = (v) => (+v).toFixed(1), f0 = (v) => `${Math.round(v)}°`;

/** Equality for scene values: ignores key order and undefined members, compares hex colours case-insensitively. */
function same(a, b) {
  if (a === b) return true;
  if (typeof a === 'string' && typeof b === 'string') return a[0] === '#' && a.toLowerCase() === b.toLowerCase();
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => same(a[k], b[k]));
}

/**
 * True when the settings a look owns (LOOK_KEYS: material, colour scheme, lighting, effects, background, cell
 * colour) still hold what applying look `l` gives, or its dark-interface background and cell colour.
 * Edits since then only touched settings a look leaves alone (sizes, bonds, per-element colours…).
 */
function lookIntact(scene, l) {
  const want = deepMerge(makeScene(), deepClone(l.scene));
  return LOOK_KEYS.every((p) => {
    const v = getPath(scene, p);
    if (same(v, getPath(want, p))) return true;
    if (p === 'display.background') return !!l.backgroundDark && same(v, l.backgroundDark);
    if (p === 'display.cell.color') return !!l.cellDark && same(v, l.cellDark);
    return false;
  });
}
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

const MAX_EXTRA_LIGHTS = 4;
/** Supercell sizes: check above ASK displayed atoms, warn harder above SOFT, refuse above the renderer's limit. */
const SUPERCELL_ASK = 30000, SUPERCELL_SOFT = 250000, SUPERCELL_HARD = MAX_DISPLAY_ATOMS;
/** Repeats typed in the Scene tab but not applied yet ({structure, v}); kept across re-renders of the tab. */
let stagedSupercell = null;
let supercellSyncOff = null;   // keeps the open Repeat fields in step with display.supercell (Enter, undo)

function luminance(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** True when the viewport background is mostly light (transparent counts as not light). */
function lightBackground(bg) {
  if (!bg || bg.mode === 'transparent') return false;
  const ls = [bg.color1, bg.mode === 'solid' ? null : bg.color2].map(luminance).filter((v) => v != null);
  return ls.length > 0 && ls.reduce((a, b) => a + b, 0) / ls.length > 0.5;
}
const prefersDark = (m) => (m ? (m.prefersDark ?? ['xray', 'glow'].includes(m.id)) : false);
/** Run fn as one undo step when the app supports it. */
const oneStep = (app, label, fn) => (app.transaction ? app.transaction(label, fn) : fn());

/** Table radius (Å) before atomScale, for the radius source in use. */
function tableRadius(sym, S) {
  const e = element(sym);
  switch (S.radiusSource) {
    case 'vdw': return e.rvdw;
    case 'covalent': return e.rcov;
    case 'uniform': return S.bondRadius ?? 0.2;
    default: return e.ratom;
  }
}

// ------------------------------------------------------------------ Style
registerInspectorTab({
  id: 'style', title: 'Style', icon: 'style', tip: 'Looks, representation, colours and materials',
  render(app, el, shell) {
    const S = app.scene.style;
    const sc = app.scene;
    const q = (path) => shell.quiet((v) => app.set(path, v));

    // looks: the current look is highlighted. Edits to settings a look owns give its card a dashed ring
    // and a "Custom" chip; edits to anything else (sizes, bonds…) keep the look highlighted.
    const prev = !sc.look && sc.lookBase ? looks.get(sc.lookBase) : null;
    const intact = !!prev && lookIntact(sc, prev);
    const base = intact ? null : prev;
    const lookGrid = h('div.grid-cards.aio-looks');
    const shown = looks.list().filter((l) => !l.hidden || l.id === sc.look || l.id === sc.lookBase || (l.scene?.style?.rep && l.scene.style.rep === S.rep));
    for (const l of shown) {
      const current = sc.look === l.id || (intact && prev.id === l.id), based = base?.id === l.id;
      const b = h('button.card-btn', { type: 'button', 'aria-pressed': String(current), 'data-tip': based ? `${l.description}. Click to re-apply its material, colour scheme, lighting, effects and background.` : l.description },
        l.ball ? h('div.sw.aio-ball-sw', { style: { background: l.swatch } }, h('span.aio-ball', { style: { background: l.ball } })) : h('div.sw', { style: { background: l.swatch } }),
        h('div.nm', l.name));
      if (based) b.classList.add('aio-based');
      b.addEventListener('click', () => app.applyLook(l.id));
      lookGrid.append(b);
    }
    const lookHead = h('h3.aio-head', h('span.grow', 'Looks'));
    if (base) {
      lookHead.append(h('span.aio-chip', { 'data-tip': `You changed the material, colour scheme, lighting, effects or background after applying ${base.name}` }, h('span', `Custom · based on ${base.name}`),
        h('button.aio-chip-btn', { type: 'button', 'data-tip': `Re-apply ${base.name}'s material, colour scheme, lighting, effects and background. Representation, sizes and bonds stay as they are.`, on: { click: () => app.applyLook(base.id) } }, 'Reset')));
    } else lookHead.append(h('span.muted.aio-sub', 'material + light + effects'));
    el.append(section(lookHead, lookGrid));

    // representation
    const repGrid = h('div.rep-grid');
    styles.list().forEach((s, i) => {
      const b = h('button.rep-btn', { type: 'button', 'aria-pressed': String(S.rep === s.id), 'data-tip': s.description, 'data-kbd': i < 9 ? String(i + 1) : null, html: s.icon });
      b.append(h('span', s.name));
      b.addEventListener('click', () => app.setRepresentation(s.id));
      repGrid.append(b);
    });
    el.append(section('Representation', repGrid));

    // colour (and per-element size)
    const groups = {};
    for (const c of colorSchemes.list()) { if (c.available && !c.available(app.structure)) continue; (groups[c.group] ??= []).push({ value: c.id, label: c.name }); }
    const schemeSel = select({ options: Object.entries(groups).map(([g, options]) => ({ group: g === 'Element' ? 'By element' : g, options })), value: S.colorScheme, onChange: (v) => app.set('style.colorScheme', v), label: 'Colour scheme' });
    const colorSec = section('Colour & size per element', field('Scheme', schemeSel, colorSchemes.get(S.colorScheme)?.description));
    if (S.colorScheme === 'mono') colorSec.append(field('Colour', colorInput(S.monoColor, q('style.monoColor'))));
    if (app.structure) {
      const comp = app.structure.composition();
      const hidden = new Set(app.scene.display.hiddenElements ?? []);
      const ro = S.radiusOverrides ?? {};
      const list = h('div.aio-elems');
      list.append(h('div.elem-row.aio-elem.aio-elem-head', h('span'), h('span', 'Element'), h('span', 'Count'), h('span', { 'data-tip': 'Sphere radius in Å before the atom scale. Empty = from the radius table.' }, 'Radius Å'), h('span'), h('span')));
      for (const sym of Object.keys(comp).sort((a, b) => element(a).Z - element(b).Z)) {
        const e = element(sym);
        const vis = !hidden.has(sym);
        const eye = btn('', { icon: vis ? 'eye' : 'eyeOff', cls: 'ghost icon small', tip: vis ? `Hide ${e.name}` : `Show ${e.name}`, on: () => {
          const set = new Set(app.scene.display.hiddenElements ?? []);
          vis ? set.add(sym) : set.delete(sym);
          app.set('display.hiddenElements', [...set]);
        } });
        const ci = colorInput(elementColorHex(sym, S), shell.quiet((v) => { app.set('style.colorOverrides', { ...app.scene.style.colorOverrides, [sym]: v }); }), `${e.name} colour`);
        ci.addEventListener('change', () => shell.renderInspector());
        // radius override (Å), empty = table value
        const has = Number.isFinite(ro[sym]) && ro[sym] > 0;
        const tbl = tableRadius(sym, S);
        const rin = h('input.field.num.aio-rad', { type: 'number', min: 0.05, max: 5, step: 0.05, value: has ? String(ro[sym]) : '', placeholder: tbl.toFixed(2),
          'aria-label': `${e.name} radius in Å`, 'data-tip': has ? `${e.name}: ${ro[sym]} Å (table: ${tbl.toFixed(2)} Å)` : `${e.name}: ${tbl.toFixed(2)} Å from the table. Type a radius to override it.` });
        rin.addEventListener('change', () => {
          const o = { ...(app.scene.style.radiusOverrides ?? {}) };
          const v = parseFloat(rin.value);
          if (rin.value.trim() === '' || !Number.isFinite(v) || v <= 0) delete o[sym];
          else o[sym] = Math.round(Math.min(5, Math.max(0.05, v)) * 100) / 100;
          app.set('style.radiusOverrides', o);
        });
        rin.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') rin.blur(); });
        const sizeCell = h('span.aio-size', rin, has ? btn('', { icon: 'reset', cls: 'ghost icon small', tip: 'Back to the table radius', on: () => { const o = { ...(app.scene.style.radiusOverrides ?? {}) }; delete o[sym]; app.set('style.radiusOverrides', o); } }) : null);
        list.append(h('div.elem-row.aio-elem', ci, h('span.aio-elname', h('span.sym', sym), ' ', h('span.nm', e.name)), h('span.num.muted', { style: { fontSize: '11.5px' } }, `×${comp[sym]}`), sizeCell, eye,
          S.colorOverrides?.[sym] ? btn('', { icon: 'reset', cls: 'ghost icon small', tip: 'Back to scheme colour', on: () => { const o = { ...S.colorOverrides }; delete o[sym]; app.set('style.colorOverrides', o); } }) : h('span')));
      }
      colorSec.append(list);
    }
    el.append(colorSec);

    // material
    const matGrid = h('div.mat-grid');
    for (const m of materials.list()) {
      const b = h('button.mat-btn', { type: 'button', 'aria-pressed': String(S.material === m.id), 'aria-label': m.name, 'data-tip': `${m.name} — ${m.description}` }, h('span', { style: { background: m.swatch } }));
      b.addEventListener('click', () => app.set('style.material', m.id));
      matGrid.append(b);
    }
    const mat = materials.get(S.material);
    let darkHint = null;
    if (prefersDark(mat) && lightBackground(app.scene.display.background)) {
      darkHint = h('div.callout.aio-hint', h('span', ic('info', 'sm'), h('span', `${mat.name} shows best on a dark background.`)),
        btn('Use dark background', { cls: 'small', tip: 'Switch to the dark studio gradient (undo with Ctrl Z)', on: () => oneStep(app, 'Dark background', () => {
          app.set('display.background', { ...DARK_BG });
          const cc = app.scene.display.cell?.color;
          if (cc && (luminance(cc) ?? 1) < 0.35) app.set('display.cell.color', DARK_CELL);   // keep cell lines visible
        }) }));
    }
    el.append(section(h('h3', h('span.grow', 'Material'), h('span', { style: { textTransform: 'none', letterSpacing: 0, color: 'var(--fg-2)', fontWeight: 500 } }, mat?.name ?? '')), matGrid, darkHint,
      !['flat', 'toon', 'xray', 'phong'].includes(S.material) ? slider({ label: 'Roughness', value: S.roughness ?? defaultsOf(S.material).roughness, min: 0, max: 1, step: 0.01, fmt: f2, onInput: q('style.roughness'), tip: 'Lower = sharper reflections' }) : null,
      !['flat', 'toon', 'xray', 'phong'].includes(S.material) ? slider({ label: 'Metalness', value: S.metalness ?? defaultsOf(S.material).metalness, min: 0, max: 1, step: 0.01, fmt: f2, onInput: q('style.metalness') }) : null,
      S.material !== 'xray' ? slider({ label: 'Opacity', value: S.opacity ?? 1, min: 0.1, max: 1, step: 0.01, fmt: f2, onInput: q('style.opacity') }) : null,
    ));

    // sizes
    const style = styles.get(S.rep);
    const sizes = section('Size',
      field('Radius', seg([{ value: 'atomic', label: 'Atomic', tip: 'Empirical atomic radii (VESTA)' }, { value: 'covalent', label: 'Covalent', tip: 'Cordero covalent radii' }, { value: 'vdw', label: 'vdW', tip: 'Van der Waals radii' }, { value: 'uniform', label: 'Same', tip: 'All atoms the same size' }], S.radiusSource, (v) => app.set('style.radiusSource', v)), 'Which radius table sets sphere sizes'),
      slider({ label: 'Atom scale', value: S.atomScale, min: 0.05, max: 1.6, step: 0.01, fmt: f2, onInput: q('style.atomScale') }),
    );
    if (style?.bonds && !style.lines) sizes.append(slider({ label: 'Bond radius', value: S.bondRadius, min: 0.02, max: 0.5, step: 0.005, fmt: (v) => `${(+v).toFixed(2)} Å`, onInput: q('style.bondRadius') }));
    if (style?.lines) sizes.append(slider({ label: 'Line width', value: S.lineWidth ?? 2.5, min: 0.5, max: 8, step: 0.1, fmt: (v) => `${f1(v)} px`, onInput: q('style.lineWidth') }));
    if (style?.bonds) {
      sizes.append(field('Bond colour', seg([{ value: 'split', label: 'Split by atom' }, { value: 'uniform', label: 'Single' }], S.bondColor, (v) => { app.set('style.bondColor', v); })));
      if (S.bondColor === 'uniform') sizes.append(field('', colorInput(S.bondUniformColor, q('style.bondUniformColor'), 'Bond colour')));
      const bondMats = [{ value: 'auto', label: 'Automatic' }, { value: 'same', label: 'Same as atoms' }, ...materials.list().map((m) => ({ value: m.id, label: m.name }))];
      sizes.append(field('Bond material', select({ options: bondMats, value: S.bondMaterial ?? 'auto', onChange: (v) => app.set('style.bondMaterial', v), label: 'Bond material' }),
        'Automatic keeps bonds solid under see-through atoms (Glass, X-ray); otherwise they use the atom material'));
    }
    sizes.append(field('Quality', select({ options: [{ value: 'auto', label: 'Automatic' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low (fast)' }, { value: 'draft', label: 'Draft (huge systems)' }], value: S.quality ?? 'auto', onChange: (v) => app.set('style.quality', v) }), 'Sphere tessellation; Automatic lowers it as atom count grows'));
    el.append(sizes);

    if (S.rep === 'polyhedra' && app.structure) {
      const pol = S.polyhedra ?? {};
      const els = app.structure.elements();
      const auto = pol.centers === 'auto' || !pol.centers;
      const chips = h('div.chips');
      const autoChip = h('button.chip', { type: 'button', 'aria-pressed': String(auto), 'data-tip': 'Pick cations with 4–8 anion neighbours automatically' }, 'Auto');
      autoChip.classList.toggle('sel', auto);
      autoChip.addEventListener('click', () => app.set('style.polyhedra', { ...pol, centers: 'auto' }));
      chips.append(autoChip);
      for (const s of els) {
        const on = !auto && pol.centers.includes(s);
        const c = h('button.chip', { type: 'button', 'aria-pressed': 'true' }, h('span.dot', { style: { background: elementColorHex(s, S) } }), s);
        c.classList.toggle('sel', on);
        c.addEventListener('click', () => {
          const cur = new Set(auto ? [] : pol.centers);
          on ? cur.delete(s) : cur.add(s);
          app.set('style.polyhedra', { ...pol, centers: cur.size ? [...cur] : 'auto' });
        });
        chips.append(c);
      }
      el.append(section('Polyhedra', h('div.sub-h', 'Centre atoms'), chips,
        slider({ label: 'Opacity', value: pol.opacity ?? 0.55, min: 0.1, max: 1, step: 0.01, fmt: f2, onInput: q('style.polyhedra.opacity') }),
        toggle({ label: 'Edges', checked: pol.edges !== false, onChange: (v) => app.set('style.polyhedra.edges', v) })));
    }
  },
});

function defaultsOf(id) {
  const m = materials.get(id)?.create({});
  const r = { roughness: m?.roughness ?? 0.5, metalness: m?.metalness ?? 0 };
  m?.dispose?.();
  return r;
}

// ------------------------------------------------------------------ Light
registerInspectorTab({
  id: 'light', title: 'Light', icon: 'sun', tip: 'Lighting presets, light directions, environment, shadows and exposure',
  render(app, el, shell) {
    const L = app.scene.lighting;
    const q = (path) => shell.quiet((v) => app.set(path, v));
    /** Sliders by lighting sub-path ('key.azimuth'), so the light pad can keep them in step. */
    const refs = {};
    const reg = (path, ctl) => { refs[path] = ctl; return ctl; };

    // presets first (one click, like Looks in the Style tab), each drawn as a lit sphere; then the light pad to fine-tune
    const grid = h('div.grid-cards.aio-presets');
    for (const p of lightingPresets.list()) {
      let url = '';
      try { url = litSphereURL(presetToSettings(p.id), 40); } catch (e) { console.warn('preset thumbnail failed', e); }
      const sw = url ? h('div.sw.aio-thumb', { style: { backgroundImage: `url("${url}")` } }) : h('div.sw', ...(p.swatch ?? []).map((c) => h('span', { style: { background: c } })));
      const b = h('button.card-btn.light-card', { type: 'button', 'aria-pressed': String(L.preset === p.id), 'data-tip': p.description }, sw, h('div.nm', p.name));
      b.addEventListener('click', () => app.setLightingPreset(p.id));
      grid.append(b);
    }
    el.append(section(h('h3.aio-head', h('span.grow', 'Lighting presets'), h('span.muted.aio-sub', 'replace all lights')), grid));

    // light pad
    const pad = lightPad({
      get: () => app.scene.lighting,
      set: (path, v) => { shell.quiet(() => app.set(`lighting.${path}`, v))(); refs[path]?.set(v); },
    });
    const off = app.on('scene', () => { if (!pad.isConnected) { off(); return; } pad.redraw(); });
    el.append(section(h('h3.aio-head', h('span.grow', 'Light directions'), h('span.muted.aio-sub', 'drag the dots')), pad,
      h('p.hint.aio-padhint', globalThis.matchMedia?.('(pointer: coarse)').matches
        ? 'Dots on the sphere light it from the front, dots in the outer ring from behind. Pick a light in the list, then tap or drag on the pad to move it.'
        : 'Dots on the sphere light it from the front, dots in the outer ring from behind. Scroll on a dot to change its brightness.'),
      toggle({ label: 'Lights follow the camera', sub: 'Shading stays the same while you rotate. Turn off to fix lights in the scene.', checked: L.follow !== false, onChange: (v) => app.set('lighting.follow', v) })));

    const dirCtls = (path, p) => [
      reg(`${path}.intensity`, slider({ label: 'Intensity', value: p.intensity ?? 0, min: 0, max: 6, step: 0.05, fmt: f2, onInput: q(`lighting.${path}.intensity`) })),
      reg(`${path}.azimuth`, slider({ label: 'Direction', value: p.azimuth ?? 0, min: -180, max: 180, step: 1, fmt: f0, onInput: q(`lighting.${path}.azimuth`), tip: 'Azimuth: 0° from the viewer, 90° from the right, ±180° from behind' })),
      reg(`${path}.elevation`, slider({ label: 'Height', value: p.elevation ?? 0, min: -90, max: 90, step: 1, fmt: f0, onInput: q(`lighting.${path}.elevation`), tip: 'Elevation: 90° straight from above' })),
    ];
    const lightCtl = (key, title, tip) => {
      const p = L[key] ?? {};
      return section(h('h3', h('span.grow', { 'data-tip': tip }, title), colorInput(p.color ?? '#ffffff', q(`lighting.${key}.color`), `${title} colour`)), ...dirCtls(key, p));
    };
    el.append(lightCtl('key', 'Key light', 'The main light: sets the shading and the shadows'),
      lightCtl('fill', 'Fill light', 'Softens the shadow side'),
      lightCtl('rim', 'Rim / back light', 'Outlines the structure against the background'));

    // extra lights
    const extras = Array.isArray(L.extra) ? L.extra : [];
    const addLight = () => {
      const cur = Array.isArray(app.scene.lighting.extra) ? app.scene.lighting.extra : [];
      if (cur.length >= MAX_EXTRA_LIGHTS) return;
      const spots = [[110, 15], [-110, 15], [0, -45], [180, 50]];
      const [azimuth, elevation] = spots.find(([a, e]) => !cur.some((x) => Math.abs((x.azimuth ?? 0) - a) < 20 && Math.abs((x.elevation ?? 0) - e) < 20)) ?? spots[cur.length % spots.length];
      app.set('lighting.extra', [...cur.map((x) => ({ ...x })), { intensity: 1.5, color: ['#ffd9a8', '#a8d4ff', '#ffffff', '#ffb3e6'][cur.length % 4], azimuth, elevation }]);
    };
    const exHead = h('h3.aio-head', h('span.grow', 'Extra lights'), h('span.muted.aio-sub.num', `${extras.length} / ${MAX_EXTRA_LIGHTS}`),
      btn('Add light', { icon: 'plus', cls: 'small', disabled: extras.length >= MAX_EXTRA_LIGHTS, tip: extras.length >= MAX_EXTRA_LIGHTS ? `Up to ${MAX_EXTRA_LIGHTS} extra lights` : 'Add a light; it appears as a numbered dot on the light pad', on: addLight }));
    const exSec = section(exHead);
    if (!extras.length) exSec.append(h('p.hint', 'Add coloured side lights or a kicker from below. Each one shows up as a numbered dot on the light pad above.'));
    extras.forEach((p, i) => {
      const remove = () => app.set('lighting.extra', (app.scene.lighting.extra ?? []).filter((_, k) => k !== i).map((x) => ({ ...x })));
      exSec.append(h('div.aio-extra',
        h('div.aio-extra-head', colorInput(p.color ?? '#ffffff', q(`lighting.extra.${i}.color`), `Light ${i + 1} colour`), h('b', `Light ${i + 1}`),
          h('span.muted.aio-sub', (p.intensity ?? 0) > 0 ? '' : 'off'),
          btn('', { icon: 'trash', cls: 'ghost icon small', tip: `Remove light ${i + 1}`, on: remove })),
        ...dirCtls(`extra.${i}`, p)));
    });
    el.append(exSec);

    // ambient and environment
    const env = L.env ?? {};
    const envOpts = environmentMaps.list().map((m) => ({ value: m.id, label: m.name }));
    const envMap = environmentMaps.get(env.map) ? env.map : DEFAULT_ENV_MAP;
    el.append(section('Ambient & environment',
      slider({ label: 'Sky light', value: L.hemi?.intensity ?? 0, min: 0, max: 3, step: 0.05, fmt: f2, onInput: q('lighting.hemi.intensity'), tip: 'Hemisphere light: sky colour from above, ground colour from below' }),
      h('div.row', h('span.ctl-label', { style: { width: '96px' } }, 'Sky / ground'), colorInput(L.hemi?.sky ?? '#fff', q('lighting.hemi.sky'), 'Sky colour'), colorInput(L.hemi?.ground ?? '#444', q('lighting.hemi.ground'), 'Ground colour')),
      slider({ label: 'Flat ambient', value: L.ambient?.intensity ?? 0, min: 0, max: 3, step: 0.05, fmt: f2, onInput: q('lighting.ambient.intensity'), tip: 'Even light from everywhere; flattens the shading' }),
      toggle({ label: 'Environment reflections', sub: 'Image-based light and reflections from a virtual surrounding', checked: !!env.enabled, onChange: (v) => { app.set('lighting.env.enabled', v); } }),
      env.enabled ? field('Surroundings', select({ options: envOpts, value: envMap, onChange: (v) => app.set('lighting.env.map', v), label: 'Environment' }), environmentMaps.get(envMap)?.description) : null,
      env.enabled ? slider({ label: 'Strength', value: env.intensity ?? 0.5, min: 0, max: 3, step: 0.05, fmt: f2, onInput: q('lighting.env.intensity') }) : null,
      env.enabled ? slider({ label: 'Rotation', value: env.rotation ?? 0, min: -180, max: 180, step: 1, fmt: f0, onInput: q('lighting.env.rotation'), tip: 'Turn the surroundings to move reflections across the atoms' }) : null,
      env.enabled && !['metallic', 'glass', 'glossy', 'pearl'].includes(app.scene.style.material) && (env.map ?? DEFAULT_ENV_MAP) !== DEFAULT_ENV_MAP
        ? h('p.hint', 'Reflections show most on the Metallic, Glossy, Glass and Pearl materials.') : null));

    const sh = L.shadows ?? {};
    el.append(section('Shadows',
      toggle({ label: 'Cast shadows', sub: 'Atoms shadow each other from the key light', checked: !!sh.enabled, onChange: (v) => app.set('lighting.shadows.enabled', v) }),
      sh.enabled ? slider({ label: 'Softness', value: sh.softness ?? 3, min: 0, max: 10, step: 0.5, fmt: f1, onInput: q('lighting.shadows.softness'), tip: 'Blur of the shadow edges: 0 is hard, 10 is very soft' }) : null,
      sh.enabled ? toggle({ label: 'Shadow floor', sub: 'Ground plane under the structure; best with fixed lights', checked: !!sh.floor, onChange: (v) => app.set('lighting.shadows.floor', v) }) : null));
    el.append(section('Camera',
      slider({ label: 'Exposure', value: L.exposure ?? 1, min: 0.2, max: 2.5, step: 0.01, fmt: f2, onInput: q('lighting.exposure') }),
      field('Tone mapping', select({ options: [{ value: 'neutral', label: 'Neutral (true colours)' }, { value: 'agx', label: 'AgX (filmic, soft)' }, { value: 'aces', label: 'ACES (contrasty)' }, { value: 'reinhard', label: 'Reinhard' }, { value: 'cineon', label: 'Cineon' }, { value: 'linear', label: 'Linear' }, { value: 'none', label: 'None' }], value: L.toneMapping ?? 'neutral', onChange: (v) => app.set('lighting.toneMapping', v) }), 'How bright highlights are compressed into the screen range')));
  },
});

// ------------------------------------------------------------------ Effects
registerInspectorTab({
  id: 'effects', title: 'Effects', icon: 'sparkles', tip: 'Ambient occlusion, outlines, depth cueing, drop shadows, paper texture, bloom, depth of field',
  render(app, el, shell) {
    const P = app.scene.post;
    const DP = DEFAULT_SCENE.post;
    const q = (path) => shell.quiet((v) => app.set(path, v));
    const fx = (key, title, sub, controls) => section(toggle({ label: title, sub, checked: !!P[key]?.enabled, onChange: (v) => app.set(`post.${key}.enabled`, v) }), ...(P[key]?.enabled ? controls() : []));
    el.append(
      fx('ao', 'Ambient occlusion', 'Soft contact shadows where atoms meet — adds depth', () => [
        slider({ label: 'Strength', value: P.ao.intensity ?? DP.ao.intensity, min: 0, max: 2.5, step: 0.05, fmt: f2, onInput: q('post.ao.intensity') }),
        slider({ label: 'Radius', value: Math.min(AO_MAX_RADIUS, P.ao.radius ?? DP.ao.radius), min: 0.1, max: AO_MAX_RADIUS, step: 0.05, fmt: (v) => `${f2(v)} Å`, onInput: q('post.ao.radius'), tip: 'How far the contact shadows reach' })]),
      fx('outline', 'Ink outlines', 'Silhouette and crease lines for an illustrated look', () => [
        slider({ label: 'Thickness', value: P.outline.thickness ?? DP.outline.thickness, min: 0.5, max: 5, step: 0.1, fmt: (v) => `${f1(v)} px`, onInput: q('post.outline.thickness') }),
        slider({ label: 'Strength', value: P.outline.strength ?? DP.outline.strength, min: 0.1, max: 1, step: 0.05, fmt: f2, onInput: q('post.outline.strength') }),
        slider({ label: 'Sensitivity', value: P.outline.sensitivity ?? DP.outline.sensitivity, min: 0.2, max: 3, step: 0.05, fmt: f2, onInput: q('post.outline.sensitivity') }),
        h('div.row', h('span.ctl-label', { style: { width: '96px' } }, 'Ink colour'), colorInput(P.outline.color ?? '#111', q('post.outline.color'))),
        toggle({ label: 'Crease lines', sub: 'Also draw lines where surfaces meet', checked: P.outline.creases !== false, onChange: (v) => app.set('post.outline.creases', v) })]),
      fx('fog', 'Depth cueing', 'Fade distant atoms into the background', () => [
        slider({ label: 'Strength', value: P.fog.strength ?? DP.fog.strength, min: 0, max: 1, step: 0.01, fmt: f2, onInput: q('post.fog.strength') })]),
      fx('dropShadow', 'Drop shadows', 'Every atom and bond casts a soft shadow on what lies behind it, like layered paper', () => [
        slider({ label: 'Distance', value: P.dropShadow.distance ?? DP.dropShadow.distance, min: 0, max: 1.5, step: 0.01, fmt: (v) => `${f2(v)} Å`, onInput: q('post.dropShadow.distance') }),
        slider({ label: 'Softness', value: P.dropShadow.softness ?? DP.dropShadow.softness, min: 0, max: 1, step: 0.01, fmt: (v) => `${f2(v)} Å`, onInput: q('post.dropShadow.softness') }),
        slider({ label: 'Opacity', value: P.dropShadow.opacity ?? DP.dropShadow.opacity, min: 0, max: 1, step: 0.01, fmt: f2, onInput: q('post.dropShadow.opacity') }),
        slider({ label: 'Direction', value: P.dropShadow.angle ?? DP.dropShadow.angle, min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°`, onInput: q('post.dropShadow.angle'), tip: 'Where the shadows fall: 0° to the right, −90° straight down' }),
        h('div.row', h('span.ctl-label', { style: { width: '96px' } }, 'Colour'), colorInput(P.dropShadow.color ?? DP.dropShadow.color, q('post.dropShadow.color')))]),
      fx('paper', 'Paper texture', 'Fine paper grain over the whole picture — for drawn and painted looks', () => [
        slider({ label: 'Strength', value: P.paper.strength ?? DP.paper.strength, min: 0, max: 2, step: 0.05, fmt: f2, onInput: q('post.paper.strength') })]),
      fx('bloom', 'Bloom', 'Glow around bright highlights — try with Glow or Neon', () => [
        slider({ label: 'Strength', value: P.bloom.strength ?? DP.bloom.strength, min: 0, max: 3, step: 0.05, fmt: f2, onInput: q('post.bloom.strength') }),
        slider({ label: 'Radius', value: P.bloom.radius ?? DP.bloom.radius, min: 0, max: 1, step: 0.01, fmt: f2, onInput: q('post.bloom.radius') }),
        slider({ label: 'Threshold', value: P.bloom.threshold ?? DP.bloom.threshold, min: 0, max: 1, step: 0.01, fmt: f2, onInput: q('post.bloom.threshold'), tip: 'Only parts brighter than this glow; raise it if the whole picture blurs' })]),
      fx('dof', 'Depth of field', 'Camera blur in front of and behind the focus point', () => [
        slider({ label: 'Aperture', value: P.dof.aperture ?? DP.dof.aperture, min: 0.1, max: 10, step: 0.1, fmt: f1, onInput: q('post.dof.aperture') }),
        slider({ label: 'Max blur', value: P.dof.maxblur ?? DP.dof.maxblur, min: 0.001, max: 0.03, step: 0.001, fmt: (v) => (+v).toFixed(3), onInput: q('post.dof.maxblur') }),
        h('p.hint', 'Focus follows the rotation centre. Right-click an atom and choose Centre here to focus on it.')]),
      fx('vignette', 'Vignette', 'Darken the corners of the frame', () => [
        slider({ label: 'Darkness', value: P.vignette.darkness ?? DP.vignette.darkness, min: 0, max: 2, step: 0.05, fmt: f2, onInput: q('post.vignette.darkness') }),
        slider({ label: 'Size', value: P.vignette.offset ?? DP.vignette.offset, min: 0.2, max: 2, step: 0.05, fmt: f2, onInput: q('post.vignette.offset') })]),
      h('p.hint', { style: { paddingTop: '12px' } }, 'Effects run on your graphics card. For very large systems, turn them off or set Quality to Low in the Style tab.'),
    );
  },
});

// ------------------------------------------------------------------ Scene
/** Ask (or refuse) before showing a very large supercell. Resolves true when it may be applied. */
async function supercellAllowed(app, N, structure) {
  const total = estimateDisplayCount(structure, N, app.scene.display);   // visible atoms × repeats + boundary images
  if (total > SUPERCELL_HARD) {
    await new Promise((resolve) => dialog({
      title: 'Too many atoms to show',
      body: h('div.aio-dialog',
        h('p', `${N.join(' × ')} repeats would show about ${fmtInt(total)} atoms, more than a browser tab can draw.`),
        h('p.hint', 'Use fewer repeats. To work with a large supercell, switch to the lighter Wireframe style, then use Make supercell real in the Structure panel to edit or export it.')),
      actions: [
        { label: 'Switch to Wireframe', run: () => { app.setRepresentation('wireframe'); } },
        { label: 'OK', primary: true },
      ],
      onClose: () => resolve(),
    }));
    return false;
  }
  if (total > SUPERCELL_SOFT) {
    return confirmDialog({ title: 'Large supercell', message: `This shows about ${fmtInt(total)} atoms and may freeze the tab. Continue?`, confirm: 'Show anyway', danger: true });
  }
  if (total > SUPERCELL_ASK) {
    const light = /wire|line|point/i.test(app.scene.style?.representation ?? '');
    return confirmDialog({ title: 'Show a large supercell?', message: `${N.join(' × ')} repeats show about ${fmtInt(total)} atoms. The view may turn slow${light ? '' : ', especially with bonds and effects on; the Wireframe style is lighter'}.`, confirm: 'Show supercell' });
  }
  return true;
}

registerInspectorTab({
  id: 'scene', title: 'Scene', icon: 'layers', tip: 'Background, unit cell, supercell, bonds, labels and camera',
  render(app, el, shell) {
    const D = app.scene.display;
    const q = (path) => shell.quiet((v) => app.set(path, v));
    const s = app.structure;
    const bg = D.background;
    const presets = [['#ffffff', '#ffffff', 'solid'], ['#f7f8fa', '#dde2e8', 'gradient'], ['#efebe6', '#d4cdc5', 'gradient'], ['#252a31', '#0f1114', 'gradient'], ['#3a4048', '#121418', 'radial'], ['#000000', '#000000', 'solid']];
    const quick = h('div.chips', ...presets.map(([a, b, m]) => {
      const c = h('button.chip', { type: 'button', 'aria-pressed': 'true', 'aria-label': `Background ${a}`, style: { padding: '0 4px' } }, h('span.dot', { style: { background: m === 'solid' ? a : `linear-gradient(${a}, ${b})`, width: '22px', height: '16px', borderRadius: '4px' } }));
      c.addEventListener('click', () => app.patch({ display: { background: { mode: m, color1: a, color2: b } } }));
      return c;
    }));
    el.append(section('Background',
      seg([{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }, { value: 'radial', label: 'Radial' }, { value: 'transparent', label: 'None', tip: 'Transparent — for PNG export onto slides' }], bg.mode, (v) => app.set('display.background.mode', v)),
      h('div.row', h('span.ctl-label', { style: { width: '96px' } }, bg.mode === 'solid' ? 'Colour' : 'Colours'), colorInput(bg.color1, q('display.background.color1')), bg.mode === 'gradient' || bg.mode === 'radial' ? colorInput(bg.color2, q('display.background.color2')) : null),
      quick));

    supercellSyncOff?.(); supercellSyncOff = null;
    if (s?.periodic) {
      const c = D.cell;
      // repeats are typed into all three fields and applied together (Enter or Apply), so that typing
      // 20, 20, 3 never builds 20 × 1 × 1 and 20 × 20 × 1 on the way.
      // `cur` is the supercell shown now; it is re-read because the panel is not rebuilt while a field has focus
      const curOf = () => (app.scene.display.supercell ?? [1, 1, 1]).map((x) => x | 0 || 1);
      let cur = curOf();
      if (stagedSupercell && stagedSupercell.structure !== s) stagedSupercell = null;
      const start = stagedSupercell?.v ?? cur;
      const inputs = ['a', 'b', 'c'].map((ax, k) => h('input.field.num', { type: 'number', min: 1, max: 20, step: 1, value: start[k], 'aria-label': `Repeat along ${ax}`, disabled: !s.pbc[k] }));
      const triple = h('div.triple', ...['a', 'b', 'c'].map((ax, k) => h('label', ax, inputs[k])));
      const read = () => inputs.map((inp, k) => (s.pbc[k] ? Math.max(1, Math.min(20, Math.round(+inp.value) || 1)) : cur[k]));
      const est = h('span.sc-est');
      const applyBtn = btn('Apply', { cls: 'primary small', tip: 'Show these repeats', kbd: 'Enter' });
      const undoBtn = btn('Cancel', { cls: 'ghost small', tip: 'Go back to the repeats shown now', kbd: 'Esc' });
      const pending = h('div.sc-pending', { hidden: true, role: 'status' }, est, undoBtn, applyBtn);
      const sync = () => {
        cur = curOf();
        const v = read();
        const changed = v.some((x, k) => x !== cur[k]);
        stagedSupercell = changed ? { structure: s, v } : null;
        pending.hidden = !changed;
        if (changed) est.textContent = `${v.join(' × ')} · about ${fmtInt(estimateDisplayCount(s, v, app.scene.display))} atoms`;
      };
      const revert = () => { stagedSupercell = null; cur = curOf(); inputs.forEach((inp, k) => { inp.value = cur[k]; }); sync(); };
      let asking = false;
      const apply = async () => {
        cur = curOf();
        const v = read();
        if (asking || v.every((x, k) => x === cur[k])) return;
        asking = true;
        let ok = false;
        try { ok = await supercellAllowed(app, v, s); } finally { asking = false; }
        if (!ok) return;
        stagedSupercell = null;
        app.set('display.supercell', v);
        sync();   // the fields now match what is shown: no pending bar while focus stays in a field
      };
      const off = app.on('scene', () => {
        if (!triple.isConnected) { off(); if (supercellSyncOff === off) supercellSyncOff = null; return; }
        // undo/redo or a script changed the repeats: show them unless the user has typed values of their own
        if (!stagedSupercell) { const live = curOf(); inputs.forEach((inp, k) => { if (+inp.value !== live[k]) inp.value = live[k]; }); }
        sync();
      });
      supercellSyncOff = off;
      applyBtn.addEventListener('click', apply);
      undoBtn.addEventListener('click', revert);
      inputs.forEach((inp) => {
        inp.addEventListener('input', sync);
        inp.addEventListener('change', sync);
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); sync(); apply(); }
          else if (e.key === 'Escape' && stagedSupercell) { e.preventDefault(); e.stopPropagation(); revert(); }
        });
      });
      sync();
      const n = D.supercell.reduce((a, b) => a * b, 1) * s.length;
      el.append(section('Unit cell',
        toggle({ label: 'Show cell edges', checked: !!c.show, onChange: (v) => app.set('display.cell.show', v) }),
        c.show ? seg([{ value: 'unit', label: 'Unit cell' }, { value: 'supercell', label: 'Outline' }, { value: 'grid', label: 'All cells' }], c.which ?? 'unit', (v) => app.set('display.cell.which', v)) : null,
        c.show ? field('Line colour', colorInput(c.color, q('display.cell.color'), 'Cell line colour')) : null,
        c.show ? slider({ label: 'Line width', key: 'cell-line-width', value: c.width ?? 1.6, min: 0.5, max: 5, step: 0.1, fmt: (v) => `${f1(v)} px`, onInput: q('display.cell.width') }) : null,
        c.show ? toggle({ label: 'Axis letters (O, a, b, c)', checked: c.labels !== false, onChange: (v) => app.set('display.cell.labels', v) }) : null));
      const scHead = h('div.row', h('span.ctl-label', { 'data-tip': 'Repeats along a, b and c. Only the view changes; Make supercell real in the Structure panel changes the structure.' }, 'Supercell'),
        h('span.muted.aio-sub', { style: { marginLeft: 'auto' } }, 'display only'));
      el.append(section('Repeat & boundaries', scHead, triple, pending,
        n > 60000 ? h('p.hint', { style: { color: 'var(--warn)' } }, `${n.toLocaleString()} atoms — rendering may be slow.`) : null,
        toggle({ label: 'Wrap atoms into the cell', checked: D.wrap !== false, onChange: (v) => app.set('display.wrap', v) }),
        toggle({ label: 'Atoms on cell faces', sub: 'Repeat atoms sitting on the boundary, as in textbook drawings', checked: D.boundaryAtoms !== false, onChange: (v) => app.set('display.boundaryAtoms', v) }),
        toggle({ label: 'Bonded atoms outside the cell', sub: 'Complete coordination shells across the boundary', checked: !!D.completeBonds, onChange: (v) => app.set('display.completeBonds', v) })));
    }

    const B = D.bonds;
    const bondSec = section('Bonds',
      toggle({ label: 'Show bonds', checked: B.show !== false, onChange: (v) => app.set('display.bonds.show', v) }),
      slider({ label: 'Tolerance', value: B.tolerance ?? 1.15, min: 0.8, max: 1.6, step: 0.01, fmt: (v) => `×${f2(v)}`, onInput: q('display.bonds.tolerance'), tip: 'Bond if distance < tolerance × (r₁ + r₂), covalent radii' }),
      toggle({ label: 'Chemistry-aware defaults', sub: 'No metal–metal bonds in ionic solids', checked: B.smart !== false, onChange: (v) => app.set('display.bonds.smart', v) }));
    if (s) {
      const m = app.viewer.model;
      const stats = m ? Object.fromEntries(bondPairStats(m.symbols, m.bonds).map((x) => [x.pair, x])) : {};
      const els = s.elements();
      const pairs = candidatePairs(s.symbols, B.tolerance ?? 1.15);
      if (pairs.length <= 28) {
        const list = h('div', { style: { display: 'grid', gap: '2px' } });
        for (const p of pairs) {
          const def = B.smart !== false ? smartPairDefault(p.pair, els) : true;
          const on = B.pairOverrides?.[p.pair] ?? def;
          const st = stats[p.pair];
          const id = `pair-${p.pair}`;
          const cb = h('input', { type: 'checkbox', id, checked: on });
          cb.addEventListener('change', () => app.set('display.bonds.pairOverrides', { ...B.pairOverrides, [p.pair]: cb.checked }));
          list.append(h('label.row', { for: id, style: { fontSize: '12.5px', cursor: 'pointer', padding: '2px 0' } }, cb, h('b', { style: { fontWeight: 500, minWidth: '54px' } }, p.pair.replace('-', '–')),
            h('span.muted.num', { style: { fontSize: '11.5px', marginLeft: 'auto' } }, st ? `${st.count} × ${st.min.toFixed(2)}${st.max - st.min > 0.01 ? `–${st.max.toFixed(2)}` : ''} Å` : `≤ ${p.cutoff.toFixed(2)} Å`)));
        }
        bondSec.append(h('div.sub-h', 'Element pairs'), list);
      }
    }
    el.append(bondSec);

    el.append(section('Labels & overlays',
      seg([{ value: 'none', label: 'None' }, { value: 'element', label: 'Element' }, { value: 'index', label: 'Index' }, { value: 'both', label: 'Both' }], D.labels ?? 'none', (v) => app.set('display.labels', v), { label: 'Atom labels' }),
      D.labels !== 'none' ? slider({ label: 'Size', value: D.labelSize ?? 12, min: 8, max: 24, step: 1, fmt: (v) => `${v}px`, onInput: q('display.labelSize') }) : null,
      s && s.length > 600 && D.labels !== 'none' ? h('p.hint', 'Large structure: only selected atoms are labelled.') : null,
      field('Legend', seg([{ value: 'auto', label: 'Auto', tip: 'A colour bar when atoms are coloured by a property' }, { value: 'always', label: 'Always', tip: 'Also list the elements and their colours' }, { value: 'none', label: 'Off', tip: 'No legend' }], D.legend ?? 'auto', (v) => app.set('display.legend', v), { label: 'Legend' }), 'Colour key in the view and in exported images'),
      toggle({ label: 'Scale bar', sub: 'A length bar (1, 2 or 5 Å steps), also in exported images', checked: !!D.scaleBar, onChange: (v) => app.set('display.scaleBar', v) })));

    el.append(section('Camera',
      seg([{ value: 'perspective', label: 'Perspective' }, { value: 'orthographic', label: 'Orthographic' }], D.projection, (v) => app.set('display.projection', v)),
      D.projection === 'perspective' ? slider({ label: 'Field of view', value: D.fov ?? 30, min: 10, max: 75, step: 1, fmt: f0, onInput: q('display.fov') }) : null,
      field('Rotation', seg([{ value: 'orbit', label: 'Orbit', tip: 'Keeps the up direction — easy to control' }, { value: 'trackball', label: 'Free', tip: 'Trackball: rotate freely in any direction' }], D.controls ?? 'orbit', (v) => app.set('display.controls', v))),
      toggle({ label: 'Flat views along axes', sub: 'Views along a, b, c, x, y or z use an orthographic camera until you rotate', checked: D.orthoAxisViews !== false, onChange: (v) => app.set('display.orthoAxisViews', v) }),
      toggle({ label: 'Axis indicator', checked: D.axes !== false, onChange: (v) => app.set('display.axes', v) }),
      toggle({ label: 'Turntable', sub: 'Slowly rotate around the vertical axis', checked: !!D.turntable, onChange: (v) => app.set('display.turntable', v) })));
  },
});
