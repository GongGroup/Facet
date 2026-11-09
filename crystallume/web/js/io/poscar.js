/**
 * VASP POSCAR / CONTCAR / XDATCAR reader and POSCAR writer (F0-D §3.10). The Python twin is
 * `crystallume/io/poscar.py`: the same rules and, word for word, the same errors and notes; the shared cases are
 * tests/data/surface/f0d/poscar.json.
 *
 * Reader: VASP 5 and VASP 4 (species from the element symbols in the comment line, else X); one scale factor, a
 * negative one (target volume) or three for x, y and z (VASP 6); Direct and Cartesian coordinates; a word that
 * starts with ! or # begins a comment.
 * - Selective dynamics: the flags go to `props.selective_dynamics` (true = free along a, b, c), all-free rows
 *   included. A flag is T/F in any spelling of FLAG_RE (.TRUE., t, …); a line with fewer than three words after the
 *   coordinates has no flags (a lone F may be fluorine), an unreadable word reads as T, words after the third flag
 *   are ignored (pymatgen writes the element there), and one note counts the lines with such problems. The flags
 *   refer to the cell vectors in Direct and Cartesian files alike (VASP), so they are never converted.
 * - A species line that names an element twice (`Ga As H H`) keeps its blocks in `props.poscar_species`: the words
 *   as written when they differ (H.75, H1.25), else H, H#2, H#3, …
 * - XDATCAR: every `Direct configuration=` block is a frame; a lattice header before a block (variable-cell runs)
 *   gives that frame its own cell (`frames[i].cell`). An incomplete last configuration is skipped with a note.
 * - The velocities after the coordinates of a CONTCAR go to `props.velocities` (Cartesian Å/fs) unless they are
 *   all zero: a blank mode line or one starting with C or K is Cartesian (not scaled), any other Direct (cell vectors
 *   per time step, converted assuming 1 fs, with a note). Lattice velocities and predictor-corrector data are skipped.
 *
 * Writer: the current frame, Direct coordinates (not wrapped), one block per species in order of first appearance
 * (poscarOrder; the blocks of `props.poscar_species` when present), `Selective dynamics` whenever
 * `props.selective_dynamics` exists, the velocities when they are not all zero. A number that would print as
 * -0.000… is written without the sign.
 */
import { Structure, fixDegenerateCell, addWarning, poscarOrder } from '../core/structure.js';
import { det3, fracToCart } from '../core/util.js';
import { ELEMENTS, normalizeSymbol } from '../core/elements.js';
import { FLAG_RE, MOVE_FLAGS_KEY, moveFlags } from '../core/constraints.js';

const LINE_BREAK = /\r\n|\r|\n/;
/** A number as Fortran writes it: optional sign, digits with an optional point, optional E or D exponent. */
const NUMBER = /^[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eEdD][-+]?[0-9]+)?$/;
const WHOLE = /^[0-9]+$/;
const NUMERIC_START = /^[-+]?[0-9]/;
const SYMBOL = /^[A-Z][a-z]?$/;
const COMMENT_SPLIT = /[ \t\f\v,]+/;
const CONFIGURATION = /configuration[ \t]*=/i;

const TOO_SHORT = 'POSCAR is too short: it needs a comment line, a scale factor, three lattice vectors, the atom counts and the coordinates';
const VASP4 = 'VASP 4 POSCAR without element names in the comment line; species set to X';
const DIRECT_VELOCITIES = 'velocities in direct coordinates were converted to Å/fs assuming a time step of 1 fs';
const LAST_CONFIGURATION = 'XDATCAR: the last configuration is incomplete and was skipped';
/** The lines of the lattice velocities of a CONTCAR: the title line, the initialization state, 3 velocities, 3 vectors. */
const LATTICE_VELOCITY_LINES = 8;
const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// ------------------------------------------------------------------------------------------------------ words
/** The words of `line` (split at spaces and tabs) before the first one that starts with ! or #. */
function words(line) {
  const out = [];
  for (const w of (line ?? '').match(/[^ \t\f\v]+/g) ?? []) {
    if (w[0] === '!' || w[0] === '#') break;
    out.push(w);
  }
  return out;
}

/** The first character of `line` that is not a space or a tab ('' for a blank line). */
const firstChar = (line) => ((line ?? '').match(/[^ \t\f\v]/) ?? [''])[0];
/** `word` quoted for a message (at most 32 characters). */
const show = (w) => `'${w.length <= 32 ? w : `${w.slice(0, 32)}...`}'`;
const isNumber = (w) => NUMBER.test(w);
const isCountsStart = (w) => NUMERIC_START.test(w);

/** `word` as a number (Fortran D exponents too); throws `line 4: expected a number, found 'x'`. */
function number(w, lineNo) {
  if (NUMBER.test(w)) {
    const x = Number(w.replace(/[dD]/, 'e'));
    if (Number.isFinite(x)) return x;
  }
  throw new Error(`line ${lineNo}: expected a number, found ${show(w)}`);
}

/** The first three words as numbers, or null when there are fewer than three or one is not a number. */
function numbers3(ws, lineNo) {
  if (ws.length < 3 || !ws.slice(0, 3).every(isNumber)) return null;
  try { return ws.slice(0, 3).map((w) => number(w, lineNo)); } catch { return null; }   // too large for a double
}

// ----------------------------------------------------------------------------------------------------- header
/** The scale line: three factors (x, y, z) when its first three words are numbers, else one factor. */
function scalesOf(ws, lineNo) {
  if (ws.length >= 3 && ws.slice(0, 3).every(isNumber)) return ws.slice(0, 3).map((w) => number(w, lineNo));
  if (!ws.length) throw new Error(`line ${lineNo}: expected the scale factor, found nothing`);
  return [number(ws[0], lineNo)];
}

function latticeVector(ws, lineNo) {
  if (ws.length < 3) throw new Error(`line ${lineNo}: a lattice vector needs three numbers, found ${ws.length}`);
  return ws.slice(0, 3).map((w) => number(w, lineNo));
}

/** The cell (VASP semantics of the scale line) and the factors of the Cartesian x, y and z components. */
function scaledCell(lattice, scales, lineNo) {
  let factor;
  if (scales.length === 3) factor = scales.slice();
  else if (scales[0] < 0) {
    const vol = Math.abs(det3(lattice));
    if (!(vol > 0)) throw new Error(`line ${lineNo}: a negative scale factor (target volume) needs a cell with a non-zero volume`);
    const f = Math.cbrt(-scales[0] / vol);
    factor = [f, f, f];
  } else factor = [scales[0], scales[0], scales[0]];
  return { cell: lattice.map((row) => row.map((v, k) => v * factor[k])), factor };
}

/** Rows of fractional or Cartesian coordinates as a flat Float64Array of Cartesian positions. */
function toPositions(rows, cell, factor, cartesian) {
  const pos = new Float64Array(3 * rows.length);
  rows.forEach((v, i) => pos.set(cartesian ? v.map((x, j) => x * factor[j]) : fracToCart(v, cell), 3 * i));
  return pos;
}

/** VASP 4: the element symbols written as such in the comment line, if there are enough of them. */
function vasp4Species(comment, nBlocks) {
  const found = comment.split(COMMENT_SPLIT).filter((w) => SYMBOL.test(w) && w !== 'X' && ELEMENTS.has(w));
  return found.length >= nBlocks ? found.slice(0, nBlocks) : null;
}

/** The poscar_species label of every species block, or null when no element has two blocks. */
function blockLabels(ws, elements) {
  const blocks = new Map();
  elements.forEach((e, b) => { if (!blocks.has(e)) blocks.set(e, []); blocks.get(e).push(b); });
  if ([...blocks.values()].every((bs) => bs.length === 1)) return null;
  const labels = elements.slice();
  for (const [e, bs] of blocks) {
    if (bs.length === 1) continue;
    const raw = bs.map((b) => ws[b]);
    const names = new Set(raw).size === raw.length ? raw : [e, ...bs.slice(1).map((_, t) => `${e}#${t + 2}`)];
    bs.forEach((b, t) => { labels[b] = names[t]; });
  }
  return labels;
}

/**
 * The cell and factors of the lattice header that ends just before line index `stop` (an XDATCAR configuration
 * line), within lines[start..stop); null when those lines do not end with a complete header.
 */
function frameHeader(lines, start, stop, natoms) {
  if (stop - 1 < start) return null;
  const countWords = words(lines[stop - 1]);
  if (!countWords.length || !countWords.every((c) => WHOLE.test(c))) return null;
  let top = stop - 1;                                    // the line after the lattice vectors
  if (stop - 2 >= start) {
    const sw = words(lines[stop - 2]);
    if (sw.length && !isCountsStart(sw[0])) top = stop - 2;   // a species line
  }
  if (top - 4 < start) return null;
  let header;
  try {
    const scales = scalesOf(words(lines[top - 4]), top - 3);
    const lattice = [0, 1, 2].map((t) => latticeVector(words(lines[top - 3 + t]), top - 2 + t));
    header = scaledCell(lattice, scales, top - 3);
  } catch { return null; }
  const total = countWords.reduce((a, c) => a + parseInt(c, 10), 0);
  if (total !== natoms) throw new Error(`line ${stop}: the XDATCAR header counts ${total} atoms instead of ${natoms}`);
  return header;
}

// ----------------------------------------------------------------------------------------------------- reader
/**
 * The velocity block that starts at line index `k` (just after the coordinates), as Cartesian Å/fs rows; null when
 * there is none, when it is incomplete (with a note) or when every velocity is zero.
 */
function velocitiesOf(lines, k, natoms, cell, notes) {
  if (k < lines.length && /^[Ll]$/.test(firstChar(lines[k]))) k += LATTICE_VELOCITY_LINES;   // "Lattice velocities and vectors": skipped
  if (k >= lines.length) return null;
  const cartesian = ['', 'C', 'c', 'K', 'k'].includes(firstChar(lines[k]));
  const rows = [];
  for (let i = 0; i < natoms; i++) {
    const j = k + 1 + i;
    const row = j < lines.length ? numbers3(words(lines[j]), j + 1) : null;
    if (!row) {
      if (i) notes.push(`velocities: the block after the coordinates is incomplete (line ${j + 1}); it was ignored`);
      return null;
    }
    rows.push(row);
  }
  if (!rows.some((r) => r.some((v) => v !== 0))) return null;
  if (cartesian) return rows;
  notes.push(DIRECT_VELOCITIES);
  return rows.map((r) => fracToCart(r, cell));
}

/** The XDATCAR configurations after the first one (which ends before line index `k`), as frames. */
function configurations(lines, k, natoms, cell, factor, notes) {
  const frames = [];
  for (;;) {
    let stop = k;
    while (stop < lines.length && !CONFIGURATION.test(lines[stop])) stop++;
    if (stop >= lines.length) return frames;
    const header = frameHeader(lines, k, stop, natoms);
    const fc = header ? header.cell : cell, ff = header ? header.factor : factor;
    const cartesian = ['c', 'C', 'k', 'K'].includes(firstChar(lines[stop]));
    const rows = [];
    for (let i = 0; i < natoms; i++) {
      const j = stop + 1 + i;
      const ws = j < lines.length ? words(lines[j]) : [];
      if (!ws.length) { notes.push(LAST_CONFIGURATION); return frames; }
      if (ws.length < 3) throw new Error(`line ${j + 1}: expected three coordinates, found ${ws.length}`);
      rows.push(ws.slice(0, 3).map((w) => number(w, j + 1)));
    }
    frames.push({ positions: toPositions(rows, fc, ff, cartesian), cell: header ? fc : null });
    k = stop + 1 + natoms;
  }
}

/**
 * Parse POSCAR, CONTCAR or XDATCAR text into a Structure (an XDATCAR's configurations as frames). See the header
 * of this file for what is read. Errors name the line, with the Python reader's text
 * (`line 7: expected the atom counts (whole numbers), found 'x'`).
 */
export function readPOSCAR(text, filename = '') {
  const lines = String(text ?? '').split(LINE_BREAK);
  if (lines.filter((x) => firstChar(x)).length < 7) throw new Error(TOO_SHORT);
  const comment = lines[0].replace(/^[ \t\f\v]+|[ \t\f\v]+$/g, '');
  const notes = [];
  const line = (k) => (k < lines.length ? lines[k] : '');

  const scales = scalesOf(words(line(1)), 2);
  const lattice = [2, 3, 4].map((k) => latticeVector(words(line(k)), k + 1));
  const { cell, factor } = scaledCell(lattice, scales, 2);

  let k = 5;
  let speciesWords = null;
  const first = words(line(k));
  if (first.length && !isCountsStart(first[0])) { speciesWords = first; k++; }
  const countWords = words(line(k));
  if (!countWords.length) throw new Error(`line ${k + 1}: expected the atom counts (whole numbers), found nothing`);
  for (const c of countWords) if (!WHOLE.test(c)) throw new Error(`line ${k + 1}: expected the atom counts (whole numbers), found ${show(c)}`);
  const counts = countWords.map((c) => parseInt(c, 10));
  let elements;
  if (!speciesWords) {
    elements = vasp4Species(comment, counts.length);
    if (!elements) { elements = counts.map(() => 'X'); notes.push(VASP4); }
    speciesWords = elements.slice();
  } else elements = speciesWords.map((w) => normalizeSymbol(w.split('/')[0].split('_')[0]));
  if (elements.length !== counts.length) throw new Error(`line ${k + 1}: ${elements.length} element names but ${counts.length} atom counts`);
  const natoms = counts.reduce((a, c) => a + c, 0);
  k++;

  const noMode = () => new Error(`line ${k + 1}: expected the coordinate mode (Direct or Cartesian), found nothing`);
  if (k >= lines.length) throw noMode();
  const selective = /^[sS]$/.test(firstChar(lines[k]));
  if (selective) { k++; if (k >= lines.length) throw noMode(); }
  const mode = lines[k];
  const cartesian = ['c', 'C', 'k', 'K'].includes(firstChar(mode));
  const xdatcar = CONFIGURATION.test(mode);
  k++;

  const coords = [], flags = [];
  let problems = 0, firstProblem = '';
  for (let i = 0; i < natoms; i++) {
    const j = k + i;
    const ws = j < lines.length ? words(lines[j]) : [];
    if (!ws.length) throw new Error(`expected ${natoms} coordinate line(s), found ${i}`);
    if (ws.length < 3) throw new Error(`line ${j + 1}: expected three coordinates, found ${ws.length}`);
    coords.push(ws.slice(0, 3).map((w) => number(w, j + 1)));
    if (!selective) continue;
    const rest = ws.slice(3);
    let row, bad = '';
    if (rest.length < 3) { row = [true, true, true]; bad = 'no flags'; } else {
      row = rest.slice(0, 3).map((w) => {
        const m = FLAG_RE.exec(w);
        if (!m && !bad) bad = show(w);
        return m ? m[1] === 'T' || m[1] === 't' : true;
      });
    }
    flags.push(row);
    if (bad) { problems++; firstProblem ||= `line ${j + 1}, ${bad}`; }
  }
  k += natoms;
  if (problems) {
    notes.push(`selective dynamics: ${problems} line(s) had missing or unreadable T/F flags (first: ${firstProblem}); those directions were read as T (free)`);
  }

  const positions = toPositions(coords, cell, factor, cartesian);
  const symbols = [];
  elements.forEach((e, b) => { for (let t = 0; t < counts[b]; t++) symbols.push(e); });
  const props = {};
  if (selective) props[MOVE_FLAGS_KEY] = flags;
  const labels = blockLabels(speciesWords, elements);
  if (labels) {
    props.poscar_species = [];
    labels.forEach((lab, b) => { for (let t = 0; t < counts[b]; t++) props.poscar_species.push(lab); });
  }
  let frames = [];
  if (xdatcar) frames = configurations(lines, k, natoms, cell, factor, notes);
  else {
    const v = velocitiesOf(lines, k, natoms, cell, notes);
    if (v) props.velocities = v;
  }
  const info = { source: 'poscar' };
  if (notes.length) info.warnings = notes;
  const fix = fixDegenerateCell(cell, [true, true, true], positions);
  const s = new Structure({ name: comment.slice(0, 120) || filename || 'POSCAR', symbols, positions, cell: fix.cell, pbc: fix.pbc, frames, props, info });
  addWarning(s.info, fix.warning);
  return s;
}

// ----------------------------------------------------------------------------------------------------- writer
/** `v` with `d` decimals; a value that rounds to zero is written without a minus sign. */
function fixed(v, d) {
  const t = v.toFixed(d);
  return /^-[0.]*$/.test(t) ? t.slice(1) : t;
}

/** The velocities the writer writes: one row of three finite numbers per atom, not all zero; else null. */
function velocityRows(s) {
  const col = has(s.props, 'velocities') ? s.props.velocities : null;
  if (!Array.isArray(col) || col.length !== s.length) return null;
  const rows = [];
  for (const v of col) {
    const r = ArrayBuffer.isView(v) ? Array.from(v) : v;
    if (!Array.isArray(r) || r.length !== 3 || !r.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
    rows.push(r);
  }
  return rows.some((r) => r.some((x) => x !== 0)) ? rows : null;
}

/**
 * The block label of every atom: its poscar_species label when that names the atom's element (a label left
 * behind by changing an atom's element is ignored), else the element symbol.
 */
function speciesBlocks(s) {
  const col = has(s.props, 'poscar_species') && Array.isArray(s.props.poscar_species) && s.props.poscar_species.length === s.length
    ? s.props.poscar_species : null;
  return s.symbols.map((sym, i) => {
    const lab = col ? col[i] : null;
    return typeof lab === 'string' && lab && normalizeSymbol(lab) === sym ? lab : sym;
  });
}

/**
 * VASP 5 POSCAR text of the current frame (Direct coordinates). `order` 'species' (default) groups the atoms into one
 * block per species in order of first appearance; 'keep' keeps the atom order and writes one block per run of atoms
 * of one species (an element may then appear twice, which VASP accepts unless machine-learned force fields are on).
 * Throws for a structure without a cell.
 */
export function writePOSCAR(s, { order = 'species' } = {}) {
  if (order !== 'species' && order !== 'keep') throw new Error("order must be 'species' or 'keep'");
  if (!s.cell) throw new Error('POSCAR needs a unit cell. Add a cell or export as XYZ instead.');
  const labels = speciesBlocks(s);
  const idx = order === 'species' ? poscarOrder(s.symbols, null, labels) : s.symbols.map((_, i) => i);
  const names = [], counts = [];
  let prev = null;
  for (const i of idx) {
    if (labels[i] !== prev) { names.push(s.symbols[i]); counts.push(0); prev = labels[i]; }
    counts[counts.length - 1]++;
  }
  const frac = s.fracPositions();
  const flags = has(s.props, MOVE_FLAGS_KEY) ? moveFlags(s) : null;
  const velocities = velocityRows(s);
  const lines = [String(s.name || s.formula()).replace(/[\r\n]/g, ' '), '1.0'];
  for (const r of s.cell) lines.push('  ' + r.map((v) => fixed(v, 10).padStart(16)).join(' '));
  lines.push('  ' + names.join('  '));
  lines.push('  ' + counts.join('  '));
  if (flags) lines.push('Selective dynamics');
  lines.push('Direct');
  for (const i of idx) {
    let row = '  ' + [0, 1, 2].map((k) => fixed(frac[3 * i + k], 10).padStart(14)).join(' ');
    if (flags) row += '  ' + flags[i].map((f) => (f ? 'T' : 'F')).join('  ');
    lines.push(row);
  }
  if (velocities) {
    lines.push('');
    for (const i of idx) lines.push('  ' + velocities[i].map((v) => fixed(v, 10).padStart(14)).join(' '));
  }
  return lines.join('\n') + '\n';
}
