/**
 * Command registry used by the command palette, keyboard shortcuts and plugins.
 *   commands.register({ id, title, category, key?, keywords?, hidden?, run(app, ...args), when?(app) })
 * `run` always receives the app first: commands.run(id, ...args) calls run(app, ...args), and so does
 * calling `commands.get(id).run()` (the palette and shortcuts do). The app is set once with
 * commands.setContext(app). `key` is a shortcut spec ('r', 'Escape', 'mod+o') or an array of them.
 * `when(app)` says whether the command can run now: the palette hides it, shortcuts skip it, and
 * commands.run() throws an Error saying why (whyNot(app) → string, if given, explains other reasons).
 */
const registry = new Map();
const RAW = Symbol('raw run');
let context = null;

const keysOf = (k) => (k == null || k === '' ? [] : (Array.isArray(k) ? k : [k]).map((x) => String(x).toLowerCase()));

export const commands = {
  /** Register (or replace) a command; returns a function that removes it again. */
  register(c) {
    if (!c?.id) throw new Error('commands.register: missing id');
    if (typeof c.run !== 'function') throw new Error(`commands.register: missing run() for “${c.id}”`);
    const mine = keysOf(c.key);
    if (mine.length) {
      for (const o of registry.values()) {
        if (o.id === c.id) continue;
        const clash = keysOf(o.key).find((k) => mine.includes(k));
        if (clash) console.warn(`commands.register: key “${clash}” of “${c.id}” is already used by “${o.id}”`);
      }
    }
    const raw = c.run[RAW] ?? c.run;
    const entry = { ...c };
    entry.run = function run(...args) { return raw.call(entry, context, ...args); };
    entry.run[RAW] = raw;
    registry.set(c.id, entry);
    return () => { if (registry.get(c.id) === entry) registry.delete(c.id); };
  },
  /** Remove a command by id. */
  unregister: (id) => registry.delete(id),
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
  /** Run a command: run(app, ...args). Throws for an unknown id, or when its `when` guard says it cannot run now. */
  run(id, ...args) {
    const c = registry.get(id);
    if (!c) throw new Error(`Unknown command ${id}`);
    if (!available(c)) throw Object.assign(new Error(unavailableReason(c)), { code: 'unavailable' });
    return c.run(...args);
  },
  /** Whether a command (object or id) can run now (its `when` guard; a guard that throws counts as no). */
  available: (c) => available(typeof c === 'string' ? registry.get(c) : c),
  /** Why a command cannot run now, as a sentence for the user. */
  unavailableReason: (c) => unavailableReason(typeof c === 'string' ? registry.get(c) : c),
  /** Set the object passed as the first argument to every command's run() (the App). */
  setContext(app) { context = app; },
  get context() { return context; },
};

function available(c) {
  if (!c) return false;
  try { return !c.when || !!c.when(context); } catch { return false; }
}
function unavailableReason(c) {
  let why = null;
  try { why = c?.whyNot?.(context) ?? null; } catch { /* use the generic reasons */ }
  if (why) return why;
  if (context?.busy) return 'Wait for the current task to finish.';
  if (context && !context.structure) return 'Load a structure first.';
  return `“${c?.title ?? c?.id ?? 'This command'}” is not available right now.`;
}
