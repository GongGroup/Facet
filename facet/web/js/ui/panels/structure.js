/**
 * Structure panel: identity, cell, composition, structures in the project, selection editing, measurements, analyses, tools.
 * Two slots take sections that modules register (ui/sections.js): 'cell' after the summary (M1's Cell) and
 * 'transform' after the selection (M4's Transform, M3's Constraints); an empty slot shows nothing.
 */
import { h, ic, btn, field } from '../dom.js';
import { toast, promptDialog, confirmDialog } from '../overlays.js';
import { element, normalizeSymbol } from '../../core/elements.js';
import { elementColorHex } from '../../render/colors.js';
import { formulaHTML, formulaEl, registerLeftPanel } from '../shell.js';
import { analyses, runKey, structureKey, defaultParams } from '../../core/analyses.js';
import { paramForm, renderResult, analysisContext } from '../paramform.js';
import { renderSections, sectionsSignature } from '../sections.js';
import { deleteSelection, confirmHiddenSelection } from '../selectioncard.js';
import { parseRef } from '../../core/measure.js';

/** Analysis results by runKey (structure version, params, scene deps): re-renders never recompute. */
const results = new Map();
/** Parameter values per analysis id, kept while the panel re-renders. */
const formState = new Map();
const remember = (k, v) => { results.delete(k); results.set(k, v); while (results.size > 60) results.delete(results.keys().next().value); };

/** One card per registered analysis: parameters, Run (or automatic), cached result. */
function analysisCard(app, s, a, shell, skey) {
  const ctx = analysisContext(app, s);
  const auto = typeof a.auto === 'function' ? !!a.auto(s) : !!a.auto;
  const hasParams = (a.params ?? []).length > 0;
  const form = hasParams ? paramForm(a.params, { values: formState.get(a.id) ?? {}, structure: s, onChange: (v) => { formState.set(a.id, { ...v }); draw(); } }) : null;
  const params = () => ({ ...defaultParams(a.params, s), ...(form?.values ?? {}) });
  const out = h('div.an-out', { 'aria-live': 'polite' });
  // skey: the structure key of this render (computed once per panel); later draws read it afresh
  const draw = (sk) => {
    const r = results.get(runKey(app, a, params(), sk));
    out.replaceChildren();
    if (!r) return;
    if (r.status === 'running') out.append(h('p.hint.an-running', 'Running…'));
    else if (r.status === 'error') out.append(h('p.err-text', r.error));
    else {
      try { if (a.render) a.render(r.result, out, ctx); else renderResult(r.result, out); }
      catch (e) { out.replaceChildren(h('p.err-text', `Could not show the result: ${e.message}`)); }
    }
  };
  const run = async (sk = structureKey(app)) => {
    const bad = form?.validate();
    if (bad) { out.replaceChildren(h('p.err-text', bad)); return; }
    const k = runKey(app, a, params(), sk);
    if (results.get(k)?.status === 'running') return;
    remember(k, { status: 'running' });
    draw(sk);
    try { remember(k, { status: 'done', result: await analyses.run(a.id, s, params(), ctx) }); }
    catch (e) { remember(k, { status: 'error', error: e?.message ?? String(e) }); }
    if (out.isConnected) draw();
    else if (shell?.leftId === 'structure' && app.structure === s) shell.renderDrawer();
  };
  const runBtn = !auto || hasParams ? btn(auto ? 'Update' : 'Run', { cls: 'small', icon: 'play', tip: a.description || `Run ${a.name}`, on: () => run() }) : null;
  const from = sourceLabel(a);
  const card = h('div.an-card', { dataset: { analysis: a.id } },
    h('div.an-head', h('b', a.name ?? a.id), runBtn),
    from || a.description ? h('p.hint', from ? h('span.an-src', from) : null, a.description ?? '') : null,
    form?.el ?? null, out);
  if (auto && !results.has(runKey(app, a, params(), skey))) run(skey);
  else draw(skey);
  return card;
}

/** Three numbers for a key–value row; a narrow panel wraps between them, never inside one. */
const triple = (v, digits) => h('dd.kv-triple', ...v.flatMap((x, i) => [i ? ', ' : null, h('span', x.toFixed(digits))]).filter((x) => x != null));

/** Where an analysis comes from, for its card ('hello plugin · runs on the server'); null for built-in ones. */
function sourceLabel(a) {
  if (!a.source || a.source === 'built-in') return null;
  const who = a.source === 'plugin' || a.source === 'server' ? a.plugin : a.source;   // 'plugin' is the registry default
  const name = who ? (/plugin$/i.test(who) ? who : `${who} plugin`) : a.server ? 'Server plugin' : 'Plugin';
  return a.server ? `${name} · runs on the server` : name;
}

registerLeftPanel({
  id: 'structure', title: 'Structure', icon: 'atom', tip: 'Composition, cell, selection, measurements, analyses', kbd: null,
  /** App events after which the shell may re-render this panel … */
  refreshOn: ['project', 'structure', 'selection', 'measure', 'scene', 'registry'],
  /** … and only when this changes (cheap; everything the panel shows depends on it). */
  signature(app) {
    const s = app.structure, p = app.project, sc = app.scene;
    const ms = app.viewer?.measurements ?? [];
    return JSON.stringify([
      p.activeStructure, p.structures.map((e) => `${e.id}:${e.name}:${e.structure.length}:${e.structure.nFrames}`), s ? structureKey(app) : null, s?.name,
      s?.info?.spacegroup, s?.info?.note,
      app.selection.join(','), ms.map((m) => `${m.id}:${m.drawn ?? '-'}:${m.valid && Number.isFinite(m.value) ? m.value.toFixed(4) : '-'}`),
      sc?.style?.colorScheme, sc?.style?.monoColor, sc?.style?.colorOverrides, sc?.display?.bonds, sc?.display?.supercell,
      analyses.list().map((a) => a.id),
      sectionsSignature('structure', app),
    ]);
  },
  render(app, el, shell) {
    const s = app.structure;
    const p = app.project;
    // structures in project
    if (p.structures.length) {
      const list = h('div.list');
      for (const e of p.structures) {
        const active = e.id === p.activeStructure;
        const row = h('div.proj-item', { role: 'button', tabindex: 0, 'aria-current': String(active), style: { gridTemplateColumns: '1fr auto auto' } },
          h('span.meta', h('b', e.name), h('small', formulaEl(e.structure.formula()), ` · ${e.structure.length.toLocaleString()} atoms${e.structure.nFrames > 1 ? ` · ${e.structure.nFrames} frames` : ''}`)),
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
        cp ? [h('dt', 'a, b, c (Å)'), triple([cp.a, cp.b, cp.c], 3), h('dt', 'α, β, γ (°)'), triple([cp.alpha, cp.beta, cp.gamma], 2),
          h('dt', 'Volume'), h('dd', `${s.volume().toFixed(3)} Å³`), h('dt', 'Density'), h('dd', `${s.density().toFixed(2)} g/cm³`), h('dt', 'Periodic'), h('dd', s.pbc.map((b) => (b ? 'T' : 'F')).join(' '))] : [h('dt', 'Cell'), h('dd', 'none (cluster / molecule)')],
        s.info.note ? [h('dt', 'Note'), h('dd', { style: { fontFamily: 'var(--font-ui)', textAlign: 'left' } }, s.info.note)] : null,
      ));
    el.append(sum);
    renderSections('structure', app, el, shell, { slot: 'cell' });

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
          btn('Delete', { icon: 'trash', cls: 'small danger', tip: 'Delete selected atoms', kbd: 'Del', on: () => deleteSelection(app) }),
          btn('Invert', { cls: 'small', on: () => app.invertSelection() }),
          btn('Clear', { cls: 'small', kbd: 'Esc', on: () => app.clearSelection() })),
        h('div.row', h('span.ctl-label', 'Replace with'), rep, btn('Apply', { cls: 'small', on: async () => {
          const sym = normalizeSymbol(rep.value);
          if (sym === 'X') { toast('Type an element symbol, like Fe or O.', { type: 'error' }); return; }
          const atoms = await confirmHiddenSelection(app, 'Change', sel);   // hidden atoms change only when the user says so
          if (!atoms?.length) return;
          if (atoms.length !== sel.length) app.select(atoms);
          // one toast: the message, the notes of the change (calculated results that went) and an Undo for it
          app.replaceSelected(sym, { toast: `Replaced ${atoms.length} atom${atoms.length > 1 ? 's' : ''} with ${sym}` });
        } })));
    }
    el.append(selSec);
    renderSections('structure', app, el, shell, { slot: 'transform' });

    // measurements
    const ms = app.viewer.measurements;
    const mSec = h('div.section', h('h3', h('span.grow', 'Measurements'), ms.length ? btn('Clear', { cls: 'ghost small', on: () => { app.viewer.clearMeasurements(); app.emit('measure'); } }) : null));
    if (!ms.length) mSec.append(h('p.hint', 'Press M or use the ruler in the toolbar, then click 2, 3 or 4 atoms.'), h('div.row', { style: { gap: '6px' } },
      btn('Distance', { cls: 'small', on: () => app.setTool('measure', 'distance') }), btn('Angle', { cls: 'small', on: () => app.setTool('measure', 'angle') }), btn('Dihedral', { cls: 'small', on: () => app.setTool('measure', 'dihedral') })));
    else {
      for (const x of ms) {
        // atoms by their structure index (refs); a hidden atom keeps the value but has no line; an atom the structure
        // does not have (any more) shows no value
        const ok = x.valid && Number.isFinite(x.value);
        const atoms = ok ? (x.refs ?? []).map((r) => parseRef(r)?.atom) : [];
        const names = atoms.map((i) => `${s.symbols[i]}${i}`).join('–');
        const label = !ok ? '(not in view)' : x.drawn === 'hidden' ? `${names} (hidden)` : names;
        mSec.append(h('div.row', { style: { fontSize: '12.5px' } }, h('span', { style: { minWidth: '62px', color: 'var(--muted)' } }, x.type[0].toUpperCase() + x.type.slice(1)), h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }, 'data-tip': x.drawn === 'hidden' ? 'An atom of this measurement is hidden, so the view does not draw it' : null }, label),
          h('b.num', { style: { fontWeight: 500 } }, ok ? (x.type === 'distance' ? `${x.value.toFixed(3)} Å` : `${x.value.toFixed(2)}°`) : '—'),
          btn('', { icon: 'x', cls: 'ghost icon small', tip: 'Remove', on: () => { app.viewer.removeMeasurement(x.id); app.emit('measure'); } })));
      }
    }
    el.append(mSec);

    // analyses (built-in, JS plugins, server plugins)
    const skey = structureKey(app);
    const list = analyses.list().sort((a, b) => (a.source === 'built-in' ? 0 : 1) - (b.source === 'built-in' ? 0 : 1));
    el.append(h('div.section', h('h3', h('span.grow', 'Analyses'), h('span.muted', { style: { textTransform: 'none', letterSpacing: 0 } }, String(list.length))),
      ...list.map((a) => analysisCard(app, s, a, shell, skey))));

    // tools
    const tools = h('div.section', h('h3', 'Tools'));
    const row = h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } });
    if (s.periodic) {
      row.append(btn('Wrap into cell', { cls: 'small', tip: 'Move every atom into the unit cell (edits the structure)', on: () => { const c = s.clone(); c.wrap(); c.name = s.name; app.replaceActiveStructure(c); toast('Atoms wrapped into the cell'); } }));
      const N = app.scene.display.supercell;
      if (N.some((v) => v > 1)) {
        row.append(btn(`Make ${N.join('×')} supercell real`, { cls: 'small', tip: 'Turn the displayed repeat into an actual supercell you can edit and export', on: () => {
          let c;
          const bake = () => { c = s.repeat(...N); app.replaceActiveStructure(c, { resetCamera: false, label: 'Make supercell' }); app.set('display.supercell', [1, 1, 1]); };
          try { if (app.transaction) app.transaction('Make supercell', bake); else bake(); toast(`Built ${c.length}-atom supercell`); }
          catch (e) { toast(e.message, { type: 'error' }); }
        } }));
      }
    }
    // always next to the original, even in an untouched sample project (which adding would otherwise replace)
    row.append(btn('Duplicate', { cls: 'small', tip: 'Add a copy of this structure to the project', on: () => { const c = s.clone(); c.name = `${s.name} (copy)`; app.addStructure(c, { replaceProject: false }); } }));
    tools.append(row);
    el.append(tools);
  },
});
