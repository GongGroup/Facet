/**
 * Storage manager. Every provider implements:
 *   { id, label, icon, description, init(), available(), list(), get(id), save(project) -> saved, remove(id) }
 * Plugins may add providers with `storage.register(provider)` (e.g. S3, WebDAV, a lab database).
 */
import { Emitter } from '../core/events.js';

export function summarize(p) {
  const active = p.structures?.find((s) => s.id === p.activeStructure) ?? p.structures?.[0];
  const st = active?.structure;
  let formula = p.formula;
  if (st?.symbols) {
    const c = {};
    st.symbols.forEach((s) => { c[s] = (c[s] ?? 0) + 1; });
    formula = Object.keys(c).sort().map((k) => k + (c[k] > 1 ? c[k] : '')).join('');
  }
  return {
    id: p.id, name: p.name ?? 'Untitled', description: p.description ?? '', tags: p.tags ?? [], created: p.created, updated: p.updated,
    thumbnail: p.thumbnail ?? null, nStructures: p.structures?.length ?? p.nStructures ?? 0, nAtoms: st?.symbols?.length ?? p.nAtoms ?? 0, formula: formula ?? '',
  };
}

export class StorageManager extends Emitter {
  constructor() {
    super();
    this.providers = new Map();
  }
  register(p) { this.providers.set(p.id, p); this.emit('change'); return () => { this.providers.delete(p.id); this.emit('change'); }; }
  get(id) { return this.providers.get(id); }
  list() { return [...this.providers.values()]; }
  async availableProviders() {
    const out = [];
    for (const p of this.providers.values()) { try { if (await p.available()) out.push(p); } catch { /* skip */ } }
    return out;
  }
}
