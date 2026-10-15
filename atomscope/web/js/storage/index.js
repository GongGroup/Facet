/**
 * Storage manager. Every provider implements:
 *   { id, label, icon, description, where, init(), available(), list(q?), get(id), save(project, {force}?) -> saved, remove(id) }
 * `where` completes "Saved …" in the save chip ("in this browser", "in folder Projects").
 * save() rejects with err.code === 'conflict' when the project changed elsewhere since it was
 * loaded (pass {force: true} to overwrite) and err.code === 'auth' / 'offline' where that applies.
 * Plugins may add providers with `storage.register(provider)` (e.g. S3, WebDAV, a lab database).
 */
import { Emitter } from '../core/events.js';
import { Structure } from '../core/structure.js';

/** Formula exactly as the info card shows it (Structure.formula ordering). */
function formulaOf(st) {
  try { return Structure.fromJSON({ symbols: st.symbols }).formula(); } catch { /* fall through */ }
  const c = {};
  st.symbols.forEach((s) => { c[s] = (c[s] ?? 0) + 1; });
  return Object.keys(c).sort().map((k) => k + (c[k] > 1 ? c[k] : '')).join('');
}

/**
 * List-row summary of a project document (no structures/scene). `size` is the stored size in bytes, when known.
 * `formula` and `nAtoms` describe the active structure; `formulas` and `nAtomsTotal` cover every structure.
 */
export function summarize(p, size) {
  const active = p.structures?.find((s) => s.id === p.activeStructure) ?? p.structures?.[0];
  const st = active?.structure;
  const formula = st?.symbols ? formulaOf(st) : p.formula;
  const all = Array.isArray(p.structures) ? p.structures.map((e) => e?.structure).filter((x) => Array.isArray(x?.symbols)) : null;
  const out = {
    id: p.id, name: p.name ?? 'Untitled', description: String(p.description ?? '').slice(0, 500), tags: p.tags ?? [], created: p.created, updated: p.updated,
    thumbnail: p.thumbnail ?? null, nStructures: p.structures?.length ?? p.nStructures ?? 0, nAtoms: st?.symbols?.length ?? p.nAtoms ?? 0, formula: formula ?? '',
    formulas: all ? all.map(formulaOf) : (p.formulas ?? (formula ? [formula] : [])),
    nAtomsTotal: all ? all.reduce((n, x) => n + x.symbols.length, 0) : (p.nAtomsTotal ?? p.nAtoms ?? 0),
  };
  const n = size ?? p.size;
  if (n > 0) out.size = n;
  return out;
}

/** The error thrown by save() when the stored copy is newer than the one being saved. */
export function conflictError(message = 'This project was changed somewhere else since you opened it.') {
  return Object.assign(new Error(message), { code: 'conflict' });
}

/** Strip client-side bookkeeping that is never stored (location, baseUpdated). */
export function storable(project) {
  const { location, baseUpdated, ...rest } = project;
  return rest;
}

/**
 * A list row written by an older version (alphabetical formula such as 'Cl2Na2', no `formulas`): the formula
 * in the info card's order and the fields search uses. Rows of this version come back unchanged.
 */
export function upgradeSummary(m) {
  if (!m || Array.isArray(m.formulas)) return m;
  let formula = String(m.formula ?? '');
  if (/^(?:[A-Z][a-z]*\d*)+$/.test(formula)) {
    const symbols = [];
    for (const [, el, n] of formula.matchAll(/([A-Z][a-z]*)(\d*)/g)) {
      const k = n ? Number(n) : 1;
      if (symbols.length + k > 50000) { symbols.length = 0; break; }   // too large to expand: keep the stored text
      for (let i = 0; i < k; i++) symbols.push(el);
    }
    if (symbols.length) formula = formulaOf({ symbols });
  }
  return { ...m, formula, formulas: formula ? [formula] : [], nAtomsTotal: m.nAtomsTotal ?? m.nAtoms ?? 0 };
}

/** Case-insensitive match of a summary against a search string (name, every structure's formula, tags, description). */
export function matchesQuery(summary, q) {
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return true;
  const formulas = [summary.formula, ...(summary.formulas ?? [])].map((f) => String(f ?? '').toLowerCase());
  // "nacl" also finds Na4Cl4: a query without digits is compared with the formulas' element letters too
  if (!/\d/.test(needle) && formulas.some((f) => f.replace(/\d+/g, '').includes(needle))) return true;
  return [summary.name, ...formulas, summary.description, ...(summary.tags ?? [])]
    .some((v) => String(v ?? '').toLowerCase().includes(needle));
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
