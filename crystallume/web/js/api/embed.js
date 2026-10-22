/**
 * postMessage API for embedding Crystallume in an <iframe>. Only messages from the parent window are
 * accepted; replies go to the sender's origin and repeat the message's `type` and `id`.
 *   { type: 'crystallume:load', text | structure, format?, name?, look? }      -> { ok: true }
 *   { type: 'crystallume:look', id } | { type: 'crystallume:set', path, value } | { type: 'crystallume:view', axis }
 *   { type: 'crystallume:screenshot', scale?, transparent?, id }                 -> { dataURL }
 *   { type: 'crystallume:call', method, args: [...], id }                        -> { result } | { error }
 *       method ∈ setRepresentation setLighting applyLook patch set sample setCamera getCamera fit resetView
 *                select frame command exportText (ALLOWED); scene paths with __proto__ etc. are refused
 *   { type: 'crystallume:get', what: 'scene' | 'summary' | 'selection' | 'camera', id } -> { result }
 *   { type: 'crystallume:subscribe', events: ['selection', ...] } / 'crystallume:unsubscribe'
 *       -> later { type: 'crystallume:event', name, detail } for each event (see crystallume.help('events'))
 * Once it has booted and shows its first structure, the frame posts { type: 'crystallume:ready', version } to its
 * parent (the function returned by installEmbedAPI does that), so a load sent on 'ready' is not replaced.
 * Former name: 'atomscope:*' messages are understood too; the frame also posts 'atomscope:ready', and a parent that
 * subscribed with 'atomscope:subscribe' gets its events as 'atomscope:event'.
 */
import { assertSafePath } from './public.js';

/** Methods reachable with crystallume:call. */
export const ALLOWED = ['setRepresentation', 'setLighting', 'applyLook', 'patch', 'set', 'sample', 'setCamera', 'getCamera', 'fit', 'resetView', 'select', 'frame', 'command', 'exportText'];
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function checkKeys(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 12) return;
  for (const k of Object.keys(o)) { if (BAD_KEYS.has(k)) throw new Error(`invalid key ${k}`); checkKeys(o[k], depth + 1); }
}

/** A structured-clone-safe copy of a result or event detail (plain JSON data only). */
function plain(v, api) {
  if (v == null) return null;
  if (v instanceof api.Structure) return v.summary();
  if (v instanceof Blob) return v;
  try { const s = JSON.stringify(v); return s === undefined || s.length > 4e6 ? null : JSON.parse(s); } catch { return null; }
}

/** Listen for embedding messages; returns announceReady(), which posts 'crystallume:ready' (and the former 'atomscope:ready'; call it after the first content). */
export function installEmbedAPI(api) {
  if (window.parent === window) return () => {};
  const subs = new Map();      // event name -> off()
  let target = { win: window.parent, origin: '*', prefix: 'crystallume' };
  const queued = new Map();    // coalesce app + viewer copies of the same event in one tick
  const detailOf = (name, d) => {
    if (name === 'selection') return api.selection;
    if (name === 'structure') return api.structure ? api.structure.summary() : null;
    if (name === 'camera') return api.getCamera();
    if (name === 'error') return { message: d?.message ?? String(d) };
    if (name === 'model' || name === 'scene' || name === 'render' || name === 'project') return null;
    return plain(d, api);
  };
  const send = (name, d) => {
    const first = !queued.has(name);
    queued.set(name, d);
    if (!first) return;
    const flush = () => {
      const detail = queued.get(name);
      queued.delete(name);
      try { target.win.postMessage({ type: `${target.prefix}:event`, name, detail: detailOf(name, detail) }, target.origin); } catch (e) { console.warn('crystallume embed: event not sent', e); }
    };
    if (name === 'camera' || name === 'render') setTimeout(flush, 100); else queueMicrotask(flush);
  };

  addEventListener('message', async (e) => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || !/^(crystallume|atomscope):/.test(String(m.type))) return;
    const type = String(m.type).replace(/^atomscope:/, 'crystallume:');   // former name still understood
    const origin = e.origin === 'null' ? '*' : e.origin;
    const reply = (data) => e.source.postMessage({ type: m.type, id: m.id, ...data }, origin);
    try {
      switch (type) {
        case 'crystallume:load': await api.load(m.text ?? m.structure, { format: m.format, name: m.name, look: m.look, newProject: m.newProject !== false }); reply({ ok: true }); break;
        case 'crystallume:look': api.applyLook(m.id); reply({ ok: true }); break;
        case 'crystallume:set': assertSafePath(m.path); api.set(m.path, m.value); reply({ ok: true }); break;
        case 'crystallume:view': api.view(m.axis); reply({ ok: true }); break;
        case 'crystallume:screenshot': {
          const blob = await api.screenshot({ scale: m.scale ?? 2, transparent: !!m.transparent });
          const dataURL = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
          reply({ dataURL });
          break;
        }
        case 'crystallume:call': {
          const method = String(m.method ?? '');
          if (!ALLOWED.includes(method)) throw new Error(`method ${method || '(none)'} is not allowed; use one of ${ALLOWED.join(', ')}`);
          const args = Array.isArray(m.args) ? m.args : m.args === undefined ? [] : [m.args];
          if (method === 'set') assertSafePath(args[0]);
          if (method === 'patch') checkKeys(args[0]);
          reply({ result: plain(await api[method](...args), api) });
          break;
        }
        case 'crystallume:get': {
          const what = m.what ?? 'summary';
          const result = what === 'scene' ? plain(api.scene, api) : what === 'summary' ? (api.structure ? { name: api.structure.name, ...api.structure.summary() } : null)
            : what === 'selection' ? api.selection : what === 'camera' ? plain(api.getCamera(), api) : undefined;
          if (result === undefined) throw new Error(`unknown 'what' ${what}; use scene, summary, selection or camera`);
          reply({ result });
          break;
        }
        case 'crystallume:subscribe':
        case 'crystallume:unsubscribe': {
          const names = (Array.isArray(m.events) ? m.events : [m.events]).filter((x) => typeof x === 'string' && x);
          target = { win: e.source, origin, prefix: String(m.type).startsWith('atomscope:') ? 'atomscope' : 'crystallume' };
          for (const name of names) {
            if (type === 'crystallume:subscribe' && !subs.has(name)) subs.set(name, api.on(name, (d) => send(name, d)));
            if (type === 'crystallume:unsubscribe' && subs.has(name)) { subs.get(name)(); subs.delete(name); }
          }
          reply({ ok: true, events: [...subs.keys()] });
          break;
        }
        default: reply({ error: `unknown message ${m.type}` });
      }
    } catch (err) { reply({ error: err?.message ?? String(err) }); }
  });
  let announced = false;
  return () => {
    if (announced) return;
    announced = true;
    window.parent.postMessage({ type: 'crystallume:ready', version: api.version }, '*');
    window.parent.postMessage({ type: 'atomscope:ready', version: api.version }, '*');   // for parents written for the former name
  };
}
