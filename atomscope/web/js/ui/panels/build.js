/** Builder panel: crystals from prototypes, nanoclusters, molecules and pasted text. */
import { h, btn, seg, select, slider, field } from '../dom.js';
import { prototypes, buildCrystal } from '../../build/crystal.js';
import { clusters, buildCluster, nnDistance } from '../../build/cluster.js';
import { MOLECULES, buildMolecule } from '../../build/molecules.js';
import { normalizeSymbol, ELEMENTS } from '../../core/elements.js';
import { formats } from '../../io/index.js';
import { toast } from '../overlays.js';
import { registerLeftPanel } from '../shell.js';

const state = { tab: 'crystal', proto: 'perovskite', params: {}, cluster: 'icosahedron', cel: 'Au', csize: null, paste: '', pasteFmt: '' };

function elementInput(value, onChange, label) {
  const listId = 'elements-datalist';
  if (!document.getElementById(listId)) document.body.append(h('datalist', { id: listId }, ...[...ELEMENTS.keys()].filter((s) => s !== 'X').map((s) => h('option', { value: s }))));
  const inp = h('input.field', { value, list: listId, 'aria-label': label, style: { width: '64px', textAlign: 'center', fontWeight: 600 }, maxlength: 3, spellcheck: false });
  inp.addEventListener('change', () => { const s = normalizeSymbol(inp.value); inp.value = s === 'X' ? '' : s; if (s !== 'X') onChange(s); });
  return inp;
}

registerLeftPanel({
  id: 'build', title: 'Build', icon: 'build', tip: 'Build crystals, nanoclusters and molecules',
  render(app, el, shell) {
    const rerender = () => shell.renderDrawer();
    const custom = app.serverStore.info?.customBuilders ?? [];
    const tabs = [{ value: 'crystal', label: 'Crystal' }, { value: 'cluster', label: 'Cluster' }, { value: 'molecule', label: 'Molecule' }, { value: 'paste', label: 'Paste' }];
    if (custom.length) tabs.push({ value: 'plugins', label: 'Plugins', tip: 'Builders provided by server plugins' });
    el.append(h('div', { style: { padding: '0 0 10px' } }, seg(tabs, state.tab, (v) => { state.tab = v; rerender(); })));
    const body = h('div', { style: { display: 'grid', gap: '12px' } });
    el.append(body);

    if (state.tab === 'crystal') {
      const p = prototypes.get(state.proto);
      const prm = (state.params[p.id] ??= { elements: [...p.defaults.elements], a: p.defaults.a, c: p.defaults.c, u: p.defaults.u, repeat: p.twoD ? [3, 3, 1] : [2, 2, 2] });
      const protoSel = select({ options: [{ group: 'Cubic', options: prototypes.list().filter((x) => x.lattice === 'cubic').map((x) => ({ value: x.id, label: x.name })) }, { group: 'Hexagonal & tetragonal', options: prototypes.list().filter((x) => x.lattice !== 'cubic' && !x.twoD).map((x) => ({ value: x.id, label: x.name })) }, { group: '2D', options: prototypes.list().filter((x) => x.twoD).map((x) => ({ value: x.id, label: x.name })) }], value: p.id, onChange: (v) => { state.proto = v; rerender(); }, label: 'Prototype' });
      const preview = h('div.callout');
      const update = () => {
        try {
          const s = buildCrystal(p.id, prm);
          preview.replaceChildren(h('div.row', h('b', { style: { fontSize: '15px' } }, s.formula({ reduce: true })), h('span.muted', { style: { marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '12px' } }, `${s.length} atoms · ${s.density()?.toFixed(2)} g/cm³`)), h('span.hint', `${p.description} · ${p.spacegroup}`));
        } catch (e) { preview.replaceChildren(h('span.err-text', e.message)); }
      };
      const roles = h('div.row', { style: { flexWrap: 'wrap' } }, ...p.roles.map((r, i) => h('label.row', { style: { gap: '6px', fontSize: '12.5px', color: 'var(--muted)' } }, r, elementInput(prm.elements[i], (v) => { prm.elements[i] = v; update(); }, `Element ${r}`))));
      const num = (key, label, step = 0.001, tip) => {
        const inp = h('input.field.num', { type: 'number', step, value: prm[key], min: 0, 'aria-label': label });
        inp.addEventListener('input', () => { prm[key] = +inp.value; update(); });
        return field(label, inp, tip);
      };
      const rep = h('div.triple', ...['a', 'b', 'c'].map((ax, k) => { const i = h('input.field.num', { type: 'number', min: 1, max: 30, value: prm.repeat[k], 'aria-label': `Repeat ${ax}` }); i.addEventListener('input', () => { prm.repeat[k] = Math.max(1, i.value | 0); update(); }); return h('label', `${ax}`, i); }));
      body.append(field('Prototype', protoSel), h('div.sub-h', 'Elements'), roles,
        num('a', 'a (Å)', 0.001, 'Lattice constant'),
        p.defaults.c != null ? num('c', p.twoD ? 'Vacuum c (Å)' : 'c (Å)', 0.001) : null,
        p.defaults.u != null ? num('u', 'u (internal)', 0.001, 'Internal coordinate of the anion') : null,
        h('div.sub-h', 'Repeat (build a supercell)'), rep, preview,
        h('div.row', btn('Build crystal', { icon: 'build', cls: 'primary', on: () => { try { const s = buildCrystal(p.id, prm); app.addStructure(s, { look: p.id === 'perovskite' || p.id === 'rutile' ? 'polyhedra-studio' : null }); toast(`Built ${s.name}`); } catch (e) { toast(e.message, { type: 'error' }); } } }),
          h('span.hint', 'Adds to the current project.')));
      update();
    }

    if (state.tab === 'cluster') {
      const c = clusters.get(state.cluster);
      if (state.csize == null || state.csize < (c.min ?? 0) || state.csize > (c.max ?? 99)) state.csize = c.default;
      const kindSel = select({ options: clusters.list().map((x) => ({ value: x.id, label: x.name })), value: c.id, onChange: (v) => { state.cluster = v; state.csize = null; rerender(); }, label: 'Cluster shape' });
      const info = h('div.callout');
      let nn = null;
      const update = () => {
        try {
          const s = buildCluster(c.id, { element: state.cel, size: state.csize, d: nn ?? undefined });
          info.replaceChildren(h('div.row', h('b', { style: { fontSize: '15px' } }, s.formula()), h('span.muted', { style: { marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '12px' } }, `${s.length} atoms`)), h('span.hint', c.description));
        } catch (e) { info.replaceChildren(h('span.err-text', e.message)); }
      };
      const nnInput = h('input.field.num', { type: 'number', step: 0.01, placeholder: nnDistance(state.cel).toFixed(3), 'aria-label': 'Nearest-neighbour distance' });
      nnInput.addEventListener('input', () => { nn = nnInput.value ? +nnInput.value : null; update(); });
      body.append(field('Shape', kindSel),
        !c.fixedElement ? field('Element', elementInput(state.cel, (v) => { state.cel = v; nnInput.placeholder = nnDistance(v).toFixed(3); update(); }, 'Cluster element')) : null,
        c.sizeLabel ? slider({ label: c.sizeLabel.replace(/ \(.*\)/, ''), value: state.csize, min: c.min, max: c.max, step: c.step ?? 1, fmt: (v) => String(v), onInput: (v) => { state.csize = v; update(); }, tip: c.sizeLabel }) : null,
        !c.fixedElement ? field('NN distance (Å)', nnInput, 'Nearest-neighbour distance; leave empty for the element’s bulk value') : null,
        info,
        h('div.row', btn('Build cluster', { icon: 'build', cls: 'primary', on: () => { try { const s = buildCluster(c.id, { element: state.cel, size: state.csize, d: nn ?? undefined }); app.addStructure(s); toast(`Built ${s.name}`); } catch (e) { toast(e.message, { type: 'error' }); } } })));
      update();
    }

    if (state.tab === 'molecule') {
      const grid = h('div.grid-cards.two');
      for (const [id, m] of Object.entries(MOLECULES)) {
        const b = h('button.sample-item', { type: 'button' }, h('span', h('b', m.name)), h('span.count', `${m.build().symbols.length} atoms`));
        b.addEventListener('click', () => { app.addStructure(buildMolecule(id)); toast(`Added ${m.name}`); });
        grid.append(b);
      }
      body.append(grid, h('p.hint', 'Ideal gas-phase geometries for quick illustrations.'));
    }

    if (state.tab === 'plugins') {
      for (const b of custom) {
        const vals = Object.fromEntries((b.params ?? []).map((p) => [p.name, p.default]));
        const controls = (b.params ?? []).map((p) => {
          if (p.type === 'bool') { const c = h('input', { type: 'checkbox', checked: !!p.default }); c.addEventListener('change', () => { vals[p.name] = c.checked; }); return field(p.label ?? p.name, h('span', c)); }
          if (p.type === 'element') return field(p.label ?? p.name, elementInput(p.default ?? 'C', (v) => { vals[p.name] = v; }, p.label ?? p.name));
          const inp = h('input.field.num', { type: p.type === 'int' || p.type === 'float' ? 'number' : 'text', value: p.default ?? '', min: p.min, max: p.max, step: p.type === 'int' ? 1 : 'any' });
          inp.addEventListener('input', () => { vals[p.name] = p.type === 'int' ? parseInt(inp.value, 10) : p.type === 'float' ? parseFloat(inp.value) : inp.value; });
          return field(p.label ?? p.name, inp);
        });
        body.append(h('div.callout', h('b', b.label ?? b.name), b.description ? h('span.hint', b.description) : null, h('span.hint', `Plugin: ${b.plugin}`), ...controls,
          h('div', btn('Build', { icon: 'build', cls: 'primary small', on: async () => {
            try { const r = await app.serverStore.api(`/build/custom/${encodeURIComponent(b.name)}`, { method: 'POST', body: vals }); const st = (await import('../../core/structure.js')).Structure.fromJSON(r.structure); app.addStructure(st); toast(`Built ${st.name}`); }
            catch (e) { toast(e.message, { type: 'error' }); }
          } }))));
      }
    }

    if (state.tab === 'paste') {
      const ta = h('textarea.field', { rows: 12, placeholder: 'Paste CIF, POSCAR, XYZ or PDB text here…', spellcheck: false, style: { fontFamily: 'var(--font-mono)', fontSize: '11.5px' } }, state.paste);
      ta.addEventListener('input', () => { state.paste = ta.value; });
      const fmtSel = select({ options: [{ value: '', label: 'Detect automatically' }, ...formats.readers().map((f) => ({ value: f.id, label: f.name }))], value: state.pasteFmt, onChange: (v) => { state.pasteFmt = v; }, label: 'Format' });
      const err = h('p.err-text', { hidden: true });
      body.append(ta, field('Format', fmtSel), err, h('div.row', btn('Load structure', { icon: 'upload', cls: 'primary', on: async () => {
        try { const s = await app.importText(state.paste, 'pasted', state.pasteFmt || null); err.hidden = true; toast(`Loaded ${s.length} atoms`); }
        catch (e) { err.hidden = false; err.textContent = e.message; }
      } })));
    }
  },
});
