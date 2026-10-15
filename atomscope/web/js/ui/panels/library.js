/** Library panel: curated samples grouped by category, with search. */
import { h, ic } from '../dom.js';
import { samples } from '../../build/samples.js';
import { looks } from '../../render/looks.js';
import { styles } from '../../render/styles.js';
import { toast } from '../overlays.js';
import { registerLeftPanel } from '../shell.js';

const counts = new Map();
let query = '';

/** 'Ball & stick · Illustration look' — what opening the sample shows. */
function describe(s) {
  const rep = styles.get(s.rep ?? s.scene?.style?.rep ?? looks.get(s.look)?.scene?.style?.rep)?.name;
  const look = s.look ? looks.get(s.look)?.name ?? s.look : null;
  return [rep, look ? `${look} look` : null].filter(Boolean).join(' · ');
}

registerLeftPanel({
  id: 'library', title: 'Library', icon: 'library', tip: 'Sample crystals, 2D materials, clusters and molecules',
  refreshOn: [],   // static list: registry changes re-render it through refreshShell()
  render(app, el) {
    const search = h('input.field', { type: 'search', placeholder: 'Search samples (e.g. oxide, gold, 2D)…', value: query, 'aria-label': 'Search samples' });
    const list = h('div', { style: { display: 'grid', gap: '14px' } });
    const draw = () => {
      const q = query.toLowerCase();
      const items = samples.list().filter((s) => !q || `${s.name} ${s.category} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(q));
      const groups = {};
      items.forEach((s) => (groups[s.category] ??= []).push(s));
      list.replaceChildren(...Object.entries(groups).map(([g, arr]) => h('div', { style: { display: 'grid', gap: '6px' } }, h('div.sub-h', g), ...arr.map((s) => {
        if (!counts.has(s.id)) { try { const st = s.build(); counts.set(s.id, `${st.length} atoms${st.nFrames > 1 ? ` · ${st.nFrames} frames` : ''}`); } catch { counts.set(s.id, ''); } }
        const what = describe(s);
        const b = h('button.sample-item', { type: 'button', 'data-tip': what ? `Open ${s.name} — ${what}` : `Open ${s.name}` },
          h('span', h('b', s.name), h('small', (s.tags ?? []).join(' · '))), h('span.count', counts.get(s.id)));
        b.addEventListener('click', async () => {
          try {
            const fresh = app.pristine;   // otherwise loadSample shows its own toast ('Opened … in a new project')
            const st = await app.loadSample(s.id);
            if (!st) return;              // cancelled at the unsaved-changes dialog
            if (fresh) toast(`Loaded ${s.name}`);
            if (matchMedia('(max-width: 920px)').matches) document.querySelector('.drawer .close-mobile')?.click();
          } catch (e) { toast(e.message, { type: 'error' }); }
        });
        return b;
      }))));
      if (!items.length) list.append(h('p.hint', 'No sample matches. Try “oxide”, “2D” or “cluster”.'));
    };
    search.addEventListener('input', () => { query = search.value; draw(); });
    el.append(h('div', { style: { display: 'grid', gap: '12px' } }, search, list,
      h('div.callout', h('b', 'Your own files'), h('span.hint', 'Drop CIF, POSCAR/CONTCAR/XDATCAR, XYZ/extXYZ, PDB or AtomScope JSON onto the window, or paste file contents anywhere.'))));
    draw();
  },
});
