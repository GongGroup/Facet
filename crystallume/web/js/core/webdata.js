/**
 * Data files shared by the web app and the Python package: `crystallume/web/data/*.json`.
 *
 * Each table has one copy, in `crystallume/web/data`. The browser fetches it next to the app
 * (`new URL('../../data/<name>', import.meta.url)`, so it works from `crystallume serve`, a static host and the
 * static bundle alike); Node tests read the same file with `fs` (a `file:` URL). The modules that own a table wrap
 * loadWebData with their own loader and checks (build/surface.js: loadOxidationStates for `oxidation_states.json`;
 * the adsorbate library). A module whose data must be in place before the app reports ready registers its loader
 * as a start-up task (core/boot.js registerBootTask); after that the synchronous webData(name) returns it.
 *
 * The Python twin is `crystallume/core/webdata.py` (`load_web_data`, read through importlib.resources); names must be
 * lower-case letters, digits and underscores ending in `.json`, with the same error text in both languages.
 */
const BASE = new URL('../../data/', import.meta.url);
/** A data file name: lower-case letters, digits and underscores, then `.json` (no directories). */
const NAME = /^[a-z0-9_]+\.json$/;
const pending = new Map(), loaded = new Map();

/** The error for a name that is not a data file name (the text of Python's load_web_data). */
const badName = (name) => new Error(`invalid data file name ${typeof name === 'string' ? `'${name}'` : String(name)}`);

/**
 * Load `crystallume/web/data/<name>` once: a Promise of the parsed JSON (the same promise for every call while it
 * loads or after it loaded). It rejects for an invalid name and when the file cannot be read or parsed
 * (`could not load <name>: <reason>`); a later call then tries again. Callers must not modify the value.
 */
export function loadWebData(name) {
  if (typeof name !== 'string' || !NAME.test(name)) return Promise.reject(badName(name));
  if (!pending.has(name)) pending.set(name, (async () => {
    const u = new URL(name, BASE);
    const text = u.protocol === 'file:'
      ? await (await import('node:fs/promises')).readFile(u, 'utf8')            // Node tests
      : await (async () => { const r = await fetch(u, { cache: 'no-cache' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })();
    const value = JSON.parse(text);
    loaded.set(name, value);
    return value;
  })().catch((e) => { pending.delete(name); throw new Error(`could not load ${name}: ${e.message}`); }));
  return pending.get(name);
}

/** The loaded value of `name` (synchronous), or null while it is not loaded. Callers must not modify it. */
export const webData = (name) => loaded.get(name) ?? null;

/** Put `value` in place of `name` (tests, plugins): webData returns it and loadWebData resolves with it. */
export function setWebData(name, value) {
  if (typeof name !== 'string' || !NAME.test(name)) throw badName(name);
  loaded.set(name, value);
  pending.set(name, Promise.resolve(value));
}
