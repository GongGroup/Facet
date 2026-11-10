/**
 * Command registry used by the command palette, keyboard shortcuts, embedding pages and plugins.
 *   commands.register({ id, title, category, key?, kbd?, keywords?, hidden?, palette?, repeat?, shortcutGroup?,
 *                       run(app, ...args), when?(app), whyNot?(app),
 *                       params?, aliases?, ms?, estimate?(app, values), edits? })
 * `run` always receives the app first: commands.run(id, ...args) calls run(app, ...args), and so does
 * calling `commands.get(id).run()` (the palette and shortcuts do). The app is set once with
 * commands.setContext(app). `key` is a shortcut spec ('r', 'Escape', 'mod+o') or an array of them.
 * `when(app)` says whether the command can run now: the palette hides it, shortcuts skip it, and
 * commands.run() throws an Error saying why (whyNot(app) → string, if given, explains other reasons).
 *
 * Commands of the surface tools also give (F0-A §3.16):
 * - params: a parameter schema (core/params.js). Called with a parameter object (commands.run(id, params),
 *   commands.get(id).run(params), crystallume.command, an embedding page, a plugin) the command checks it first:
 *   not a plain object → `<Title>: pass the parameters as an object.`; values that do not fit the schema, unknown
 *   keys included → `<Title>: <Label>: …` (the first problem; all of them in `errors`); both as a CommandError with
 *   code 'invalid-params', and run() is not called. run(app, values, ctx) then gets the normalized values and
 *   ctx = {interactive, atoms, warnings}. Called without parameters it runs run(app) as before (interactively:
 *   typically it opens its panel section). <Title> is the title without a trailing ellipsis. Commands without
 *   `params` get their arguments unchanged.
 * - estimate(app, values) → the number of atoms the command would make (null: unknown). Above atomLimit()
 *   (LIMITS.maxAtoms, or the `maxAtoms` preference up to MAX_ATOMS_LIMIT) the command refuses with code 'too-large':
 *   `<Title>: this would make 250,000 atoms; the limit is 200,000.`. Above LIMITS.confirmAtoms an interactive call
 *   (second argument {interactive: true}, as a panel passes it) asks first (commands.setConfirm) and returns a
 *   Promise, which resolves to undefined when the user declines; scripts are not asked.
 * - aliases: more names to find the command by in the palette, the Materials Studio names ('Cleave Surface');
 *   ms: the Materials Studio menu path ('Build › Surfaces › Cleave Surface'), shown only.
 * - edits: true for a command that changes the structure: it also needs canEdit(app) (a structure, no task
 *   running, no preview open); during a preview whyNot says 'Apply or cancel the preview first.'.
 * Keys a command must not take (M7 KC-06) are left out with a console warning: Ctrl/⌘ C, V and X (the clipboard:
 * the copy, cut and paste events do that), E and Q (held down to change a drag), Shift with X, Y, Z, R, Q or E
 * (those run only on release) and Alt with a letter (macOS types another character). `kbd` may still show them.
 */
import { validateParams } from './params.js';

const registry = new Map();
const RAW = Symbol('raw');
let context = null;
let confirmHook = null;

/** Atom limits of the web app: commands refuse more than maxAtoms (see atomLimit) and ask before more than confirmAtoms. */
export const LIMITS = Object.freeze({ maxAtoms: 200_000, confirmAtoms: 30_000 });
/** The highest atom limit the `maxAtoms` preference can set. */
export const MAX_ATOMS_LIMIT = 2_000_000;

const keysOf = (k) => (k == null || k === '' ? [] : (Array.isArray(k) ? k : [k]).map((x) => String(x).toLowerCase()));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** The function a guard or run was made from (register wraps run, and when/whyNot of `edits` commands). */
const unwrap = (f) => (typeof f === 'function' && has(f, RAW) ? f[RAW] : f);
const mark = (f, raw) => { f[RAW] = raw; return f; };
/** A count as the messages write it: 250,000. */
const count = (n) => Math.round(n).toLocaleString('en-US');

/** A command that cannot run: `code` is 'invalid-params', 'too-large' or 'unavailable'; the message is for the user. */
export class CommandError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/** A command's title in messages: without a trailing ellipsis ('Cleave surface…' → 'Cleave surface'). Takes a command or a title. */
export function commandTitle(c) {
  const t = typeof c === 'string' ? c : c?.title ?? c?.id;
  return String(t ?? 'This command').replace(/(?:…|\.\.\.)\s*$/, '').trim() || 'This command';
}

/** The atom limit of the web app: the `maxAtoms` preference (1 to MAX_ATOMS_LIMIT), else LIMITS.maxAtoms. */
export function atomLimit(app = context) {
  const p = Number(app?.prefs?.maxAtoms);
  return Number.isFinite(p) && p >= 1 ? Math.min(Math.floor(p), MAX_ATOMS_LIMIT) : LIMITS.maxAtoms;
}

/** Throw CommandError 'too-large' when `n` atoms are more than atomLimit(app); `title` is the command's (or the command). */
export function checkAtoms(n, { title = 'This command', app = context } = {}) {
  const max = atomLimit(app);
  if (typeof n === 'number' && n > max) {
    throw new CommandError('too-large', `${commandTitle(title)}: this would make ${count(n)} atoms; the limit is ${count(max)}.`, { atoms: n, limit: max });
  }
}

/**
 * Whether to go on with a structure of `n` atoms (a Promise of a boolean): true up to LIMITS.confirmAtoms, else what
 * the user answers in the confirmation of commands.setConfirm (true when none is set). Panels that build through a
 * preview session call checkAtoms and then this before they commit.
 */
export async function confirmAtoms(n, { title = 'This command' } = {}) {
  if (!(typeof n === 'number' && n > LIMITS.confirmAtoms) || !confirmHook) return true;
  const t = commandTitle(title);
  return !!(await confirmHook({
    title: 'Make a large structure?',
    message: `${t} would make ${count(n)} atoms. The view may turn slow, and undo keeps fewer steps for a structure this large.`,
    confirm: 'Continue', atoms: n, command: t,
  }));
}

/** The open preview session of the app (app.session), or null. */
export function previewSession(app = context) {
  const s = app?.session;
  return s && s.active !== false ? s : null;
}
/** Whether the structure can be edited now: there is one, no task is running and no preview is open. */
export function canEdit(app = context) {
  return !!app?.structure && !app.busy && !previewSession(app);
}
/** The reason an editing command cannot run beyond the generic ones (no structure, busy): an open preview. */
export function editWhyNot(app = context) {
  return previewSession(app) ? 'Apply or cancel the preview first.' : null;
}

// ------------------------------------------------------------------ keys commands must not take (M7 KC-06)
const CLIPBOARD = new Set(['c', 'v', 'x']);
const HELD = new Set(['x', 'y', 'z', 'r', 'q', 'e']);
/** {mods, key} of a spec, read as ui/keys.js parseKey reads it ('+' and 'shift++' keep '+' as the key). */
function splitKey(spec) {
  if (spec === '+' || spec.length === 1) return { mods: new Set(), key: spec };
  const parts = spec.split('+');
  let key = parts.pop();
  if (key === '' && parts.length) { parts.pop(); key = '+'; }
  return { mods: new Set(parts), key };
}
/** Why shortcut `spec` must not be a command's key, or null. */
export function keyProblem(spec) {
  const { mods, key } = splitKey(String(spec ?? '').toLowerCase());
  const mod = ['mod', 'ctrl', 'cmd', 'meta'].some((m) => mods.has(m)), alt = mods.has('alt'), shift = mods.has('shift');
  if (mod && !alt && CLIPBOARD.has(key)) return 'Ctrl/⌘ C, V and X belong to copy, paste and cut';
  if (alt && /^[a-z]$/.test(key)) return 'Alt with a letter types another character on macOS';
  if (!mod && !alt && !shift && (key === 'e' || key === 'q')) return 'E and Q are held down to change what a drag does';
  if (!mod && !alt && shift && HELD.has(key)) return 'X, Y, Z, R, Q and E are held down to change a drag, so Shift with them runs only on release';
  return null;
}

/** The aliases of a command definition as a list of names. */
function aliasList(id, a) {
  if (a == null) return [];
  const list = typeof a === 'string' ? [a] : a;
  if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) throw new TypeError(`commands.register: aliases of “${id}” must be a name or a list of names`);
  return list.map((x) => x.trim()).filter(Boolean);
}

/** A plain object (any realm, or without a prototype): the only thing a command's parameters can be. */
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

/** Run command `entry` with parameters: check them, the atom count and (interactive calls) ask, then run(app, values, ctx). */
function invoke(entry, raw, params, opts) {
  const title = commandTitle(entry);
  if (!isPlainObject(params)) throw new CommandError('invalid-params', `${title}: pass the parameters as an object.`);
  const { values, errors, warnings } = validateParams(entry.params, params, { strict: true, title });
  if (errors.length) {
    const all = errors.map((m) => (m.startsWith(`${title}: `) ? m : `${title}: ${m}`));
    throw new CommandError('invalid-params', all[0], { errors: all });
  }
  let atoms = null;
  if (typeof entry.estimate === 'function') {
    const n = entry.estimate(context, values);
    if (typeof n === 'number' && Number.isFinite(n)) atoms = n;
  }
  if (atoms !== null) checkAtoms(atoms, { title, app: context });
  const ctx = { interactive: opts?.interactive === true, atoms, warnings };
  if (ctx.interactive && atoms !== null && atoms > LIMITS.confirmAtoms) {
    return confirmAtoms(atoms, { title }).then((ok) => (ok ? raw.call(entry, context, values, ctx) : undefined));
  }
  return raw.call(entry, context, values, ctx);
}

export const commands = {
  /** Register (or replace) a command; returns a function that removes it again. */
  register(c) {
    if (!c?.id) throw new Error('commands.register: missing id');
    if (typeof c.run !== 'function') throw new Error(`commands.register: missing run() for “${c.id}”`);
    if (c.params != null && !Array.isArray(c.params)) throw new TypeError(`commands.register: params of “${c.id}” must be a list (a parameter schema)`);
    if (c.estimate != null && typeof c.estimate !== 'function') throw new TypeError(`commands.register: estimate of “${c.id}” must be a function (app, params) → atoms`);
    const aliases = aliasList(c.id, c.aliases);
    let key = c.key;
    const specs = key == null || key === '' ? [] : [].concat(key);
    const refused = specs.filter((k) => keyProblem(k));
    for (const k of refused) console.warn(`commands.register: “${c.id}” cannot use the key “${k}”: ${keyProblem(k)}; the key is left out`);
    if (refused.length) { const kept = specs.filter((k) => !refused.includes(k)); key = kept.length ? (Array.isArray(c.key) ? kept : kept[0]) : undefined; }
    const mine = keysOf(key);
    if (mine.length) {
      for (const o of registry.values()) {
        if (o.id === c.id) continue;
        const clash = keysOf(o.key).find((k) => mine.includes(k));
        if (clash) console.warn(`commands.register: key “${clash}” of “${c.id}” is already used by “${o.id}”`);
      }
    }
    const raw = unwrap(c.run);
    const entry = { ...c, key, aliases };
    const when = unwrap(c.when), whyNot = unwrap(c.whyNot);
    if (c.edits) {
      // an editing command also needs canEdit; its own whyNot speaks only when its own guard is what fails
      entry.when = mark((app) => canEdit(app) && (!when || !!when(app)), when);
      entry.whyNot = mark((app) => editWhyNot(app) ?? (canEdit(app) && whyNot ? whyNot(app) : null), whyNot);
    } else {
      entry.when = when;
      entry.whyNot = whyNot;
    }
    entry.run = function run(...args) {
      if (!Array.isArray(entry.params)) return raw.call(entry, context, ...args);
      if (args[0] === undefined) return raw.call(entry, context);
      return invoke(entry, raw, args[0], args[1]);
    };
    entry.run[RAW] = raw;
    registry.set(c.id, entry);
    return () => { if (registry.get(c.id) === entry) registry.delete(c.id); };
  },
  /**
   * Register `c` only when no command has its id yet: a module that implements the command registers it (before or
   * after) and wins. Returns the remover, or null when the id was taken.
   */
  registerFallback(c) {
    if (!c?.id) throw new Error('commands.registerFallback: missing id');
    return registry.has(c.id) ? null : commands.register(c);
  },
  /** Remove a command by id. */
  unregister: (id) => registry.delete(id),
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
  /** Run a command: run(app, ...args). Throws for an unknown id, or when its `when` guard says it cannot run now. */
  run(id, ...args) {
    const c = registry.get(id);
    if (!c) throw new Error(`Unknown command ${id}`);
    if (!available(c)) throw new CommandError('unavailable', unavailableReason(c));
    return c.run(...args);
  },
  /** Whether a command (object or id) can run now (its `when` guard; a guard that throws counts as no). */
  available: (c) => available(typeof c === 'string' ? registry.get(c) : c),
  /** Why a command cannot run now, as a sentence for the user. */
  unavailableReason: (c) => unavailableReason(typeof c === 'string' ? registry.get(c) : c),
  /** Set the object passed as the first argument to every command's run() (the App). */
  setContext(app) { context = app; },
  get context() { return context; },
  /**
   * Set how an interactive command asks before it makes a large structure: fn({title, message, confirm, atoms,
   * command}) → Promise<boolean> (main.js: the confirmation dialog); null asks nobody (the answer is yes).
   */
  setConfirm(fn) { confirmHook = typeof fn === 'function' ? fn : null; },
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

// ------------------------------------------------------------------ F0-A's commands and the surface modules' (F0-A §5.8)
/** Cancel preview: ends the open preview session without applying it (Esc does the same through sel.clear). */
export const CANCEL_PREVIEW = Object.freeze({
  id: 'edit.cancelPreview', title: 'Cancel preview', category: 'Edit', keywords: 'discard preview',
  when: (app) => !!previewSession(app),
  whyNot: () => 'There is no preview to cancel.',
  run: (app) => previewSession(app)?.cancel('cancel'),
});

/** The vacuum of the cleave and slab commands: required, no default (U4); the total gap to the periodic image. */
const VACUUM = Object.freeze({ name: 'vacuum', type: 'float', label: 'Vacuum', unit: 'Å', min: 0, max: 1000, required: true,
  description: 'Total gap between the slab and its periodic image (Å); 0 for none.' });
const MILLER = Object.freeze({ name: 'miller', type: 'miller', label: 'Plane' });
const LAYERS = Object.freeze({ name: 'layers', type: 'int', label: 'Layers', min: 1, max: 1000 });

const row = (id, title, category, { aliases = [], ms = null, open, need = [], edits = false, params = null }) => Object.freeze({
  id, title, category, aliases: Object.freeze(aliases), ms, open: Object.freeze(open), need: Object.freeze(need), edits,
  params: params && Object.freeze(params),
});

/**
 * The commands of the surface modules (M1–M6) that the app knows from the start (F0-A §5.8, ledger L-F0-52; the ids
 * are fixed): title, category, Materials Studio names, the panel section each opens (`open: [panel, section]`; a
 * section of null opens the panel), what it needs (`need`: 'structure', 'selection', 'cell', 'gap' (a vacuum gap or
 * one non-periodic axis), 'projectCell' (a structure with a cell in the project)), `edits` and, where the contract
 * fixes them, the parameters. main.js registers a fallback for each (sectionFallbacks); the module that implements
 * a command registers it under the same id and replaces the fallback.
 */
export const SECTION_COMMANDS = Object.freeze([
  row('surface.cleave', 'Cleave surface…', 'Surface', { aliases: ['Cleave Surface'], ms: 'Build › Surfaces › Cleave Surface', open: ['surface', 'cleave'], need: ['cell'], edits: true, params: [MILLER, LAYERS, VACUUM] }),
  row('surface.vacuum', 'Build vacuum slab…', 'Surface', { aliases: ['Build Vacuum Slab'], ms: 'Build › Crystals › Build Vacuum Slab', open: ['surface', 'slab'], need: ['cell'], edits: true, params: [VACUUM] }),
  row('surface.setVacuum', 'Set vacuum…', 'Surface', { aliases: ['Vacuum'], open: ['surface', 'slab'], need: ['cell', 'gap'], edits: true, params: [VACUUM] }),
  row('surface.flip', 'Flip slab', 'Surface', { open: ['surface', 'slab'], need: ['gap'], edits: true }),
  row('surface.center', 'Centre slab', 'Surface', { open: ['surface', 'slab'], need: ['gap'], edits: true }),
  row('cell.supercell', 'Supercell…', 'Cell', { aliases: ['Supercell', 'Create Supercell'], open: ['structure', 'cell'], need: ['cell'], edits: true }),
  row('cell.redefine', 'Redefine lattice…', 'Cell', { aliases: ['Redefine Lattice'], open: ['structure', 'cell'], need: ['cell'], edits: true }),
  row('cell.parameters', 'Lattice parameters…', 'Cell', { aliases: ['Lattice Parameters'], open: ['structure', 'cell'], need: ['cell'], edits: true }),
  row('cell.reorient', 'Re-orient to standard', 'Cell', { aliases: ['Re-orient to standard'], open: ['structure', 'cell'], need: ['cell'], edits: true }),
  row('constraints.edit', 'Modify constraints…', 'Edit', { aliases: ['Modify Constraints', 'Edit Constraints'], ms: 'Modify › Constraints', open: ['structure', 'constraints'], need: ['structure'], edits: true }),
  row('sel.fix', 'Fix selected atoms', 'Edit', { aliases: ['Fix fractional position'], open: ['structure', 'constraints'], need: ['selection'], edits: true }),
  row('sel.free', 'Free selected atoms', 'Edit', { open: ['structure', 'constraints'], need: ['selection'], edits: true }),
  row('sel.query', 'Atom selection…', 'Edit', { aliases: ['Atom Selection'], ms: 'Edit › Atom Selection', open: ['structure', null], need: ['structure'] }),
  row('tool.move', 'Move tool', 'Tools', { aliases: ['Translate', 'Rotate'], open: ['structure', 'transform'], need: ['structure'] }),
  row('adsorbate.add', 'Add adsorbate…', 'Surface', { aliases: ['Add Adsorbate'], open: ['surface', 'adsorbates'], need: ['cell'], edits: true }),
  row('sites.find', 'Find adsorption sites', 'Surface', { aliases: ['Find Adsorption Sites'], open: ['surface', 'adsorbates'], need: ['cell', 'gap'] }),
  row('tool.sitePick', 'Pick adsorption site', 'Tools', { open: ['surface', 'adsorbates'], need: ['cell', 'gap'] }),
  row('build.layers', 'Build layers…', 'Surface', { aliases: ['Build Layers'], ms: 'Build › Build Layers', open: ['surface', 'interface'], need: ['projectCell'] }),
]);

/** Guards a row can name: each returns true, a reason (a sentence) or false (the generic reasons). */
const GUARDS = {
  structure: (app) => !!app?.structure,
  selection: (app) => (!app?.structure ? false : app.selection?.length > 0 || 'Select atoms first.'),
  projectCell: (app) => (app?.project?.structures ?? []).some((e) => e?.structure?.cell) || 'Load a structure with a unit cell first.',
  cell: (app) => !!app?.structure?.cell,
  gap: () => true,
};

/**
 * The fallback commands of SECTION_COMMANDS, for commands.registerFallback (main.js). Run without parameters a
 * fallback opens its section with open(panel, section), which returns whether that section exists; when it does
 * not, notify(message) says the command is not in this build yet. Run with parameters (checked first, where the row
 * has a schema) it throws CommandError 'unavailable'. `guards` = {cell, gap} replaces the simple built-in checks
 * (ui/sections.js requireCell and requireVacuumGap, which give the reasons).
 */
export function sectionFallbacks({ open, notify = () => {}, guards = {} } = {}) {
  if (typeof open !== 'function') throw new TypeError('sectionFallbacks: open(panel, section) must be a function');
  return SECTION_COMMANDS.map((r) => {
    const checks = r.need.map((k) => (typeof guards[k] === 'function' ? guards[k] : GUARDS[k]));
    const verdict = (app) => {
      for (const g of checks) { const v = g(app); if (v !== true) return v; }
      return true;
    };
    const title = commandTitle(r);
    return {
      id: r.id, title: r.title, category: r.category, aliases: [...r.aliases], ms: r.ms, edits: r.edits, fallback: true,
      ...(r.params ? { params: r.params } : {}),
      when: (app) => verdict(app) === true,
      whyNot: (app) => { const v = verdict(app); return typeof v === 'string' && v ? v : null; },
      run(app, params) {
        if (params !== undefined) throw new CommandError('unavailable', `${title}: not available in this build yet.`);
        const [panel, section] = r.open;
        if (!open(panel, section)) notify(`${title} is not available in this build yet.`);
      },
    };
  });
}
