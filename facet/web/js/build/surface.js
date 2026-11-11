/**
 * Cleaving surfaces and the slab tools (M2): new slabs from a bulk crystal, and tools for existing slabs. A pure
 * module (no DOM), so Node tests import it directly.
 *
 * buildSurface(bulk, { miller, vacuum, … }) cleaves a crystal along (hkl) or (h k i l) and returns a new slab (pbc
 * T T T, a along x, c perpendicular to the surface and along z, the vacuum along c); surfaceAnalysis and terminations
 * describe the surface first (surface cell, atomic layers, inequivalent terminations, broken bonds, polarity, Tasker
 * type); slabReport, surfaceTop and standardizeSlab read or prepare an existing slab (the in-place tools setVacuum,
 * addVacuum, centerSlab and flipSlab are Structure methods). The Python twin is `facet/build/surface.py`: the
 * same algorithms and results with the same words in snake_case (buildSurface ↔ surface; design brief P1).
 *
 * `vacuum` is always the total gap between the slab and its periodic image along the surface normal, in Å (0 = no
 * vacuum: the slab repeats as in the bulk), never per side; it is required and has no default (user decision U4).
 *
 * The module is written by several tasks, each inside its own segment (`// --- surface-modeling <name> ---` …
 * `// --- end <name> ---`, plan.md §2.2), each with its own imports: `M2-T2` the formal oxidation states
 * (loadOxidationStates, estimateOxidationStates, from the shared table `facet/web/data/oxidation_states.json`;
 * M2 §3.9.1), `M2-T6a` the cleave analysis (surfaceAnalysis, terminations), `M2-T3b` surface coordination and
 * exposed layers, `M2-T6b` the slab (buildSurface, estimateSurfaceAtoms, orientedCell, planePolygons), `M2-T5` the
 * tools for existing structures (slabReport, surfaceTop, standardizeSlab).
 */

// --- surface-modeling M2-T2 ---
import { METALS, PAULING } from '../core/elements.js';
import { loadWebData, webData } from '../core/webdata.js';

/** The shared table of formal oxidation states (written by scripts/gen_oxidation_states.py). */
const OXIDATION_FILE = 'oxidation_states.json';
const OXIDATION_SCHEMA = 'facet.oxidation-states/1';
/** Elements of the anion table within this much (Pauling) of the most electronegative element are anions. */
const ANION_WINDOW = 0.6;
/** Slack of the electronegativity comparisons (the values have two decimals). */
const EN_SLACK = 1e-9;
const NOT_LOADED = 'oxidation states are not loaded yet; call await loadOxidationStates() first';
/** table object → checked { anions: Map(element → charge), cations: Map(element → valences) } */
const checkedTables = new WeakMap();

/**
 * Load the formal oxidation-state table of the cleave tool (M2 §3.9.1), `facet/web/data/oxidation_states.json`
 * (the copy Python reads too), through core/webdata.js: a Promise of the table `{ schema:
 * 'facet.oxidation-states/1', source, anions: { element: charge }, cations: { element: [valence, …] } }`,
 * cation valences in order of preference. It rejects for a file that cannot be read or a malformed table. The app
 * awaits it at start-up, before it reports ready (a start-up task, core/boot.js); afterwards estimateOxidationStates
 * and formalCharges work synchronously. Node tests await it first. Callers must not modify the table.
 */
export async function loadOxidationStates() {
  const table = await loadWebData(OXIDATION_FILE);
  checkedTable(table);
  return table;
}

/**
 * Formal charge of each element of a composition, or null when it cannot be estimated (M2 §3.9.1): the rules of the
 * Python twin estimate_oxidation_states, with the same results.
 * - only metals (core/elements.js METALS), or a single element: every charge is 0 (no ionic charges);
 * - the anions are the elements of the table's anion list within 0.6 (Pauling) of the most electronegative element
 *   (O and N in TaON; C is a cation in CaCO3), each with its anion charge; the other elements are cations;
 * - the cation valences come from the table: the first combination in order of preference (the cations in formula
 *   order) that makes the formula neutral (SrTiO3: Sr +2, Ti +4, O -2); when none does, each cation's first valence
 *   is scaled so that the charges add up to zero (Fe3O4: Fe +2.67);
 * - null (unknown) when the most electronegative element has no anion charge, an element has no Pauling
 *   electronegativity (He, Ne, Ar, X), a cation is not in the table, or every element is an anion.
 * `symbols` is an array of element symbols (one per atom, e.g. structure.symbols) or an object or Map of element →
 * count. `charges` gives the charges instead ({ Sr: 2, Ti: 4, O: -2 }); it must give every element (`charges must give
 * every element: missing O`). The result has the elements in formula order (Pauling electronegativity, then symbol).
 * Without `charges` the table must be loaded: otherwise this throws (it never silently answers "unknown", so the
 * analysis gives the same default termination whenever it runs).
 */
export function estimateOxidationStates(symbols, { charges = null } = {}) {
  return formalCharges(symbols, { charges }).charges;
}

/**
 * estimateOxidationStates with where the charges come from, for the cleave analysis (internal; Python
 * _formal_charges): `{ charges: object | null, source, notes: string[] }`, source 'user' (charges given), 'metal'
 * (only metals), 'element' (one element that is not a metal), 'formal' (a neutral combination of the table's
 * valences), 'averaged' (scaled first valences; notes holds the note W11, `formal charges were averaged (Fe +2.67)`)
 * or 'unknown' (charges null).
 */
export function formalCharges(symbols, { charges = null } = {}) {
  const counts = composition(symbols);
  const elements = [...counts.keys()].sort(formulaOrder);
  if (charges != null) return { charges: givenCharges(elements, charges), source: 'user', notes: [] };
  const table = webData(OXIDATION_FILE);
  if (table == null) throw new Error(NOT_LOADED);
  const { anions: anionCharge, cations: valences } = checkedTable(table);
  const zeros = () => Object.fromEntries(elements.map((e) => [e, 0]));
  if (elements.every((e) => METALS.has(e))) return { charges: zeros(), source: 'metal', notes: [] };
  if (elements.length === 1) return { charges: zeros(), source: 'element', notes: [] };
  const unknown = { charges: null, source: 'unknown', notes: [] };
  const en = new Map(elements.map((e) => [e, pauling(e)]));
  if ([...en.values()].some((v) => v == null)) return unknown;
  const enMax = Math.max(...en.values());
  if (!elements.some((e) => en.get(e) >= enMax - EN_SLACK && anionCharge.has(e))) return unknown;
  const anions = elements.filter((e) => anionCharge.has(e) && en.get(e) >= enMax - ANION_WINDOW - EN_SLACK);
  const cations = elements.filter((e) => !anions.includes(e));
  if (!cations.length || cations.some((e) => !valences.has(e))) return unknown;
  let need = 0;
  for (const e of anions) need -= counts.get(e) * anionCharge.get(e);
  const states = neutralValences(cations.map((e) => counts.get(e)), cations.map((e) => valences.get(e)), need);
  const cationCharge = new Map();
  const notes = [];
  let source;
  if (states) {
    cations.forEach((e, i) => cationCharge.set(e, states[i]));
    source = 'formal';
  } else {
    let total = 0;
    for (const e of cations) total += counts.get(e) * valences.get(e)[0];
    for (const e of cations) cationCharge.set(e, valences.get(e)[0] * need / total);
    source = 'averaged';
    notes.push(`formal charges were averaged (${cations.map((e) => `${e} ${signedCharge(cationCharge.get(e))}`).join(', ')})`);
  }
  const out = Object.fromEntries(elements.map((e) => [e, cationCharge.has(e) ? cationCharge.get(e) : anionCharge.get(e)]));
  return { charges: out, source, notes };
}

/** The checked table (cached per table object); Error (the text of Python's) for a malformed one. */
function checkedTable(table) {
  const known = checkedTables.get(table);
  if (known) return known;
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(table) || table.schema !== OXIDATION_SCHEMA) throw new Error(`${OXIDATION_FILE} is not a ${OXIDATION_SCHEMA} table`);
  if (!isObject(table.anions) || !isObject(table.cations)) throw new Error(`${OXIDATION_FILE} needs the objects anions and cations`);
  const anions = new Map(), cations = new Map();
  for (const [e, q] of Object.entries(table.anions)) {
    if (!Number.isInteger(q) || q >= 0) throw new Error(`${OXIDATION_FILE}: anions.${e} must be a negative whole number`);
    anions.set(e, q);
  }
  for (const [e, qs] of Object.entries(table.cations)) {
    if (!Array.isArray(qs) || !qs.length || qs.some((q) => !Number.isInteger(q) || q <= 0) || new Set(qs).size !== qs.length) {
      throw new Error(`${OXIDATION_FILE}: cations.${e} must be a list of distinct positive whole numbers`);
    }
    cations.set(e, Object.freeze([...qs]));
  }
  const checked = Object.freeze({ anions, cations });
  checkedTables.set(table, checked);
  return checked;
}

/** Element → number of atoms of an array (or other iterable) of symbols, or of an object or Map of counts. */
function composition(symbols) {
  if (symbols === null || typeof symbols !== 'object') {
    throw new TypeError('symbols must be a list of element symbols or a mapping of counts');
  }
  const counts = new Map();
  const add = (e, n) => counts.set(e, (counts.get(e) ?? 0) + n);
  if (symbols instanceof Map || typeof symbols[Symbol.iterator] !== 'function') {
    for (const [key, n] of symbols instanceof Map ? symbols.entries() : Object.entries(symbols)) {
      const e = String(key);
      if (!Number.isInteger(n) || n < 0) throw new Error(`the count of ${e} must be a whole number`);
      if (n) add(e, n);
    }
    return counts;
  }
  for (const s of symbols) add(String(s), 1);
  return counts;
}

/** The Pauling electronegativity of the element symbol `e` exactly as written, or null. */
const pauling = (e) => (Object.hasOwn(PAULING, e) ? PAULING[e] : null);

/** The formula order: Pauling electronegativity (2.0 when it has none), then the symbol (code-unit order). */
function formulaOrder(a, b) {
  return ((pauling(a) ?? 2) - (pauling(b) ?? 2)) || (a < b ? -1 : a > b ? 1 : 0);
}

function givenCharges(elements, charges) {
  const isMap = charges instanceof Map;
  if (!isMap && (typeof charges !== 'object' || Array.isArray(charges))) {
    throw new TypeError('charges must be a mapping of element symbols to charges');
  }
  const get = (e) => (isMap ? charges.get(e) : Object.hasOwn(charges, e) ? charges[e] : undefined);
  const has = (e) => (isMap ? charges.has(e) : Object.hasOwn(charges, e));
  const missing = elements.filter((e) => !has(e));
  if (missing.length) throw new Error(`charges must give every element: missing ${missing.join(', ')}`);
  const out = {};
  for (const e of elements) {
    const q = get(e);
    if (typeof q !== 'number' || !Number.isFinite(q)) throw new Error(`the charge given for ${e} is not a finite number`);
    out[e] = q;
  }
  return out;
}

/**
 * The first valence combination, in order of preference, with Σ count · valence = need, or null: combinations are
 * ordered lexicographically by the position of each valence in its list (the first list varies slowest), and the sets
 * of sums the remaining cations can still reach (at most need + 1 values each) keep the search linear.
 */
function neutralValences(counts, options, need) {
  const reach = options.map(() => null);
  reach.push(new Set([0]));
  for (let i = options.length - 1; i >= 0; i--) {
    const next = new Set();
    for (const v of options[i]) for (const r of reach[i + 1]) { const s = counts[i] * v + r; if (s <= need) next.add(s); }
    reach[i] = next;
  }
  if (!reach[0].has(need)) return null;
  const chosen = [];
  let rest = need;
  options.forEach((vs, i) => {
    const v = vs.find((x) => reach[i + 1].has(rest - counts[i] * x));
    chosen.push(v);
    rest -= counts[i] * v;
  });
  return chosen;
}

/** `+2.67`: q with its sign and two decimals, rounded half up as formatDecimal rounds (ledger L-M1-15). */
function signedCharge(q) {
  const s = Math.floor(Math.abs(q) * 100 + 0.5);
  const text = `${Math.floor(s / 100)}.${String(s % 100).padStart(2, '0')}`;
  return s === 0 ? text : (q > 0 ? '+' : '-') + text;
}
// --- end M2-T2 ---

// --- surface-modeling M2-T6a ---
import { ANIONS, covalentRadius } from '../core/elements.js';
import { SURFACE_DEFAULTS } from '../core/defaults.js';
import { egcd } from '../core/intmath.js';
import { isHexagonalCell } from '../core/lattice.js';
import { coerceParam } from '../core/params.js';

const AXIS_NAMES = 'abc';
const MIDDOT = '·';
const TIMES = '×';
const DEGREES = 180 / Math.PI;

// ------------------------------------------------------------------------------------ small vector helpers
// Plain arrays and explicit sums, written the same way as the Python module (facet/build/surface.py), so that both
// languages run the same floating-point operations in the same order.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.sqrt(dot(a, a));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** coeffs @ rows: the combination Σ coeffs[i] · rows[i] of three row vectors. */
const comb = (c, rows) => [0, 1, 2].map((k) => c[0] * rows[0][k] + c[1] * rows[1][k] + c[2] * rows[2][k]);
const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
  + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
function inv3(m) {
  const d = det3(m);
  return [
    [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / d, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / d, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / d],
    [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / d, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / d, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / d],
    [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / d, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / d, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / d],
  ];
}
/** The adjugate of an integer matrix (exact). */
const iadj3 = (m) => [
  [m[1][1] * m[2][2] - m[1][2] * m[2][1], m[0][2] * m[2][1] - m[0][1] * m[2][2], m[0][1] * m[1][2] - m[0][2] * m[1][1]],
  [m[1][2] * m[2][0] - m[1][0] * m[2][2], m[0][0] * m[2][2] - m[0][2] * m[2][0], m[0][2] * m[1][0] - m[0][0] * m[1][2]],
  [m[1][0] * m[2][1] - m[1][1] * m[2][0], m[0][1] * m[2][0] - m[0][0] * m[2][1], m[0][0] * m[1][1] - m[0][1] * m[1][0]],
];
function wrap01(x) {
  const w = x - Math.floor(x);
  return w >= 1 - 1e-9 ? 0 : w;
}
const gcd2 = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const gcd3 = (v) => gcd2(gcd2(v[0], v[1]), v[2]);
const fmod = (a, b) => ((a % b) + b) % b;
/** x rounded half up to 6 decimals (the values info.surface stores); never -0. */
function r6(x) {
  const v = Math.floor(Math.abs(x) * 1e6 + 0.5) / 1e6;
  return x >= 0 || v === 0 ? v : -v;
}
/** Two decimals, halves up: '1.07', '-0.50'. */
function fmt2(x) {
  const s = Math.floor(Math.abs(x) * 100 + 0.5);
  const text = `${Math.floor(s / 100)}.${String(s % 100).padStart(2, '0')}`;
  return x >= 0 || s === 0 ? text : `-${text}`;
}
/** A number in a message: '15' for 15, '1.5' for 1.5. */
const num = (x) => String(+x);
const count = (n) => Math.round(n).toLocaleString('en-US');
const isWhole = (x) => typeof x === 'number' && Number.isFinite(x) && Number.isInteger(x);

/** 'Ti2O2': the elements in formula order (Pauling electronegativity, then symbol), counts above 1 written. */
function compFormula(comp) {
  return Object.keys(comp).sort(formulaOrder).map((e) => `${e}${comp[e] !== 1 ? comp[e] : ''}`).join('');
}
function reducedComp(comp) {
  let g = 0;
  for (const n of Object.values(comp)) g = gcd2(g, n);
  return g ? Object.fromEntries(Object.entries(comp).map(([e, n]) => [e, n / g])) : { ...comp };
}
function counts(symbols) {
  const out = {};
  for (const s of symbols) out[s] = (out[s] ?? 0) + 1;
  return out;
}
/** '(111)', '(10-10)'; indices above 9 are spaced: '(1 1 12)'. */
const millerToken = (idx) => `(${idx.map((x) => String(x + 0)).join(idx.every((x) => Math.abs(x) <= 9) ? '' : ' ')})`;
const millerSpaced = (idx) => `(${idx.map((x) => String(x + 0)).join(' ')})`;

// ------------------------------------------------------------------------------------ integer bases of a plane
/**
 * Integer rows [v1, v2, v3] with v1·hkl = v2·hkl = 0, v3·hkl = 1 and det = handedness (M2 §3.3); hkl are coprime.
 * v1 and v2 span the lattice plane and v3 is one stacking step, so a × b of the surface cell points to the +hkl
 * side: the top of a slab is the (hkl) face, never its mirror image.
 */
function planeBasis(hkl, handedness) {
  const [h, k, l] = hkl;
  const [g, p, q] = egcd(k, l);
  let v1, v2, v3;
  if (g === 0) { v1 = [0, 1, 0]; v2 = [0, 0, 1]; v3 = [h, 0, 0]; }
  else {
    const [, x, y] = egcd(g, h);
    v1 = [g, -p * h, -q * h]; v2 = [0, l / g, -k / g]; v3 = [y, x * p, x * q];
  }
  if (det3([v1, v2, v3]) !== handedness) v1 = v1.map((t) => -t);
  return [v1, v2, v3].map((v) => v.map((t) => t + 0));
}

/**
 * The reduced in-plane basis [u, v, M] of the net spanned by a and b: [u; v] = M @ [a; b], det M = 1. Gauss
 * reduction, then the obtuse convention (γ from 90° to 120°): at the tie |u·v| = |u|²/2 (a hexagonal 60° pair and
 * every centred rectangular net) u is kept and v becomes v − u; any other acute pair becomes (v, −u); u then points
 * along a rather than against it. The handedness of the pair is kept.
 */
function gaussReduce2d(a, b) {
  const tau = SURFACE_DEFAULTS.gaussTolerance;
  let u = a.map(Number), v = b.map(Number);
  let M = [[1, 0], [0, 1]];
  for (let it = 0; it < 10000; it++) {
    if (dot(u, u) > dot(v, v) * (1 + tau)) {
      [u, v] = [v, [-u[0], -u[1], -u[2]]];
      M = [M[1], [-M[0][0], -M[0][1]]];
    }
    const x = dot(u, v) / dot(u, u);
    let mu = 0;
    if (Math.abs(x) > 0.5 + tau) {
      mu = Math.floor(Math.abs(x) + 0.5 - tau);
      if (x < 0) mu = -mu;
    }
    if (mu === 0) break;
    v = [v[0] - mu * u[0], v[1] - mu * u[1], v[2] - mu * u[2]];
    M = [M[0], [M[1][0] - mu * M[0][0], M[1][1] - mu * M[0][1]]];
  }
  const d = dot(u, v);
  if (d > tau * Math.sqrt(dot(u, u)) * Math.sqrt(dot(v, v))) {
    if (Math.abs(d) >= dot(u, u) / 2 * (1 - 1e-6)) {
      v = [v[0] - u[0], v[1] - u[1], v[2] - u[2]];
      M = [M[0], [M[1][0] - M[0][0], M[1][1] - M[0][1]]];
    } else {
      [u, v] = [v, [-u[0], -u[1], -u[2]]];
      M = [M[1], [-M[0][0], -M[0][1]]];
    }
  }
  const cu = dot(u, a) / Math.sqrt(dot(u, u) * dot(a, a));
  const cv = dot(v, b) / Math.sqrt(dot(v, v) * dot(b, b));
  if (cu < -tau || (Math.abs(cu) <= tau && cv < -tau)) {
    u = [-u[0], -u[1], -u[2]]; v = [-v[0], -v[1], -v[2]];
    M = [[-M[0][0], -M[0][1]], [-M[1][0], -M[1][1]]];
  }
  return [u, v, M.map((r) => r.map((t) => t + 0))];
}

function angleDeg(u, v) {
  const c = dot(u, v) / (norm(u) * norm(v));
  return Math.acos(Math.max(-1, Math.min(1, c))) * DEGREES;
}

function meshKind(u, v, rel, deg) {
  const la = norm(u), lb = norm(v);
  const gamma = angleDeg(u, v);
  const same = Math.abs(la - lb) <= rel * Math.max(la, lb);
  if (same && Math.abs(gamma - 120) <= deg) return 'hexagonal';
  if (Math.abs(gamma - 90) <= deg) return same ? 'square' : 'rectangular';
  if (same || Math.abs(2 * Math.abs(dot(u, v)) - la * la) <= rel * la * la) return 'centred-rectangular';
  return 'oblique';
}
/** 'hexagonal', 'square', 'rectangular', 'centred-rectangular' or 'oblique' for a reduced pair. */
function meshType(u, v) {
  const kind = meshKind(u, v, 1e-3, 0.1);
  if (kind === 'centred-rectangular' || kind === 'oblique') {
    const wide = meshKind(u, v, 0.03, 2.0);
    if (wide === 'hexagonal' || wide === 'square' || wide === 'rectangular') return wide;
  }
  return kind;
}

function lateral(v, n) {
  const d = dot(v, n);
  return [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]];
}
/** The coordinates of the in-plane vector w in the basis (a1, b1). */
function solve2(a1, b1, w) {
  const aa = dot(a1, a1), ab = dot(a1, b1), bb = dot(b1, b1);
  const wa = dot(w, a1), wb = dot(w, b1);
  const det = aa * bb - ab * ab;
  return [(wa * bb - wb * ab) / det, (wb * aa - wa * ab) / det];
}
/** The shortest length of w + i·a1 + j·b1 (w in the plane of the reduced pair a1, b1). */
function mic2d(w, a1, b1) {
  const [f0, f1] = solve2(a1, b1, w);
  const i0 = Math.floor(f0 + 0.5), j0 = Math.floor(f1 + 0.5);
  let best = Infinity;
  for (const di of [-1, 0, 1]) {
    for (const dj of [-1, 0, 1]) {
      const x = [0, 1, 2].map((k) => w[k] - (i0 + di) * a1[k] - (j0 + dj) * b1[k]);
      best = Math.min(best, norm(x));
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------ the primitive cell
/**
 * The primitive cell of a crystal given in a larger cell, or null when the cell is already primitive: the pure
 * translations are searched among the vectors from the first atom of the rarest element to its other atoms (each must
 * map every atom onto an atom of the same element within tol Å), snapped to multiples of 1/m, and the three shortest
 * lattice vectors with the right volume make the new cell. Returns {cell, M, points, keep} with cell = M @ primitive
 * and one input atom per primitive site; throws when the translations do not form a lattice.
 */
function primitiveReduction(symbols, frac, cell, tol) {
  const n = symbols.length;
  const byEl = new Map();
  symbols.forEach((s, i) => { if (!byEl.has(s)) byEl.set(s, []); byEl.get(s).push(i); });
  const order = [...byEl.keys()].sort((a, b) => (byEl.get(a).length - byEl.get(b).length) || (byEl.get(a)[0] - byEl.get(b)[0]));
  const rare = byEl.get(order[0]);
  if (rare.length < 2) return null;
  const tol2 = tol * tol;
  const groups = order.map((e) => byEl.get(e));
  const C = cell;
  const maps = (t) => {
    for (const idx of groups) {
      for (const i of idx) {
        const fi = frac[i];
        let ok = false;
        for (const j of idx) {
          const fj = frac[j];
          let d0 = fi[0] + t[0] - fj[0], d1 = fi[1] + t[1] - fj[1], d2 = fi[2] + t[2] - fj[2];
          d0 -= Math.floor(d0 + 0.5); d1 -= Math.floor(d1 + 0.5); d2 -= Math.floor(d2 + 0.5);
          const x = d0 * C[0][0] + d1 * C[1][0] + d2 * C[2][0];
          const y = d0 * C[0][1] + d1 * C[1][1] + d2 * C[2][1];
          const z = d0 * C[0][2] + d1 * C[1][2] + d2 * C[2][2];
          if (x * x + y * y + z * z < tol2) { ok = true; break; }
        }
        if (!ok) return false;
      }
    }
    return true;
  };
  const found = [];
  const f0 = frac[rare[0]];
  for (const j of rare.slice(1)) {
    const t = [0, 1, 2].map((k) => wrap01(frac[j][k] - f0[k]));
    if (maps(t)) found.push(t);
  }
  if (!found.length) return null;
  const m = found.length + 1;
  if (n % m) throw new Error(`${m - 1} translations do not divide the ${n} atoms`);
  const nums = [[0, 0, 0]];
  for (const t of found) {
    const K = [0, 1, 2].map((k) => fmod(Math.floor(t[k] * m + 0.5), m));
    const d = [0, 1, 2].map((k) => { const x = t[k] - K[k] / m; return x - Math.floor(x + 0.5); });
    if (norm(comb(d, cell)) > tol) throw new Error('a translation is not a simple fraction of the cell');
    nums.push(K);
  }
  const cands = [];
  for (const K of nums) {
    for (const i of [-1, 0, 1]) {
      for (const j of [-1, 0, 1]) {
        for (const k of [-1, 0, 1]) {
          const v = [K[0] + i * m, K[1] + j * m, K[2] + k * m];
          if (v[0] === 0 && v[1] === 0 && v[2] === 0) continue;
          const r = comb([v[0] / m, v[1] / m, v[2] / m], cell);
          cands.push([Math.floor(dot(r, r) * 1e6 + 0.5), -v[0], -v[1], -v[2]]);
        }
      }
    }
  }
  cands.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]) || (a[3] - b[3]));
  const vecs = cands.map((c) => [-c[1], -c[2], -c[3]].map((x) => x + 0));
  const v1 = vecs[0];
  const v2 = vecs.find((v) => cross(v1, v).some((x) => x !== 0)) ?? null;
  let v3 = null;
  if (v2) {
    for (const v of vecs) {
      const d = det3([v1, v2, v]);
      if (Math.abs(d) === m * m) { v3 = d > 0 ? v : v.map((x) => -x + 0); break; }
    }
  }
  if (!v3) throw new Error('no primitive cell was found among the translations');
  const K3 = [v1, v2, v3];
  const adj = iadj3(K3);
  if (adj.some((row) => row.some((x) => fmod(x, m) !== 0))) throw new Error('the translations do not form a lattice');
  const M = adj.map((row) => row.map((x) => x / m + 0));   // cell = M @ primitive
  const P = K3.map((v) => comb([v[0] / m, v[1] / m, v[2] / m], cell));
  // one atom per primitive site
  const FP = frac.map((f) => [0, 1, 2].map((k) => { const x = f[0] * M[0][k] + f[1] * M[1][k] + f[2] * M[2][k]; return x - Math.floor(x); }));
  const keep = [];
  const keptByEl = new Map();
  const lim2 = (2 * tol) * (2 * tol);
  for (let i = 0; i < n; i++) {
    if (!keptByEl.has(symbols[i])) keptByEl.set(symbols[i], []);
    const mine = keptByEl.get(symbols[i]);
    let twin = false;
    for (const j of mine) {
      let d0 = FP[j][0] - FP[i][0], d1 = FP[j][1] - FP[i][1], d2 = FP[j][2] - FP[i][2];
      d0 -= Math.floor(d0 + 0.5); d1 -= Math.floor(d1 + 0.5); d2 -= Math.floor(d2 + 0.5);
      const r = comb([d0, d1, d2], P);
      if (dot(r, r) < lim2) { twin = true; break; }
    }
    if (twin) continue;
    mine.push(i);
    keep.push(i);
  }
  if (keep.length * m !== n) throw new Error(`${keep.length} sites were found where ${n / m} were expected`);
  return { cell: P, M, points: m, keep };
}

// ------------------------------------------------------------------------------------ bonds
/**
 * Every bond of the periodic crystal once, [i, j, v] with v = r_j + image − r_i, and the shortest distance between
 * two atoms. A pair is bonded when its distance lies between bondMin and min(bondMax, bondScale · (r_i + r_j))
 * (covalent radii); a metal–metal pair is left out when both metals also bond to a non-metal anion.
 */
function bondsAndDmin(symbols, cart, cell) {
  const D = SURFACE_DEFAULTS;
  const n = symbols.length;
  const els = [...new Set(symbols)].sort();
  const cov = Object.fromEntries(els.map((e) => [e, covalentRadius(e)]));
  let cutMax = -Infinity;
  for (const a of els) for (const b of els) cutMax = Math.max(cutMax, Math.min(D.bondMax, D.bondScale * (cov[a] + cov[b])));
  const vol = Math.abs(det3(cell));
  const reach = [0, 1, 2].map((k) => Math.ceil(cutMax / (vol / norm(cross(cell[(k + 1) % 3], cell[(k + 2) % 3])))) + 1);
  const radii = symbols.map((s) => cov[s]);
  const edges = [];
  let dMin = Infinity;
  for (let la = -reach[0]; la <= reach[0]; la++) {
    for (let lb = -reach[1]; lb <= reach[1]; lb++) {
      for (let lc = -reach[2]; lc <= reach[2]; lc++) {
        const shift = comb([la, lb, lc], cell);
        const positive = la > 0 || (la === 0 && (lb > 0 || (lb === 0 && lc > 0)));
        for (let i = 0; i < n; i++) {
          for (let j = positive ? i : i + 1; j < n; j++) {
            const v = [cart[j][0] + shift[0] - cart[i][0], cart[j][1] + shift[1] - cart[i][1], cart[j][2] + shift[2] - cart[i][2]];
            const dist = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
            if (dist < dMin) dMin = dist;
            if (dist > D.bondMin && dist < Math.min(D.bondMax, D.bondScale * (radii[i] + radii[j]))) edges.push([i, j, v]);
          }
        }
      }
    }
  }
  const nonmetal = new Set([...ANIONS].filter((e) => !METALS.has(e)));
  const tied = new Set();
  for (const [i, j] of edges) {
    if (METALS.has(symbols[i]) && nonmetal.has(symbols[j])) tied.add(i);
    if (METALS.has(symbols[j]) && nonmetal.has(symbols[i])) tied.add(j);
  }
  const bonds = edges.filter(([i, j]) => !(METALS.has(symbols[i]) && METALS.has(symbols[j]) && tied.has(i) && tied.has(j)));
  return { bonds, dMin };
}

// ------------------------------------------------------------------------------------ the analysis
const QF = [[-1, 1, 1], [1, -1, 1], [1, 1, -1]];
const QI = [[0, 1, 1], [1, 0, 1], [1, 1, 0]];
const QR = [[1, -1, 0], [0, 1, -1], [1, 1, 1]];
const QC = [[1, 1, 0], [-1, 1, 0], [0, 0, 1]];
/** [Pearson symbol, matrix to the conventional cell, the kind of cell that matrix must give], tried in this order. */
const CENTRED = [['cF', QF, 'cubic'], ['cI', QI, 'cubic'], ['hR', QR, 'hexagonal'], ['tI', QI, 'tetragonal'],
  ['oF', QF, 'orthorhombic'], ['oI', QI, 'orthorhombic'], ['oC', QC, 'orthorhombic'], ['mC', QC, 'monoclinic']];

/** 'cubic', 'tetragonal', 'orthorhombic', 'hexagonal' (γ = 120°), 'monoclinic' or null, from lengths and angles alone. */
function cellKind(cell) {
  const rel = 1e-3, deg = 0.1;
  const a = norm(cell[0]), b = norm(cell[1]), c = norm(cell[2]);
  const al = angleDeg(cell[1], cell[2]), be = angleDeg(cell[0], cell[2]), ga = angleDeg(cell[0], cell[1]);
  const eq = (x, y) => Math.abs(x - y) <= rel * Math.max(x, y);
  const right = (x) => Math.abs(x - 90) <= deg;
  if (right(al) && right(be) && right(ga)) {
    if (eq(a, b) && eq(b, c)) return 'cubic';
    return eq(a, b) ? 'tetragonal' : 'orthorhombic';
  }
  if (right(al) && right(be) && Math.abs(ga - 120) <= deg && eq(a, b)) return 'hexagonal';
  if (right(al) && right(ga)) return 'monoclinic';
  return null;
}

/**
 * Whether `cell` is the standard primitive cell of a centred lattice: {kind, toConventional} or null. `kind` is the
 * Pearson symbol of the lattice (cF, cI, hR, tI, oF, oI, oC, mC) and `toConventional` the integer matrix Q with
 * conventional = Q @ cell: the primitive settings that Materials Project, spglib and ASE write. Judged from the
 * lengths and angles alone; a cell that already looks cubic, tetragonal, orthorhombic or hexagonal gives null.
 * Python: conventional_cell_hint.
 */
export function conventionalCellHint(cell) {
  const rows = cell.map((r) => r.map(Number));
  const kind = cellKind(rows);
  if (kind === 'cubic' || kind === 'hexagonal' || kind === 'tetragonal' || kind === 'orthorhombic') return null;
  for (const [name, Q, target] of CENTRED) {
    if (cellKind(Q.map((q) => comb(q, rows))) === target) return { kind: name, toConventional: Q.map((q) => [...q]) };
  }
  return null;
}

function millerIndices(miller, cell, basis = 'input') {
  if (basis !== 'input' && basis !== 'conventional') throw new Error("miller_basis must be 'input' or 'conventional'");
  let hkl;
  try { hkl = coerceParam({ type: 'miller', name: 'miller' }, miller); }
  catch (e) {
    const text = String(e?.message ?? e).replace(/^miller: /, '');
    throw new Error(text.replace(/\.$/, ''));
  }
  if (hkl == null) throw new Error('enter three whole numbers h k l');
  const given = Array.from(miller, (x) => x + 0);
  const hex = isHexagonalCell(cell);
  const hex120 = !!hex && hex.axis === 2 && hex.gamma === 120;
  const hint = conventionalCellHint(cell);
  const convHex = !!hint && hint.kind === 'hR';
  if (basis === 'conventional' && !hint) {
    throw new Error('conventional indices need a standard primitive cell of a centred lattice; this cell is not one, so enter indices for this cell');
  }
  if (given.length === 4 && !(basis === 'conventional' ? convHex : hex120)) {
    throw new Error('four-index (h k i l) notation needs a hexagonal cell with γ = 120°');
  }
  const g = gcd3(hkl);
  const notes = [];
  let red = hkl.map((x) => x / g + 0);
  if (g > 1) notes.push(`${millerSpaced(hkl)} was reduced to ${millerSpaced(red)}`);
  let conv = null;
  if (hint) {
    const Q = hint.toConventional;
    if (basis === 'conventional') {
      conv = red;
      const adj = iadj3(Q);
      const v = [0, 1, 2].map((i) => adj[i][0] * conv[0] + adj[i][1] * conv[1] + adj[i][2] * conv[2]);
      const gv = gcd3(v);
      red = v.map((x) => x / gv + 0);
    } else {
      const v = [0, 1, 2].map((i) => Q[i][0] * red[0] + Q[i][1] * red[1] + Q[i][2] * red[2]);
      const gv = gcd3(v);
      conv = v.map((x) => x / gv + 0);
    }
  }
  let hkil = null;
  if (hex120) hkil = [red[0], red[1], -(red[0] + red[1]) + 0, red[2]];
  else if (convHex && conv) hkil = [conv[0], conv[1], -(conv[0] + conv[1]) + 0, conv[2]];
  return { miller: red, given, hkil, conventional: hint, millerConventional: conv, notes };
}

function checkBulk(bulk) {
  if (!bulk || !Array.isArray(bulk.symbols)) throw new TypeError('cleaving needs a Structure');
  if (!bulk.cell) throw new Error('cleaving needs a periodic crystal with a unit cell');
  if (!bulk.pbc.every(Boolean)) {
    const on = [0, 1, 2].filter((k) => bulk.pbc[k]).map((k) => AXIS_NAMES[k]);
    const which = on.length ? `this one is periodic along ${on.join(' and ')} only` : 'it is not periodic';
    throw new Error(`cleaving needs a structure that is periodic along a, b and c (${which})`);
  }
  const limit = SURFACE_DEFAULTS.maxCleaveBulkAtoms;
  if (bulk.length > limit) throw new Error(`cleaving supports bulk cells with up to ${count(limit)} atoms (this one has ${count(bulk.length)})`);
  if (bulk.length === 0) throw new Error('cleaving needs a crystal with atoms');
}

/** How many of the planes zCut + n·h lie strictly between zLo and zHi. */
function crossings(zLo, zHi, zCut, h) {
  const lo = Math.min(zLo, zHi), hi = Math.max(zLo, zHi);
  return Math.max(0, Math.ceil((hi - zCut) / h - 1e-12) - Math.floor((lo - zCut) / h + 1e-12) - 1);
}

/** The index after the widest circular gap of the sorted heights zs (the first of equal gaps). */
function ringStart(zs, h) {
  const n = zs.length;
  let best = -Infinity, at = 0;
  for (let k = 0; k < n; k++) {
    const gap = (zs[(k + 1) % n] + (k === n - 1 ? h : 0)) - zs[k] - 1e-9 * k;
    if (gap > best) { best = gap; at = k; }
  }
  return (at + 1) % n;
}

/**
 * What cleaving a crystal along one lattice plane gives: the result of surfaceAnalysis (Python: SurfaceAnalysis).
 * Fields (Å, degrees): miller (three coprime integers of the input cell), millerInput, millerBasis, hkil,
 * conventional, millerConventional, normal, mesh {a, b, gamma, area, type}, period, layersPerPeriod, layers (one
 * period, bottom to top: {index, composition, formula, z, min, max, gapAbove, charge, atoms, sublayers}), cuts
 * ({index, layer, z, gap, brokenBonds, dipole, polar, termination}; `layer` is the layer just below the cut, the top
 * layer of a slab cut there), terminations (the inequivalent cuts, best first: {index, label, cut, cuts,
 * composition, below, brokenBonds, polar}), tasker (1, 2, 3 or null), charges, chargesSource, layerTolerance,
 * layerGrouping, dMin, primitive, translationTolerance, notes and warnings. toJSON() gives the plain data.
 */
export class SurfaceAnalysis {
  constructor() { this.notes = []; this.warnings = []; }

  toJSON() {
    return {
      miller: [...this.miller], millerInput: [...this.millerInput], millerBasis: this.millerBasis,
      millerConventional: this.millerConventional ? [...this.millerConventional] : null,
      conventional: this.conventional ? { kind: this.conventional.kind, toConventional: this.conventional.toConventional.map((r) => [...r]) } : null,
      hkil: this.hkil ? [...this.hkil] : null,
      primitive: this.primitive, translationTolerance: this.translationTolerance,
      normal: this.normal.map(r6), period: r6(this.period), layersPerPeriod: this.m,
      mesh: { a: r6(this.mesh.a), b: r6(this.mesh.b), gamma: r6(this.mesh.gamma), area: r6(this.mesh.area), type: this.mesh.type },
      layerTolerance: r6(this.layerTolerance), layerGrouping: this.layerGrouping,
      tasker: this.tasker, charges: this.charges ? { ...this.charges } : null, chargesSource: this.chargesSource,
      dMin: r6(this.dMin), atomsPerCell: this.symbols.length, bulkAtoms: this.bulkAtoms,
      layers: this.layers.map((L) => ({ ...L, composition: { ...L.composition } })),
      cuts: this.cuts.map((c) => ({ ...c })),
      terminations: this.terminations.map((t) => ({ ...t, cuts: [...t.cuts], composition: { ...t.composition }, below: { ...t.below } })),
      notes: [...this.notes], warnings: [...this.warnings],
    };
  }

  get layersPerPeriod() { return this.m; }

  // -- stacking: layer J = k + q·m is layer k of the ring, q periods up
  _Z(J) { return this._lay[fmod(J, this.m)].mean + Math.floor(J / this.m) * this.period; }
  _zmin(J) { return this._lay[fmod(J, this.m)].min + Math.floor(J / this.m) * this.period; }
  _zmax(J) { return this._lay[fmod(J, this.m)].max + Math.floor(J / this.m) * this.period; }

  /** The atoms of layer J: [index in the oriented cell, position in the bulk's Cartesian frame]. */
  _atomsOf(J) {
    const L = this._lay[fmod(J, this.m)];
    const q = Math.floor(J / this.m);
    return L.members.map((i, t) => {
      const shift = Math.floor((L.zs[t] - this.z[i]) / this.period + 0.5) + q;
      return [i, [0, 1, 2].map((k) => this.r[i][k] + shift * this.c0[k])];
    });
  }

  /**
   * What a face looks like from outside, layer by layer for one period: composition, depth and, for every atom, its
   * in-plane distance to the nearest atom of each element of the outermost layer.
   */
  _fingerprint(J0, sign) {
    const top = this._atomsOf(J0);
    const elements = [...new Set(top.map(([i]) => this.symbols[i]))].sort();
    const fp = [];
    for (let j = 0; j < this.m; j++) {
      const J = J0 + sign * j;
      const atoms = this._atomsOf(J);
      const depth = Math.abs(this._Z(J) - this._Z(J0));
      const c = counts(atoms.map(([i]) => this.symbols[i]));
      const comp = Object.keys(c).sort().map((e) => `${e}:${c[e]}`).join(',');
      const rows = atoms.map(([i, r], ia) => {
        const lam = elements.map((el) => {
          let best = Infinity;
          top.forEach(([i2, r2], it) => {
            if (this.symbols[i2] !== el) return;
            const w = lateral(sub(r, r2), this.normal);
            let d = mic2d(w, this.a1, this.b1);
            if (j === 0 && it === ia && d < 1e-9) {   // the atom itself: its nearest image
              d = Infinity;
              for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) if (x || y) d = Math.min(d, norm([0, 1, 2].map((k) => w[k] + x * this.a1[k] + y * this.b1[k])));
            }
            best = Math.min(best, d);
          });
          return best;
        });
        return [this.symbols[i], lam];
      });
      fp.push([comp, depth, rows]);
    }
    return fp;
  }

  static _same(fa, fb, level = 2) {
    const tol = SURFACE_DEFAULTS.matchTolerance;
    if (fa.length !== fb.length) return false;
    for (let t = 0; t < fa.length; t++) {
      const [ca, da, Da] = fa[t], [cb, db, Db] = fb[t];
      if (ca !== cb || Math.abs(da - db) > tol) return false;
      if (level === 2) {
        if (Da.length !== Db.length) return false;
        // each atom of one layer must find its own partner in the other (the lists are matched, not compared in order)
        const free = [...Db];
        for (const [sa, la] of Da) {
          const hit = free.findIndex(([sb, lb]) => sa === sb && la.every((x, q) => Math.abs(x - lb[q]) <= tol));
          if (hit < 0) return false;
          free.splice(hit, 1);
        }
      }
    }
    return true;
  }

  _match(fa, fb) { return SurfaceAnalysis._same(fa, fb, 1) && SurfaceAnalysis._same(fa, fb, 2); }

  /** The label of the bottom face of an L-layer slab whose top is cut k. */
  _bottomLabel(k, L) {
    const m = this.m;
    const fb = this._fingerprint(k - L + 1, +1);
    for (const c of this._classes) if (this._match(this._fps[c.rep], fb)) return c.label;
    const faces = [];
    for (let kk = 0; kk < m; kk++) {
      const f = this._fingerprint(kk + 1, +1);
      if (!faces.some(([g]) => this._match(f, g))) faces.push([f, kk + 1]);
    }
    const bases = faces.map(([, b]) => compFormula(this._lay[fmod(b, m)].composition));
    const mine = faces.findIndex(([g]) => this._match(fb, g));
    const twins = bases.map((b, i) => i).filter((i) => bases[i] === bases[mine]);
    if (twins.length === 1) return bases[mine];
    const ext = twins.map((i) => `${bases[i]}${MIDDOT}${compFormula(this._lay[fmod(faces[i][1] + 1, m)].composition)}`);
    if (new Set(ext).size === ext.length) return ext[twins.indexOf(mine)];
    const n = twins.indexOf(mine);
    return bases[mine] + (twins.length <= 26 ? `-${String.fromCharCode(65 + n)}` : `-${n + 1}`);
  }

  /** The smallest number of layers from L0 on whose bottom face matches the top face of cut k, or null. */
  _symmetricLayers(k, L0) {
    for (let e = 0; e < this.m; e++) {
      const L = L0 + e;
      if (this._match(this._fps[k], this._fingerprint(k - L + 1, +1))) return L;
    }
    return null;
  }
}

function findPlanes(an, layerTolerance) {
  const D = SURFACE_DEFAULTS;
  const h = an.period;
  let tries;
  if (layerTolerance != null) {
    const tau = Number(layerTolerance);
    if (!(Number.isFinite(tau) && tau >= 0.01 && tau <= 2)) throw new Error('layer_tolerance must be between 0.01 and 2 Å');
    tries = [tau];
  } else tries = [D.planeResolution, D.planeResolutionMin];
  const n = an.z.length;
  const order = an.z.map((_, i) => i).sort((a, b) => (an.z[a] - an.z[b]) || (a - b));
  const zs = order.map((i) => an.z[i]);
  const start = ringStart(zs, h);
  const seq = [];
  for (let t = 0; t < n; t++) seq.push([order[(start + t) % n], zs[(start + t) % n] + (start + t >= n ? h : 0)]);
  for (const res of tries) {
    const planes = [];
    let cur = [seq[0]];
    for (let t = 1; t < n; t++) {
      if (seq[t][1] - seq[t - 1][1] > res) { planes.push(cur); cur = [seq[t]]; } else cur.push(seq[t]);
    }
    planes.push(cur);
    const last = planes.at(-1);
    if (last.at(-1)[1] - planes[0][0][1] < h - res) {
      an._planes = planes.map((p) => ({ members: p.map(([i]) => i), zs: p.map(([, z]) => z) }));
      let inner = 0;
      for (const p of an._planes) for (let t = 1; t < p.zs.length; t++) inner = Math.max(inner, p.zs[t] - p.zs[t - 1]);
      an._inner = inner;
      an._resolution = res;
      return;
    }
  }
  let closest = h;
  for (let t = 1; t < n; t++) closest = Math.min(closest, seq[t][1] - seq[t - 1][1]);
  closest = Math.min(closest, seq[0][1] + h - seq[n - 1][1]);
  throw new Error(`no separate atomic layers along ${millerSpaced(an.miller)} even at ${num(tries.at(-1))} Å: the closest atoms are ${fmt2(closest)} Å apart along the normal; give a layer tolerance below ${fmt2(Math.max(closest, 0.02))} Å`);
}

function findLayers(an, layerTolerance) {
  const D = SURFACE_DEFAULTS;
  const h = an.period, P = an._planes;
  const m = P.length;
  const loHi = P.map((p) => [Math.min(...p.zs), Math.max(...p.zs)]);
  const gaps = loHi.map((_, k) => (loHi[(k + 1) % m][0] + (k === m - 1 ? h : 0)) - loHi[k][1]);
  const zCut = gaps.map((g, k) => loHi[k][1] + g / 2);
  const allMetal = Object.keys(an.composition).every((e) => METALS.has(e));
  const nonmetal = new Set([...ANIONS].filter((e) => !METALS.has(e)));
  const flags = new Array(m).fill(false);
  if (layerTolerance == null && !allMetal && m > 1) {
    for (let k = 0; k < m; k++) {
      if (gaps[k] >= D.sublayerGap) continue;
      let best = null;
      for (const [i, j, v] of an._bonds) {
        if (nonmetal.has(an.symbols[i]) === nonmetal.has(an.symbols[j])) continue;
        const zi = dot(an.primCart[i], an.normal);
        const vz = dot(v, an.normal);
        if (crossings(zi, zi + vz, zCut[k], h)) {
          const tilt = Math.asin(Math.min(1, Math.abs(vz) / norm(v))) * DEGREES;
          best = best === null ? tilt : Math.min(best, tilt);
        }
      }
      flags[k] = best !== null && best < D.sublayerTilt;
    }
  }
  let merged = flags.some(Boolean) && !flags.every(Boolean);
  let lo = 0, hi = 0;
  if (merged) {
    lo = Math.max(Math.max(...gaps.filter((_, k) => flags[k])), an._inner) + D.layerToleranceMargin;
    hi = Math.min(...gaps.filter((_, k) => !flags[k])) - D.layerToleranceMargin;
    merged = lo <= hi;
  }
  let groups;
  if (merged) {
    let kbest = 0, gbest = -Infinity;
    for (let k = 0; k < m; k++) if (!flags[k] && gaps[k] > gbest) { kbest = k; gbest = gaps[k]; }
    const start = (kbest + 1) % m;
    groups = [];
    let cur = [[start, 0]];
    for (let t = 1; t < m; t++) {
      const k = (start + t) % m;
      const item = [k, start + t >= m ? h : 0];
      if (flags[fmod(k - 1, m)]) cur.push(item); else { groups.push(cur); cur = [item]; }
    }
    groups.push(cur);
    an.layerTolerance = Math.min(Math.max(D.layerTolerance, lo), hi);
    an.layerGrouping = 'merged';
  } else {
    groups = P.map((_, k) => [[k, 0]]);
    if (layerTolerance != null) { an.layerTolerance = Number(layerTolerance); an.layerGrouping = 'explicit'; }
    else {
      lo = an._inner + D.layerToleranceMargin; hi = Math.min(...gaps) - D.layerToleranceMargin;
      an.layerTolerance = lo <= hi ? Math.min(Math.max(D.layerTolerance, lo), hi) : (an._inner + Math.min(...gaps)) / 2;
      an.layerGrouping = 'planes';
    }
  }
  const q = an.charges;
  const layers = groups.map((grp) => {
    const members = [], zs = [];
    for (const [k, shift] of grp) { members.push(...P[k].members); zs.push(...P[k].zs.map((z) => z + shift)); }
    let sum = 0;
    for (const z of zs) sum += z;
    let charge = null;
    if (q) { charge = 0; for (const i of members) charge += q[an.symbols[i]]; }
    return { members, zs, min: Math.min(...zs), max: Math.max(...zs), mean: sum / zs.length,
      composition: counts(members.map((i) => an.symbols[i])), sublayers: grp.length, charge };
  });
  const base = Math.floor(layers[0].min / h + 1e-12);
  if (base) {
    for (const L of layers) {
      L.zs = L.zs.map((z) => z - base * h);
      L.min -= base * h; L.max -= base * h; L.mean -= base * h;
    }
  }
  an._lay = layers;
  an.m = layers.length;
}

function findCuts(an) {
  const m = an.m, h = an.period;
  an._gapsAbove = []; an._zCut = []; an._broken = [];
  for (let k = 0; k < m; k++) {
    an._gapsAbove.push(an._zmin(k + 1) - an._zmax(k));
    an._zCut.push((an._zmax(k) + an._zmin(k + 1)) / 2);
  }
  for (let k = 0; k < m; k++) {
    let n = 0;
    for (const [i, , v] of an._bonds) {
      const zi = dot(an.primCart[i], an.normal);
      n += crossings(zi, zi + dot(v, an.normal), an._zCut[k], h);
    }
    an._broken.push(n);
  }
  if (!an.charges) {
    an._dipole = new Array(m).fill(null); an._polar = new Array(m).fill(null); an.tasker = null;
    return;
  }
  const sig = an._lay.map((L) => L.charge);
  an._dipole = [];
  for (let k = 0; k < m; k++) {
    let mu = 0;
    for (let j = 0; j < m; j++) mu += sig[fmod(k - j, m)] * (an._Z(k - j) - an._Z(k));
    an._dipole.push(mu);
  }
  an._polar = an._dipole.map((mu) => Math.abs(mu) / an.area > SURFACE_DEFAULTS.polarThreshold);
  if (sig.every((s) => Math.abs(s) <= 1e-6)) an.tasker = 1;
  else if (!an._polar.every(Boolean)) an.tasker = 2;
  else an.tasker = 3;
}

function findClasses(an) {
  const m = an.m;
  const fps = [];
  for (let k = 0; k < m; k++) fps.push(an._fingerprint(k, -1));
  an._fps = fps;
  const parent = fps.map((_, k) => k);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      if (an._match(fps[a], fps[b])) {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
      }
    }
  }
  const groups = new Map();
  for (let k = 0; k < m; k++) { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k); }
  const q = an.charges;
  const classes = [];
  for (const cuts of groups.values()) {
    const rep = Math.min(...cuts);
    const top = an._lay[rep];
    const qs = q ? top.members.map((i) => q[an.symbols[i]]) : [];
    let qmax = 0, nanion = 0;
    for (const x of qs) { if (x > 0) qmax = Math.max(qmax, x); if (x < 0) nanion++; }
    classes.push({ cuts: [...cuts].sort((a, b) => a - b), rep, polar: an._polar[rep], broken: an._broken[rep], qmax, nanion,
      top: top.composition, below: an._lay[fmod(rep - 1, m)].composition });
  }
  classes.sort((a, b) => ((a.polar ? 1 : 0) - (b.polar ? 1 : 0)) || (a.broken - b.broken) || (b.qmax - a.qmax) || (b.nanion - a.nanion) || (a.rep - b.rep));
  // labels: the top layer's composition; twins add the layer below, then -A, -B, ...
  const bases = classes.map((c) => compFormula(c.top));
  const labels = [...bases];
  for (const base of new Set(bases)) {
    const idx = bases.map((b, i) => i).filter((i) => bases[i] === base);
    if (idx.length === 1) continue;
    const ext = idx.map((i) => `${base}${MIDDOT}${compFormula(classes[i].below)}`);
    if (new Set(ext).size === ext.length) idx.forEach((i, t) => { labels[i] = ext[t]; });
    else idx.forEach((i, n) => { labels[i] = base + (idx.length <= 26 ? `-${String.fromCharCode(65 + n)}` : `-${n + 1}`); });
  }
  classes.forEach((c, i) => { c.label = labels[i]; });
  an._classes = classes;
  const ofCut = new Map();
  classes.forEach((c, t) => { for (const k of c.cuts) ofCut.set(k, t); });
  an.layers = an._lay.map((L, k) => ({ index: k, composition: { ...L.composition }, formula: compFormula(L.composition),
    z: r6(L.mean), min: r6(L.min), max: r6(L.max), gapAbove: r6(an._gapsAbove[k]),
    charge: L.charge === null ? null : r6(L.charge), atoms: L.members.length, sublayers: L.sublayers }));
  an.cuts = fps.map((_, k) => ({ index: k, layer: k, z: r6(an._zCut[k]), gap: r6(an._gapsAbove[k]), brokenBonds: an._broken[k],
    dipole: an._dipole[k] === null ? null : r6(an._dipole[k]), polar: an._polar[k], termination: ofCut.get(k) }));
  an.terminations = classes.map((c, t) => ({ index: t, label: c.label, cut: c.rep, cuts: [...c.cuts], composition: { ...c.top },
    below: { ...c.below }, brokenBonds: c.broken, polar: c.polar }));
  if (classes.length === 2) {
    const [a, b] = classes;
    if (an._bottomLabel(a.rep, m) === b.label && an._bottomLabel(b.rep, m) === a.label) {
      an.notes.push(`for a whole number of periods, the ${a.label} and ${b.label} choices give the same slab upside down`);
    }
  }
}

/** The fractional coordinates (wrapped) and the cell of a structure's current frame, as plain arrays. */
function bulkData(bulk) {
  const cell = bulk.cell.map((r) => r.map(Number));
  const inv = inv3(cell);
  const p = bulk.positions;
  const frac = [];
  for (let i = 0; i < bulk.length; i++) frac.push(comb([p[3 * i], p[3 * i + 1], p[3 * i + 2]], inv).map(wrap01));
  return { cell, inv, frac };
}

/**
 * Describe the surface that cleaving `bulk` along the plane `miller` gives (nothing is built): a SurfaceAnalysis.
 * `bulk` is a crystal periodic along a, b and c; `miller` three integers (h, k, l) of its cell, or four (h, k, i, l)
 * on a hexagonal cell with γ = 120°; with `millerBasis: 'conventional'` on the standard primitive cell of a centred
 * lattice (conventionalCellHint) the indices are those of the conventional cell instead. Options: `primitive`
 * (default true: reduce a conventional cell or supercell to its primitive cell first, so that the surface cell is the
 * smallest one), `translationTolerance` (0.05 Å), `layerTolerance` (Å: atoms closer than it along the normal share a
 * layer; default: planes within 0.1 Å, and planes less than 0.45 Å apart joined by a nearly flat cation–anion bond
 * are one rumpled layer) and `charges` (formal charges per element; default estimateOxidationStates). The
 * terminations come best first: non-polar before polar, then fewest broken bonds, then the highest cation valence and
 * the most anions in the top layer. Needs loadOxidationStates() once unless `charges` is given. The same results as
 * Python's surface_analysis.
 */
export function surfaceAnalysis(bulk, { miller, millerBasis = 'input', primitive = true, translationTolerance = null, layerTolerance = null, charges = null } = {}) {
  const D = SURFACE_DEFAULTS;
  checkBulk(bulk);
  const { cell, inv: invC, frac } = bulkData(bulk);
  const an = new SurfaceAnalysis();
  const mi = millerIndices(miller, bulk.cell, millerBasis);
  an.miller = mi.miller; an.millerInput = mi.given; an.hkil = mi.hkil;
  an.millerBasis = millerBasis; an.conventional = mi.conventional; an.millerConventional = mi.millerConventional;
  an.notes.push(...mi.notes);
  an.primitive = !!primitive;
  const tol = translationTolerance == null ? D.translationTolerance : Number(translationTolerance);
  if (!(Number.isFinite(tol) && tol > 0 && tol <= 1)) throw new Error('translation_tolerance must be between 0 and 1 Å');
  an.translationTolerance = tol;
  const symbolsIn = [...bulk.symbols];
  an.bulkAtoms = symbolsIn.length;
  // the primitive cell: P, the integer M with cell = M @ P, and one atom per primitive site
  let P = cell, M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], keep = symbolsIn.map((_, i) => i);
  if (primitive) {
    if (symbolsIn.length > D.maxPrimitiveSearchAtoms) {
      an.warnings.push(`the primitive-cell search was skipped for a cell of more than ${count(D.maxPrimitiveSearchAtoms)} atoms; the input cell was used`);
    } else {
      let red = null;
      try { red = primitiveReduction(symbolsIn, frac, cell, tol); }
      catch (e) { an.warnings.push(`the primitive-cell search failed (${e.message}); the input cell was used`); }
      if (red) {
        ({ cell: P, M, keep } = red);
        an.notes.push(`the ${symbolsIn.length}-atom input cell was reduced to its ${keep.length}-atom primitive cell; turn off Minimal surface cell to keep the input cell (for example for magnetic order set in INCAR)`);
      }
    }
  }
  if (keep.length > D.maxCleaveCellAtoms) {
    throw new Error(`the cell has ${count(keep.length)} atoms after reduction to the primitive cell; cleaving supports up to ${count(D.maxCleaveCellAtoms)}`);
  }
  an.points = symbolsIn.length / keep.length;
  an.keep = keep;
  an.symbols = keep.map((i) => symbolsIn[i]);
  // the plane in the primitive basis: adj(M) @ hkl (M has a positive determinant)
  const adj = iadj3(M);
  const v = [0, 1, 2].map((i) => adj[i][0] * an.miller[0] + adj[i][1] * an.miller[1] + adj[i][2] * an.miller[2]);
  const g = gcd3(v);
  const hklP = v.map((x) => x / g + 0);
  const G = [0, 1, 2].map((k) => an.miller[0] * invC[k][0] + an.miller[1] * invC[k][1] + an.miller[2] * invC[k][2]);
  const gn = norm(G);
  an.normal = G.map((x) => x / gn);
  const handed = det3(P) > 0 ? 1 : -1;
  const [v1, v2, v3] = planeBasis(hklP, handed);
  const A1 = comb(v1, P), B1 = comb(v2, P), V3 = comb(v3, P);
  const [a1, b1] = gaussReduce2d(A1, B1);
  an.a1 = a1; an.b1 = b1;
  // c0: the stacking vector with the smallest in-plane part
  const lat3 = lateral(V3, an.normal);
  const [f0, f1] = solve2(a1, b1, lat3);
  let best = Infinity, bi = 0, bj = 0;
  for (const di of [0, 1]) {
    for (const dj of [0, 1]) {
      const i = Math.floor(f0) + di, j = Math.floor(f1) + dj;
      const d = norm([0, 1, 2].map((k) => lat3[k] - i * a1[k] - j * b1[k]));
      if (d < best - 1e-9) { best = d; bi = i; bj = j; }
    }
  }
  an.c0 = [0, 1, 2].map((k) => V3[k] - bi * a1[k] - bj * b1[k]);
  an.oucCell = [a1, b1, an.c0];
  an.period = dot(an.c0, an.normal);
  const area = norm(cross(a1, b1));
  an.mesh = { a: norm(a1), b: norm(b1), gamma: angleDeg(a1, b1), area, type: meshType(a1, b1) };
  an.area = area;
  // the atoms of one primitive cell, then wrapped into the oriented cell
  const invP = inv3(P), invO = inv3(an.oucCell);
  an.primCart = []; an.r = []; an.z = [];
  for (const i of keep) {
    const cart = comb(frac[i], cell);
    const fp = comb(cart, invP).map(wrap01);
    const pc = comb(fp, P);
    const fo = comb(pc, invO).map(wrap01);
    const r = comb(fo, an.oucCell);
    an.primCart.push(pc); an.r.push(r); an.z.push(dot(r, an.normal));
  }
  an.composition = counts(an.symbols);
  const fc = formalCharges(an.composition, { charges });
  an.charges = fc.charges; an.chargesSource = fc.source;
  an.notes.push(...fc.notes);
  ({ bonds: an._bonds, dMin: an.dMin } = bondsAndDmin(an.symbols, an.primCart, P));
  findPlanes(an, layerTolerance);
  findLayers(an, layerTolerance);
  findCuts(an);
  findClasses(an);
  return an;
}

/**
 * The inequivalent terminations of the plane `miller` of `bulk`, best first: surfaceAnalysis(bulk, opts).terminations
 * ({index, label, cut, cuts, composition, below, brokenBonds, polar}); pass `termination: <index or label>` to
 * buildSurface to build one.
 */
export function terminations(bulk, opts = {}) {
  return surfaceAnalysis(bulk, opts).terminations;
}
// --- end M2-T6a ---

// --- surface-modeling M2-T3b ---
// --- end M2-T3b ---

// --- surface-modeling M2-T6b ---
import { Structure, RESULT_PROPS, CARTESIAN_VECTOR_PROPS, addWarning, copyValue, markEdited } from '../core/structure.js';

const SQRT = '√';
const DEG = '°';
/** Per-atom columns of the bulk that a slab does not take over (constraints, layer tags, adsorbate numbers). */
const NOT_COPIED = ['selective_dynamics', 'tags', 'adsorbate_id'];
/** Surface supercells that can be given by name, on the meshes they fit: rows = the new a and b in the 1×1 mesh. */
const WOOD_PRESETS = {
  'c2x2': [[[1, 1], [-1, 1]], ['square', 'rectangular']],
  'sqrt2xsqrt2r45': [[[1, 1], [-1, 1]], ['square']],
  'sqrt3xsqrt3r30': [[[2, 1], [-1, 1]], ['hexagonal']],
  '2sqrt3x2sqrt3r30': [[[4, 2], [-2, 2]], ['hexagonal']],
  'sqrt7xsqrt7r19.1': [[[3, 1], [-1, 2]], ['hexagonal']],
  'sqrt5xsqrt5r26.6': [[[2, 1], [-1, 2]], ['square']],
};
const isList = (v) => Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));

/**
 * The 2×2 integer matrix of a surface supercell: rows are the new a and b in units of the 1×1 surface cell. `spec`
 * is null (1×1), two whole numbers [n, m], a 2×2 matrix, or text: 'p(3×3)', '3x3', 'c(2×2)' (square and rectangular
 * meshes), '(√2×√2)R45°', '(√3×√3)R30°', '(2√3×2√3)R30°', '(√7×√7)R19.1°' (hexagonal meshes) or '(√5×√5)R26.6°'
 * (square); 'sqrt3' may be written for '√3'. `meshType` (analysis.mesh.type) is needed for the named cells. The
 * determinant must be positive. Python: parse_surface_supercell.
 */
export function parseSurfaceSupercell(spec, meshTypeName = null) {
  const limit = SURFACE_DEFAULTS.supercellMaxEntry;
  let S;
  if (spec == null) return [[1, 0], [0, 1]];
  if (typeof spec === 'string') {
    const text = spec.trim();
    // the name without blanks, brackets and the degree sign: '(√3×√3)R30°' and 'sqrt3xsqrt3R30' are the same
    const key = text.toLowerCase().replaceAll(' ', '').replaceAll(TIMES, 'x').replaceAll(SQRT, 'sqrt').replaceAll(DEG, '').replaceAll('(', '').replaceAll(')', '');
    const mm = /^p?(\d+)x(\d+)$/.exec(key);
    if (mm) S = [[Number(mm[1]), 0], [0, Number(mm[2])]];
    else {
      const preset = Object.hasOwn(WOOD_PRESETS, key) ? WOOD_PRESETS[key] : null;
      if (!preset) throw new Error(`unknown surface supercell '${text}' (use for example p(2${TIMES}2), (${SQRT}3${TIMES}${SQRT}3)R30${DEG}, c(2${TIMES}2) or a 2${TIMES}2 matrix)`);
      if (meshTypeName != null && !preset[1].includes(meshTypeName)) throw new Error(`${text} does not fit this surface cell (${meshTypeName})`);
      S = preset[0].map((r) => [...r]);
    }
  } else {
    const rows = isList(spec) ? Array.from(spec) : null;
    if (rows && rows.length === 2 && rows.every(isWhole)) S = [[rows[0], 0], [0, rows[1]]];
    else if (rows && rows.length === 2 && rows.every((r) => isList(r) && r.length === 2 && Array.from(r).every(isWhole))) S = rows.map((r) => Array.from(r));
    else throw new Error(`the surface supercell must be a 2${TIMES}2 matrix of whole numbers`);
  }
  if (S.some((row) => row.some((x) => Math.abs(x) > limit))) throw new Error(`surface supercell entries must be between -${limit} and ${limit}`);
  const det = S[0][0] * S[1][1] - S[0][1] * S[1][0];
  if (det <= 0) throw new Error(`the surface supercell has determinant ${det}; ${det < 0 ? 'swap the two rows' : 'its rows must be independent'}`);
  return S.map((r) => r.map((x) => x + 0));
}

/** '√3' for 3, '2' for 4, '2√3' for 12. */
function rootToken(n) {
  const k = Math.floor(Math.sqrt(n) + 1e-9);
  if (k * k === n) return String(k);
  let out = 1, rest = n;
  for (let f = 2; f * f <= rest; f++) while (rest % (f * f) === 0) { out *= f; rest /= f * f; }
  return `${out > 1 ? out : ''}${SQRT}${rest}`;
}

/**
 * The name of the surface supercell S of the 1×1 mesh (a1, b1): '' for 1×1, 'p(3×3)' for a diagonal matrix, Wood's
 * notation '(√3×√3)R30°' when both sides are turned by the same angle, else the matrix as '[2 1 0, -1 3 0, 0 0 1]'.
 * Python: surface_mesh_label.
 */
export function surfaceMeshLabel(S, a1, b1) {
  const [s11, s12] = S[0], [s21, s22] = S[1];
  if (s11 === 1 && s12 === 0 && s21 === 0 && s22 === 1) return '';
  if (s12 === 0 && s21 === 0) return `p(${s11}${TIMES}${s22})`;
  const A = [0, 1, 2].map((k) => s11 * a1[k] + s12 * b1[k]);
  const B = [0, 1, 2].map((k) => s21 * a1[k] + s22 * b1[k]);
  const na = dot(A, A) / dot(a1, a1), nb = dot(B, B) / dot(b1, b1);
  const ia = Math.floor(na + 0.5), ib = Math.floor(nb + 0.5);
  const ta = angleDeg(A, a1), tb = angleDeg(B, b1);
  if (Math.abs(na - ia) < 1e-6 && Math.abs(nb - ib) < 1e-6 && Math.abs(ta - tb) < 0.05) {
    const tenths = Math.floor(ta * 10 + 0.5);
    const angle = tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`;
    return `(${rootToken(ia)}${TIMES}${rootToken(ib)})R${angle}${DEG}`;
  }
  return `[${s11} ${s12} 0, ${s21} ${s22} 0, 0 0 1]`;
}

/** '+2', '-2', '+2.67', '0'. */
const signed = (q) => (Number.isInteger(q) ? (q ? `${q > 0 ? '+' : '-'}${Math.abs(q)}` : '0') : signedCharge(q));

function stoichiometry(comp, unit) {
  let n = Infinity;
  for (const [e, u] of Object.entries(unit)) n = Math.min(n, Math.floor((comp[e] ?? 0) / u));
  const rest = {};
  for (const e of new Set([...Object.keys(comp), ...Object.keys(unit)])) {
    const x = (comp[e] ?? 0) - n * (unit[e] ?? 0);
    if (x) rest[e] = x;
  }
  const any = Object.keys(rest).length > 0;
  return [!any, any ? compFormula(rest) : null];
}

/** The fewest layers under cut k whose atoms span at least `thickness` Å. */
function thicknessLayers(an, k, thickness) {
  const top = an._zmax(k);
  let L = 1;
  while (top - an._zmin(k - L + 1) < thickness - 1e-9 && L < SURFACE_DEFAULTS.maxLayers) L++;
  return L;
}

const isNumber = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Cleave `bulk` along the plane `miller` and return the slab as a new Structure: a along x, the surface normal along
 * z, c perpendicular to the surface, pbc T T T, the vacuum along c and the (hkl) face on top.
 * - miller: [h, k, l] of the cell of `bulk`, or [h, k, i, l] on a hexagonal cell with γ = 120°.
 * - vacuum (required, Å): the total gap between the top atoms and the bottom atoms of the next periodic image, never
 *   per side; 0 gives no vacuum: the slab then repeats as in the bulk (a whole number of periods, c tilted).
 * - thickness: `layers` atomic layers (default 4), or `periods` stacking periods, or the fewest layers at least
 *   `thickness` Å thick; `symmetric` adds up to one period of layers until the bottom face matches the top face.
 * - termination: an index or a label of terminations() (default 0); `cut` picks one of the analysis' cuts instead.
 * - position: 'center' or 'bottom' (the lowest atoms `offset` Å above the cell's bottom face).
 * - supercell: a surface supercell (parseSurfaceSupercell: [2, 2], '(√3×√3)R30°', a 2×2 matrix).
 * - fixBottom / fixMiddle: fix the lowest (or the middle) N layers with selective dynamics; fixAxes names the fixed
 *   directions ('abc': F F F; 'c': T T F).
 * - millerBasis, primitive, translationTolerance, layerTolerance, charges: as for surfaceAnalysis; `analysis` reuses
 *   a SurfaceAnalysis of the same bulk and options instead of computing it again.
 * Atoms are ordered by element (in the order of the bulk), each element from the bottom layer up; props.tags holds
 * the layer number counted from the top (1 = top layer); info.surface records how the slab was made and
 * info.warnings what to check. The same slab as Python's facet.build.surface.
 */
export function buildSurface(bulk, opts = {}) {
  const D = SURFACE_DEFAULTS;
  const {
    miller, vacuum: vacuumIn = null, layers = null, periods = null, thickness = null, termination = 0, cut = null, symmetric = false,
    position = 'center', offset = 0, supercell = null, primitive = true, millerBasis = 'input', translationTolerance = null,
    fixBottom = 0, fixMiddle = 0, fixAxes = 'abc', layerTolerance = null, charges = null, name = null, analysis = null,
  } = opts;
  checkBulk(bulk);
  if (vacuumIn == null) throw new Error('vacuum is required: the total gap in Å between the slab and its periodic image (0 for none)');
  if (!isNumber(vacuumIn) || vacuumIn < 0 || vacuumIn > D.maxVacuum) throw new Error(`vacuum must be between 0 and ${num(D.maxVacuum)} Å`);
  const vacuum = vacuumIn;
  if ([layers, periods, thickness].filter((x) => x != null).length > 1) throw new Error('give only one of layers, periods or thickness');
  for (const [label, value] of [['layers', layers], ['periods', periods]]) {
    if (value != null && !(isWhole(value) && value >= 1 && value <= D.maxLayers)) throw new Error(`${label} must be a whole number from 1 to ${D.maxLayers}`);
  }
  if (thickness != null && !(isNumber(thickness) && thickness > 0 && thickness <= 500)) throw new Error('thickness must be between 0 and 500 Å');
  if (position !== 'center' && position !== 'bottom') throw new Error("position must be 'center' or 'bottom'");
  if (!isWhole(fixBottom) || !isWhole(fixMiddle) || fixBottom < 0 || fixMiddle < 0) throw new Error('fix_bottom and fix_middle must be whole numbers of layers');
  if (fixBottom && fixMiddle) throw new Error('give only one of fix_bottom or fix_middle');
  if (typeof fixAxes !== 'string' || !fixAxes || [...fixAxes].some((ax) => !'abc'.includes(ax))) throw new Error("fix_axes must name the fixed directions: 'abc', 'c', ...");
  const an = analysis ?? surfaceAnalysis(bulk, { miller, millerBasis, primitive, translationTolerance, layerTolerance, charges });
  const m = an.m, classes = an._classes;
  // the cut
  let k, tIndex;
  if (cut != null) {
    if (!isWhole(cut) || cut < 0 || cut >= m) throw new Error(`cut ${cut} does not exist (this surface has ${m} cut${m !== 1 ? 's' : ''} per period)`);
    k = cut; tIndex = an.cuts[k].termination;
  } else {
    if (typeof termination === 'string') {
      tIndex = classes.findIndex((c) => c.label === termination);
      if (tIndex < 0) throw new Error(`unknown termination '${termination}' (use ${classes.map((c) => c.label).join(' or ')})`);
    } else if (isWhole(termination)) {
      tIndex = termination;
      if (tIndex < 0 || tIndex >= classes.length) throw new Error(`termination ${tIndex} does not exist (this surface has ${classes.length}: ${classes.map((c, i) => `${i} ${c.label}`).join(', ')})`);
    } else throw new Error('termination must be an index or a label');
    k = classes[tIndex].rep;
  }
  const cls = classes[tIndex];
  // the number of layers
  let L, spec;
  if (periods != null) { L = periods * m; spec = { mode: 'periods', value: periods }; }
  else if (thickness != null) { L = thicknessLayers(an, k, thickness); spec = { mode: 'thickness', value: thickness }; }
  else if (layers != null) { L = layers; spec = { mode: 'layers', value: layers }; }
  else { L = D.layers; spec = { mode: 'default', value: D.layers }; }
  const nameIdx = an.hkil ?? an.millerConventional ?? an.miller;
  if (symmetric) {
    const Ls = an._symmetricLayers(k, L);
    if (Ls === null) {
      throw new Error(`no symmetric slab exists with the ${cls.label} termination: no bottom layer matches the top (the ${millerSpaced(nameIdx)} and ${millerSpaced(nameIdx.map((x) => -x))} faces of this crystal differ); for a polar surface, passivate the bottom (for example with pseudo-hydrogen) or use an asymmetric slab with a dipole correction`);
    }
    L = Ls;
  }
  if (L > D.maxLayers) throw new Error(`layers must be a whole number from 1 to ${D.maxLayers}`);
  if (Math.max(fixBottom, fixMiddle) > L) throw new Error(`${fixBottom ? 'fix_bottom' : 'fix_middle'} must be from 0 to the number of layers (${L})`);
  if (vacuum === 0 && L % m) throw new Error(`a vacuum of 0 Å needs a whole number of periods (this slab has ${num(L / m)}); choose Periods or another thickness`);
  if (vacuum > 0 && !(offset >= 0 && offset <= vacuum)) throw new Error(`offset must be between 0 and the vacuum (${num(vacuum)} Å)`);
  const S = parseSurfaceSupercell(supercell, an.mesh.type);
  const det = S[0][0] * S[1][1] - S[0][1] * S[1][0];
  // the frame of the slab: the supercell's a along x, the normal along z
  const { a1, b1, normal: n3 } = an;
  const A2b = [0, 1, 2].map((i) => S[0][0] * a1[i] + S[0][1] * b1[i]);
  const B2b = [0, 1, 2].map((i) => S[1][0] * a1[i] + S[1][1] * b1[i]);
  const la = norm(A2b);
  const e1 = A2b.map((x) => x / la);
  const e2 = cross(n3, e1);
  const rot = (v) => [dot(e1, v), dot(e2, v), dot(n3, v)];
  const a1r = rot(a1), b1r = rot(b1);
  const A2 = rot(A2b), B2 = rot(B2b);
  const det2 = A2[0] * B2[1] - A2[1] * B2[0];
  let span = 0;
  for (const row of S) for (const x of row) span = Math.max(span, Math.abs(x));
  span += 1;
  const images = [];
  for (let i = -span; i <= span; i++) {
    for (let j = -span; j <= span; j++) {
      const px = i * a1r[0] + j * b1r[0], py = i * a1r[1] + j * b1r[1];
      const fa = (px * B2[1] - py * B2[0]) / det2, fb = (py * A2[0] - px * A2[1]) / det2;
      if (fa > -1e-9 && fa < 1 - 1e-9 && fb > -1e-9 && fb < 1 - 1e-9) images.push([px, py]);
    }
  }
  if (images.length !== det) throw new Error('the surface supercell could not be filled (an internal error: please report the matrix)');
  const rank = new Map();
  for (const s of bulk.symbols) if (!rank.has(s)) rank.set(s, rank.size);
  const Jb = k - L + 1;
  const rows = [];
  for (let ell = 0; ell < L; ell++) {
    for (const [i, r] of an._atomsOf(Jb + ell)) {
      const p = rot(r);
      images.forEach(([px, py], g) => rows.push([rank.get(an.symbols[i]), ell, g, i, [p[0] + px, p[1] + py, p[2]]]));
    }
  }
  let zLo = Infinity, zHi = -Infinity;
  for (const row of rows) { zLo = Math.min(zLo, row[4][2]); zHi = Math.max(zHi, row[4][2]); }
  const t = zHi - zLo;
  let cell, z0;
  if (vacuum > 0) {
    cell = [[la, 0, 0], [B2[0], B2[1], 0], [0, 0, t + vacuum]];
    z0 = position === 'center' ? vacuum / 2 : offset;
  } else {
    const c0r = rot(an.c0);
    cell = [[la, 0, 0], [B2[0], B2[1], 0], c0r.map((x) => (L / m) * x)];
    z0 = 0;
  }
  cell = cell.map((row) => row.map((x) => (Math.abs(x) < 1e-12 ? 0 : x)));
  // the contact across the cell edge (top atoms and the bottom atoms of the next image)
  let contact = null;
  if (vacuum > 0) {
    const top = an._atomsOf(k), bottom = an._atomsOf(Jb);
    let dX = Infinity;
    for (const [, rt] of top) {
      for (const [, rb] of bottom) {
        const dz = dot(rb, n3) + (t + vacuum) - dot(rt, n3);
        const w = lateral(sub(rb, rt), n3);
        const dl = mic2d(w, a1, b1);
        dX = Math.min(dX, Math.sqrt(dl * dl + dz * dz));
      }
    }
    if (dX < D.contactErrorFraction * an.dMin) {
      const need = Math.ceil(7.5 * an.dMin) / 10;
      throw new Error(`the vacuum (${num(vacuum)} Å) is too small: atoms would be ${fmt2(dX)} Å apart across the cell edge (shortest distance in the bulk ${fmt2(an.dMin)} Å); use at least ${num(need)} Å, or 0 for a bulk-like stacking`);
    }
    if (dX < D.contactWarnFraction * an.dMin - 1e-9) contact = dX;
  }
  // in-plane origin on the first atom of the top layer, then wrapped into the cell
  const anchor = rows.find((row) => row[1] === L - 1)[4];
  const ox = anchor[0], oy = anchor[1];
  const inv = inv3(cell);
  rows.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]) || (a[3] - b[3]));
  const symbols = [], positions = [], tags = [], src = [];
  for (const [, ell, , i, p] of rows) {
    const f = comb([p[0] - ox, p[1] - oy, p[2] - zLo + z0], inv);
    for (const ax of [0, 1]) {
      const w = f[ax] - Math.floor(f[ax] + 1e-9);
      f[ax] = w < 0 || w >= 1 - 1e-9 ? 0 : w;
    }
    positions.push(comb(f, cell));
    symbols.push(an.symbols[i]);
    tags.push(L - ell);
    src.push(an.keep[i]);
  }
  // constraints
  let fixedLayers = [];
  if (fixBottom) fixedLayers = Array.from({ length: fixBottom }, (_, i) => i);
  else if (fixMiddle) { const lo = Math.floor((L - fixMiddle) / 2); fixedLayers = Array.from({ length: fixMiddle }, (_, i) => lo + i); }
  const props = { tags };
  if (fixedLayers.length) {
    const flag = [...'abc'].map((ax) => !fixAxes.includes(ax));
    const on = new Set(fixedLayers);
    props.selective_dynamics = tags.map((tg) => (on.has(L - tg) ? [...flag] : [true, true, true]));
  }
  for (const [key, col] of Object.entries(bulk.props ?? {})) {
    if (NOT_COPIED.includes(key) || RESULT_PROPS.includes(key) || CARTESIAN_VECTOR_PROPS.includes(key)) continue;
    props[key] = src.map((j) => copyValue(col[j]));
  }
  // what the slab is made of
  const comp1 = {};
  const heights = [];
  for (let J = Jb; J <= k; J++) {
    for (const [i, r] of an._atomsOf(J)) {
      comp1[an.symbols[i]] = (comp1[an.symbols[i]] ?? 0) + 1;
      heights.push([dot(r, n3), an.symbols[i]]);
    }
  }
  const composition = Object.fromEntries(Object.entries(comp1).map(([e, n]) => [e, n * det]));
  const unit = reducedComp(counts(bulk.symbols));
  const [stoich, excess] = stoichiometry(composition, unit);
  const q = an.charges;
  let polarity = { polar: null, netCharge: null, dipole: null, dipoleDensity: null };
  let dipole1 = 0, net = 0, density = 0;
  if (q) {
    const zMid = zLo + t / 2;
    for (const [z, s] of heights) { dipole1 += q[s] * (z - zMid); net += q[s]; }
    net *= det;
    density = dipole1 / an.area;
    polarity = { polar: Math.abs(density) > D.polarThreshold, netCharge: r6(net), dipole: r6(dipole1 * det), dipoleDensity: r6(density) };
  }
  const nTerms = classes.length;
  const topLabel = cls.label;
  const bottomLabel = nTerms > 1 ? an._bottomLabel(k, L) : topLabel;
  const bulkFormula = compFormula(unit);
  const meshToken = surfaceMeshLabel(S, a1, b1);
  const term = nTerms > 1 ? (topLabel === bottomLabel ? `${topLabel}-term` : `${topLabel}/${bottomLabel}-term`) : '';
  const auto = [bulkFormula + millerToken(nameIdx), meshToken, term, `${L}L`].filter(Boolean).join(' ');
  const record = {
    version: 2, kind: 'cleave', autoName: name == null ? auto : null,
    miller: [...an.miller], millerInput: [...an.millerInput], millerBasis: an.millerBasis,
    primitive: an.primitive, translationTolerance: an.translationTolerance,
    bulkNormal: n3.map(r6), normal: [0, 0, 1], axis: 2,
    period: r6(an.period), layersPerPeriod: m,
    layerTolerance: r6(an.layerTolerance), layerGrouping: an.layerGrouping,
    meshParams: { a: r6(an.mesh.a), b: r6(an.mesh.b), gamma: r6(an.mesh.gamma), area: r6(an.mesh.area), type: an.mesh.type },
    termination: { index: tIndex, count: nTerms, label: topLabel, top: topLabel, bottom: bottomLabel,
      topComposition: { ...an._lay[fmod(k, m)].composition }, bottomComposition: { ...an._lay[fmod(Jb, m)].composition },
      brokenBonds: an._broken[k], polar: an._polar[k] },
    tasker: an.tasker, layers: L, thicknessSpec: spec, thickness: r6(t), vacuum: r6(vacuum),
    stacking: vacuum > 0 ? 'vacuum' : 'bulk', position, offset: r6(position === 'bottom' ? offset : 0),
    symmetric: !!symmetric, symmetryCheck: 'fingerprint', flipped: false,
    asBuilt: { composition, stoichiometric: stoich, excess, polarity },
    bulk: { name: bulk.name, formula: compFormula(counts(bulk.symbols)), reducedFormula: bulkFormula, natoms: bulk.length,
      cell: bulk.cell.map((row) => row.map((x) => r6(x))) },
  };
  if (an.hkil) record.hkil = [...an.hkil];
  if (an.millerConventional) {
    record.millerConventional = [...an.millerConventional];
    record.conventional = { kind: an.conventional.kind, toConventional: an.conventional.toConventional.map((r) => [...r]) };
  }
  if (meshToken) record.asBuilt.supercell = S.map((r) => [...r]);
  if (fixedLayers.length) record.asBuilt.fixed = { layers: fixedLayers.length, from: fixBottom ? 'bottom' : 'middle', axes: fixAxes };
  for (const key of ['spacegroup', 'source']) if (bulk.info?.[key] != null) record.bulk[key] = bulk.info[key];
  const info = { source: 'builder:surface', surface: record };
  if (meshToken) info.supercellMatrix = [[S[0][0], S[0][1], 0], [S[1][0], S[1][1], 0], [0, 0, 1]];
  const slab = new Structure({ name: name == null ? auto : String(name), symbols, positions, cell, pbc: [true, true, true], props, info });
  // what to check
  for (const w of an.warnings) addWarning(slab.info, w);
  if (bulk.nFrames > 1) addWarning(slab.info, `only the current frame was used (the structure has ${bulk.nFrames} frames)`);
  if (bulk.props && Object.hasOwn(bulk.props, 'selective_dynamics')) addWarning(slab.info, 'the bulk constraints (selective dynamics) were not copied');
  if (!stoich) addWarning(slab.info, `the slab is not stoichiometric: ${compFormula(composition)} per cell (bulk ${bulkFormula}), excess ${excess}`);
  if (q) {
    if (polarity.polar) {
      const shown = Object.keys(q).sort(formulaOrder).map((e) => `${e} ${signed(q[e])}`).join(', ');
      addWarning(slab.info, `the slab is polar: dipole ${fmt2(dipole1 * det)} e${MIDDOT}Å per cell (${fmt2(density)} e/Å), from formal charges ${shown}`);
    }
    if (Math.abs(net) > 1e-6) addWarning(slab.info, `the slab has a net formal charge of ${signed(net)} per cell`);
  }
  if (contact !== null) addWarning(slab.info, `the vacuum (${num(vacuum)} Å) leaves atoms ${fmt2(contact)} Å apart across the cell edge, closer than in the bulk (${fmt2(an.dMin)} Å)`);
  if (fixedLayers.length && fixedLayers.length === L) addWarning(slab.info, 'all layers are fixed');
  return slab;
}

/**
 * The bulk re-oriented with the plane `miller` in the ab plane: buildSurface with vacuum 0 and `periods` (default 1)
 * stacking periods, a 3D crystal with a along x, the plane normal along z and c one stacking vector. Its shortest
 * distances are those of the bulk. Python: oriented_cell.
 */
export function orientedCell(bulk, { periods = 1, ...opts } = {}) {
  return buildSurface(bulk, { ...opts, vacuum: 0, periods });
}

/** The number of atoms buildSurface would make for an analysis: layers × atoms per layer × supercell (an estimate). */
export function estimateSurfaceAtoms(an, { layers = SURFACE_DEFAULTS.layers, supercell = null } = {}) {
  const S = parseSurfaceSupercell(supercell, an.mesh.type);
  const det = S[0][0] * S[1][1] - S[0][1] * S[1][0];
  return Math.ceil((layers / an.m) * an.symbols.length * det);
}
// --- end M2-T6b ---

// --- surface-modeling M2-T5 ---
import { contiguousShifts, findVacuumGap, surfaceNormal } from '../core/vacuum.js';
import { applyBasisChange, moveFlags } from '../core/constraints.js';

const NO_SLAB = 'flipping needs a slab: a vacuum gap or a non-periodic axis';

/** [axis, cut, has a vacuum gap] of the structure's surface: the vacuum axis, else `axis` or c. */
function slabAxis(s, axis) {
  const sn = surfaceNormal(s);
  if (!sn) throw new Error('setting the vacuum needs a unit cell');
  if (axis != null) {
    if (![0, 1, 2].includes(axis)) throw new Error('axis must be 0, 1 or 2 (a, b or c)');
    const cut = sn.surface && sn.axis === axis ? sn.cut : null;
    return [axis, cut, cut != null];
  }
  const cut = sn.surface ? sn.cut : null;
  return [sn.axis, cut, cut != null];
}

/** {pos (rows, in one piece along axis k), shifts, n (unit normal), height (of the cell along n)}. */
function unwrapped(s, k, cut) {
  const cell = s.cell.map((r) => r.map(Number));
  const a = cell[(k + 1) % 3], b = cell[(k + 2) % 3], c = cell[k];
  let n = cross(a, b);
  const ln = norm(n);
  n = n.map((x) => x / ln);
  if (dot(c, n) < 0) n = n.map((x) => -x);
  const p = s.positions;
  const N = s.length;
  let shifts = new Int32Array(N);
  if (s.pbc[k] && N) {
    let window = cut;
    if (window == null) {
      const gap = findVacuumGap(s, k, { minWidth: 0, periodicOnly: false });
      window = gap ? gap.center - 1 : null;
    }
    if (window != null) shifts = contiguousShifts(s, k, { cut: window });
  }
  const pos = [];
  for (let i = 0; i < N; i++) pos.push([p[3 * i] + shifts[i] * c[0], p[3 * i + 1] + shifts[i] * c[1], p[3 * i + 2] + shifts[i] * c[2]]);
  return { pos, shifts, n, height: dot(c, n), cell };
}

/**
 * Where the atoms are along the surface normal: {axis, normal, bottom, top, thickness, gap, height, vacuum} in Å
 * (`gap`: the cell height minus the thickness, the space between the top atoms and the next image; `vacuum`: whether
 * that is a vacuum gap), or null without a unit cell. Read-only. Python: slab_extent.
 */
export function slabExtent(s, { axis = null } = {}) {
  if (!s?.cell || !s.length) return null;
  const [k, cut, hasGap] = slabAxis(s, axis);
  const { pos, n, height } = unwrapped(s, k, cut);
  let bottom = Infinity, top = -Infinity;
  for (const p of pos) { const z = dot(p, n); bottom = Math.min(bottom, z); top = Math.max(top, z); }
  return { axis: k, normal: n, bottom, top, thickness: top - bottom, gap: height - (top - bottom), height, vacuum: hasGap };
}

/**
 * The atomic layers of a slab along its surface normal: {axis, count, layer, heights, sizes}. layer[i] is the layer
 * of atom i counted from the bottom (0 = bottom layer), heights the mean height of each layer above the lowest atom
 * (Å) and sizes its number of atoms. Atoms closer than `tolerance` along the normal share a layer (default:
 * info.surface.layerTolerance, else 0.3 Å). Python: slab_layers.
 */
export function slabLayers(s, { tolerance = null, axis = null } = {}) {
  if (!s?.cell) throw new Error('layers need a unit cell');
  let tol = tolerance;
  if (tol == null) {
    tol = s.info?.surface?.layerTolerance;
    if (!(isNumber(tol) && tol > 0 && tol <= 2)) tol = SURFACE_DEFAULTS.layerTolerance;
  }
  const [k, cut] = slabAxis(s, axis);
  const { pos, n } = unwrapped(s, k, cut);
  const z = pos.map((p) => dot(p, n));
  const order = z.map((_, i) => i).sort((a, b) => (z[a] - z[b]) || (a - b));
  const layer = new Array(z.length).fill(0);
  const heights = [], sizes = [];
  let cur = [];
  const close = () => { let sum = 0; for (const j of cur) sum += z[j]; heights.push(sum / cur.length); sizes.push(cur.length); cur = []; };
  order.forEach((i, t) => {
    if (cur.length && z[i] - z[order[t - 1]] > tol) close();
    cur.push(i);
    layer[i] = heights.length;
  });
  if (cur.length) close();
  let z0 = Infinity;
  for (const v of z) z0 = Math.min(z0, v);
  if (!z.length) z0 = 0;
  return { axis: k, count: heights.length, layer, heights: heights.map((h) => h - z0), sizes };
}

/** Whole-cell shifts [ka, kb, kc] per atom that the slab tools apply to put a slab in one piece (for the view). */
export function slabShifts(s, { axis = null } = {}) {
  if (!s?.cell || !s.length) return null;
  const [k, cut] = slabAxis(s, axis);
  const { shifts } = unwrapped(s, k, cut);
  return { axis: k, shifts };
}

function place(s, gap, position, offset, axis, label) {
  const [k, cut, hasGap] = slabAxis(s, axis);
  if (s.nFrames > 1) {
    const nFrames = s.nFrames, shown = s.frame + 1;
    s.keepFrame();
    addWarning(s.info, `only frame ${shown} was kept (the structure had ${nFrames} frames)`);
  }
  const { pos, n, height, cell } = unwrapped(s, k, cut);
  let bottom = Infinity, top = -Infinity;
  for (const p of pos) { const z = dot(p, n); bottom = Math.min(bottom, z); top = Math.max(top, z); }
  const t = top - bottom;
  if (gap == null) gap = height - t;
  else if (!hasGap && s.pbc[k]) {
    const widest = findVacuumGap(s, k, { minWidth: 0, periodicOnly: false });
    addWarning(s.info, `no vacuum gap of at least ${num(SURFACE_DEFAULTS.vacuumGapMin)} Å was found; the structure was cut at its widest gap along ${AXIS_NAMES[k]} (${fmt2(widest ? widest.width : 0)} Å)`);
  }
  const scale = (t + gap) / height;
  cell[k] = cell[k].map((x) => x * scale);
  const z0 = position === 'center' ? gap / 2 : offset;
  const lift = z0 - bottom;
  s.writeFrame('current', { positions: pos.map((p) => [p[0] + lift * n[0], p[1] + lift * n[1], p[2] + lift * n[2]]), cell });
  markEdited(s, 'cell');
  const update = { axis: k, normal: n.map(r6), thickness: r6(t), vacuum: r6(gap), position, offset: r6(position === 'bottom' ? offset : 0), stacking: 'vacuum' };
  const rec = s.info.surface;
  if (rec && typeof rec === 'object' && !Array.isArray(rec)) Object.assign(rec, update);
  else if (label === 'vacuum') s.info.surface = { version: 2, kind: 'vacuum', autoName: null, ...update };
  return s;
}

/**
 * Set the vacuum of a slab, in place: the total gap (Å) between its top atoms and the bottom atoms of the next
 * periodic image along the surface normal (Materials Studio's "Build Vacuum Slab"). The vacuum axis is the cell
 * vector with the vacuum gap (surfaceNormal), or `axis` (0, 1, 2); a crystal without a gap is cut at its widest gap
 * along c (a warning says so). A slab that crosses the cell edge is put in one piece first. The cell vector along the
 * vacuum keeps its direction and gets the length that makes the gap `vacuum` Å; the atoms keep their distances and are
 * moved along the normal: position 'center' puts the slab in the middle, 'bottom' its lowest atoms `offset` Å above
 * the bottom face. pbc and the constraints are kept. `vacuum` has no default and must be larger than 0. Returns the
 * structure. Python: set_vacuum.
 */
export function setVacuum(s, vacuum, { position = 'center', offset = 0, axis = null } = {}) {
  const D = SURFACE_DEFAULTS;
  if (!s?.cell) throw new Error('setting the vacuum needs a unit cell');
  if (vacuum == null) throw new Error('vacuum is required: the total gap in Å between the slab and its periodic image (0 for none)');
  if (!isNumber(vacuum) || vacuum < 0 || vacuum > D.maxVacuum) throw new Error(`vacuum must be between 0 and ${num(D.maxVacuum)} Å`);
  if (vacuum === 0) throw new Error('a vacuum of 0 Å is only possible when cleaving (the slab then repeats as in the bulk); enter a gap larger than 0 Å');
  if (position !== 'center' && position !== 'bottom') throw new Error("position must be 'center' or 'bottom'");
  if (position === 'bottom' && !(offset >= 0 && offset <= vacuum)) throw new Error(`offset must be between 0 and the vacuum (${num(vacuum)} Å)`);
  if (s.pbc.filter((p) => !p).length >= 2) throw new Error('setting the vacuum needs a structure periodic in at least two directions');
  return place(s, vacuum, position, offset, axis, 'vacuum');
}

/**
 * Move a slab to the middle of its cell along the surface normal, in place (the cell and the vacuum stay as they are;
 * a slab that crosses the cell edge is put in one piece first). Returns the structure. Python: center_slab.
 */
export function centerSlab(s, { axis = null } = {}) {
  if (!s?.cell) throw new Error('centring a slab needs a unit cell');
  return place(s, null, 'center', 0, axis, 'center');
}

/** The automatic name of a cleaved slab from its record (after a flip): formula(hkl) mesh term nL. */
function flippedName(s, rec) {
  const idx = rec.hkil ?? rec.miller;
  const term = rec.termination ?? {};
  let token = '';
  if ((term.count ?? 1) > 1) token = term.top === term.bottom ? `${term.top}-term` : `${term.top}/${term.bottom}-term`;
  let mesh = '';
  if (s.info.supercellMatrix != null) {
    const mm = /\) (.+?) (?:\S+-term )?\d+L$/.exec(rec.autoName ?? '');
    mesh = mm && !mm[1].endsWith('-term') ? mm[1] : '';
  }
  return [String(rec.bulk?.reducedFormula ?? '') + millerToken(idx), mesh, token, `${rec.layers}L`].filter(Boolean).join(' ');
}

/**
 * Turn a slab upside down, in place: a rotation by 180° about its a axis (never a mirror image), so the bottom face
 * becomes the top face. The slab stays where it was along the normal; the in-plane cell is reduced again (γ from 90°
 * to 120°) and a is turned back along x, the atoms are wrapped into the cell, the constraints follow the new cell
 * vectors, the layer tags are renumbered from the new top, and a cleave record in info.surface is updated: the
 * indices change sign, top and bottom termination swap and the automatic name follows ('ZnO(000-1) O/Zn-term 16L').
 * Needs a vacuum gap along c with a and b in the plane of the surface. Returns the structure. Python: flip_slab.
 */
export function flipSlab(s) {
  if (!s?.cell) throw new Error(NO_SLAB);
  const [k, cut, hasGap] = slabAxis(s, null);
  if (!hasGap && s.pbc.every(Boolean)) throw new Error(NO_SLAB);
  if (k !== 2) throw new Error(`flipping needs the vacuum along c (here it is along ${AXIS_NAMES[k]})`);
  if (s.nFrames > 1) {
    const nFrames = s.nFrames, shown = s.frame + 1;
    s.keepFrame();
    addWarning(s.info, `only frame ${shown} was kept (the structure had ${nFrames} frames)`);
  }
  const { pos, n: nIn, cell } = unwrapped(s, 2, cut);
  const [a, b, c] = cell;
  const la = norm(a);
  const ah = a.map((x) => x / la);
  const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => 2 * ah[i] * ah[j] - (i === j ? 1 : 0)));
  const turn = (v) => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];
  const rb = turn(b), rc = turn(c);
  const [u, v, M2] = gaussReduce2d(a, rb.map((x) => -x));
  const next = [u, v, rc.map((x) => -x)];
  let n = cross(u, v);
  const ln = norm(n);
  n = n.map((x) => x / ln);
  let out = pos.map(turn);
  let zBefore = Infinity, zAfter = Infinity;
  for (const p of pos) zBefore = Math.min(zBefore, dot(p, nIn));
  for (const p of out) zAfter = Math.min(zAfter, dot(p, n));
  const lift = zBefore - zAfter;
  out = out.map((p) => [p[0] + lift * n[0], p[1] + lift * n[1], p[2] + lift * n[2]]);
  // the standard frame: a along x, the normal along z
  const lu = norm(u);
  const e1 = u.map((x) => x / lu);
  const e2 = cross(n, e1);
  const frame = (w) => [dot(e1, w), dot(e2, w), dot(n, w)];
  const final = next.map((row) => frame(row).map((x) => (Math.abs(x) < 1e-12 ? 0 : x)));
  const inv = inv3(final);
  const positions = out.map((p) => {
    const f = comb(frame(p), inv);
    for (const ax of [0, 1]) {
      const w = f[ax] - Math.floor(f[ax] + 1e-12);
      f[ax] = w < 0 || w >= 1 - 1e-12 ? 0 : w;
    }
    return comb(f, final);
  });
  const oldVectors = [frame(a), frame(rb), frame(rc)];
  s.writeFrame('current', { positions, cell: final });
  applyBasisChange(s, oldVectors, final);
  markEdited(s, 'cell');
  // the supercell record refers to the 1×1 mesh, which is turned over and reduced as well (M2 §3.15)
  const S3 = s.info.supercellMatrix;
  if (Array.isArray(S3) && S3.length === 3 && S3.every((r) => Array.isArray(r) && r.length === 3)
    && S3[2][0] === 0 && S3[2][1] === 0 && S3[2][2] === 1 && S3[0][2] === 0 && S3[1][2] === 0 && [S3[0][0], S3[0][1], S3[1][0], S3[1][1]].every(isWhole)) {
    const So = [[S3[0][0], S3[0][1]], [S3[1][0], S3[1][1]]];
    const det = So[0][0] * So[1][1] - So[0][1] * So[1][0];
    if (det > 0) {
      const oneA = [0, 1, 2].map((i) => (So[1][1] * a[i] - So[0][1] * b[i]) / det);
      const oneB = [0, 1, 2].map((i) => (-So[1][0] * a[i] + So[0][0] * b[i]) / det);
      const [, , M1] = gaussReduce2d(turn(oneA), turn(oneB).map((x) => -x));
      const dsd = [[So[0][0], -So[0][1]], [-So[1][0], So[1][1]]];   // D · S · D with D = diag(1, −1)
      const inv1 = [[M1[1][1], -M1[0][1]], [-M1[1][0], M1[0][0]]];   // det M1 = 1
      const mul = (x, y) => [0, 1].map((i) => [0, 1].map((j) => x[i][0] * y[0][j] + x[i][1] * y[1][j] + 0));
      const Sn = mul(mul(M2, dsd), inv1);
      s.info.supercellMatrix = [[Sn[0][0], Sn[0][1], 0], [Sn[1][0], Sn[1][1], 0], [0, 0, 1]];
    }
  }
  const tags = s.props.tags;
  if (Array.isArray(tags) && tags.length) {
    let top = 0;
    for (const t of tags) if (isNumber(t) && t > 0) top = Math.max(top, t);
    s.setProp('tags', tags.map((t) => (isNumber(t) && t > 0 ? top + 1 - t : t)));
  }
  const rec = s.info.surface;
  if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
    rec.normal = [0, 0, 1]; rec.axis = 2;
    if (rec.kind === 'cleave') {
      for (const key of ['miller', 'millerInput', 'hkil', 'bulkNormal']) {
        if (Array.isArray(rec[key])) rec[key] = rec[key].map((x) => (Number.isInteger(x) ? -x + 0 : r6(-x)));
      }
      const term = rec.termination;
      if (term && typeof term === 'object') {
        [term.top, term.bottom] = [term.bottom, term.top];
        [term.topComposition, term.bottomComposition] = [term.bottomComposition, term.topComposition];
        term.label = term.top;
      }
      rec.flipped = !rec.flipped;
      if (rec.autoName != null && s.name === rec.autoName) {
        const name = flippedName(s, rec);
        rec.autoName = name;
        s.name = name;
      } else rec.autoName = null;
    }
  }
  return s.touch();
}

/**
 * Fix the lowest (where: 'bottom'), the highest ('top') or the middle ('middle') n atomic layers of a slab with
 * selective dynamics, in place; the other atoms keep their flags. `axes` names the fixed directions ('abc': F F F;
 * 'c': T T F). Layers as in slabLayers. Returns the number of atoms fixed. Python: fix_layers.
 */
export function fixLayers(s, n, { where = 'bottom', axes = 'abc', tolerance = null } = {}) {
  if (!['bottom', 'top', 'middle'].includes(where)) throw new Error("where must be 'bottom', 'top' or 'middle'");
  if (typeof axes !== 'string' || !axes || [...axes].some((ax) => !'abc'.includes(ax))) throw new Error("axes must name the fixed directions: 'abc', 'c', ...");
  const lay = slabLayers(s, { tolerance });
  const total = lay.count;
  if (!isWhole(n) || n < 0 || n > total) throw new Error(`the number of fixed layers must be from 0 to the number of layers (${total})`);
  const lo = where === 'bottom' ? 0 : where === 'top' ? total - n : Math.floor((total - n) / 2);
  const flags = moveFlags(s).map((row) => [...row]);
  const flag = [...'abc'].map((ax) => !axes.includes(ax));
  let fixed = 0;
  lay.layer.forEach((ell, i) => { if (ell >= lo && ell < lo + n) { flags[i] = [...flag]; fixed++; } });
  s.setProp('selective_dynamics', flags);
  return fixed;
}

/**
 * Let atoms move again, in place: all of them (the constraints are removed), or only `indices`. Returns the number of
 * atoms freed. Python: free_atoms.
 */
export function freeAtoms(s, indices = null) {
  const flags = moveFlags(s).map((row) => [...row]);
  const which = indices == null ? flags.map((_, i) => i) : Array.from(indices);
  let freed = 0;
  for (const i of which) {
    if (!flags[i].every(Boolean)) freed++;
    flags[i] = [true, true, true];
  }
  if (flags.every((row) => row.every(Boolean))) s.removeProp('selective_dynamics');
  else s.setProp('selective_dynamics', flags);
  return freed;
}
// --- end M2-T5 ---
