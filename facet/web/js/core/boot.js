/**
 * Start-up data tasks. A module that needs data before the app reports that it is ready (oxidation
 * states, the adsorbate library…) registers a task when it is imported:
 *   registerBootTask('oxidation states', () => loadOxidationStates());
 * main.js starts every registered task when it boots and waits for them before the first structure opens,
 * the API is installed and the page reports ready. Each task gets BOOT_TIMEOUT ms. A task that fails or
 * times out does not stop the start-up: it is logged, main.js shows one notice (bootFailureMessage), and
 * the sections that need its data say so (requireBootTask in ui/sections.js). A task registered after the
 * start (a plugin) runs at once. Node tests do not run main.js: call a module's own loader directly.
 */
export const BOOT_TIMEOUT = 10000;

/** name → { name, fn, state: 'waiting' | 'running' | 'ok' | 'failed', error, promise } */
const tasks = new Map();
let startedWith = null;   // the options of the first bootTasks() call; later registrations run at once with them

/**
 * Register a start-up task. `name` is a short phrase the user may see ("Some data failed to load: <name>."),
 * `fn` returns a Promise (or a value) once the data is in place.
 */
export function registerBootTask(name, fn) {
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('registerBootTask: expected a name');
  if (typeof fn !== 'function') throw new TypeError(`registerBootTask: “${name}” needs a function that loads its data`);
  if (tasks.has(name)) throw new Error(`registerBootTask: “${name}” is already registered`);
  const t = { name, fn, state: 'waiting', error: null, promise: null };
  tasks.set(name, t);
  if (startedWith) run(t, startedWith.timeout);
}

/** Run one task once; resolves (never rejects) with {name, ok, error} when it settles or times out. */
function run(t, timeout) {
  if (t.promise) return t.promise;
  t.state = 'running';
  let timer = 0;
  const limit = new Promise((resolve) => {
    if (Number.isFinite(timeout) && timeout > 0) timer = setTimeout(() => resolve({ timedOut: true }), timeout);
  });
  const work = Promise.resolve().then(() => t.fn()).then(() => ({ ok: true }), (error) => ({ error }));
  t.promise = Promise.race([work, limit]).then((r) => {
    clearTimeout(timer);
    if (r.ok) { t.state = 'ok'; t.error = null; }
    else if (r.timedOut) {
      t.state = 'failed';
      t.error = `timed out after ${timeout >= 1000 ? `${+(timeout / 1000).toFixed(1)} s` : `${timeout} ms`}`;
      console.error(`Start-up data “${t.name}” failed to load: ${t.error}`);
      // a task that finishes after its time ran out still brings its data
      work.then((late) => { if (late.ok) { t.state = 'ok'; t.error = null; } });
    } else {
      t.state = 'failed';
      t.error = r.error?.message ?? String(r.error);
      console.error(`Start-up data “${t.name}” failed to load`, r.error);
    }
    return { name: t.name, ok: t.state === 'ok', error: t.error };
  });
  return t.promise;
}

/**
 * Start every registered task (each runs once) and wait for all of them: resolves with
 * [{name, ok, error}] in registration order. Calling it again waits for the same runs.
 */
export function bootTasks({ timeout = BOOT_TIMEOUT } = {}) {
  startedWith ??= { timeout };
  return Promise.all([...tasks.values()].map((t) => run(t, startedWith.timeout)));
}

/** State of a task: {name, state: 'waiting' | 'running' | 'ok' | 'failed', error}, or null for an unknown name. */
export function bootTaskStatus(name) {
  const t = tasks.get(name);
  return t ? { name: t.name, state: t.state, error: t.error } : null;
}

/** The notice for failed tasks in a bootTasks() result ('Some data failed to load: a, b.'), or null when all loaded. */
export function bootFailureMessage(results) {
  const bad = (results ?? []).filter((r) => r && !r.ok).map((r) => r.name);
  return bad.length ? `Some data failed to load: ${bad.join(', ')}.` : null;
}
