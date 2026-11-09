/**
 * Members of the public API that modules add (ledger L-F0-53): `defineApi('edit.fix', fn, { owner: 'M3' })` makes
 * `crystallume.edit.fix`. A path is '<namespace>.<name>' with a namespace of API_NAMESPACES, or one top-level name
 * ('exportReport'). Modules call it when they are imported, before the API exists: createAPI() adds what was defined
 * so far (attachApi), and later definitions appear on the live object at once. Members of `crystallume.edit` change
 * the active structure as one undo step per call (through app.editActive or app.replaceActiveStructure); the others
 * return data or new structures. This is wiring between modules, not a plugin interface.
 */

/** The namespaces of `crystallume` that modules add members to. */
export const API_NAMESPACES = Object.freeze(['edit', 'build', 'analysis', 'surface', 'lattice', 'params', 'tools']);

const NAME = /^[A-Za-z_$][\w$]*$/;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/** path → the current definition {path, ns, name, fn, owner, sig, replace, prev, retired}; prev: the definition it replaced. */
const defined = new Map();
/** Each live API object → its own members when it was made ({path → property descriptor}): what a definition may not replace silently. */
const apis = new Map();

const list = (xs) => `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`;

function parsePath(path) {
  if (typeof path !== 'string') throw new TypeError(`defineApi: expected a path such as 'edit.fix' (got ${path === null ? 'null' : typeof path})`);
  const parts = path.split('.');
  if (!path || parts.length > 2 || parts.some((p) => !NAME.test(p) || UNSAFE.has(p))) {
    throw new Error(`defineApi: “${path}” is not a member path (use '<namespace>.<name>', e.g. 'edit.fix', or one top-level name)`);
  }
  if (parts.length === 1) {
    if (API_NAMESPACES.includes(path)) throw new Error(`defineApi: crystallume.${path} is a namespace (define a member, e.g. '${path}.myTool')`);
    return { ns: null, name: path };
  }
  if (!API_NAMESPACES.includes(parts[0])) throw new Error(`defineApi: unknown namespace “${parts[0]}” (use ${list(API_NAMESPACES)})`);
  return { ns: parts[0], name: parts[1] };
}

/** The object that holds the members of namespace `ns` on `api` (`api` itself for top-level names), made when missing. */
function holder(api, ns) {
  if (!ns) return api;
  if (!api[ns] || typeof api[ns] !== 'object') Object.defineProperty(api, ns, { value: {}, writable: true, enumerable: true, configurable: true });
  return api[ns];
}

const put = (api, rec) => Object.defineProperty(holder(api, rec.ns), rec.name, { value: rec.fn, writable: true, enumerable: true, configurable: true });
const hasMember = (api, { ns, name }) => Object.hasOwn(holder(api, ns), name);
/** A definition takes the place of the API object's own member of that path only when it was made with replace: true. */
const applies = (rec, own) => rec.replace || !own.has(rec.path);
const already = (path, owner) => `defineApi: crystallume.${path} is already defined${owner ? ` (by ${owner})` : ''}`;

/**
 * Add `crystallume.<path>` = fn. `owner` names the module (it appears in the error when another module uses the path),
 * `sig` is an optional one-line signature for the reference (crystallume.reference().api and Help › Scripting & API),
 * `replace: true` replaces a member of that path instead of failing. Throws TypeError
 * `defineApi: expected a function for crystallume.edit.fix` and Error `defineApi: crystallume.edit.fix is already
 * defined (by M3)`. Returns a function that removes the member again (putting back the one it replaced, if any).
 */
export function defineApi(path, fn, { owner = null, replace = false, sig = null } = {}) {
  const where = parsePath(path);
  if (typeof fn !== 'function') throw new TypeError(`defineApi: expected a function for crystallume.${path}`);
  if (sig != null && (typeof sig !== 'string' || /[\r\n]/.test(sig))) throw new TypeError(`defineApi: the sig of crystallume.${path} must be one line of text`);
  const prev = defined.get(path) ?? null;
  if (!replace) {
    if (prev) throw new Error(already(path, prev.owner));
    if ([...apis.keys()].some((api) => hasMember(api, where))) throw new Error(already(path, 'the app'));
  }
  const rec = { path, ...where, fn, owner: owner == null ? null : String(owner), sig: sig?.trim() || null, replace: !!replace, prev, retired: false };
  defined.set(path, rec);
  for (const api of apis.keys()) put(api, rec);
  return () => remove(rec);
}

function remove(rec) {
  if (rec.retired) return;
  rec.retired = true;
  if (defined.get(rec.path) !== rec) return;   // replaced since: the newer definition stays
  let back = rec.prev;
  while (back?.retired) back = back.prev;
  if (back) defined.set(rec.path, back); else defined.delete(rec.path);
  for (const [api, own] of apis) {
    if (back && applies(back, own)) put(api, back);
    else if (own.has(rec.path)) Object.defineProperty(holder(api, rec.ns), rec.name, own.get(rec.path));   // the app's own member it replaced
    else delete holder(api, rec.ns)[rec.name];
  }
}

/**
 * Make `api` (createAPI's object) live: every namespace of API_NAMESPACES exists on it, the members defined so far are
 * added and later ones follow. A definition made before `api` existed that collides with one of its own members (and
 * was not made with replace: true) is left out, with a console error. Returns `api`.
 */
export function attachApi(api) {
  if (apis.has(api)) return api;
  const own = new Map();
  for (const name of Object.keys(api)) if (!API_NAMESPACES.includes(name)) own.set(name, Object.getOwnPropertyDescriptor(api, name));
  for (const ns of API_NAMESPACES) {
    const o = holder(api, ns);
    for (const name of Object.keys(o)) own.set(`${ns}.${name}`, Object.getOwnPropertyDescriptor(o, name));
  }
  apis.set(api, own);
  for (const rec of defined.values()) {
    if (applies(rec, own)) put(api, rec);
    else console.error(already(rec.path, 'the app'));
  }
  return api;
}

/** The members defined with defineApi, sorted by path: [{path, owner, sig}]. */
export function apiMembers() {
  return [...defined.values()].map(({ path, owner, sig }) => ({ path, owner, sig })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
