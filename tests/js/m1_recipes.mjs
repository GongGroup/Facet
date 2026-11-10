// M1 (cell and lattice tools): JS twin of tests/m1_recipes.py, the structure recipes of the M1 golden cases and the
// noise they use. The recipes, their arguments, the geometry, the atom order and the error texts are documented in
// the Python module's docstring; this file does the same IEEE-754 operations in the same order, so both languages
// build bit-identical structures (tests/data/surface/m1_recipes_check.json compares structureDigest results).
// tests/js/ops/m1.mjs registers the recipes: fcc111, fcc100, fcc110, hcp0001, bcc110 and graphene.
//
//   "input": {"recipe": {"name": "fcc111", "args": {"element": "Pt", "a": 3.92, "layers": 4, "vacuum": 15}}}
//
// Exact arithmetic: no matrix products, no sums of arrays, no trigonometry. An atom of site (u, v) in surface cell
// (i, j) of layer k of copy m is at x = (i + u)·a1x + (j + v)·a2x, y = (j + v)·a2y, z = z0 + k·d + m·cz; the noise
// adds amp·(2u − 1) with amp = σ·√3 and u = x / 2**32 from XorShift32(seed) (Marsaglia's xorshift32 started from
// mix32(seed), MurmurHash3's fmix32). Node only: structureDigest uses node:crypto.
import { createHash } from 'node:crypto';
import { Structure } from '../../facet/web/js/core/structure.js';
import { ELEMENTS } from '../../facet/web/js/core/elements.js';

/** The most atoms one recipe builds (same as MAX_ATOMS in Python). */
export const MAX_ATOMS = 200000;
const U32_MAX = 0xFFFFFFFF;
const S2 = Math.sqrt(2), S3 = Math.sqrt(3), S6 = Math.sqrt(6);

// ------------------------------------------------------------------------------------------- the noise generator
/** One step of Marsaglia's xorshift32 (shifts 13, 17, 5) on the 32-bit state x; returns the new state. */
export function xorshift32Step(x) {
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/** MurmurHash3's 32-bit finaliser (fmix32): a bijection of the 32-bit integers that maps 0 to 0 only. */
export function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85EBCA6B);
  h ^= h >>> 13;
  h = Math.imul(h, 0xC2B2AE35);
  h ^= h >>> 16;
  return h >>> 0;
}

const u32 = (v) => (Number.isInteger(v) && v >= 1 && v <= U32_MAX ? v : null);

/**
 * The deterministic random numbers of the M1 recipes (the same numbers as the Python XorShift32).
 * `new XorShift32(seed)` starts from mix32(seed); `new XorShift32(null, { state })` from the raw state (Marsaglia's
 * stream). Seeds and states are integers from 1 to 2**32 - 1 (Error otherwise).
 */
export class XorShift32 {
  constructor(seed = null, { state = null } = {}) {
    if ((seed === null) === (state === null)) throw new Error('xorshift32 needs a seed or a state');
    if (state !== null) {
      if (u32(state) === null) throw new Error('xorshift32 state must be an integer from 1 to 4294967295');
      this.state = state;
    } else {
      if (u32(seed) === null) throw new Error('xorshift32 seed must be an integer from 1 to 4294967295');
      this.state = mix32(seed);
    }
  }

  /** The next number: the state after one more step, an integer from 1 to 2**32 - 1. */
  nextU32() {
    this.state = xorshift32Step(this.state);
    return this.state;
  }

  /** The next `count` numbers. */
  take(count) {
    const out = new Array(count);
    for (let t = 0; t < count; t++) out[t] = this.nextU32();
    return out;
  }

  /** The next number divided by 2**32: uniform in (0, 1), exact in float64. */
  uniform() { return this.nextU32() / 4294967296; }
}

/** The displacements σ·√3·(2u − 1) (Å) for the generator outputs `numbers` (u = number / 2**32), a Float64Array. */
export function noiseValues(sigma, numbers) {
  const amp = sigma * S3;
  return Float64Array.from(numbers, (x) => amp * (2 * (x / 4294967296) - 1));
}

/** `count` displacements from XorShift32(seed): uniform in (−σ√3, σ√3), standard deviation σ. */
export function uniformNoise(sigma, seed, count) {
  return noiseValues(sigma, new XorShift32(seed).take(count));
}

// --------------------------------------------------------------------------------------------- the face table
const O = [0, 0];
const H = [1 / 2, 1 / 2];

/**
 * One recipe's geometry: `mesh(a, c, gamma) → [a1x, a2x, a2y, d]` and `sites(gamma)`, the sites of each layer of
 * the stacking (fractions on a1, a2). `label` follows the element in the default name; `lattice` lists the required
 * lattice constants; `layered` takes `layers`; `hexagonal` takes `gamma`.
 */
export const FACES = Object.freeze({
  fcc111: {
    label: '(111)', lattice: ['a'], layered: true, hexagonal: true,
    mesh: (a, c, g) => { const s = a / S2; return [s, g === 120 ? -(s / 2) : s / 2, s * S3 / 2, a / S3]; },
    sites: (g) => (g === 120 ? [[O], [[2 / 3, 1 / 3]], [[1 / 3, 2 / 3]]] : [[O], [[1 / 3, 1 / 3]], [[2 / 3, 2 / 3]]]),
  },
  fcc100: {
    label: '(100)', lattice: ['a'], layered: true, hexagonal: false,
    mesh: (a) => { const s = a / S2; return [s, 0, s, a / 2]; },
    sites: () => [[O], [H]],
  },
  fcc110: {
    label: '(110)', lattice: ['a'], layered: true, hexagonal: false,
    mesh: (a) => { const s = a / S2; return [s, 0, a, s / 2]; },
    sites: () => [[O], [H]],
  },
  hcp0001: {
    label: '(0001)', lattice: ['a', 'c'], layered: true, hexagonal: true,
    mesh: (a, c, g) => [a, g === 120 ? -(a / 2) : a / 2, a * S3 / 2, c / 2],
    sites: (g) => (g === 120 ? [[O], [[2 / 3, 1 / 3]]] : [[O], [[1 / 3, 1 / 3]]]),
  },
  bcc110: {
    label: '(110)', lattice: ['a'], layered: true, hexagonal: false,
    mesh: (a) => [a * S3 / 2, -(a * S3 / 6), a * S6 / 3, a / S2],
    sites: () => [[O], [H]],
  },
  graphene: {
    label: ' graphene', lattice: ['a'], layered: false, hexagonal: true,
    mesh: (a, c, g) => [a, g === 120 ? -(a / 2) : a / 2, a * S3 / 2, 0],
    sites: (g) => (g === 120 ? [[[1 / 3, 2 / 3], [2 / 3, 1 / 3]]] : [[[1 / 3, 1 / 3], [2 / 3, 2 / 3]]]),
  },
});
/** The recipe names, in registration order. */
export const RECIPE_NAMES = Object.freeze(Object.keys(FACES));

const COMMON = ['element', 'a', 'vacuum', 'supercell', 'z0', 'tags', 'fix', 'noise', 'delete', 'name', 'info'];
const TOP = /^top:([1-9][0-9]*)$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function allowed(f) {
  const keys = [...COMMON];
  if (f.lattice.includes('c')) keys.push('c');
  if (f.layered) keys.push('layers');
  if (f.hexagonal) keys.push('gamma');
  return keys;
}

// ------------------------------------------------------------------------------------------------ the builder
/**
 * Build the recipe `face` ('fcc111', ...) from `args` (an object as in a case file); the arguments, the geometry and
 * the atom order are those of tests/m1_recipes.py, with the same error messages (`recipe fcc111: missing arg vacuum`).
 */
export function slab(face, args = {}) {
  if (!has(FACES, face)) throw new Error(`unknown slab recipe ${JSON.stringify(face)} (known: ${RECIPE_NAMES.join(', ')})`);
  const f = FACES[face];
  const name = `recipe ${face}`;
  if (!isObject(args)) throw new Error(`${name}: the arguments must be an object`);
  const ok = allowed(f);
  const unknown = Object.keys(args).filter((k) => !ok.includes(k)).sort();
  if (unknown.length) throw new Error(`${name}: unknown args ${unknown.join(', ')}`);
  for (const key of ['element', ...f.lattice, ...(f.layered ? ['layers'] : []), 'vacuum']) {
    if (!has(args, key)) throw new Error(`${name}: missing arg ${key}`);
  }

  const { element } = args;
  if (!(typeof element === 'string' && element !== 'X' && ELEMENTS.has(element))) {
    throw new Error(`${name}: element must be an element symbol such as "Pt"`);
  }
  for (const key of f.lattice) {
    if (!(isNumber(args[key]) && args[key] > 0.5)) throw new Error(`${name}: ${key} must be a number larger than 0.5 (Å)`);
  }
  const a = args.a;
  const c = f.lattice.includes('c') ? args.c : 0;
  let layers = 1;
  if (f.layered) {
    if (!(Number.isInteger(args.layers) && args.layers >= 1)) throw new Error(`${name}: layers must be a positive integer`);
    layers = args.layers;
  }
  if (!(isNumber(args.vacuum) && args.vacuum > 0)) throw new Error(`${name}: vacuum must be a positive number (Å)`);
  const vacuum = args.vacuum;
  let gamma = 120;
  if (has(args, 'gamma')) {
    if (args.gamma !== 120 && args.gamma !== 60) throw new Error(`${name}: gamma must be 120 or 60`);
    gamma = args.gamma;
  }
  let reps = [1, 1, 1];
  if (has(args, 'supercell')) {
    const sc = args.supercell;
    if (!(Array.isArray(sc) && (sc.length === 2 || sc.length === 3) && sc.every((n) => Number.isInteger(n) && n >= 1))) {
      throw new Error(`${name}: supercell must be [n1, n2] or [n1, n2, n3] with positive integers`);
    }
    reps = sc.length === 2 ? [...sc, 1] : [...sc];
  }
  let z0 = 0;
  if (has(args, 'z0')) {
    if (!isNumber(args.z0)) throw new Error(`${name}: z0 must be a number (Å)`);
    z0 = args.z0;
  }
  let tags = false;
  if (has(args, 'tags')) {
    if (typeof args.tags !== 'boolean') throw new Error(`${name}: tags must be true or false`);
    tags = args.tags;
  }
  let fix = null;
  if (has(args, 'fix')) {
    if (!(Number.isInteger(args.fix) && args.fix >= 0 && args.fix <= layers)) {
      throw new Error(`${name}: fix must be an integer from 0 to ${layers} (the number of layers)`);
    }
    fix = args.fix;
  }
  let sigma = 0, seed = 1;
  if (has(args, 'noise')) {
    const noise = args.noise;
    if (!(isObject(noise) && Object.keys(noise).sort().join(',') === 'seed,sigma')) {
      throw new Error(`${name}: noise must be {"sigma": ..., "seed": ...}`);
    }
    if (!(isNumber(noise.sigma) && noise.sigma >= 0 && noise.sigma <= 1)) {
      throw new Error(`${name}: noise sigma must be a number from 0 to 1 (Å)`);
    }
    if (u32(noise.seed) === null) throw new Error(`${name}: noise seed must be an integer from 1 to 4294967295`);
    sigma = noise.sigma;
    seed = noise.seed;
  }
  if (has(args, 'name') && !(typeof args.name === 'string' && args.name)) throw new Error(`${name}: name must be a non-empty string`);
  if (has(args, 'info') && !isObject(args.info)) throw new Error(`${name}: info must be an object`);

  const [n1, n2, n3] = reps;
  const stacking = f.sites(gamma);
  const perLayer = n1 * n2 * stacking[0].length;
  const total = n3 * layers * perLayer;
  if (total > MAX_ATOMS) throw new Error(`${name}: ${total} atoms are more than a recipe may build (${MAX_ATOMS})`);
  const deleted = has(args, 'delete') ? deletedAtoms(name, args.delete, total, perLayer) : [];

  const [a1x, a2x, a2y, d] = f.mesh(a, c, gamma);
  const cz = (layers - 1) * d + vacuum;
  const pos = new Float64Array(3 * total);
  const layerOf = new Int32Array(total);
  let o = 0, row = 0;
  for (let m = 0; m < n3; m++) {
    for (let k = 0; k < layers; k++) {
      const z = z0 + k * d + m * cz;
      const sites = stacking[k % stacking.length];
      for (let i = 0; i < n1; i++) {
        for (let j = 0; j < n2; j++) {
          for (const [u, v] of sites) {
            const fu = i + u, fv = j + v;
            pos[o++] = fu * a1x + fv * a2x;
            pos[o++] = fv * a2y;
            pos[o++] = z;
            layerOf[row++] = k;
          }
        }
      }
    }
  }
  if (sigma > 0) {
    const noise = uniformNoise(sigma, seed, pos.length);
    for (let t = 0; t < pos.length; t++) pos[t] += noise[t];
  }

  const keep = new Uint8Array(total).fill(1);
  for (const i of deleted) keep[i] = 0;
  const kept = [];
  for (let i = 0; i < total; i++) if (keep[i]) kept.push(i);
  const positions = new Float64Array(3 * kept.length);
  kept.forEach((i, r) => positions.set(pos.subarray(3 * i, 3 * i + 3), 3 * r));
  const props = {};
  if (tags) props.tags = kept.map((i) => layers - layerOf[i]);
  if (fix !== null) props.selective_dynamics = kept.map((i) => (layerOf[i] < fix ? [false, false, false] : [true, true, true]));

  let title = args.name;
  if (!has(args, 'name')) {
    const mesh = n1 === 1 && n2 === 1 ? '' : ` p(${n1}×${n2})`;
    title = `${element}${f.label}${mesh}${f.layered ? ` ${layers}L` : ''}${n3 > 1 ? ` ×${n3}` : ''}`;
  }
  const cell = [[n1 * a1x, 0, 0], [n2 * a2x, n2 * a2y, 0], [0, 0, n3 * cz]];
  return new Structure({
    name: title, symbols: kept.map(() => element), positions, cell, pbc: [true, true, true], props,
    info: has(args, 'info') ? args.info : {},
  });
}

/** The atom indices that `delete` removes (sorted). */
function deletedAtoms(name, spec, total, perLayer) {
  let idx;
  if (typeof spec === 'string') {
    const m = TOP.exec(spec);
    if (!m) throw new Error(`${name}: delete must be "top:N" or a list of atom indices`);
    const n = Number(m[1]);
    if (n > perLayer) throw new Error(`${name}: delete top:${n} removes more atoms than the top layer has (${perLayer})`);
    idx = Array.from({ length: n }, (_, t) => total - n + t);
  } else if (Array.isArray(spec)) {
    if (!spec.every((i) => Number.isInteger(i) && i >= 0 && i < total)) {
      throw new Error(`${name}: delete must list atom indices from 0 to ${total - 1}`);
    }
    const seen = new Set();
    for (const i of spec) {
      if (seen.has(i)) throw new Error(`${name}: delete lists atom ${i} twice`);
      seen.add(i);
    }
    idx = [...spec];
  } else {
    throw new Error(`${name}: delete must be "top:N" or a list of atom indices`);
  }
  if (idx.length >= total) throw new Error(`${name}: delete removes every atom`);
  return idx.sort((p, q) => p - q);
}

// ---------------------------------------------------------------------------------------------- exact digests
const f64Text = (x) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x, 0);
  return `"f${b.toString('hex')}"`;
};

/**
 * `value` as the canonical text of tests/m1_recipes.py: keys sorted, no spaces; integers (other than -0) below 2**53
 * in decimal, every other number as "f<16 hex digits>" of its big-endian float64 bits; strings as JSON.
 */
export function canonicalText(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    return Number.isInteger(value) && Math.abs(value) < 2 ** 53 && !Object.is(value, -0) ? String(value) : f64Text(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return `[${Array.from(value, canonicalText).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalText(value[k])}`).join(',')}}`;
  }
  throw new TypeError(`cannot write ${typeof value} as canonical text`);
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function f64le(values) {
  const b = Buffer.alloc(8 * values.length);
  values.forEach((v, t) => b.writeDoubleLE(v, 8 * t));
  return b;
}

/**
 * SHA-256 digests of structure `s`: `positions` and `cell` (null without one) of their little-endian float64 bytes,
 * row by row; `symbols` and `props` of canonicalText. The same digests as the Python structure_digest for the same
 * structure, so equal digests mean bit-identical structures.
 */
export function structureDigest(s) {
  const cell = s.cell ? s.cell.flatMap((row) => Array.from(row)) : null;
  return {
    symbols: sha256(Buffer.from(canonicalText(s.symbols), 'utf8')),
    positions: sha256(f64le(Array.from(s.positions))),
    cell: cell ? sha256(f64le(cell)) : null,
    props: sha256(Buffer.from(canonicalText(s.props), 'utf8')),
  };
}
