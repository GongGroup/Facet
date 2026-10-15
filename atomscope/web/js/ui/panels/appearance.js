/** Inspector tabs: Style (looks, representation, colours, material, sizes), Light, Effects, Scene. */
import { h, ic, btn, slider, toggle, seg, select, colorInput, section, field } from '../dom.js';
import { looks } from '../../render/looks.js';
import { styles } from '../../render/styles.js';
import { colorSchemes, elementColorHex } from '../../render/colors.js';
import { materials } from '../../render/materials.js';
import { lightingPresets } from '../../render/lighting.js';
import { element } from '../../core/elements.js';
import { candidatePairs, bondPairStats } from '../../core/bonds.js';
import { smartPairDefault } from '../../render/display.js';
import { registerInspectorTab } from '../shell.js';

const f2 = (v) => (+v).toFixed(2), f1 = (v) => (+v).toFixed(1), f0 = (v) => `${Math.round(v)}°`;

// ------------------------------------------------------------------ Style
registerInspectorTab({
  id: 'style', title: 'Style', icon: 'style', tip: 'Looks, representation, colours and materials',
  render(app, el, shell) {
    const S = app.scene.style;
    const q = (path) => shell.quiet((v) => app.set(path, v));

    // looks
    const lookGrid = h('div.grid-cards');
    for (const l of looks.list().filter((x) => !x.hidden)) {
      const b = h('button.card-btn', { type: 'button', 'aria-pressed': String(app.scene.look === l.id), 'data-tip': l.description },
        h('div.sw', { style: { background: l.swatch } }), h('div.nm', l.name));
      b.addEventListener('click', () => app.applyLook(l.id));
      lookGrid.append(b);
    }
    el.append(section(h('h3', h('span.grow', 'Looks'), h('span.muted', { style: { textTransform: 'none', letterSpacing: 0, fontWeight: 400 } }, 'material + light + effects')), lookGrid));

    // representation
    const repGrid = h('div.rep-grid');
    styles.list().forEach((s, i) => {
      const b = h('button.rep-btn', { type: 'button', 'aria-pressed': String(S.rep === s.id), 'data-tip': s.description, 'data-kbd': i < 9 ? String(i + 1) : null, html: s.icon });
      b.append(h('span', s.name));
      b.addEventListener('click', () => app.setRepresentation(s.id));
      repGrid.append(b);
    });
    el.append(section('Representation', repGrid));

    // colour
    const groups = {};
    for (const c of colorSchemes.list()) { if (c.available && !c.available(app.structure)) continue; (groups[c.group] ??= []).push({ value: c.id, label: c.name }); }
    const schemeSel = select({ options: Object.entries(groups).map(([g, options]) => ({ group: g === 'Element' ? 'By element' : g, options })), value: S.colorScheme, onChange: (v) => app.set('style.colorScheme', v), label: 'Colour scheme' });
    const colorSec = section('Colour', field('Scheme', schemeSel, colorSchemes.get(S.colorScheme)?.description));
    if (S.colorScheme === 'mono') colorSec.append(field('Colour', colorInput(S.monoColor, q('style.monoColor'))));
    if (app.structure) {
      const comp = app.structure.composition();
      const hidden = new Set(app.scene.display.hiddenElements ?? []);
      const list = h('div');
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
        list.append(h('div.elem-row', ci, h('span', h('span.sym', sym), ' ', h('span.nm', e.name)), h('span.num.muted', { style: { fontSize: '11.5px' } }, `×${comp[sym]}`), eye,
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
    el.append(section(h('h3', h('span.grow', 'Material'), h('span', { style: { textTransform: 'none', letterSpacing: 0, color: 'var(--fg-2)', fontWeight: 500 } }, mat?.name ?? '')), matGrid,
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
  id: 'light', title: 'Light', icon: 'sun', tip: 'Lighting presets, key/fill/rim lights, shadows and exposure',
  render(app, el, shell) {
    const L = app.scene.lighting;
    const q = (path) => shell.quiet((v) => app.set(path, v));
    const grid = h('div.grid-cards');
    for (const p of lightingPresets.list()) {
      const b = h('button.card-btn.light-card', { type: 'button', 'aria-pressed': String(L.preset === p.id), 'data-tip': p.description },
        h('div.sw', ...p.swatch.map((c) => h('span', { style: { background: c } }))), h('div.nm', p.name));
      b.addEventListener('click', () => app.setLightingPreset(p.id));
      grid.append(b);
    }
    el.append(section('Lighting rig', grid,
      toggle({ label: 'Lights follow the camera', sub: 'Shading stays the same while you rotate. Turn off to fix lights in the scene.', checked: L.follow !== false, onChange: (v) => app.set('lighting.follow', v) })));

    const lightCtl = (key, title, { dir = true } = {}) => {
      const p = L[key] ?? {};
      return section(h('h3', h('span.grow', title), colorInput(p.color ?? '#ffffff', q(`lighting.${key}.color`), `${title} colour`)),
        slider({ label: 'Intensity', value: p.intensity ?? 0, min: 0, max: 6, step: 0.05, fmt: f2, onInput: q(`lighting.${key}.intensity`) }),
        dir ? slider({ label: 'Direction', value: p.azimuth ?? 0, min: -180, max: 180, step: 1, fmt: f0, onInput: q(`lighting.${key}.azimuth`), tip: 'Azimuth: 0° from the viewer, 90° from the right' }) : null,
        dir ? slider({ label: 'Height', value: p.elevation ?? 0, min: -90, max: 90, step: 1, fmt: f0, onInput: q(`lighting.${key}.elevation`), tip: 'Elevation: 90° straight from above' }) : null);
    };
    el.append(lightCtl('key', 'Key light'), lightCtl('fill', 'Fill light'), lightCtl('rim', 'Rim / back light'));
    el.append(section('Ambient',
      slider({ label: 'Sky light', value: L.hemi?.intensity ?? 0, min: 0, max: 3, step: 0.05, fmt: f2, onInput: q('lighting.hemi.intensity'), tip: 'Hemisphere light: sky colour from above, ground colour from below' }),
      h('div.row', h('span.ctl-label', { style: { width: '96px' } }, 'Sky / ground'), colorInput(L.hemi?.sky ?? '#fff', q('lighting.hemi.sky'), 'Sky colour'), colorInput(L.hemi?.ground ?? '#444', q('lighting.hemi.ground'), 'Ground colour')),
      slider({ label: 'Flat ambient', value: L.ambient?.intensity ?? 0, min: 0, max: 3, step: 0.05, fmt: f2, onInput: q('lighting.ambient.intensity') }),
      toggle({ label: 'Environment reflections', sub: 'Image-based light from a virtual studio room', checked: !!L.env?.enabled, onChange: (v) => { app.set('lighting.env.enabled', v); } }),
      L.env?.enabled ? slider({ label: 'Strength', value: L.env.intensity ?? 0.5, min: 0, max: 3, step: 0.05, fmt: f2, onInput: q('lighting.env.intensity') }) : null));
    const sh = L.shadows ?? {};
    el.append(section('Shadows',
      toggle({ label: 'Cast shadows', sub: 'Atoms shadow each other from the key light', checked: !!sh.enabled, onChange: (v) => app.set('lighting.shadows.enabled', v) }),
      sh.enabled ? slider({ label: 'Softness', value: sh.softness ?? 3, min: 0, max: 10, step: 0.5, fmt: f1, onInput: q('lighting.shadows.softness') }) : null,
      sh.enabled ? toggle({ label: 'Shadow floor', sub: 'Ground plane under the structure; best with fixed lights', checked: !!sh.floor, onChange: (v) => app.set('lighting.shadows.floor', v) }) : null));
    el.append(section('Camera',
      slider({ label: 'Exposure', value: L.exposure ?? 1, min: 0.2, max: 2.5, step: 0.01, fmt: f2, onInput: q('lighting.exposure') }),
      field('Tone mapping', select({ options: [{ value: 'neutral', label: 'Neutral (true colours)' }, { value: 'agx', label: 'AgX (filmic, soft)' }, { value: 'aces', label: 'ACES (contrasty)' }, { value: 'reinhard', label: 'Reinhard' }, { value: 'cineon', label: 'Cineon' }, { value: 'linear', label: 'Linear' }, { value: 'none', label: 'None' }], value: L.toneMapping ?? 'neutral', onChange: (v) => app.set('lighting.toneMapping', v) }), 'How bright highlights are compressed into the screen range')));
  },
});

// ------------------------------------------------------------------ Effects
registerInspectorTab({
  id: 'effects', title: 'Effects', icon: 'sparkles', tip: 'Ambient occlusion, outlines, depth cueing, bloom, depth of field',
  render(app, el, shell) {
    const P = app.scene.post;
    const q = (path) => shell.quiet((v) => app.set(path, v));
    const fx = (key, title, sub, controls) => section(toggle({ label: title, sub, checked: !!P[key]?.enabled, onChange: (v) => app.set(`post.${key}.enabled`, v) }), ...(P[key]?.enabled ? controls() : []));
    el.append(
      fx('ao', 'Ambient occlusion', 'Soft contact shadows where atoms meet — adds depth', () => [
        slider({ label: 'Strength', value: P.ao.intensity ?? 1, min: 0, max: 2.5, step: 0.05, fmt: f2, onInput: q('post.ao.intensity') }),
        slider({ label: 'Radius', value: P.ao.radius ?? 0.6, min: 0.1, max: 3, step: 0.05, fmt: (v) => `${f2(v)} Å`, onInput: q('post.ao.radius') })]),
      fx('outline', 'Ink outlines', 'Silhouette and crease lines for an illustrated look', () => [
        slider({ label: 'Thickness', value: P.outline.thickness ?? 1.5, min: 0.5, max: 5, step: 0.1, fmt: (v) => `${f1(v)} px`, onInput: q('post.outline.thickness') }),
        slider({ label: 'Strength', value: P.outline.strength ?? 1, min: 0.1, max: 1, step: 0.05, fmt: f2, onInput: q('post.outline.strength') }),
        slider({ label: 'Sensitivity', value: P.outline.sensitivity ?? 1, min: 0.2, max: 3, step: 0.05, fmt: f2, onInput: q('post.outline.sensitivity') }),
        h('div.row', h('span.ctl-label', { style: { width: '96px' } }, 'Ink colour'), colorInput(P.outline.color ?? '#111', q('post.outline.color'))),
        toggle({ label: 'Crease lines', sub: 'Also draw lines where surfaces meet', checked: P.outline.creases !== false, onChange: (v) => app.set('post.outline.creases', v) })]),
      fx('fog', 'Depth cueing', 'Fade distant atoms into the background', () => [
        slider({ label: 'Strength', value: P.fog.strength ?? 0.5, min: 0, max: 1, step: 0.01, fmt: f2, onInput: q('post.fog.strength') })]),
      fx('bloom', 'Bloom', 'Glow around bright highlights — try with Glow or Neon', () => [
        slider({ label: 'Strength', value: P.bloom.strength ?? 0.6, min: 0, max: 3, step: 0.05, fmt: f2, onInput: q('post.bloom.strength') }),
        slider({ label: 'Radius', value: P.bloom.radius ?? 0.4, min: 0, max: 1, step: 0.01, fmt: f2, onInput: q('post.bloom.radius') }),
        slider({ label: 'Threshold', value: P.bloom.threshold ?? 0.8, min: 0, max: 1, step: 0.01, fmt: f2, onInput: q('post.bloom.threshold') })]),
      fx('dof', 'Depth of field', 'Camera blur in front of and behind the focus point', () => [
        slider({ label: 'Aperture', value: P.dof.aperture ?? 2, min: 0.1, max: 10, step: 0.1, fmt: f1, onInput: q('post.dof.aperture') }),
        slider({ label: 'Max blur', value: P.dof.maxblur ?? 0.008, min: 0.001, max: 0.03, step: 0.001, fmt: (v) => (+v).toFixed(3), onInput: q('post.dof.maxblur') }),
        h('p.hint', 'Focus follows the rotation centre. Double-click an atom to focus on it.')]),
      fx('vignette', 'Vignette', 'Darken the corners of the frame', () => [
        slider({ label: 'Darkness', value: P.vignette.darkness ?? 1.1, min: 0, max: 2, step: 0.05, fmt: f2, onInput: q('post.vignette.darkness') }),
        slider({ label: 'Size', value: P.vignette.offset ?? 1, min: 0.2, max: 2, step: 0.05, fmt: f2, onInput: q('post.vignette.offset') })]),
      h('p.hint', { style: { paddingTop: '12px' } }, 'Effects run on your graphics card. For very large systems, turn them off or set Quality to Low in the Style tab.'),
    );
  },
});

// ------------------------------------------------------------------ Scene
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

    if (s?.periodic) {
      const c = D.cell;
      const triple = h('div.triple');
      ['a', 'b', 'c'].forEach((ax, k) => {
        const inp = h('input.field.num', { type: 'number', min: 1, max: 20, step: 1, value: D.supercell[k], 'aria-label': `Repeat along ${ax}`, disabled: !s.pbc[k] });
        inp.addEventListener('change', () => { const v = [...D.supercell]; v[k] = Math.max(1, Math.min(20, inp.value | 0)); app.set('display.supercell', v); });
        triple.append(h('label', ax, inp));
      });
      const n = D.supercell.reduce((a, b) => a * b, 1) * s.length;
      el.append(section('Unit cell',
        toggle({ label: 'Show cell edges', checked: !!c.show, onChange: (v) => app.set('display.cell.show', v) }),
        c.show ? seg([{ value: 'unit', label: 'Unit cell' }, { value: 'supercell', label: 'Outline' }, { value: 'grid', label: 'All cells' }], c.which ?? 'unit', (v) => app.set('display.cell.which', v)) : null,
        c.show ? h('div.row', h('span.ctl-label', { style: { width: '96px' } }, 'Line'), colorInput(c.color, q('display.cell.color')), h('div', { style: { flex: 1 } }, slider({ label: '', value: c.width ?? 1.6, min: 0.5, max: 5, step: 0.1, fmt: (v) => `${f1(v)}px`, onInput: q('display.cell.width') }))) : null,
        c.show ? toggle({ label: 'Axis letters (O, a, b, c)', checked: c.labels !== false, onChange: (v) => app.set('display.cell.labels', v) }) : null));
      el.append(section('Repeat & boundaries', h('div.sub-h', 'Supercell (display only)'), triple,
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

    el.append(section('Labels',
      seg([{ value: 'none', label: 'None' }, { value: 'element', label: 'Element' }, { value: 'index', label: 'Index' }, { value: 'both', label: 'Both' }], D.labels ?? 'none', (v) => app.set('display.labels', v)),
      D.labels !== 'none' ? slider({ label: 'Size', value: D.labelSize ?? 12, min: 8, max: 24, step: 1, fmt: (v) => `${v}px`, onInput: q('display.labelSize') }) : null,
      s && s.length > 600 && D.labels !== 'none' ? h('p.hint', 'Large structure: only selected atoms are labelled.') : null));

    el.append(section('Camera',
      seg([{ value: 'perspective', label: 'Perspective' }, { value: 'orthographic', label: 'Orthographic' }], D.projection, (v) => app.set('display.projection', v)),
      D.projection === 'perspective' ? slider({ label: 'Field of view', value: D.fov ?? 30, min: 10, max: 75, step: 1, fmt: f0, onInput: q('display.fov') }) : null,
      field('Rotation', seg([{ value: 'orbit', label: 'Orbit', tip: 'Keeps the up direction — easy to control' }, { value: 'trackball', label: 'Free', tip: 'Trackball: rotate freely in any direction' }], D.controls ?? 'orbit', (v) => app.set('display.controls', v))),
      toggle({ label: 'Axis indicator', checked: D.axes !== false, onChange: (v) => app.set('display.axes', v) }),
      toggle({ label: 'Turntable', sub: 'Slowly rotate around the vertical axis', checked: !!D.turntable, onChange: (v) => app.set('display.turntable', v) })));
  },
});
