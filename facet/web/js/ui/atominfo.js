/**
 * Extra lines for the atom hover card and the selection card (one atom selected). A module registers
 *   registerAtomInfo((app, index, { where }) => [{ label: 'layer', value: '2/4 · fixed c (z)' }], { order })
 * where `index` is the structure (source) atom and `where` is 'hover' or 'card'. Returning null adds
 * nothing. The hover card shows the rows after its "bonds" line, the selection card after the
 * coordinates, both in `order` (then registration) order.
 */
const providers = [];
let seq = 0;
const failed = new WeakSet();   // providers already reported in the console (hover runs them on every move)

/** Add an atom-info provider; returns a function that removes it again. */
export function registerAtomInfo(fn, { order = 100 } = {}) {
  if (typeof fn !== 'function') throw new TypeError('registerAtomInfo: expected a function (app, index, { where }) → [{ label, value }] | null');
  if (!Number.isFinite(order)) throw new TypeError('registerAtomInfo: order must be a number');
  const p = { fn, order, seq: seq++ };
  providers.push(p);
  providers.sort((a, b) => a.order - b.order || a.seq - b.seq);
  return () => { const i = providers.indexOf(p); if (i >= 0) providers.splice(i, 1); };
}

/**
 * The extra rows for source atom `index`: [{label, value}] as strings, from every provider in order.
 * A provider that throws is skipped (and reported once); rows without a label are dropped.
 */
export function atomInfoRows(app, index, where = 'hover') {
  const out = [];
  for (const p of providers.slice()) {
    let rows;
    try { rows = p.fn(app, index, { where }); }
    catch (e) {
      if (!failed.has(p.fn)) { failed.add(p.fn); console.error('registerAtomInfo: a provider failed', e); }
      continue;
    }
    if (rows == null) continue;
    for (const r of Array.isArray(rows) ? rows : [rows]) {
      if (!r || r.label == null || r.label === '') continue;
      out.push({ label: String(r.label), value: r.value == null ? '' : String(r.value) });
    }
  }
  return out;
}
