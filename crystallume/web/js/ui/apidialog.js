/**
 * Help › Scripting & API: a quick start with copyable snippets, a live reference of every registry,
 * command, scene path and event, and the server's API docs and plugin status.
 * Also "Copy current scene as script" (sceneScript / copySceneScript).
 */
import { h, btn } from './dom.js';
import { dialog, toast } from './overlays.js';
import { DEFAULT_SCENE } from '../render/settings.js';
import { looks } from '../render/looks.js';

let lastTab = 'start';
let dialogSeq = 0;   // unique ids for the tab widget of each open dialog
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const short = (v) => { const s = JSON.stringify(v); return s == null ? String(v) : s.length > 48 ? `${s.slice(0, 46)}…` : s; };
const js = (v) => (typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : JSON.stringify(v));

// ------------------------------------------------------------------ clipboard
/** Copy text; resolves true when it reached the clipboard (async API, then the legacy fallback). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* blocked: try the fallback */ }
  try {
    const ta = h('textarea', { readonly: true, style: { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' } }, text);
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/** Copy and confirm with a toast; when the clipboard is blocked, show the text to copy by hand. */
async function copyWithToast(text, done = 'Copied to the clipboard') {
  if (await copyText(text)) { toast(done); return true; }
  const ta = h('textarea.field.api-manual', { rows: Math.min(16, text.split('\n').length + 1), readonly: true, spellcheck: false }, text);
  dialog({ title: 'Copy this text', body: h('div', { style: { display: 'grid', gap: '8px' } }, h('p.hint', 'The clipboard is not available here. Select the text and press Ctrl C (⌘ C on a Mac).'), ta) });
  setTimeout(() => { ta.focus(); ta.select(); }, 40);
  return false;
}

// ------------------------------------------------------------------ scene as script
function diff(cur, def) {
  if (isObj(cur) && isObj(def)) {
    const out = {};
    for (const k of Object.keys(cur)) {
      const d = k in def ? diff(cur[k], def[k]) : cur[k];
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(cur) === JSON.stringify(def) ? undefined : cur;
}

/** The scene as `crystallume.patch({...})` of what differs from the defaults, plus the camera. */
export function sceneScript(app) {
  const sc = JSON.parse(JSON.stringify(app.scene ?? {}));
  const base = sc.lookBase ?? sc.look;
  for (const k of ['camera', 'look', 'lookBase']) delete sc[k];
  const d = diff(sc, DEFAULT_SCENE);
  const lines = ['// Crystallume scene — run in the browser console or from a plugin (changes made after a default scene).'];
  if (base && looks.get(base)) lines.push(`// Started from the “${looks.get(base).name ?? base}” look.`);
  lines.push(d ? `crystallume.patch(${JSON.stringify(d, null, 2).replace(/"([A-Za-z_$][\w$]*)":/g, '$1:')});` : '// The scene uses the default settings.');
  try {
    const cam = app.viewer?.getCameraState?.();
    if (cam?.position) {
      const r = (a) => (Array.isArray(a) ? a.map((v) => +(+v).toFixed(4)) : a);
      lines.push(`crystallume.setCamera(${JSON.stringify({ position: r(cam.position), up: r(cam.up), target: r(cam.target), zoom: +(+cam.zoom || 1).toFixed(4) })});`);
    }
  } catch { /* no viewer */ }
  return `${lines.join('\n')}\n`;
}

export function copySceneScript(app) {
  return copyWithToast(sceneScript(app), 'Scene script copied — paste it into the browser console');
}

// ------------------------------------------------------------------ dialog
/** Open Help › Scripting & API on a tab: 'start' | 'reference' | 'server'. */
export function openApiDialog(shell, api = window.crystallume, tab = lastTab) {
  if (!api) return null;
  const app = api.app;
  const TABS = [['start', 'Quick start'], ['reference', 'Reference'], ['server', 'Server']];
  const uid = `api-${++dialogSeq}`;
  const bar = h('div.api-tabs', { role: 'tablist', 'aria-label': 'Scripting & API' });
  const panel = h('div.api-panel', { role: 'tabpanel', id: `${uid}-panel` });
  const show = (id) => {
    lastTab = id;
    bar.querySelectorAll('button').forEach((b) => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    panel.setAttribute('aria-labelledby', `${uid}-tab-${id}`);
    panel.replaceChildren(id === 'reference' ? referenceTab(api) : id === 'server' ? serverTab(api) : startTab(api));
  };
  for (const [id, label] of TABS) {
    const b = h('button', { type: 'button', role: 'tab', id: `${uid}-tab-${id}`, 'aria-controls': `${uid}-panel`, dataset: { tab: id } }, label);
    b.addEventListener('click', () => show(id));
    b.addEventListener('keydown', (e) => {
      const i = TABS.findIndex(([t]) => t === id);
      const j = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      const n = TABS[j][0];
      show(n); bar.querySelector(`[data-tab="${n}"]`)?.focus();
    });
    bar.append(b);
  }
  // keep the reference and plugin list live while the dialog is open
  const offs = ['registry', 'plugins'].map((ev) => app.on(ev, () => { if (lastTab !== 'start' && panel.isConnected && !panel.contains(document.activeElement)) show(lastTab); }));
  const d = dialog({ title: 'Scripting & API', wide: true, className: 'api-dialog', body: h('div.api-body', bar, panel), onClose: () => offs.forEach((off) => off?.()) });
  show(TABS.some(([t]) => t === tab) ? tab : 'start');
  return d;
}

function snippet(title, code, note) {
  return h('div.api-snippet',
    h('div.api-snippet-head', h('b', title), btn('Copy', { icon: 'copy', cls: 'ghost small', tip: `Copy the ${title.toLowerCase()} snippet`, on: () => copyWithToast(code) })),
    note ? h('p.hint', note) : null,
    h('pre.api-code', code));
}

function startTab(api) {
  const app = api.app;
  const look = looks.list().find((l) => !l.hidden && l.id !== app.scene?.look)?.id ?? 'studio';
  const console_ = `// Browser console (or a plugin). crystallume.help() lists everything.
const s = crystallume.build.crystal('perovskite', { elements: ['Ba', 'Ti', 'O'], a: 4.01, repeat: [3, 3, 3] });
crystallume.load(s);                           // show it
crystallume.applyLook('${look}');                // one-click look
crystallume.set('post.outline.enabled', true);  // any scene path
crystallume.view('c');                          // look along c
crystallume.selectSameElement('O');             // select every O atom
const rdf = await crystallume.analyze('rdf', { rmax: 6 });
const png = await crystallume.screenshot({ scale: 3 });   // Blob
crystallume.on('selection', () => console.log(crystallume.selection));`;
  const plugin = `// my-plugin.js — add it to plugins.json next to index.html,
// load it with crystallume.plugins.load('my-plugin.js'), or ship it in a Python plugin.
export default function activate(api) {
  api.registerLook({
    id: 'lab-night', name: 'Lab night', swatch: '#10202a',
    scene: { display: { background: { mode: 'solid', color1: '#10202a' } },
             post: { outline: { enabled: true, color: '#dff3ff' } } },
  });
  api.registerAnalysis({
    id: 'mass', name: 'Total mass',
    run: (s) => ({ atoms: s.length, elements: s.elements().join(' ') }),
  });
  api.registerCommand({ id: 'lab-night.apply', title: 'Lab night look', run: () => api.applyLook('lab-night') });
}`;
  const embed = `// A page that embeds Crystallume: <iframe id="viewer" src="https://your-host/crystallume/"></iframe>
const viewer = document.getElementById('viewer').contentWindow;
addEventListener('message', (e) => {
  if (e.data?.type === 'crystallume:ready') {
    viewer.postMessage({ type: 'crystallume:load', text: cifText, name: 'NaCl.cif' }, '*');
    viewer.postMessage({ type: 'crystallume:call', id: 1, method: 'applyLook', args: ['${look}'] }, '*');
    viewer.postMessage({ type: 'crystallume:subscribe', events: ['selection'] }, '*');
  }
  if (e.data?.type === 'crystallume:event') console.log(e.data.name, e.data.detail);
});`;
  return h('div.api-start',
    h('p.hint', 'Everything in the app is scriptable through ', h('code', 'window.crystallume'), ': in the browser console, in plugins (they receive the same object) and from a page that embeds Crystallume. Click any entry in Reference to copy a ready-made call.'),
    snippet('Console', console_),
    snippet('Plugin', plugin, 'Plugins add looks, representations, colour schemes, lighting, samples, file formats, analyses, panels and commands. Each register call checks its entry and returns a function that removes it.'),
    snippet('Embed', embed, 'Messages are accepted from the parent window only. crystallume:call runs an allow-listed method and replies with {result} or {error}.'));
}

function referenceTab(api) {
  const ref = api.reference();
  const q = h('input.field', { type: 'search', placeholder: 'Filter by id, title or path…', 'aria-label': 'Filter the reference' });
  const sections = [];
  const item = (label, call, { sub, tip } = {}) => {
    const b = h('button.api-item', { type: 'button', 'data-tip': tip ?? `Copy ${call}`, dataset: { s: `${label} ${sub ?? ''} ${call}`.toLowerCase() } }, h('code', label), sub ? h('small', sub) : null);
    b.addEventListener('click', () => copyWithToast(call, `Copied ${call.length > 60 ? 'the call' : call}`));
    return b;
  };
  const section = (title, count, items, cls = 'api-chips') => {
    const body = h(`div.${cls}`, items);
    const head = h('h3', h('span.grow', title), h('span.api-count', String(count)));
    const s = h('section.api-sec', head, body);
    sections.push(s);
    return s;
  };
  const regs = ref.registries.map((r) => section(r.label, r.count, r.ids.map((id) => item(id, r.example.replace('{id}', id)))));
  // members of crystallume.edit, .build, … that the app and its modules define (defineApi), with their signatures
  const byNs = {};
  for (const m of ref.api ?? []) (byNs[m.path.includes('.') ? m.path.split('.')[0] : ''] ??= []).push(m);
  const members = Object.entries(byNs).map(([ns, list]) => section(ns ? `crystallume.${ns}` : 'crystallume', list.length, list.map((m) => item(m.path, m.call ?? `crystallume.${m.path}()`, { sub: m.sig ?? '' })), 'api-rows'));
  const cmds = section('Commands', ref.commands.length, ref.commands.map((c) => item(c.id, `crystallume.command('${c.id}')`, { sub: `${c.title}${c.key ? ` · ${c.key}` : ''}` })), 'api-rows');
  const groups = {};
  for (const p of ref.scene) (groups[p.path.split('.')[0]] ??= []).push(p);
  const scene = Object.entries(groups).map(([top, list]) => section(`Scene · ${top}`, list.length, list.map((p) => item(p.path, `crystallume.set('${p.path}', ${js(p.current)})`, { sub: `${p.type} · ${short(p.current)}` })), 'api-rows'));
  const events = section('Events', ref.events.length, ref.events.map((e) => item(e.name, `crystallume.on('${e.name}', (detail) => console.log('${e.name}', detail))`, { sub: `${e.source} · ${e.description}` })), 'api-rows');
  const none = h('p.hint', { hidden: true }, 'Nothing matches. Try a shorter word.');
  q.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase();
    let any = false;
    for (const s of sections) {
      let n = 0;
      s.querySelectorAll('.api-item').forEach((b) => { const hit = !t || b.dataset.s.includes(t); b.hidden = !hit; if (hit) n++; });
      s.hidden = n === 0; any ||= n > 0;
    }
    none.hidden = any;
  });
  return h('div.api-ref', h('div.api-ref-top', q, h('span.hint', 'Click an entry to copy a call.')), none,
    h('div.api-group', h('div.sub-h', 'Registries'), ...regs), members.length ? h('div.api-group', h('div.sub-h', 'Namespaces'), ...members) : null,
    cmds, h('div.api-group', h('div.sub-h', 'Scene paths'), ...scene), events);
}

function pluginList(api) {
  const list = api.plugins.list();
  if (!list.length) return h('p.hint', 'No plugins are loaded. Add Python plugins with crystallume serve --plugins DIR, or frontend plugins with plugins.json or crystallume.plugins.load(url).');
  return h('div.api-plugins', list.map((p) => h('div.api-plugin', { dataset: { status: p.status } },
    h('div.row', h('span.api-status', { dataset: { status: p.status } }, p.status === 'active' ? 'Active' : p.status === 'error' ? 'Error' : p.status === 'loading' ? 'Loading' : p.status),
      h('b', p.name), p.version ? h('span.muted', p.version) : null, h('span.api-kind', p.server ? 'server' : p.source === 'plugins.json' ? 'plugins.json' : 'frontend')),
    p.description ? h('p.hint', p.description) : null,
    p.error ? h('p.err-text', p.error) : null,
    ...(p.frontend ?? []).filter((f) => f.status === 'error').map((f) => h('p.err-text', `${f.url.split('/').pop()}: ${f.error}`)),
    p.url ? h('p.hint.api-url', p.url) : null)));
}

function serverTab(api) {
  const store = api.app.serverStore;
  const info = store?.info;
  const out = h('div.api-server');
  if (info) {
    const base = new URL(store.url('/'), location.href).href.replace(/\/$/, '');
    const link = (path, label) => h('a.btn.small', { href: store.url(path), target: '_blank', rel: 'noopener' }, label);
    out.append(
      h('div.callout', h('div.row', h('b', `Crystallume server ${info.version ?? ''}`), h('span.api-kind', `${info.mode} mode`)),
        h('span.hint', info.mode === 'cloud' ? 'Projects are stored per account. API calls need Authorization: Bearer <token> from /api/v1/auth/login.' : 'Projects are folders in the server’s data directory. The REST API needs no sign-in unless the server was started with CRYSTALLUME_TOKEN.'),
        h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } }, link(info.endpoints?.docs ?? '/docs', 'Interactive API docs'), link(info.endpoints?.openapi ?? '/openapi.json', 'OpenAPI schema'), link('/api/v1/info', 'Server info'))),
      snippet('Python', `from crystallume import Client, build

c = Client("${base}")${info.mode === 'cloud' ? '\nc.login("alice", "password")' : ''}
s = c.build_crystal("perovskite", ["Ba", "Ti", "O"])
print(c.summary(s)["formula"], c.coordination(s)["average"])
print([a["name"] for a in c.custom_analyses()])        # plugin analyses
p = c.create_project("From Python", structures=[s])`),
    );
  } else {
    out.append(h('div.callout', h('b', 'Running without the Python server'),
      h('span.hint', 'Projects are kept in this browser or a folder on your computer. Run the server for the REST API, plugin formats and cloud projects:'),
      h('pre.api-code', 'pip install .                             # in a Crystallume checkout\ncrystallume serve --plugins ./plugins     # then open http://127.0.0.1:8765')));
  }
  out.append(snippet('Command line', `crystallume plugins new my-plugin --dir ./plugins   # scaffold a plugin
crystallume plugins --plugins ./plugins                # list plugins and their status
crystallume analyze hello-com POSCAR --plugins ./plugins
crystallume convert input.cif output.vasp`));
  out.append(h('div.sub-h', 'Plugins'), pluginList(api));
  return out;
}
