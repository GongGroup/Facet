/**
 * Extensions: everything the server and plugins add to the app at start-up, and the palette commands
 * that mirror the registries.
 *
 *   installExtensions(app, api, shell)  — call once after createAPI(): server presets, plugin analyses,
 *                                         server-only file formats, plugin frontends (server, plugins.json,
 *                                         ?plugin= in static mode), then syncs commands and the UI.
 *   syncRegistryCommands(app)           — (re)register rep.*, look.*, light.*, color.*, sample.* and
 *                                         export.<format> commands from the registries; drops stale ones.
 */
import { commands } from '../core/commands.js';
import { analyses } from '../core/analyses.js';
import { Structure } from '../core/structure.js';
import { styles } from '../render/styles.js';
import { looks } from '../render/looks.js';
import { lightingPresets } from '../render/lighting.js';
import { colorSchemes } from '../render/colors.js';
import { samples } from '../build/samples.js';
import { formats } from '../io/index.js';
import { isArtifact, canDownload, NO_DOWNLOADS } from '../storage/files.js';
import { toast } from '../ui/overlays.js';
import { openApiDialog, copySceneScript } from '../ui/apidialog.js';

const fail = (p) => p?.catch?.((e) => toast(e.message, { type: 'error' }));

// ------------------------------------------------------------------ registry-driven commands
/** One entry per command family: which registry it mirrors and how a command is made. */
const FAMILIES = [
  { prefix: 'rep.', category: 'Representation', items: () => styles.list(), make: (app, s) => ({ title: s.name ?? s.id, keywords: s.description, shortcutGroup: 'Representations', run: () => app.setRepresentation(s.id) }) },
  { prefix: 'look.', category: 'Look', items: () => looks.list().filter((l) => !l.hidden), make: (app, l) => ({ title: l.name ?? l.id, keywords: l.description, run: () => app.applyLook(l.id) }) },
  { prefix: 'light.', category: 'Lighting', items: () => lightingPresets.list(), make: (app, l) => ({ title: l.name ?? l.id, keywords: l.description, run: () => app.setLightingPreset(l.id) }) },
  { prefix: 'color.', category: 'Colours', items: () => colorSchemes.list(), make: (app, c) => ({ title: c.name ?? c.id, keywords: c.description, run: () => app.set('style.colorScheme', c.id) }) },
  { prefix: 'sample.', category: 'Sample', items: () => samples.list(), make: (app, s) => ({ title: s.name ?? s.id, keywords: `${s.category ?? ''} ${(s.tags ?? []).join(' ')}`, run: () => fail(Promise.resolve().then(() => app.loadSample(s.id))) }) },
  {
    prefix: 'export.', category: 'Export', items: () => formats.writers(),
    make: (app, f) => ({
      title: `Export ${f.name ?? f.id}`, keywords: `${(f.extensions ?? []).join(' ')} ${f.description ?? ''}${f.server ? ' server' : ''}`,
      when: () => !!app.structure && !app.busy && canDownload() && (!['poscar', 'cif'].includes(f.id) || !!app.structure?.cell),
      whyNot: () => (!canDownload() ? NO_DOWNLOADS : ['poscar', 'cif'].includes(f.id) && app.structure && !app.busy && !app.structure.cell ? `${f.name ?? f.id} needs a unit cell.` : null),
      run: () => fail(app.exportStructureFile(f.id)),
    }),
  },
];
const seen = new Map(FAMILIES.map((f) => [f.prefix, new Set()]));
const MINE = 'registry';

/**
 * Make the palette match the registries: a command for every representation, look, lighting preset,
 * colour scheme, sample and writable format; commands of removed entries are dropped. Commands that
 * were registered elsewhere (main.js) with the same id are kept as they are.
 */
export function syncRegistryCommands(app) {
  const usedKeys = new Set(commands.list().flatMap((c) => (c.key == null ? [] : [].concat(c.key).map(String))));
  for (const fam of FAMILIES) {
    const ids = seen.get(fam.prefix);
    const items = fam.items();
    const want = new Set();
    items.forEach((it, i) => {
      const id = `${fam.prefix}${it.id}`;
      want.add(it.id); ids.add(it.id);
      const prev = commands.get(id);
      if (prev && prev.source !== MINE) return;
      const c = { id, category: fam.category, source: MINE, ...fam.make(app, it) };
      if (prev) c.key = prev.key;
      else if (fam.prefix === 'rep.' && i < 9 && !usedKeys.has(String(i + 1))) { c.key = String(i + 1); usedKeys.add(c.key); }
      commands.register(c);
    });
    for (const id of ids) if (!want.has(id)) { const c = commands.get(`${fam.prefix}${id}`); if (c?.category === fam.category) commands.unregister(c.id); ids.delete(id); }
  }
}

// ------------------------------------------------------------------ UI refresh
let pending = null;
/** Re-render the parts of the shell that list registry entries (batched: many registrations, one render). */
export function refreshShell(shell, parts = ['inspector', 'drawer', 'rail']) {
  if (!shell) return;
  if (!pending) {
    pending = new Set();
    setTimeout(() => {
      const p = pending; pending = null;
      try {
        if (p.has('rail')) { if (typeof shell.renderRail === 'function') shell.renderRail(); else shell.buildRail?.(); }
        if (p.has('drawer') || p.has('rail')) shell.renderDrawer?.();
        if (p.has('inspector')) shell.refreshInspector?.();
      } catch (e) { console.error('Facet: refreshing the panels failed', e); }
    }, 0);
  }
  parts.forEach((x) => pending.add(x));
}

// ------------------------------------------------------------------ install
/** Install server and plugin extensions. Never throws: problems are reported in one toast. */
export async function installExtensions(app, api, shell) {
  commands.setContext(app);
  if (!commands.get('api.copyScene')) {
    commands.register({ id: 'api.copyScene', title: 'Copy current scene as script', category: 'Help', keywords: 'api javascript console patch settings code', source: MINE, run: () => copySceneScript(app) });
  }
  syncRegistryCommands(app);
  const problems = [];
  const info = app.serverStore?.info;
  if (info) {
    try { installServerPresets(api, info); } catch (e) { console.warn('Facet: server presets', e); }
    installServerAnalyses(app, api, info);
    installServerFormats(app, api, info);
    const broken = (info.plugins ?? []).filter((p) => p.status === 'error');
    if (broken.length) problems.push(broken.length === 1 ? `Server plugin “${broken[0].name}” failed to load: ${broken[0].error ?? 'unknown error'}` : `${broken.length} server plugins failed to load (${broken.map((p) => p.name).join(', ')})`);
    for (const p of info.plugins ?? []) {
      if (p.status === 'error') continue;
      for (const url of p.frontend ?? []) await loadPlugin(api, serverURL(app, url), { name: p.name, source: 'server' }, problems);
    }
  }
  for (const entry of await readManifest()) await loadPlugin(api, entry.url, { name: entry.name, source: 'plugins.json' }, problems);
  if (!info && !isArtifact()) {
    for (const url of new URLSearchParams(location.search).getAll('plugin')) {
      let u;
      try { u = new URL(url, document.baseURI); } catch { problems.push(`Plugin URL “${url}” is not valid`); continue; }
      if (u.origin !== location.origin) { problems.push(`Plugin “${u.pathname.split('/').pop() || url}” was not loaded: the address bar can only load plugins from this site`); continue; }
      await loadPlugin(api, u.href, { source: 'url' }, problems);
    }
  }
  syncRegistryCommands(app);
  refreshShell(shell);
  if (problems.length) {
    problems.forEach((p) => console.warn(`Facet: ${p}`));
    const more = problems.length > 1 ? ` (and ${problems.length - 1} more problem${problems.length > 2 ? 's' : ''})` : '';
    toast(`${problems[0]}${more}`, { type: 'error', timeout: 9000, action: shell ? { label: 'Details', run: () => openApiDialog(shell, api, 'server') } : undefined });
  }
}

async function loadPlugin(api, url, meta, problems) {
  try { await api.plugins.load(url, meta); }
  catch (e) { console.warn(`Facet: plugin ${meta.name ?? url} failed to load`, e); problems.push(`Plugin “${meta.name ?? url.split('/').pop()}” failed to load: ${e.message}`); }
}

/** Plugin module URL from /api/v1/info: relative URLs resolve against the page, '/x' gets the server's sub-path. */
function serverURL(app, url) {
  const u = /^\/(?!\/)/.test(url) && app.serverStore?.url ? app.serverStore.url(url) : url;
  return new URL(u, document.baseURI).href;
}

/** Optional same-origin plugins.json next to index.html: [{ name, url }] (or plain URL strings). */
async function readManifest() {
  try {
    const res = await fetch(new URL('plugins.json', document.baseURI), { cache: 'no-cache' });
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) { console.warn('Facet: plugins.json must be a JSON array of {name, url}'); return []; }
    return list.map((x) => (typeof x === 'string' ? { url: x } : x)).filter((x) => x && typeof x.url === 'string' && x.enabled !== false)
      .map((x) => ({ name: x.name, url: new URL(x.url, res.url || document.baseURI).href }));
  } catch { return []; }
}

function installServerPresets(api, info) {
  const P = info.presets ?? {};
  for (const p of P.lighting ?? []) tryReg(() => api.registerLightingPreset(p));
  for (const c of P.colorSchemes ?? []) {
    tryReg(() => api.registerColorScheme({ id: c.id, name: c.name, description: c.description ?? `From the server plugin ${c.plugin ?? ''}`.trim(), plugin: c.plugin, colorFor: (sym) => c.colors?.[sym] ?? c.default ?? '#b0b6bd' }));
  }
  for (const l of [...(P.styles ?? []), ...(P.looks ?? [])]) if (l.scene) tryReg(() => api.registerLook({ swatch: l.swatch ?? 'linear-gradient(135deg,#d7dbe0,#8d949c)', ...l }));
}
const tryReg = (fn) => { try { fn(); } catch (e) { console.warn('Facet: server preset skipped:', e.message); } };

/** Each plugin analysis on the server becomes an entry that runs it there. */
function installServerAnalyses(app, api, info) {
  for (const a of info.customAnalyses ?? []) {
    const id = analyses.get(a.name)?.source === 'built-in' ? `server.${a.name}` : a.name;
    tryReg(() => api.registerAnalysis({
      id, name: a.label ?? a.name, description: a.description ?? '', params: a.params ?? [], source: a.plugin ?? 'server', server: true,
      run: async (s, params) => (await app.serverStore.api(`/analysis/custom/${encodeURIComponent(a.name)}`, { method: 'POST', body: { structure: s.toJSON(), params } })).result,
    }, { replace: true }));
  }
}

/**
 * File formats only the server can read or write (e.g. from Python plugins) are added as `server: true` formats.
 * A writer's `capabilities` from GET /formats are copied, so exportReport (io/index.js) checks its exports locally
 * and synchronously, from the same table as the `warnings` of the server's /io/export.
 */
function installServerFormats(app, api, info) {
  const R = info.formats?.readers ?? [], W = info.formats?.writers ?? [];
  const store = app.serverStore;
  const ids = [...new Set([...R, ...W].map((f) => String(f.name).toLowerCase()))];
  for (const id of ids) {
    if (formats.get(id)) continue;
    const r = R.find((f) => String(f.name).toLowerCase() === id), w = W.find((f) => String(f.name).toLowerCase() === id);
    tryReg(() => api.registerFormat({
      id, name: id.charAt(0).toUpperCase() + id.slice(1), server: true, plugin: (r ?? w)?.source,
      extensions: [...new Set([...(r?.extensions ?? []), ...(w?.extensions ?? [])].map((e) => String(e).replace(/^\./, '').toLowerCase()))],
      filenames: (r?.filenames ?? []).map((n) => String(n).toUpperCase()),
      description: (r ?? w)?.description || 'Read and written by the Facet server',
      mime: w?.mimetype ?? 'text/plain',
      capabilities: w?.capabilities ?? null,
      read: r ? async (text, filename) => Structure.fromJSON((await store.api('/io/parse', { method: 'POST', body: { text, filename: filename || null, format: id } })).structure) : undefined,
      write: w ? async (st) => (await store.api('/io/export', { method: 'POST', body: { structure: st.toJSON(), format: id } })).text : undefined,
    }));
  }
}
