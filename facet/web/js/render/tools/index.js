/**
 * View tools (F0-A §3.13, ledger L-F0-41): the registry that Select and Measure (render/tools/select.js, measure.js)
 * and the tools of the feature modules (Move tool and Place atoms of M4, Pick adsorption site of M5) register in.
 * app.setTool(id, opts) switches one on; the viewer hands it the left button through its ToolHandler, and the shell
 * builds the status-bar hint, the tool HUD, the toolbar buttons and the Mouse rows of the shortcuts dialog from it.
 * A pure module (no DOM, no three.js): it runs in node.
 *
 *   const dispose = tools.register({ id, title, tip, icon, key, order, toolbar, selects, cursor, touch,
 *                                    when, whyNot, hint, hud, mouse, activate, deactivate, handler });
 *
 * ToolDef
 * - id: 'select' | 'measure' | 'move' | 'site-pick' | …; title: 'Move tool' (toasts, the generic HUD); tip: the toolbar
 *   button's tooltip and accessible name (default: the title); icon: a ui/icons.js name (needed with toolbar: true).
 * - key: the shortcut shown on the toolbar button, one key spec ('g'), kept in lower case. It binds nothing: only the
 *   command binds a key (M7 KC-03). The command that switches the tool on is tool.<camelCase id> (toolCommandId) and
 *   has the same key; toolKeyProblems() lists the tools where the two differ.
 * - order (100): toolbar buttons (after Select and Measure) and list order. toolbar: a button in the view toolbar.
 * - selects: clicks on atoms and drags on empty space still select atoms, as with Select (Select and Move do); the
 *   selection card hides under a tool that does not select.
 * - cursor: the canvas cursor while the tool is on ('grab', 'crosshair'). touch: 'claim' asks handler.claims(hit, e)
 *   whether a one-finger or pen-tip press belongs to the tool; with 'none' touch keeps the camera gestures.
 * - when(app) → bool and whyNot(app) → string: whether the tool can be switched on now, and why not.
 * - hint(app, env) → [html, …]: the status-bar hint, in parts the bar shows as many of as fit (joined by ' · ');
 *   hud(app, env) → Node | null: the tool HUD above the view. env = {touch, mac, MOD, ALT}. Without hint and hud the
 *   shell shows "<title> · Esc to finish" and a Done button (toolHint, genericHud).
 * - mouse: [[keys, description], …], rows the shortcuts dialog adds to its Mouse section.
 * - activate(app, opts), deactivate(app, reason); handler(app, viewer, opts) → ToolHandler | null, made on every switch.
 * Other fields are kept (tools.get('move').registerSnapTargets, M4).
 *
 * ToolHandler (render/viewer.js calls it; every method is optional):
 *   claims(hit, e) → bool        touch or pen tip (touch: 'claim'): does this press belong to the tool
 *   down(e, hit, press) → bool   a left press (or a claimed touch): true claims it, but it only becomes a drag once the
 *                                pointer has moved CLICK_PX; a claimed press that does not move is an ordinary click
 *   begin(e, press)              the claimed press moved past CLICK_PX: the drag starts
 *   move(e, press), up(e, press) the drag goes on, and ends normally
 *   click(e, hit) → bool         a click or tap without a drag, claimed or not: true = handled (no selection, no
 *                                atomclick or overlayclick; a second click still makes a double-click)
 *   cancel(press, reason)        a claimed press ended otherwise (CANCEL_REASONS); the tool undoes what it previewed
 *   hover(hit, e)                a move without buttons, once a frame, after the view's own hover (its cursor wins)
 *   keydown(e) → bool            a key on the focused view, before the view's own keys: true = handled
 * The right button (rotate), the middle button and Alt (pan), the wheel and both buttons together (zoom) and R + drag
 * (zoom box) never reach a tool. `hit` is viewer.pick()'s result; `press` the view's record of the press.
 */
import { escapeHTML } from '../../core/util.js';

/** Why a ToolHandler's cancel(press, reason) is called. */
export const CANCEL_REASONS = Object.freeze(['esc', 'lost', 'pointercancel', 'switch', 'second-finger', 'session']);
const TOUCH = ['none', 'claim'];
const FUNCTIONS = ['when', 'whyNot', 'hint', 'hud', 'activate', 'deactivate', 'handler'];
const STRINGS = ['tip', 'icon', 'cursor'];
const keysOf = (k) => (k == null || k === '' ? [] : (Array.isArray(k) ? k : [k]).map((x) => String(x).toLowerCase()));

/** The command that switches tool `id` on and binds its key: 'move' → 'tool.move', 'site-pick' → 'tool.sitePick'. */
export const toolCommandId = (id) => `tool.${String(id).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}`;

/** A checked copy of a tool definition with its defaults filled in. */
function normalize(def) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) throw new TypeError('tools.register: expected a tool object');
  if (typeof def.id !== 'string' || !def.id) throw new TypeError('tools.register: missing id');
  const what = `tools.register: “${def.id}”`;
  if (typeof def.title !== 'string' || !def.title.trim()) throw new TypeError(`${what} needs a title`);
  for (const k of FUNCTIONS) if (def[k] != null && typeof def[k] !== 'function') throw new TypeError(`${what}: ${k} must be a function`);
  for (const k of STRINGS) if (def[k] != null && typeof def[k] !== 'string') throw new TypeError(`${what}: ${k} must be a string`);
  if (def.key != null && def.key !== '' && typeof def.key !== 'string') throw new TypeError(`${what}: key must be one key spec such as 'g'`);
  if (def.order != null && !Number.isFinite(def.order)) throw new TypeError(`${what}: order must be a number`);
  const touch = def.touch ?? 'none';
  if (!TOUCH.includes(touch)) throw new TypeError(`${what}: touch must be 'none' or 'claim'`);
  const mouse = def.mouse ?? [];
  if (!Array.isArray(mouse) || mouse.some((r) => !Array.isArray(r) || r.length !== 2 || r.some((x) => typeof x !== 'string'))) {
    throw new TypeError(`${what}: mouse must be a list of [keys, description] pairs`);
  }
  const toolbar = !!def.toolbar;
  if (toolbar && !def.icon) throw new TypeError(`${what} is on the toolbar, so it needs an icon`);
  return {
    ...def, tip: def.tip || def.title, icon: def.icon || null, key: def.key ? def.key.toLowerCase() : null,
    order: def.order ?? 100, toolbar, selects: !!def.selects, cursor: def.cursor ?? '', touch, mouse: mouse.map((r) => [r[0], r[1]]),
  };
}

/**
 * A tool registry: register(def, {replace}) → dispose, get(id) → ToolDef | null, list() → ToolDef[] (by order, then
 * registration), onChange(fn) → off (fn(id) after every register and dispose). A tool with the id of an existing one
 * replaces it (with a console warning unless `replace` is set) until it is disposed, which brings the earlier one back.
 * `tools` below is the app's; tests make their own.
 */
export function createToolRegistry() {
  const byId = new Map();          // id → [def, …]; the last one is active
  const order = new WeakMap();     // def → registration number
  const listeners = new Set();
  let seq = 0;
  const changed = (id) => {
    for (const fn of [...listeners]) { try { fn(id); } catch (e) { console.error('tools: a change listener failed', e); } }
  };
  const active = () => [...byId.values()].map((list) => list.at(-1)).filter(Boolean);
  return {
    register(def, { replace = false } = {}) {
      const t = normalize(def);
      order.set(t, seq++);
      if (!byId.has(t.id)) byId.set(t.id, []);
      const list = byId.get(t.id);
      if (list.length && !replace) console.warn(`tools.register: “${t.id}” already exists and is replaced (pass { replace: true } to do this on purpose)`);
      const clash = t.key && active().find((o) => o.id !== t.id && o.key === t.key);
      if (clash) console.warn(`tools.register: the key “${t.key}” of “${t.id}” is already shown by “${clash.id}”`);
      list.push(t);
      changed(t.id);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const i = list.indexOf(t);
        if (i >= 0) list.splice(i, 1);
        if (!list.length && byId.get(t.id) === list) byId.delete(t.id);
        changed(t.id);
      };
    },
    /** The active definition of tool `id`, or null. */
    get: (id) => byId.get(id)?.at(-1) ?? null,
    /** The active definitions, by order, then registration. */
    list: () => active().sort((a, b) => a.order - b.order || order.get(a) - order.get(b)),
    /** Call fn(id) after every registration and dispose; returns a function that stops it. */
    onChange(fn) {
      if (typeof fn !== 'function') throw new TypeError('tools.onChange: expected a function');
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** The app's tool registry. */
export const tools = createToolRegistry();

/**
 * Tools whose shown key and command disagree (M7 KC-03: only the command binds the key, ToolDef.key must be the same):
 * one sentence per problem, for `toolList` (ToolDefs) and `commandList` (commands.list()). A tool without a key and
 * without a keyed command is fine.
 */
export function toolKeyProblems(toolList, commandList) {
  const byId = new Map([...commandList].map((c) => [c.id, c]));
  const out = [];
  for (const t of toolList) {
    const id = toolCommandId(t.id), c = byId.get(id), keys = c ? keysOf(c.key) : [];
    const key = t.key ? String(t.key).toLowerCase() : null;
    if (key && !c) out.push(`tool “${t.id}” shows the key “${key}”, but there is no command ${id} that binds it`);
    else if (key && !keys.includes(key)) out.push(`tool “${t.id}” shows the key “${key}”, but command ${id} ${keys.length ? `has “${keys.join('”, “')}”` : 'has no key'}`);
    else if (!key && keys.length) out.push(`tool “${t.id}” shows no key, but command ${id} has “${keys[0]}”`);
  }
  return out;
}

/**
 * The status-bar hint of tool `def` as HTML parts: its hint(app, env) when it gives a non-empty list, else (also when
 * the hint fails, which is logged) "<b>Title</b> · <b>Esc</b> to finish".
 */
export function toolHint(def, app, env = {}) {
  if (typeof def?.hint === 'function') {
    try {
      const parts = def.hint(app, env);
      if (Array.isArray(parts)) {
        const out = parts.filter((p) => p != null && p !== '').map(String);
        if (out.length) return out;
      }
    } catch (e) { console.error(`tools: the hint of “${def.id}” failed`, e); }
  }
  return [`<b>${escapeHTML(def?.title ?? 'Tool')}</b>`, '<b>Esc</b> to finish'];
}

/** The text of the generic HUD of a tool without hud(): "<title> · Esc to finish" (next to a Done button). */
export const genericHud = (def) => `${def?.title ?? 'Tool'} · Esc to finish`;
