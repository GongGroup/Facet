/** Structure panel: identity, cell, composition, structures in the project, selection editing, measurements, tools. */
import { h, ic, btn, field } from '../dom.js';
import { toast, promptDialog, confirmDialog } from '../overlays.js';
import { element, normalizeSymbol } from '../../core/elements.js';
import { elementColorHex } from '../../render/colors.js';
import { formulaHTML, registerLeftPanel } from '../shell.js';
import { rdf, coordinationStats } from '../../core/analysis.js';
import { lineChart } from '../chart.js';
import { disabledPairsFor } from '../../render/display.js';

const rdfState = { pair: '', rmax: 8, result: null, key: null };

registerLeftPanel({
  id: 'structure', title: 'Structure', icon: 'atom', tip: 'Composition, cell, selection, measurements', kbd: null,
  render(app, el, shell) {
    const s = app.structure;
    const p = app.project;
    // structures in project
    if (p.structures.length) {
      const list = h('div.list');
      for (const e of p.structures) {
        const active = e.id === p.activeStructure;
        const row = h('div.proj-item', { role: 'button', tabindex: 0, 'aria-current': String(active), style: { gridTemplateColumns: '1fr auto auto' } },
          h('span.meta', h('b', e.name), h('small', `${e.structure.formula()} · ${e.structure.length} atoms${e.structure.nFrames > 1 ? ` · ${e.structure.nFrames} frames` : ''}`)),
          btn('', { icon: 'edit', cls: 'ghost icon small', tip: 'Rename', on: async (ev) => { ev.stopPropagation(); const n = await promptDialog({ title: 'Rename structure', label: 'Name', value: e.name, confirm: 'Rename' }); if (n) app.renameStructure(e.id, n); } }),
          btn('', { icon: 'trash', cls: 'ghost icon small', tip: 'Remove from project', on: async (ev) => { ev.stopPropagation(); const ok = await confirmDialog({ title: `Remove “${e.name}”?`, message: 'The structure is removed from this project. You can undo this.', confirm: 'Remove', danger: true }); if (ok) app.removeStructure(e.id); } }));
        row.addEventListener('click', () => { if (!active) app.setActiveStructure(e.id); });
        row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') app.setActiveStructure(e.id); });
        list.append(row);
      }
      el.append(h('div.section', h('h3', h('span.grow', `In this project (${p.structures.length})`)), list));
    }
    if (!s) { el.append(h('p.hint', 'No structure loaded. Use the Library or Build panel, or open a file.')); return; }

    const cp = s.cellParams();
    const sum = h('div.section',
      h('div', h('div.formula', { html: formulaHTML(s.formula()) }), h('div.muted', { style: { fontSize: '12.5px' } }, s.name)),
      h('dl.kv',
        h('dt', 'Atoms'), h('dd', s.length.toLocaleString()),
        s.nFrames > 1 ? [h('dt', 'Frames'), h('dd', s.nFrames)] : null,
        s.info.spacegroup ? [h('dt', 'Space group'), h('dd', s.info.spacegroup)] : null,
        cp ? [h('dt', 'a, b, c'), h('dd', `${cp.a.toFixed(4)}, ${cp.b.toFixed(4)}, ${cp.c.toFixed(4)} Å`), h('dt', 'α, β, γ'), h('dd', `${cp.alpha.toFixed(2)}°, ${cp.beta.toFixed(2)}°, ${cp.gamma.toFixed(2)}°`),
          h('dt', 'Volume'), h('dd', `${s.volume().toFixed(3)} Å³`), h('dt', 'Density'), h('dd', `${s.density().toFixed(4)} g/cm³`), h('dt', 'Periodic'), h('dd', s.pbc.map((b) => (b ? 'T' : 'F')).join(' '))] : [h('dt', 'Cell'), h('dd', 'none (cluster / molecule)')],
        s.info.note ? [h('dt', 'Note'), h('dd', { style: { fontFamily: 'var(--font-ui)', textAlign: 'left' } }, s.info.note)] : null,
      ));
    el.append(sum);

    // composition chips (click = select element)
    const comp = s.composition();
    const chips = h('div.chips');
    for (const sym of Object.keys(comp).sort((a, b) => element(a).Z - element(b).Z)) {
      const c = h('button.chip', { type: 'button', 'aria-pressed': 'true', 'data-tip': `Select all ${element(sym).name} atoms (Shift adds)` }, h('span.dot', { style: { background: elementColorHex(sym, app.scene.style) } }), sym, h('span.n', comp[sym]));
      c.addEventListener('click', (e) => app.selectElement(sym, e.shiftKey));
      chips.append(c);
    }
    el.append(h('div.section', h('h3', 'Composition'), chips));

    // selection
    const sel = app.selection;
    const selSec = h('div.section', h('h3', h('span.grow', 'Selection'), sel.length ? h('span.muted', { style: { textTransform: 'none', letterSpacing: 0 } }, `${sel.length} atom${sel.length > 1 ? 's' : ''}`) : null));
    if (!sel.length) selSec.append(h('p.hint', 'Click atoms in the view to select them (Shift-click to add). Click an element above to select all of it.'));
    else {
      if (sel.length <= 4) {
        const P = sel.map((i) => s.pos(i));
        selSec.append(h('dl.kv', ...sel.flatMap((i, k) => [h('dt', `${s.symbols[i]} #${i}`), h('dd', P[k].map((v) => v.toFixed(3)).join('  '))])));
      }
      const rep = h('input.field', { placeholder: 'e.g. Fe', 'aria-label': 'Replace with element', style: { width: '72px', textAlign: 'center' } });
      selSec.append(
        h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } },
          btn('Delete', { icon: 'trash', cls: 'small danger', tip: 'Delete selected atoms', kbd: 'Del', on: () => app.deleteSelected() }),
          btn('Invert', { cls: 'small', on: () => app.invertSelection() }),
          btn('Clear', { cls: 'small', kbd: 'Esc', on: () => app.clearSelection() })),
        h('div.row', h('span.ctl-label', 'Replace with'), rep, btn('Apply', { cls: 'small', on: () => { const sym = normalizeSymbol(rep.value); if (sym === 'X') { toast('Type an element symbol, like Fe or O.', { type: 'error' }); return; } app.replaceSelected(sym); toast(`Replaced ${sel.length} atom${sel.length > 1 ? 's' : ''} with ${sym}`); } })));
    }
    el.append(selSec);

    // measurements
    const ms = app.viewer.measurements;
    const mSec = h('div.section', h('h3', h('span.grow', 'Measurements'), ms.length ? btn('Clear', { cls: 'ghost small', on: () => { app.viewer.clearMeasurements(); app.emit('measure'); } }) : null));
    if (!ms.length) mSec.append(h('p.hint', 'Press M or use the ruler in the toolbar, then click 2, 3 or 4 atoms.'), h('div.row', { style: { gap: '6px' } },
      btn('Distance', { cls: 'small', on: () => app.setTool('measure', 'distance') }), btn('Angle', { cls: 'small', on: () => app.setTool('measure', 'angle') }), btn('Dihedral', { cls: 'small', on: () => app.setTool('measure', 'dihedral') })));
    else {
      const m = app.viewer.model;
      for (const x of ms) {
        const label = x.valid ? x.idx.map((i) => `${m.symbols[i]}${m.src[i]}`).join('–') : '(not in view)';
        mSec.append(h('div.row', { style: { fontSize: '12.5px' } }, h('span', { style: { minWidth: '62px', color: 'var(--muted)' } }, x.type), h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
          h('b.num', { style: { fontWeight: 500 } }, x.valid ? (x.type === 'distance' ? `${x.value.toFixed(3)} Å` : `${x.value.toFixed(2)}°`) : '—'),
          btn('', { icon: 'x', cls: 'ghost icon small', tip: 'Remove', on: () => { app.viewer.removeMeasurement(x.id); app.emit('measure'); } })));
      }
    }
    el.append(mSec);

    // analysis
    const an = h('div.section', h('h3', 'Analysis'));
    const bondOpt = { tolerance: app.scene.display.bonds.tolerance ?? 1.15, disabledPairs: disabledPairsFor(s.elements(), app.scene.display.bonds) };
    if (s.length <= 5000) {
      const stats = coordinationStats(s, bondOpt);
      an.append(h('div.sub-h', 'Coordination (bonds per atom)'), h('dl.kv', ...stats.flatMap((x) => [h('dt', `${x.element} ×${x.count}`), h('dd', x.min === x.max ? `${x.min}` : `${x.mean.toFixed(2)} (${x.min}–${x.max})`)])));
    }
    const els = s.elements().sort();
    const pairOpts = [['', 'All pairs'], ...els.flatMap((a, i) => els.slice(i).map((b) => [`${a}-${b}`, `${a}–${b}`]))];
    const pairSel = h('select.field', { 'aria-label': 'Element pair', style: { flex: 1 } }, ...pairOpts.map(([v, l]) => h('option', { value: v, selected: v === rdfState.pair }, l)));
    const rmaxIn = h('input.field.num', { type: 'number', min: 2, max: 20, step: 0.5, value: rdfState.rmax, 'aria-label': 'r max (Å)', style: { width: '64px' } });
    const out = h('div');
    const key = `${app.project.activeStructure}:${s.length}:${s.frame}`;
    const draw = () => {
      const r = rdfState.result;
      if (!r || rdfState.key !== key) { out.replaceChildren(); return; }
      let peak = 0;
      r.g.forEach((v, i) => { if (v > r.g[peak]) peak = i; });
      out.replaceChildren(lineChart({ x: r.r, y: r.g, xLabel: 'r (Å)', yLabel: 'g(r)', fmtX: (v) => (+v).toFixed(2), fmtY: (v) => (+v).toFixed(2) }),
        h('p.hint', `Highest peak at ${r.r[peak].toFixed(2)} Å${r.periodic ? '' : ' · cluster: normalised pair-distance histogram'}${r.sampled ? ' · sampled for speed' : ''}`));
    };
    an.append(h('div.sub-h', 'Radial distribution g(r)'), h('div.row', pairSel, h('label.row', { style: { gap: '4px', fontSize: '12px', color: 'var(--muted)' } }, 'r max', rmaxIn),
      btn('Compute', { cls: 'small', on: () => {
        rdfState.pair = pairSel.value; rdfState.rmax = Math.max(2, Math.min(20, +rmaxIn.value || 8));
        rdfState.result = rdf(s, { rmax: rdfState.rmax, pair: rdfState.pair ? rdfState.pair.split('-') : null });
        rdfState.key = key; draw();
      } })), out);
    draw();
    el.append(an);

    // tools
    const tools = h('div.section', h('h3', 'Tools'));
    const row = h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } });
    if (s.periodic) {
      row.append(btn('Wrap into cell', { cls: 'small', tip: 'Move every atom into the unit cell (edits the structure)', on: () => { const c = s.clone(); c.wrap(); c.name = s.name; app.replaceActiveStructure(c); toast('Atoms wrapped into the cell'); } }));
      const N = app.scene.display.supercell;
      if (N.some((v) => v > 1)) row.append(btn(`Make ${N.join('×')} supercell real`, { cls: 'small', tip: 'Turn the displayed repeat into an actual supercell you can edit and export', on: () => { const c = s.repeat(...N); app.replaceActiveStructure(c, { resetCamera: false }); app.set('display.supercell', [1, 1, 1]); toast(`Built ${c.length}-atom supercell`); } }));
    }
    row.append(btn('Duplicate', { cls: 'small', tip: 'Add a copy of this structure to the project', on: () => { const c = s.clone(); c.name = `${s.name} (copy)`; app.addStructure(c); } }));
    tools.append(row);
    el.append(tools);
  },
});
