/** Projects panel: choose where projects live (browser, server folder, cloud, local folder) and manage them. */
import { h, ic, btn, seg } from '../dom.js';
import { toast, confirmDialog, showMenu, promptDialog } from '../overlays.js';
import { relativeTime, formatBytes } from '../../core/util.js';
import { pickFiles, saveFile, slug, canDownload } from '../../storage/files.js';
import { matchesQuery, storable } from '../../storage/index.js';
import { registerLeftPanel, formulaEl } from '../shell.js';
import { savePrefs } from '../../app.js';

let current = null;
const searchState = { focused: false, start: 0, end: 0 }; // survives drawer re-renders while typing
const counts = new Map(); // provider id -> projects last listed, so a re-render shows the search row before the list loads
const authState = { mode: 'login', username: '' }; // the sign-in form's choice and typed name survive drawer re-renders

const byNewest = (k) => (a, b) => String(b[k] ?? '').localeCompare(String(a[k] ?? ''));
const SORTS = {
  updated: { label: 'Updated', cmp: byNewest('updated') },
  name: { label: 'Name', cmp: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { numeric: true, sensitivity: 'base' }) },
  created: { label: 'Created', cmp: byNewest('created') },
  size: { label: 'Size', cmp: (a, b) => (b.size ?? 0) - (a.size ?? 0) },
};

const remember = (app, key, value) => { app.prefs[key] = value; savePrefs(app.prefs); };
const fmtDate = (iso) => { const t = new Date(iso); return Number.isFinite(t.getTime()) ? t.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'; };
const shortLabel = (p) => (p.id === 'browser' ? 'Browser' : p.label.replace('Local folder', 'Folder'));
const whereOf = (p) => p.where ?? `in ${p.label.toLowerCase()}`;
const FROM = { browser: 'this browser', server: 'your account on this server', claude: 'your Claude cloud space' };

registerLeftPanel({
  id: 'projects', title: 'Projects', icon: 'folder', tip: 'Open, save and organise projects',
  headActions: (app, shell) => [btn('New', { icon: 'plus', cls: 'small', tip: 'Start an empty project', on: async () => { try { if (await app.newProject()) toast('New project'); } catch (e) { toast(e.message, { type: 'error' }); } } })],
  render(app, el, shell) {
    const provs = app.storage.list();
    const asked = shell.panelArgs?.('projects')?.provider;   // e.g. the top bar's Sign in
    if (asked && provs.some((p) => p.id === asked)) current = asked;
    current = provs.find((p) => p.id === current)?.id ?? app.project.location?.provider ?? app.defaultProvider ?? provs[0]?.id;
    const prov = app.storage.get(current);
    el.append(h('div.proj-head',
      seg(provs.map((p) => ({ value: p.id, label: shortLabel(p), icon: p.icon, tip: p.description })), current, (v) => { current = v; shell.renderDrawer(); }, { label: 'Where projects are stored' }),
      prov?.memory ? null : h('p.hint', prov?.description ?? '')));   // (the warning below says it for memory-only storage)
    if (!prov) return;

    const body = h('div.proj-body');
    el.append(body);

    // account / connection gates
    if (prov.id === 'server') { const row = accountRow(app, prov, shell); if (row) body.append(row); }
    if (prov.id === 'server' && !prov.needsAuth) authState.mode = 'login';   // the next sign-in starts on "Sign in"
    if (prov.id === 'server' && prov.needsAuth) { body.append(authForm(app, prov, shell)); return; }
    if (prov.id === 'folder' && !prov.connected) {
      body.append(h('div.callout', h('b', 'Use a folder on your computer'), h('span.hint', 'Pick a folder once. Crystallume reads and writes .crystallume.json files there, so projects are ordinary files you can back up, sync or commit to Git.'),
        h('div', btn('Choose folder…', { icon: 'folder', cls: 'primary', on: async () => { try { await prov.connect(); shell.renderDrawer(); } catch (e) { if (e.name !== 'AbortError') toast(e.message, { type: 'error' }); } } }))));
      return;
    }
    if (prov.id === 'folder') body.append(h('div.row.proj-folder', ic('folder', 'sm'), h('b', { title: prov.folderName }, prov.folderName), btn('Change', { cls: 'ghost small', tip: 'Use a different folder', on: async () => { try { await prov.connect(); shell.renderDrawer(); } catch { /* cancelled */ } } })));
    if (prov.id === 'browser' && prov.memory) {
      const others = provs.filter((p) => p.id !== prov.id).map(shortLabel);
      body.append(h('div.callout.warn', h('b', 'Projects here last until you close this tab'),
        h('span.hint', `This browser blocks site storage, so download the project file to keep your work${others.length ? ` or switch to ${others.join(' or ')} above` : ''}.`),
        canDownload() ? h('div', btn('Download project', { icon: 'download', cls: 'small', on: () => app.downloadProject().catch((e) => toast(e.message, { type: 'error' })) })) : null));
    }

    // search + sort (remembered in app prefs)
    let q = typeof app.prefs.projectQuery === 'string' ? app.prefs.projectQuery : '';
    let sortKey = SORTS[app.prefs.projectSort] ? app.prefs.projectSort : 'updated';
    const input = h('input.field', { type: 'search', value: q, placeholder: 'Search projects', 'aria-label': 'Search projects by name, formula, description or tag', 'data-tip': 'Matches name, formula, description and tags', autocomplete: 'off', spellcheck: false });
    const clear = h('button.proj-clear', { type: 'button', 'aria-label': 'Clear search', 'data-tip': 'Clear search', hidden: !q }, ic('x', 'sm'));
    const sortSel = h('select.field', { 'aria-label': 'Sort projects', 'data-tip': 'Sort projects' },
      Object.entries(SORTS).map(([k, s]) => h('option', { value: k, selected: k === sortKey }, s.label)));
    const tools = h('div.proj-tools', h('label.proj-search', ic('search', 'sm'), input, clear), sortSel);
    // search + sort only help with two or more projects (or to clear a remembered search), and they are never
    // hidden while the user is in them; the last known count keeps the row steady while a re-render reloads
    const syncTools = (n) => {
      const inTools = searchState.focused || tools.contains(document.activeElement);
      tools.hidden = !inTools && (!n || (n < 2 && !q.trim()));
    };
    syncTools(counts.get(prov.id) ?? 0);

    const listEl = h('div.list', { 'aria-busy': 'true', 'aria-label': 'Projects' }, h('p.hint', 'Loading…'));
    const save = btn(`Save project ${whereOf(prov)}`, { icon: 'save', cls: 'primary', tip: `Save the open project ${whereOf(prov)}`, on: () => shell.saveToProvider(prov.id).then(() => shell.renderDrawer()) });
    const actions = h('div.proj-actions', save,
      h('div.row', { style: { gap: '6px' } },
        btn('Import file', { icon: 'upload', cls: 'small', tip: 'Open a .crystallume.json project or structure files', on: async () => { const fs = await pickFiles({ accept: '.json,.cif,.xyz,.extxyz,.vasp,.poscar,.pdb,*', multiple: true }); if (fs.length) app.importFiles(fs); } }),
        canDownload() ? btn('Download project', { icon: 'download', cls: 'small', tip: 'Save the current project as a portable .crystallume.json file', on: () => app.downloadProject().catch((e) => toast(e.message, { type: 'error' })) }) : null));
    body.append(tools, listEl, actions);

    let items = []; // every project in this store; the search filters here so it matches the same fields everywhere
    const emptyState = () => {
      const target = app.project.location?.provider ?? app.defaultProvider;
      const label = app.storage.get(target)?.label ?? 'this browser';
      const msg = app.prefs.autosave === false ? 'Press Save to keep the current project here.'
        : target === prov.id ? 'Your project is saved here automatically after your first change, or press Save.'
          : `Autosave goes to ${label}. Press Save to keep a copy here.`;
      return h('div.proj-empty', h('b', 'No projects here yet'), h('p.hint', msg));
    };
    const draw = () => {
      listEl.removeAttribute('aria-busy');
      counts.set(prov.id, items.length);
      syncTools(items.length);
      clear.hidden = !q;
      if (!items.length) { listEl.replaceChildren(emptyState()); return; }
      const shown = items.filter((p) => matchesQuery(p, q)).sort(SORTS[sortKey].cmp);
      if (!shown.length) {
        listEl.replaceChildren(h('div.proj-empty', h('p.hint', `No projects match “${q.trim()}”`),
          btn('Clear search', { cls: 'ghost small', on: () => { setQuery(''); (tools.hidden ? listEl.querySelector('.proj-item') : input)?.focus(); } })));
        return;
      }
      listEl.replaceChildren(...shown.map((p) => projectRow(app, prov, shell, p, sortKey)));
    };
    const showError = (e) => {
      listEl.removeAttribute('aria-busy');
      if (e.code === 'auth' && prov.needsAuth) { shell.renderDrawer(); return; }
      if (prov.id === 'folder' && /permission|activation|not allowed/i.test(`${e.name} ${e.message}`)) {
        listEl.replaceChildren(h('div.callout', h('b', `Allow access to “${prov.folderName}”`), h('span.hint', 'Your browser asks again after a restart before Crystallume may read the folder.'),
          h('div', btn('Allow access', { icon: 'folder', cls: 'primary small', on: async () => { try { await prov.ensurePermission(); shell.renderDrawer(); } catch (err) { toast(err.message, { type: 'error' }); } } }))));
        return;
      }
      listEl.replaceChildren(h('div.callout.err', h('span', e.code === 'offline' ? e.message : `Could not list projects: ${e.message}`),
        h('div', btn('Try again', { icon: 'reset', cls: 'small', on: () => { listEl.setAttribute('aria-busy', 'true'); load(); } }))));
    };
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      return Promise.resolve(prov.list())
        .then((list) => { if (mine === seq) { items = list ?? []; draw(); } })
        .catch((e) => { if (mine === seq) showError(e); });
    };
    const setQuery = (v) => {
      q = v; input.value = v;
      remember(app, 'projectQuery', v);
      draw();
    };

    input.addEventListener('input', () => { setQuery(input.value); searchState.start = input.selectionStart; searchState.end = input.selectionEnd; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); setQuery(''); } });
    input.addEventListener('focus', () => { searchState.focused = true; });
    input.addEventListener('blur', () => { if (input.isConnected) searchState.focused = false; });
    clear.addEventListener('click', () => { setQuery(''); input.focus(); });
    sortSel.addEventListener('change', () => { sortKey = sortSel.value; remember(app, 'projectSort', sortKey); draw(); });
    if (searchState.focused) requestAnimationFrame(() => { if (!input.isConnected) return; input.focus({ preventScroll: true }); try { input.setSelectionRange(searchState.start, searchState.end); } catch { /* type=search */ } });

    load();
  },
});

function projectRow(app, prov, shell, p, sortKey) {
  const key = p.file ?? p.id;
  const isCurrent = app.project.location?.provider === prov.id && app.project.location?.id === key;
  const th = h('span.th', p.thumbnail ? { style: { backgroundImage: `url("${p.thumbnail}")` } } : {}, p.thumbnail ? null : ic('atom'));
  const more = btn('', { icon: 'more', cls: 'ghost icon small', tip: 'More actions' });
  // several structures: name them all (the first three), with the atoms of all of them
  const fs = Array.isArray(p.formulas) && p.formulas.length > 1 ? p.formulas.filter(Boolean) : null;
  const formula = fs ? [...fs.slice(0, 3).flatMap((f, i) => [i ? ' + ' : null, formulaEl(f)]), fs.length > 3 ? ` + ${fs.length - 3} more` : null].filter(Boolean)
    : p.formula ? [formulaEl(p.formula)] : null;
  const atoms = fs && p.nAtomsTotal ? p.nAtomsTotal : p.nAtoms;
  const facts = [formula, atoms ? `${atoms.toLocaleString()} atoms` : null, p.nStructures > 1 ? `${p.nStructures} structures` : null].filter(Boolean).flatMap((x, i) => [i ? ' · ' : null, x]);
  const when = p.broken ? 'Can’t read this file'
    : sortKey === 'created' && p.created ? `Created ${relativeTime(p.created)}`
      : sortKey === 'size' && p.size ? `${formatBytes(p.size)} · ${relativeTime(p.updated)}` : relativeTime(p.updated);
  const tip = [p.created ? `Created ${fmtDate(p.created)}` : null, p.updated ? `Updated ${fmtDate(p.updated)}` : null, p.size ? formatBytes(p.size) : null].filter(Boolean).join(' · ');
  const row = h('div.proj-item', { role: 'button', tabindex: 0, 'aria-current': String(isCurrent), 'aria-label': `Open ${p.name}` }, th,
    h('span.meta', h('b', { title: p.name }, p.name), h('small', fs ? { 'data-tip': fs.join(' + ') } : {}, facts.length ? facts : '—'), h('small', tip ? { 'data-tip': tip } : {}, when)), more);

  const open = async () => {
    try { await app.openProject(prov.id, key); } // asks about unsaved changes itself
    catch (e) { toast(e.message, { type: 'error' }); }
  };
  const rename = async () => {
    const name = await promptDialog({ title: 'Rename project', label: 'Project name', value: p.name, confirm: 'Rename' });
    if (!name || name === p.name) return;
    try {
      let saved;
      const isOpen = () => app.project.location?.provider === prov.id && app.project.location?.id === key;
      // the open project: rename the version it was loaded from, so changes saved elsewhere surface as a conflict
      const opts = isOpen() && app.project.updated ? { baseUpdated: app.project.updated } : {};
      if (typeof prov.rename === 'function') saved = await prov.rename(key, name, opts);
      else { const doc = await prov.get(key); saved = await prov.save({ ...doc, name, location: { provider: prov.id, id: key } }, opts); }
      if (isOpen()) {
        app.project.name = name;
        if (saved?.updated) app.project.updated = saved.updated;
        app.emit('project');
      }
      toast(`Renamed to “${name}”`);
      shell.renderDrawer();
    } catch (err) { toast(err.message, { type: 'error' }); }
  };
  const download = async () => {
    try {
      const doc = await prov.get(key);
      const filename = `${slug(doc.name)}.crystallume.json`;
      if (await saveFile(filename, JSON.stringify(storable(doc), null, 1), 'application/json')) toast(`Downloaded ${filename}`);
    } catch (err) { toast(err.message, { type: 'error' }); }
  };
  const remove = async () => {
    const trash = prov.id === 'server' && !prov.cloud;
    const ok = await confirmDialog({
      title: `Delete “${p.name}”?`,
      message: trash ? 'It will be moved to the server’s .trash folder, where it can still be recovered.'
        : prov.id === 'folder' ? `The file ${p.file} will be permanently deleted from the folder ${prov.folderName}.`
          : `It will be permanently deleted from ${FROM[prov.id] ?? prov.label}.`,
      confirm: trash ? 'Move to trash' : 'Delete project', danger: true,
    });
    if (!ok) return;
    const wasCurrent = app.project.location?.provider === prov.id && app.project.location?.id === key;
    try {
      const doc = await app.deleteProject(prov.id, key); // the deleted document (null when it could not be read)
      shell.renderDrawer();
      toast(`Deleted “${p.name}”`, doc ? { action: { label: 'Undo', run: () => restore(app, prov, doc, wasCurrent) }, timeout: 8000 } : {});
    } catch (err) { toast(err.message, { type: 'error' }); }
  };

  row.addEventListener('click', (e) => { if (!more.contains(e.target)) open(); });
  row.addEventListener('keydown', (e) => {
    if (e.target !== row) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    else if (e.key === 'F2') { e.preventDefault(); rename(); }
    else if (e.key === 'Delete') { e.preventDefault(); remove(); }
  });
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    showMenu(more, [
      { label: 'Open', icon: 'open', run: open },
      { label: 'Rename…', icon: 'edit', kbd: 'F2', run: rename },
      { label: 'Duplicate', icon: 'copy', run: async () => { try { await app.duplicateProject(prov.id, key); shell.renderDrawer(); toast(`Duplicated “${p.name}”`); } catch (err) { toast(err.message, { type: 'error' }); } } },
      canDownload() ? { label: 'Download', icon: 'download', hint: '.crystallume.json', run: download } : null,
      { separator: true },
      { label: prov.id === 'server' && !prov.cloud ? 'Move to trash…' : 'Delete…', icon: 'trash', run: remove },
    ], { align: 'end' });
  });
  return row;
}

/** Put a deleted project back where it was (Undo). */
async function restore(app, prov, doc, wasCurrent) {
  try {
    if (typeof app.restoreProject === 'function') await app.restoreProject(prov.id, doc); // re-links the open project
    else {
      const saved = await prov.save(storable(doc));
      if (wasCurrent && !app.project.location) { app.project.location = { provider: prov.id, id: saved.__locationId ?? saved.id }; app.emit('project'); }
      app.emit('providers');
    }
    toast(`Restored “${doc.name}”`);
  } catch (e) { toast(`Could not restore “${doc.name}”: ${e.message}`, { type: 'error' }); }
}

/** "Signed in as alice · Sign out" — shown on every screen size while the server requires sign-in. */
function accountRow(app, prov, shell) {
  if (!prov.user || !prov.authRequired) return null;
  const out = h('button.linkish', { type: 'button' }, 'Sign out');
  out.addEventListener('click', async () => {
    out.disabled = true;
    await prov.logout();
    app.emit('providers');
    toast('Signed out');
    shell.renderDrawer();
  });
  const who = prov.cloud ? ['Signed in as ', h('b', prov.user.username)] : ['Signed in with the access token'];
  return h('div.account-row', ic('user', 'sm'), h('span.who', ...who), h('span.sep', { 'aria-hidden': 'true' }, '·'), out);
}

function authForm(app, prov, shell) {
  const tokenMode = !prov.cloud; // local mode protected by CRYSTALLUME_TOKEN
  const wrap = h('div', { style: { display: 'grid', gap: '10px' } });
  const canRegister = !tokenMode && prov.info?.allowRegistration !== false;
  const draw = () => {
    const register = canRegister && authState.mode === 'register';
    const user = h('input.field', { autocomplete: 'username', placeholder: 'Username', 'aria-label': 'Username', required: true, value: tokenMode ? 'local' : authState.username, hidden: tokenMode });
    if (!tokenMode) user.addEventListener('input', () => { authState.username = user.value; });
    const passHint = register ? h('small.field-hint', { id: 'auth-pass-hint' }, 'At least 6 characters') : null;
    const pass = h('input.field', {
      type: 'password', autocomplete: register ? 'new-password' : 'current-password', required: true,
      placeholder: tokenMode ? 'Access token' : 'Password', 'aria-label': tokenMode ? 'Access token' : 'Password',
      minlength: register ? 6 : null, 'aria-describedby': passHint ? 'auth-pass-hint' : null,
    });
    const err = h('p.err-text', { hidden: true, role: 'alert' });
    const submit = h('button.btn.primary', { type: 'submit' }, register ? 'Create account' : 'Sign in');
    const form = h('form.auth-form', { novalidate: true }, user, h('div.auth-pass', pass, passHint), err, submit);
    const fail = (message, field) => { err.hidden = false; err.textContent = message; field?.focus(); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (!user.value.trim()) return fail('Enter your username.', user);
      if (!pass.value) return fail(tokenMode ? 'Enter the access token.' : 'Enter your password.', pass);
      if (register && pass.value.length < 6) return fail('Use at least 6 characters for the password.', pass);
      submit.disabled = true;
      submit.textContent = register ? 'Creating account…' : 'Signing in…';
      try {
        if (register) await prov.register(user.value.trim(), pass.value); else await prov.login(user.value.trim(), pass.value);
        authState.mode = 'login'; authState.username = '';
        const unsaved = app.structure && (!app.project.location || app.project.location.provider === 'browser');
        const label = prov.cloud ? `Signed in as ${prov.user.username}` : 'Signed in to the server';
        toast(label, unsaved ? { action: { label: prov.cloud ? 'Save this project to your account' : 'Save this project to the server', run: () => app.saveTo('server') }, timeout: 9000 } : {});
        app.emit('providers');
        shell.renderDrawer();
      } catch (ex) {
        submit.disabled = false; submit.textContent = register ? 'Create account' : 'Sign in';
        const msg = tokenMode && ex.code === 'auth' ? 'That access token is not right. Check it and try again.' : ex.message;
        fail(msg, /username/i.test(msg) && !tokenMode ? user : pass);
      }
    });
    wrap.replaceChildren(...[
      tokenMode
        ? h('div.callout.accent', h('b', 'This server needs an access token'), h('span.hint', 'Enter the token the server was started with (CRYSTALLUME_TOKEN). Ask whoever runs it if you do not have it.'))
        : h('div.callout.accent', h('b', register ? 'Create an account on this server' : 'Sign in to the Crystallume server'),
          h('span.hint', register ? 'Your projects are stored under this account and available from any device.' : canRegister ? 'Use your account on this server, or create one in a few seconds.' : 'Use the account the server administrator gave you.')),
      form,
      canRegister ? h('p.hint', register ? 'Already registered? ' : 'No account yet? ', h('button.linkish', { type: 'button', on: { click: () => { authState.mode = register ? 'login' : 'register'; draw(); } } }, register ? 'Sign in' : 'Create one')) : null,
    ].filter(Boolean));
    setTimeout(() => {
      // a re-render must not pull the focus out of a field the user is typing in elsewhere (title, palette)
      const a = document.activeElement;
      if (!wrap.isConnected || (a && !wrap.contains(a) && a.matches?.('input, textarea, select, [contenteditable="true"]'))) return;
      (tokenMode || user.value ? pass : user).focus();   // a remembered username: go on to the password
    }, 20);
  };
  draw();
  return wrap;
}
