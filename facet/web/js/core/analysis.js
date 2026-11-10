/** Client-side analysis: radial distribution function and coordination statistics. */
import { inv3, cartToFrac, norm, cross, det3 } from './util.js';
import { findPeriodicNeighbors, findBonds } from './bonds.js';

/**
 * Radial distribution function g(r). Periodic structures use minimum images out to rmax;
 * clusters return the normalised pair-distance histogram. Optional element pair filter [A, B].
 */
export function rdf(s, { rmax = 8, nbins = 160, pair = null } = {}) {
  const n = s.length;
  const dr = rmax / nbins;
  const hist = new Float64Array(nbins);
  const sel = (sym, which) => !pair || sym === pair[which];
  let na = 0, nb = 0;
  for (const sym of s.symbols) { if (sel(sym, 0)) na++; if (sel(sym, 1)) nb++; }
  if (s.periodic) {
    const cell = s.cell, inv = inv3(cell), V = Math.abs(det3(cell));
    const h = [V / norm(cross(cell[1], cell[2])), V / norm(cross(cell[0], cell[2])), V / norm(cross(cell[0], cell[1]))];
    const reach = h.map((x, k) => (s.pbc[k] ? Math.ceil(rmax / x) : 0));
    const frac = [];
    for (let i = 0; i < n; i++) frac.push(cartToFrac(s.pos(i), inv));
    const maxPairs = 6e6;
    let work = n * n * (2 * reach[0] + 1) * (2 * reach[1] + 1) * (2 * reach[2] + 1);
    const stride = work > maxPairs ? Math.ceil(work / maxPairs) : 1;
    let sampled = 0;
    for (let i = 0; i < n; i += stride) {
      if (!sel(s.symbols[i], 0)) continue;
      sampled++;
      for (let j = 0; j < n; j++) {
        if (!sel(s.symbols[j], 1)) continue;
        const df = [frac[j][0] - frac[i][0], frac[j][1] - frac[i][1], frac[j][2] - frac[i][2]].map((v, k) => (s.pbc[k] ? v - Math.round(v) : v));
        for (let a = -reach[0]; a <= reach[0]; a++) for (let b = -reach[1]; b <= reach[1]; b++) for (let c = -reach[2]; c <= reach[2]; c++) {
          const f0 = df[0] + a, f1 = df[1] + b, f2 = df[2] + c;
          const x = f0 * cell[0][0] + f1 * cell[1][0] + f2 * cell[2][0];
          const y = f0 * cell[0][1] + f1 * cell[1][1] + f2 * cell[2][1];
          const z = f0 * cell[0][2] + f1 * cell[1][2] + f2 * cell[2][2];
          const d = Math.sqrt(x * x + y * y + z * z);
          if (d < 1e-6 || d >= rmax) continue;
          hist[Math.floor(d / dr)]++;
        }
      }
    }
    const rho = nb / V;
    const g = [], r = [];
    for (let k = 0; k < nbins; k++) {
      const r0 = k * dr, r1 = r0 + dr;
      const shell = (4 / 3) * Math.PI * (r1 ** 3 - r0 ** 3);
      r.push(r0 + dr / 2);
      g.push(sampled ? hist[k] / (sampled * rho * shell) : 0);
    }
    return { r, g, periodic: true, rmax, sampled: sampled < na };
  }
  for (let i = 0; i < n; i++) {
    if (!sel(s.symbols[i], 0)) continue;
    for (let j = 0; j < n; j++) {
      if (i === j || !sel(s.symbols[j], 1)) continue;
      const d = Math.hypot(s.positions[3 * j] - s.positions[3 * i], s.positions[3 * j + 1] - s.positions[3 * i + 1], s.positions[3 * j + 2] - s.positions[3 * i + 2]);
      if (d < rmax) hist[Math.floor(d / dr)]++;
    }
  }
  const tot = hist.reduce((a, b) => a + b, 0) || 1;
  return { r: Array.from({ length: nbins }, (_, k) => (k + 0.5) * dr), g: Array.from(hist, (v) => v / tot / dr), periodic: false, rmax };
}

/** Coordination numbers per element: [{element, mean, min, max, histogram}] */
export function coordinationStats(s, bondOpt = {}) {
  const n = s.length;
  const cn = new Int32Array(n);
  if (s.periodic && n <= 20000) {
    for (const { i, j } of findPeriodicNeighbors(s.positions, s.symbols, s.cell, s.pbc, bondOpt)) { cn[i]++; cn[j]++; }
  } else {
    const b = findBonds(s.positions, s.symbols, bondOpt);
    for (let k = 0; k < b.count; k++) { cn[b.pairs[2 * k]]++; cn[b.pairs[2 * k + 1]]++; }
  }
  const by = new Map();
  s.symbols.forEach((sym, i) => { const e = by.get(sym) ?? []; e.push(cn[i]); by.set(sym, e); });
  return [...by.entries()].map(([element, arr]) => ({
    element, count: arr.length, mean: arr.reduce((a, b) => a + b, 0) / arr.length, min: Math.min(...arr), max: Math.max(...arr),
  }));
}
