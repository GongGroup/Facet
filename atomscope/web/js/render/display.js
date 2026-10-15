/**
 * Display model: the explicit list of atoms that are drawn, derived from a Structure and the
 * display settings (wrapping, supercell, boundary images, bonded images, hidden elements) plus
 * the bonds between them.
 */
import { findBonds, findPeriodicNeighbors, pairKey } from '../core/bonds.js';
import { inv3, cartToFrac } from '../core/util.js';
import { METALS, ANIONS } from '../core/elements.js';

/** Default on/off for an element pair when "smart bonds" is on. */
export function smartPairDefault(pair, elementsPresent) {
  const [a, b] = pair.split('-');
  const hasAnion = elementsPresent.some((e) => ANIONS.has(e) && !METALS.has(e));
  if (hasAnion && METALS.has(a) && METALS.has(b)) return false; // no metal–metal bonds in ionic solids
  return true;
}

export function disabledPairsFor(elementsPresent, bondSettings) {
  const out = [];
  const els = [...new Set(elementsPresent)].sort();
  for (let i = 0; i < els.length; i++) for (let j = i; j < els.length; j++) {
    const k = pairKey(els[i], els[j]);
    const def = bondSettings.smart !== false ? smartPairDefault(k, els) : true;
    const on = bondSettings.pairOverrides?.[k] ?? def;
    if (!on) out.push(k);
  }
  return out;
}

/**
 * @param {import('../core/structure.js').Structure} s
 * @param {object} display display settings
 * @param {{imageCenters?:Set<string>|null}} opt
 */
export function buildDisplayModel(s, display, opt = {}) {
  const n0 = s.length;
  const symbols = [], pos = [], src = [], img = [];
  const keys = new Map();
  const periodic = s.periodic;
  const bondSettings = display.bonds ?? {};
  const disabledPairs = disabledPairsFor(s.elements(), bondSettings);
  const tolerance = bondSettings.tolerance ?? 1.15;
  const hidden = new Set(display.hiddenElements ?? []);
  let drawCell = s.cell;

  const push = (sym, p, i, image) => {
    const k = `${i}:${image[0]},${image[1]},${image[2]}`;
    if (keys.has(k)) return keys.get(k);
    keys.set(k, symbols.length);
    symbols.push(sym); pos.push(p[0], p[1], p[2]); src.push(i); img.push(image[0], image[1], image[2]);
    return symbols.length - 1;
  };

  if (periodic) {
    const cell = s.cell, inv = inv3(cell), pbc = s.pbc;
    const N = (display.supercell ?? [1, 1, 1]).map((v, k) => (pbc[k] ? Math.max(1, v | 0) : 1));
    const wrap = display.wrap !== false;
    // wrapped fractional coords of the base atoms
    const frac = [], shift = [];
    for (let i = 0; i < n0; i++) {
      const f = cartToFrac(s.pos(i), inv);
      const sh = [0, 0, 0];
      if (wrap) for (let k = 0; k < 3; k++) if (pbc[k]) {
        let w = f[k] - Math.floor(f[k]);
        if (w > 1 - 1e-6) w = 0;
        sh[k] = Math.round(f[k] - w); f[k] = w;
      }
      frac.push(f); shift.push(sh);
    }
    const toCart = (f) => [
      f[0] * cell[0][0] + f[1] * cell[1][0] + f[2] * cell[2][0],
      f[0] * cell[0][1] + f[1] * cell[1][1] + f[2] * cell[2][1],
      f[0] * cell[0][2] + f[1] * cell[1][2] + f[2] * cell[2][2],
    ];
    const tol = 1e-3;
    const add = (i, I) => push(s.symbols[i], toCart([frac[i][0] + I[0], frac[i][1] + I[1], frac[i][2] + I[2]]), i, I);
    for (let a = 0; a < N[0]; a++) for (let b = 0; b < N[1]; b++) for (let c = 0; c < N[2]; c++) {
      for (let i = 0; i < n0; i++) {
        if (hidden.has(s.symbols[i])) continue;
        add(i, [a, b, c]);
        if (display.boundaryAtoms !== false && wrap) {
          // images on the far faces / edges / corners of the displayed block
          const near = [0, 1, 2].map((k) => pbc[k] && frac[i][k] < tol && [a, b, c][k] === 0);
          const axes = [0, 1, 2].filter((k) => near[k]);
          for (let mask = 1; mask < 1 << axes.length; mask++) {
            const I = [a, b, c];
            axes.forEach((k, bit) => { if (mask & (1 << bit)) I[k] += N[k]; });
            add(i, I);
          }
        }
      }
    }
    // bonded images: complete coordination shells across the cell boundary
    const centers = display.completeBonds ? null : opt.imageCenters;
    if ((display.completeBonds || (centers && centers.size)) && n0 <= 20000) {
      const wrappedPos = new Float64Array(3 * n0);
      for (let i = 0; i < n0; i++) wrappedPos.set(toCart(frac[i]), 3 * i);
      const nb = findPeriodicNeighbors(wrappedPos, s.symbols, cell, pbc, { tolerance, disabledPairs });
      const adj = Array.from({ length: n0 }, () => []);
      for (const { i, j, offset } of nb) { adj[i].push([j, offset]); adj[j].push([i, offset.map((v) => -v)]); }
      const current = symbols.length;
      for (let d = 0; d < current; d++) {
        const i = src[d];
        if (centers && !centers.has(s.symbols[i])) continue;
        const I = [img[3 * d], img[3 * d + 1], img[3 * d + 2]];
        for (const [j, off] of adj[i]) {
          if (hidden.has(s.symbols[j])) continue;
          add(j, [I[0] + off[0], I[1] + off[1], I[2] + off[2]]);
        }
      }
    }
    drawCell = cell;
    var supercell = N;
  } else {
    for (let i = 0; i < n0; i++) if (!hidden.has(s.symbols[i])) push(s.symbols[i], s.pos(i), i, [0, 0, 0]);
  }

  const positions = new Float32Array(pos);
  const model = {
    n: symbols.length, symbols, positions, src: Int32Array.from(src), img: Int16Array.from(img), keys,
    cell: drawCell, supercell: supercell ?? [1, 1, 1], periodic, pbc: s.pbc, disabledPairs,
  };
  model.bonds = findBonds(positions, symbols, { tolerance, disabledPairs, maxLength: bondSettings.maxLength ?? 4.5 });
  return model;
}

export function keyOf(model, d) {
  return `${model.src[d]}:${model.img[3 * d]},${model.img[3 * d + 1]},${model.img[3 * d + 2]}`;
}

/** Bounding sphere of the display model (+ cell corners). */
export function modelBounds(model) {
  const p = model.positions;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const acc = (x, y, z) => { min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z); max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z); };
  for (let i = 0; i < model.n; i++) acc(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
  if (model.cell) {
    const [A, B, C] = model.cell, N = model.supercell;
    for (const a of [0, N[0]]) for (const b of [0, N[1]]) for (const c of [0, N[2]]) {
      acc(a * A[0] + b * B[0] + c * C[0], a * A[1] + b * B[1] + c * C[1], a * A[2] + b * B[2] + c * C[2]);
    }
  }
  if (!Number.isFinite(min[0])) return { center: [0, 0, 0], radius: 5 };
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(2, 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
  return { center, radius, min, max };
}
