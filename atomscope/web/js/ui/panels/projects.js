/** Projects panel: choose where projects live (browser, server folder, cloud, local folder) and manage them. */
import { h, ic, btn, seg } from '../dom.js';
import { toast, confirmDialog, showMenu, promptDialog } from '../overlays.js';
import { relativeTime } from '../../core/util.js';
import { pickFiles } from '../../storage/files.js';
import { registerLeftPanel } from '../shell.js';

let current = null;

registerLeftPanel({
  id: 'projects', title: 'Projects', icon: 'folder', tip: 'Open, save and organise projects',
  headActions: (app, shell) => [btn('New', { icon: 'plus', cls: 'small', tip: 'Start an empty project', on: () => { app.newProject(); toast('New project'); } })],
  render(app, el, shell) {
    const provs = app.storage.list();
    current = provs.find((p) => p.id === current)?.id ?? app.project.location?.provider ?? app.defaultProvider ?? provs[0]?.id;
    const prov = app.storage.get(current);
    el.append(h('div', { style: { display: 'grid', gap: '10px', paddingBottom: '10px' } },
      seg(provs.map((p) => ({ value: p.id, label: p.label.replace('Local folder', 'Folder').replace('This browser', 'Browser'), icon: p.icon, tip: p.description })), current, (v) => { current = v; shell.renderDrawer(); }),
      h('p.hint', prov?.description ?? '')));

    const listEl = h('div.list', { 'aria-busy': 'true' }, h('p.hint', 'Loading…'));
    const actions = h('div', { style: { display: 'grid', gap: '6px', paddingTop: '12px', borderTop: '1px solid var(--line)', marginTop: '12px' } });

    const body = h('div');
    el.append(body);

    // auth / connection gates
    if (prov?.id === 'server' && prov.needsAuth) { body.append(authForm(app, prov, shell)); return; }
    if (prov?.id === 'folder' && !prov.connected) {
      body.append(h('div.callout', h('b', 'Use a folder on your computer'), h('span.hint', 'Pick a folder once. AtomScope reads and writes .atomscope.json files there, so projects are ordinary files you can back up, sync or commit to Git.'),
        h('div', btn('Choose folder…', { icon: 'folder', cls: 'primary', on: async () => { try { await prov.connect(); shell.renderDrawer(); } catch (e) { if (e.name !== 'AbortError') toast(e.message, { type: 'error' }); } } }))));
      return;
    }
    if (prov?.id === 'folder') body.append(h('div.row', { style: { paddingBottom: '8px' } }, ic('folder', 'sm'), h('b', { style: { fontWeight: 500 } }, prov.folderName), btn('Change', { cls: 'ghost small', on: async () => { try { await prov.connect(); shell.renderDrawer(); } catch { /* cancelled */ } } })));

    body.append(listEl, actions);
    actions.append(
      btn(`Save current project to ${prov.label.toLowerCase()}`, { icon: 'save', cls: 'primary', on: () => shell.saveToProvider(prov.id).then(() => shell.renderDrawer()) }),
      h('div.row', { style: { gap: '6px' } },
        btn('Import file', { icon: 'upload', cls: 'small', tip: 'Open an .atomscope.json project or structure files', on: async () => { const fs = await pickFiles({ accept: '.json,.cif,.xyz,.extxyz,.vasp,.poscar,.pdb,*', multiple: true }); if (fs.length) app.importFiles(fs); } }),
        btn('Download project', { icon: 'download', cls: 'small', tip: 'Save the current project as a portable .atomscope.json file', on: () => app.downloadProject().catch((e) => toast(e.message, { type: 'error' })) })),
    );

    prov.list().then((items) => {
      listEl.removeAttribute('aria-busy');
      if (!items.length) { listEl.replaceChildren(h('p.hint', `No projects in ${prov.label.toLowerCase()} yet. Your current project is saved here automatically once you make a change, or press Save.`)); return; }
      listEl.replaceChildren(...items.map((p) => {
        const isCurrent = app.project.location?.provider === prov.id && app.project.location?.id === (p.file ?? p.id);
        const th = h('span.th', p.thumbnail ? { style: { backgroundImage: `url("${p.thumbnail}")` } } : {}, p.thumbnail ? null : ic('atom'));
        const more = btn('', { icon: 'more', cls: 'ghost icon small', tip: 'More actions' });
        const row = h('div.proj-item', { role: 'button', tabindex: 0, 'aria-current': String(isCurrent) }, th,
          h('span.meta', h('b', p.name), h('small', [p.formula, p.nAtoms ? `${p.nAtoms} atoms` : null, p.nStructures > 1 ? `${p.nStructures} structures` : null].filter(Boolean).join(' · ') || '—'), h('small', relativeTime(p.updated))), more);
        const open = async () => {
          try { if (app.dirty && !app.project.location) { const ok = await confirmDialog({ title: 'Open another project?', message: 'The current project has never been saved. Opening another project will discard it.', confirm: 'Discard and open', danger: true }); if (!ok) return; } await app.openProject(prov.id, p.file ?? p.id); }
          catch (e) { toast(e.message, { type: 'error' }); }
        };
        row.addEventListener('click', (e) => { if (!more.contains(e.target)) open(); });
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          showMenu(more, [
            { label: 'Open', icon: 'open', run: open },
            { label: 'Duplicate', icon: 'copy', run: async () => { try { await app.duplicateProject(prov.id, p.file ?? p.id); shell.renderDrawer(); toast('Duplicated'); } catch (err) { toast(err.message, { type: 'error' }); } } },
            { separator: true },
            { label: 'Delete…', icon: 'trash', run: async () => {
              const ok = await confirmDialog({ title: `Delete “${p.name}”?`, message: `This removes the project from ${prov.label.toLowerCase()}. This cannot be undone.`, confirm: 'Delete project', danger: true });
              if (!ok) return;
              try { await app.deleteProject(prov.id, p.file ?? p.id); shell.renderDrawer(); toast('Project deleted'); } catch (err) { toast(err.message, { type: 'error' }); }
            } },
          ], { align: 'end' });
        });
        return row;
      }));
    }).catch((e) => {
      if (e.code === 'auth') { shell.renderDrawer(); return; }
      listEl.replaceChildren(h('p.err-text', `Could not list projects: ${e.message}`));
    });
  },
});

function authForm(app, prov, shell) {
  let mode = 'login';
  const wrap = h('div', { style: { display: 'grid', gap: '10px' } });
  const draw = () => {
    const user = h('input.field', { autocomplete: 'username', placeholder: 'Username', 'aria-label': 'Username' });
    const pass = h('input.field', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: 'Password', 'aria-label': 'Password' });
    const err = h('p.err-text', { hidden: true });
    const form = h('form', { style: { display: 'grid', gap: '8px' } }, user, pass, err,
      h('button.btn.primary', { type: 'submit' }, mode === 'login' ? 'Sign in' : 'Create account'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        if (mode === 'login') await prov.login(user.value.trim(), pass.value); else await prov.register(user.value.trim(), pass.value);
        toast(`Signed in as ${prov.user.username}`);
        app.emit('providers');
        shell.renderDrawer();
      } catch (ex) { err.hidden = false; err.textContent = ex.message; }
    });
    wrap.replaceChildren(...[
      h('div.callout.accent', h('b', 'Sign in to the AtomScope server'), h('span.hint', 'Use your account on this server, or create one in a few seconds.')),
      form,
      prov.info?.allowRegistration !== false ? h('p.hint', mode === 'login' ? 'No account yet? ' : 'Already registered? ', h('a', { href: '#', on: { click: (e) => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(); } } }, mode === 'login' ? 'Create one' : 'Sign in')) : null,
    ].filter(Boolean));
    setTimeout(() => user.focus(), 20);
  };
  draw();
  return wrap;
}
