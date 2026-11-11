/** Builder panel: crystals from prototypes, nanoclusters, molecules, plugin builders and pasted text. */
import { h, btn, seg, select, slider, field } from '../dom.js';
import { prototypes, buildCrystal, referenceParameters } from '../../build/crystal.js';
import { clusters, buildCluster, nnDistance } from '../../build/cluster.js';
import { MOLECULES, buildMolecule } from '../../build/molecules.js';
import { Structure } from '../../core/structure.js';
import { formats } from '../../io/index.js';
import { toast } from '../overlays.js';
import { registerLeftPanel, formulaEl } from '../shell.js';
import { styles } from '../../render/styles.js';
import { paramForm, elementInput } from '../paramform.js';

/** Oxides with octahedra open as coordination polyhedra (rep defaults plus slightly firmer faces). */
const polyhedraScene = () => ({ style: { rep: 'polyhedra', ...styles.get('polyhedra').defaults, polyhedra: { opacity: 0.72 } } });

const state = { tab: 'crystal', proto: 'perovskite', params: {}, cluster: 'icosahedron', cel: 'Au', csize: null, paste: '', pasteFmt: '', custom: {} };

registerLeftPanel({
  id: 'build', title: 'Build', icon: 'build', tip: 'Build crystals, nanoclusters and molecules',
  render(app, el, shell) {
    const rerender = () => shell.renderDrawer();
    const custom = app.serverStore.info?.customBuilders ?? [];
    const tabs = [{ value: 'crystal', label: 'Crystal' }, { value: 'cluster', label: 'Cluster' }, { value: 'molecule', label: 'Molecule' }, { value: 'paste', label: 'Paste' }];
    if (custom.length) tabs.push({ value: 'plugins', label: 'Plugins', tip: 'Builders provided by server plugins' });
    // shell.openLeft('build', {tab: 'cluster'}) opens the panel at that tab (Build › Build Nanostructure › Nanocluster…)
    const want = shell.panelArgs?.('build')?.tab;
    if (want && tabs.some((t) => t.value === want)) state.tab = want;
    el.append(h('div', { style: { padding: '0 0 10px' } }, seg(tabs, state.tab, (v) => { state.tab = v; rerender(); })));
    const body = h('div', { style: { display: 'grid', gap: '12px' } });
    el.append(body);

    if (state.tab === 'crystal') {
      const p = prototypes.get(state.proto);
      const prm = (state.params[p.id] ??= { ...p.defaults, elements: [...p.defaults.elements], repeat: p.twoD ? [3, 3, 1] : [2, 2, 2] });
      const protoSel = select({ options: [{ group: 'Cubic', options: prototypes.list().filter((x) => x.lattice === 'cubic').map((x) => ({ value: x.id, label: x.name })) }, { group: 'Hexagonal & tetragonal', options: prototypes.list().filter((x) => x.lattice !== 'cubic' && !x.twoD).map((x) => ({ value: x.id, label: x.name })) }, { group: '2D', options: prototypes.list().filter((x) => x.twoD).map((x) => ({ value: x.id, label: x.name })) }], value: p.id, onChange: (v) => { state.proto = v; rerender(); }, label: 'Prototype' });
      const preview = h('div.callout');
      const update = () => {
        try {
          const s = buildCrystal(p.id, prm);
          preview.replaceChildren(h('div.row', h('b', { style: { fontSize: '15px' } }, formulaEl(s.formula({ reduce: true }))), h('span.muted', { style: { marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '12px' } }, `${s.length} atoms · ${s.density()?.toFixed(2)} g/cm³`)), h('span.hint', `${p.description} · ${p.spacegroup}`));
        } catch (e) { preview.replaceChildren(h('span.err-text', e.message)); }
      };
      const inputs = {};
      const shown = (v) => (Number.isFinite(+v) && v !== '' && v != null ? String(+(+v).toFixed(6)) : '');
      // A new element fills in its reference lattice parameters (tabulated, else estimated), as the Python builder does.
      const prefill = () => {
        Object.assign(prm, referenceParameters(p.id, prm.elements));
        for (const [key, inp] of Object.entries(inputs)) inp.value = shown(prm[key]);
      };
      const roles = h('div.row', { style: { flexWrap: 'wrap' } }, ...p.roles.map((r, i) => h('label.row', { style: { gap: '6px', fontSize: '12.5px', color: 'var(--muted)' } }, r, elementInput(prm.elements[i], (v) => { prm.elements[i] = v; prefill(); update(); }, `Element ${r}`))));
      const num = (key, label, step = 0.001, tip) => {
        const inp = h('input.field.num', { type: 'number', step, value: shown(prm[key]), min: 0, 'aria-label': label });
        inp.addEventListener('input', () => { prm[key] = +inp.value; update(); });
        inputs[key] = inp;
        return field(label, inp, tip);
      };
      const rep = h('div.triple', ...['a', 'b', 'c'].map((ax, k) => { const i = h('input.field.num', { type: 'number', min: 1, max: 30, value: prm.repeat[k], 'aria-label': `Repeat ${ax}` }); i.addEventListener('input', () => { prm.repeat[k] = Math.max(1, i.value | 0); update(); }); return h('label', `${ax}`, i); }));
      body.append(...[field('Prototype', protoSel), h('div.sub-h', 'Elements'), roles,
        num('a', 'a (Å)', 0.001, 'Lattice constant; changing an element fills in its reference value'),
        p.defaults.c != null ? num('c', p.twoD ? 'Cell height c (Å)' : 'c (Å)', 0.001, p.twoD ? 'Height of the cell: the layer and the vacuum around it' : undefined) : null,
        p.defaults.u != null ? num('u', 'u (internal)', 0.001, 'Internal coordinate of the anion') : null,
        p.defaults.thickness != null ? num('thickness', 'Thickness (Å)', 0.001, 'Height from the lower to the upper X layer') : null,
        h('div.sub-h', 'Repeat (build a supercell)'), rep, preview,
        h('div.row', btn('Build crystal', { icon: 'build', cls: 'primary', on: () => { try { const s = buildCrystal(p.id, prm); app.addStructure(s, { scene: p.id === 'perovskite' || p.id === 'rutile' ? polyhedraScene() : null }); toast(`Built ${s.name}`); } catch (e) { toast(e.message, { type: 'error' }); } } }),
          h('span.hint', 'Adds to the current project.'))].filter(Boolean));
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
          info.replaceChildren(h('div.row', h('b', { style: { fontSize: '15px' } }, formulaEl(s.formula())), h('span.muted', { style: { marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '12px' } }, `${s.length} atoms`)), h('span.hint', c.description));
        } catch (e) { info.replaceChildren(h('span.err-text', e.message)); }
      };
      const nnInput = h('input.field.num', { type: 'number', step: 0.01, placeholder: nnDistance(state.cel).toFixed(3), 'aria-label': 'Nearest-neighbour distance' });
      nnInput.addEventListener('input', () => { nn = nnInput.value ? +nnInput.value : null; update(); });
      body.append(...[field('Shape', kindSel),
        !c.fixedElement ? field('Element', elementInput(state.cel, (v) => { state.cel = v; nnInput.placeholder = nnDistance(v).toFixed(3); update(); }, 'Cluster element')) : null,
        c.sizeLabel ? slider({ label: c.sizeLabel.replace(/ \(.*\)/, ''), value: state.csize, min: c.min, max: c.max, step: c.step ?? 1, fmt: (v) => String(v), onInput: (v) => { state.csize = v; update(); }, tip: c.sizeLabel }) : null,
        !c.fixedElement ? field('NN distance (Å)', nnInput, 'Nearest-neighbour distance; leave empty for the element’s bulk value') : null,
        info,
        h('div.row', btn('Build cluster', { icon: 'build', cls: 'primary', on: () => { try { const s = buildCluster(c.id, { element: state.cel, size: state.csize, d: nn ?? undefined }); app.addStructure(s); toast(`Built ${s.name}`); } catch (e) { toast(e.message, { type: 'error' }); } } }))].filter(Boolean));
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
        const form = paramForm(b.params ?? [], { values: state.custom[b.name] ?? {}, onChange: (v) => { state.custom[b.name] = { ...v }; } });
        const err = h('p.err-text', { hidden: true });
        const go = btn('Build', { icon: 'build', cls: 'primary small', on: async () => {
          const bad = form.validate();
          err.hidden = !bad; err.textContent = bad ?? '';
          if (bad) return;
          go.disabled = true;
          try {
            const r = await app.serverStore.api(`/build/custom/${encodeURIComponent(b.name)}`, { method: 'POST', body: form.values });
            const st = Structure.fromJSON(r.structure);
            app.addStructure(st);
            toast(`Built ${st.name}`);
          } catch (e) { err.hidden = false; err.textContent = e.message; }
          finally { go.disabled = false; }
        } });
        body.append(h('div.callout.pf-card', h('div.row', h('b', b.label ?? b.name), h('span.an-src', { 'data-tip': 'Runs on the Facet server' }, `${b.plugin} · server`)),
          b.description ? h('span.hint', b.description) : null, form.el, err, h('div', go)));
      }
    }

    if (state.tab === 'paste') {
      const ta = h('textarea.field', { rows: 12, placeholder: 'Paste CIF, POSCAR, XYZ, PDB or XSD text here…', spellcheck: false, style: { fontFamily: 'var(--font-mono)', fontSize: '11.5px' } }, state.paste);
      ta.addEventListener('input', () => { state.paste = ta.value; });
      const readers = formats.readers();
      if (state.pasteFmt && !formats.get(state.pasteFmt)?.read) state.pasteFmt = '';
      const fmtSel = select({ options: [{ value: '', label: 'Detect automatically' }, ...readers.map((f) => ({ value: f.id, label: f.server ? `${f.id} (server)` : f.name }))], value: state.pasteFmt, onChange: (v) => { state.pasteFmt = v; }, label: 'Format' });
      const hint = readers.some((f) => f.server) ? h('p.hint', 'Formats marked (server) are read by the Facet server, including formats added by its plugins.') : null;
      const err = h('p.err-text', { hidden: true });
      body.append(...[ta, field('Format', fmtSel), hint, err].filter(Boolean), h('div.row', btn('Load structure', { icon: 'upload', cls: 'primary', on: async () => {
        try { const s = await app.importText(state.paste, 'pasted', state.pasteFmt || null); err.hidden = true; toast(`Loaded ${s.length} atoms`); }
        catch (e) { err.hidden = false; err.textContent = e.message; }
      } })));
    }
  },
});
