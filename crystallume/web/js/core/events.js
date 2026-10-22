/** Minimal event emitter used by the store, viewer and plugin API. */
export class Emitter {
  constructor() { this._h = new Map(); }
  on(type, fn) {
    if (!this._h.has(type)) this._h.set(type, new Set());
    this._h.get(type).add(fn);
    return () => this.off(type, fn);
  }
  once(type, fn) {
    const off = this.on(type, (...a) => { off(); fn(...a); });
    return off;
  }
  off(type, fn) { this._h.get(type)?.delete(fn); }
  emit(type, ...args) {
    for (const fn of [...(this._h.get(type) ?? [])]) {
      try { fn(...args); } catch (e) { console.error(`[crystallume] listener for "${type}" failed`, e); }
    }
    if (type !== '*') for (const fn of [...(this._h.get('*') ?? [])]) fn(type, ...args);
  }
}
