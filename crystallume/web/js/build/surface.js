/**
 * Cleaving surfaces and the slab tools (M2): new slabs from a bulk crystal, and tools for existing slabs. A pure
 * module (no DOM), so Node tests import it directly.
 *
 * buildSurface(bulk, { miller, vacuum, … }) cleaves a crystal along (hkl) or (h k i l) and returns a new slab (pbc
 * T T T, a along x, c perpendicular to the surface and along z, the vacuum along c); surfaceAnalysis and terminations
 * describe the surface first (surface cell, atomic layers, inequivalent terminations, broken bonds, polarity, Tasker
 * type); slabReport, surfaceTop and standardizeSlab read or prepare an existing slab (the in-place tools setVacuum,
 * addVacuum, centerSlab and flipSlab are Structure methods). The Python twin is `crystallume/build/surface.py`: the
 * same algorithms and results with the same words in snake_case (buildSurface ↔ surface; design brief P1).
 *
 * `vacuum` is always the total gap between the slab and its periodic image along the surface normal, in Å (0 = no
 * vacuum: the slab repeats as in the bulk), never per side; it is required and has no default (user decision U4).
 *
 * The module is written by several tasks, each inside its own segment (`// --- surface-modeling <name> ---` …
 * `// --- end <name> ---`, plan.md §2.2), each with its own imports: `M2-T2` the formal oxidation states
 * (loadOxidationStates, estimateOxidationStates, from the shared table `crystallume/web/data/oxidation_states.json`;
 * M2 §3.9.1), `M2-T6a` the cleave analysis (surfaceAnalysis, terminations), `M2-T3b` surface coordination and
 * exposed layers, `M2-T6b` the slab (buildSurface, estimateSurfaceAtoms, orientedCell, planePolygons), `M2-T5` the
 * tools for existing structures (slabReport, surfaceTop, standardizeSlab).
 */

// --- surface-modeling M2-T2 ---
import { METALS, PAULING } from '../core/elements.js';
import { loadWebData, webData } from '../core/webdata.js';

/** The shared table of formal oxidation states (written by scripts/gen_oxidation_states.py). */
const OXIDATION_FILE = 'oxidation_states.json';
const OXIDATION_SCHEMA = 'crystallume.oxidation-states/1';
/** Elements of the anion table within this much (Pauling) of the most electronegative element are anions. */
const ANION_WINDOW = 0.6;
/** Slack of the electronegativity comparisons (the values have two decimals). */
const EN_SLACK = 1e-9;
const NOT_LOADED = 'oxidation states are not loaded yet; call await loadOxidationStates() first';
/** table object → checked { anions: Map(element → charge), cations: Map(element → valences) } */
const checkedTables = new WeakMap();

/**
 * Load the formal oxidation-state table of the cleave tool (M2 §3.9.1), `crystallume/web/data/oxidation_states.json`
 * (the copy Python reads too), through core/webdata.js: a Promise of the table `{ schema:
 * 'crystallume.oxidation-states/1', source, anions: { element: charge }, cations: { element: [valence, …] } }`,
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
// --- end M2-T6a ---

// --- surface-modeling M2-T3b ---
// --- end M2-T3b ---

// --- surface-modeling M2-T6b ---
// --- end M2-T6b ---

// --- surface-modeling M2-T5 ---
// --- end M2-T5 ---
