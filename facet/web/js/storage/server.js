/**
 * Facet server (Python backend) — REST client.
 *  mode "local": projects are folders on the server's disk (file-based project management)
 *  mode "cloud": multi-user projects in the server database, bearer-token auth
 * Errors carry a `code`: 'auth' (sign in again), 'offline' (server unreachable), 'conflict' (changed
 * elsewhere since loaded — save(doc, {force: true}) overwrites), 'notfound'. Set `onAuth(user|null)` to
 * hear about sign-in changes. The API base defaults to the folder the app is served from, so the app
 * also works behind a reverse proxy under a sub-path (e.g. /facet/).
 */
import { storable } from './index.js';

const TOKEN_KEY = 'atomscope.token';   // former name, kept so sign-ins survive the rename
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } };

/** URL path of the web app's root folder, without the trailing slash ('' at the origin root). */
function appBase() {
  try {
    const u = new URL('../../', import.meta.url); // this file lives in <root>/js/storage/
    if (/^https?:$/.test(u.protocol) && u.origin === location.origin) return u.pathname.replace(/\/$/, '');
  } catch { /* bundled or blob URL */ }
  try { return new URL('.', location.href).pathname.replace(/\/$/, ''); } catch { return ''; }
}

const sentence = (s) => { const t = String(s ?? '').trim(); if (!t) return 'Something went wrong.'; const c = t[0].toUpperCase() + t.slice(1); return /[.!?]$/.test(c) ? c : `${c}.`; };

/** Server messages from /auth/* turned into plain, friendly copy. */
const AUTH_COPY = [
  [/invalid username or password/i, 'Wrong username or password.'],
  [/too many failed login/i, 'Too many failed attempts. Wait a few minutes and try again.'],
  [/too many new accounts/i, 'Too many new accounts from this network. Try again later.'],
  [/already taken/i, 'That username is taken. Choose another one.'],
  [/password must be at least (\d+)/i, (m) => `Use at least ${m[1]} characters for the password.`],
  [/username must be/i, 'Usernames are 2–64 characters: letters, digits and _ . @ -'],
  [/registration is disabled/i, 'This server does not allow new accounts. Ask its administrator for one.'],
  [/authentication is disabled/i, 'This server has no accounts, so there is nothing to sign in to.'],
  [/username:.*at least 1/i, 'Enter your username.'],
  [/password:.*at least 1/i, 'Enter your password.'],
];
export function friendlyAuthMessage(detail) {
  for (const [re, copy] of AUTH_COPY) { const m = re.exec(detail ?? ''); if (m) return typeof copy === 'function' ? copy(m) : copy; }
  return sentence(detail);
}

const err = (message, code, extra = {}) => Object.assign(new Error(message), code ? { code } : {}, extra);

export class ServerStore {
  id = 'server';
  icon = 'server';
  /** Called with the signed-in user, or null after sign-out / an expired session. */
  onAuth = null;

  constructor(base = '') {
    this.base = base ? base.replace(/\/$/, '') : appBase();
    this.info = null;
    this.user = null;
    this.token = lsGet(TOKEN_KEY);
    this._authRequired = false; // from /auth/me or a 401 when /info does not say so (local mode with a token)
    this._versions = new Map(); // project id -> `updated` of the copy last loaded or saved here
  }
  get cloud() { return this.info?.mode === 'cloud'; }
  get label() { return this.cloud ? 'Cloud server' : 'Server folder'; }
  get where() { return this.cloud ? 'in your cloud account' : 'in the server folder'; }
  get description() {
    return this.cloud
      ? 'Stored on the Facet server under your account. Available from any device.'
      : 'Saved as project folders in the server\'s data directory (one folder per project).';
  }
  get authRequired() { return !!this.info?.authRequired || this._authRequired; }
  get needsAuth() { return this.authRequired && !this.user; }
  /** Absolute URL path for a server path such as '/plugins/x/y.js' (adds the sub-path prefix). */
  url(path) { return /^\//.test(path) && !path.startsWith('//') ? `${this.base}${path}` : path; }

  _signedOut() {
    const had = !!(this.user || this.token);
    this.user = null; this.token = null; lsSet(TOKEN_KEY, null);
    if (had) this.onAuth?.(null);
  }

  async api(path, { method = 'GET', body, form, raw = false, headers: extra } = {}) {
    const headers = { ...extra };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let res;
    try { res = await fetch(`${this.base}/api/v1${path}`, { method, headers, body: payload }); }
    catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw err('Can\'t reach the server. Your changes are kept in this browser and will be saved when it\'s back.', 'offline', { cause: e });
    }
    if (res.ok) return raw ? res : res.status === 204 ? null : res.json();
    let j = null;
    try { j = await res.json(); } catch { /* not json */ }
    const detail = typeof j?.detail === 'string' ? j.detail : j ? JSON.stringify(j.detail ?? j) : `${res.status} ${res.statusText}`;
    const status = res.status;
    if (path.startsWith('/auth/')) {
      if (status === 401 && path === '/auth/me') { this._authRequired = true; if (this.token) this._signedOut(); }
      throw err(friendlyAuthMessage(detail), status === 401 ? 'auth' : status === 429 ? 'ratelimit' : undefined, { status });
    }
    if (status === 401) {
      const hadSession = !!this.token;
      this._authRequired = true;
      this._signedOut();
      throw err(hadSession ? 'Your session expired — sign in again.' : 'Sign in to the Facet server to continue.', 'auth', { status });
    }
    if (status === 409) throw err('This project was changed somewhere else since you opened it.', 'conflict', { status, updated: j?.updated ?? null });
    if (status === 404) throw err(sentence(detail), 'notfound', { status });
    if (status === 413) throw err(sentence(detail.replace(/^request body/i, 'this project')), 'toolarge', { status });
    throw err(sentence(detail), undefined, { status });
  }

  /** Detect a running Facet server next to the page. */
  async probe(timeout = 1500) {
    if (typeof window.claude?.use === 'function') return false;
    if (location.protocol === 'file:') return false;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(`${this.base}/api/v1/info`, { signal: ctl.signal });
      if (!res.ok) return false;
      const info = await res.json();
      if (info?.name !== 'Facet') return false;
      this.info = info;
      await this.refreshUser();
      return true;
    } catch { return false; } finally { clearTimeout(t); }
  }

  async init() { return this.info != null; }
  async available() { return this.info != null; }

  async refreshUser() {
    try {
      const me = await this.api('/auth/me');
      this.user = me.user ?? me;
      // newer servers say whether sign-in is required (local mode with FACET_TOKEN), so the
      // "Sign out" row survives a reload with a stored token; older ones only tell us with a 401
      if (typeof me.authRequired === 'boolean') this._authRequired = me.authRequired;
    } catch { this.user = null; }
    this.onAuth?.(this.user);
    return this.user;
  }
  async login(username, password) { const r = await this.api('/auth/login', { method: 'POST', body: { username, password } }); this._setAuth(r); return r.user; }
  async register(username, password) { const r = await this.api('/auth/register', { method: 'POST', body: { username, password } }); this._setAuth(r); return r.user; }
  async logout() {
    try { await this.api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    this.token = null; this.user = null; lsSet(TOKEN_KEY, null);
    this._versions.clear();
    this.onAuth?.(null);
  }
  _setAuth(r) { this.token = r.token; this.user = r.user; lsSet(TOKEN_KEY, r.token); this.onAuth?.(r.user); }

  _track(doc) { if (doc?.id && doc.updated) this._versions.set(doc.id, doc.updated); return doc; }
  /**
   * If-Match header for a write (none when forced or unknown). `base` — the version the edited copy was
   * loaded from — wins: a later read of the same project (Duplicate, Download, a recovery check) must not
   * move it forward, or changes saved elsewhere in between would be overwritten without a conflict.
   * Without a base, the version this tab last loaded or saved is used.
   */
  _ifMatch(id, base, force) {
    if (force) return {};
    const v = base ?? this._versions.get(id);
    return v ? { 'If-Match': `"${v}"` } : {};
  }

  async list(q) { return this.api(`/projects${q ? `?q=${encodeURIComponent(q)}` : ''}`); }
  async get(id) { return this._track(await this.api(`/projects/${encodeURIComponent(id)}`)); }

  /**
   * Create or replace a project. Replacing sends If-Match with the version this tab loaded, so a
   * project changed elsewhere rejects with code 'conflict' instead of being overwritten (opts.force skips it).
   */
  async save(input, opts = {}) {
    const loc = input.location;
    const body = storable(input);
    const pid = loc?.provider === this.id ? loc.id : null;
    if (pid) {
      try {
        return this._track(await this.api(`/projects/${encodeURIComponent(pid)}`, {
          method: 'PUT', body: { ...body, id: pid }, headers: this._ifMatch(pid, input.baseUpdated ?? opts.baseUpdated, opts.force),
        }));
      } catch (e) {
        if (e.code !== 'notfound') throw e;
        // gone on the server: re-create it, but never inside another person's account
        if (loc.user && this.user?.id && loc.user !== this.user.id) {
          throw err('This project belongs to a different account. Sign in as its owner, or save a copy to your own space.', 'notfound');
        }
      }
    }
    // new on the server: it keeps a well-formed id that is still free (so Undo after delete restores the same
    // project and links) and assigns a fresh one otherwise
    return this._track(await this.api('/projects', { method: 'POST', body }));
  }

  /** Change some top-level fields (e.g. {name}) without sending the whole project. opts: {baseUpdated, force}. */
  async patch(id, partial, opts = {}) {
    return this._track(await this.api(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: partial, headers: this._ifMatch(id, opts.baseUpdated, opts.force) }));
  }
  async rename(id, name, opts = {}) { return this.patch(id, { name }, opts); }

  async remove(id) { this._versions.delete(id); return this.api(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  /** Parse a file with the server's readers (for formats the browser cannot read, incl. plugin formats). */
  async parse(file) {
    const form = new FormData();
    form.append('file', file, file.name);
    const r = await this.api('/io/parse', { method: 'POST', form });
    return r.structure;
  }
}
