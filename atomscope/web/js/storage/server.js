/**
 * AtomScope server (Python backend) — REST client.
 *  mode "local": projects are folders on the server's disk (file-based project management)
 *  mode "cloud": multi-user projects in the server database, bearer-token auth
 */
const TOKEN_KEY = 'atomscope.token';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } };

export class ServerStore {
  id = 'server';
  icon = 'server';
  constructor(base = '') {
    this.base = base.replace(/\/$/, '');
    this.info = null;
    this.user = null;
    this.token = lsGet(TOKEN_KEY);
  }
  get label() { return this.info?.mode === 'cloud' ? 'Cloud server' : 'Server folder'; }
  get description() {
    return this.info?.mode === 'cloud'
      ? 'Stored on the AtomScope server under your account. Available from any device.'
      : 'Saved as project folders in the server\'s data directory (one folder per project).';
  }
  get needsAuth() { return !!this.info?.authRequired && !this.user; }

  async api(path, { method = 'GET', body, form, raw = false } = {}) {
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(`${this.base}/api/v1${path}`, { method, headers, body: payload });
    if (res.status === 401) { this.user = null; const e = new Error('Please sign in to the AtomScope server.'); e.code = 'auth'; throw e; }
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j); } catch { /* not json */ }
      throw new Error(msg);
    }
    return raw ? res : res.status === 204 ? null : res.json();
  }

  /** Detect a running AtomScope server next to the page. */
  async probe(timeout = 1500) {
    if (typeof window.claude?.use === 'function') return false;
    if (location.protocol === 'file:') return false;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(`${this.base}/api/v1/info`, { signal: ctl.signal });
      if (!res.ok) return false;
      const info = await res.json();
      if (info?.name !== 'AtomScope') return false;
      this.info = info;
      await this.refreshUser();
      return true;
    } catch { return false; } finally { clearTimeout(t); }
  }

  async init() { return this.info != null; }
  async available() { return this.info != null; }

  async refreshUser() {
    try { const me = await this.api('/auth/me'); this.user = me.user ?? me; } catch { this.user = null; }
    return this.user;
  }
  async login(username, password) { const r = await this.api('/auth/login', { method: 'POST', body: { username, password } }); this._setAuth(r); return r.user; }
  async register(username, password) { const r = await this.api('/auth/register', { method: 'POST', body: { username, password } }); this._setAuth(r); return r.user; }
  async logout() { try { await this.api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ } this.token = null; this.user = null; lsSet(TOKEN_KEY, null); }
  _setAuth(r) { this.token = r.token; this.user = r.user; lsSet(TOKEN_KEY, r.token); }

  async list(q) { return this.api(`/projects${q ? `?q=${encodeURIComponent(q)}` : ''}`); }
  async get(id) { return this.api(`/projects/${encodeURIComponent(id)}`); }
  async save(input) {
    const { location, ...project } = input;
    project.location = location;
    const body = (p) => { const { location: _l, ...rest } = p; return rest; };
    const exists = project.location?.provider === this.id && project.location?.id;
    if (exists) {
      try { return await this.api(`/projects/${encodeURIComponent(project.location.id)}`, { method: 'PUT', body: { ...body(project), id: project.location.id } }); }
      catch (e) { if (!/not found|404/i.test(e.message)) throw e; }
    }
    const { id, ...rest } = body(project);
    return this.api('/projects', { method: 'POST', body: rest });
  }
  async remove(id) { return this.api(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  /** Parse a file with the server's readers (for formats the browser cannot read, incl. plugin formats). */
  async parse(file) {
    const form = new FormData();
    form.append('file', file, file.name);
    const r = await this.api('/io/parse', { method: 'POST', form });
    return r.structure;
  }
}
