/**
 * Format registry. Readers/writers can be added at runtime by plugins:
 *   formats.register({ id, name, extensions, read(text, filename) => Structure, write(structure) => string,
 *                      capabilities })
 * Formats without a JS reader can be delegated to the Python server (see storage/server.js).
 *
 * Export check: `capabilities` (io/capabilities.js) says what a writer can store; exportReport compares it with
 * the structure (warnings: what the file loses; notes: what changes without affecting a calculation), with the
 * same rules and words as Python's facet.io.export_report. A format without capabilities gets no report.
 */
import { readXYZ, writeXYZ, extxyzColumns, formatInfoValue } from './xyz.js';
import { det3, slug } from '../core/util.js';
import { readPOSCAR, writePOSCAR, speciesBlocks, velocityRows } from './poscar.js';
import { readCIF, writeCIF } from './cif.js';
import { readPDB, writePDB } from './pdb.js';
import { readXSD, writeXSD, cellOrientation, nonElements } from './xsd.js';
import { readJSON, writeJSON } from './jsonfmt.js';
import { OCCUPANCY_TOLERANCE, OVERLAP_CHECK_MAX_ATOMS, WRITER_CAPABILITIES, validateCapabilities } from './capabilities.js';
import { RESULT_INFO, RESULT_PROPS, poscarOrder } from '../core/structure.js';
import { constraintSummary, latticeToCartesianMask, moveFlags } from '../core/constraints.js';
import { closeContacts } from '../core/contacts.js';
import { findVacuumGap } from '../core/vacuum.js';
import { SURFACE_DEFAULTS } from '../core/defaults.js';

const registry = new Map();

/**
 * Parse one numeric token for a reader. Accepts Fortran exponents (1.0D+00) and throws a message
 * that names the format and line, e.g. 'XYZ: line 4: expected a number, found "x"'.
 * (A function declaration so readers can import it despite the import cycle with this module.)
 */
export function num(tok, fmt = 'File', line = null) {
  const raw = tok == null ? '' : String(tok).trim();
  const v = raw === '' ? NaN : Number(raw.replace(/[dD]/, 'e'));
  if (!Number.isFinite(v)) {
    const where = line != null ? `${fmt}: line ${line}` : fmt;
    throw new Error(`${where}: expected a number, found ${raw ? `"${raw.slice(0, 32)}"` : 'nothing'}`);
  }
  return v;
}

export const formats = {
  /**
   * Add (or replace) a format. `capabilities` (validated, see io/capabilities.js) turns on the export check of its
   * writer; invalid capabilities are reported with console.warn and dropped (the format still works, unchecked).
   */
  register(fmt) {
    if (!fmt?.id) throw new Error('format needs an id');
    let capabilities = null;
    if (fmt.capabilities != null) {
      try { capabilities = validateCapabilities(fmt.id, fmt.capabilities); }
      catch (e) { console.warn(`Facet: ${e.message}; the export check of this format is off`); }
    }
    registry.set(fmt.id, { extensions: [], filenames: [], mime: 'text/plain', ...fmt, capabilities });
    return () => registry.delete(fmt.id);
  },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
  readers: () => [...registry.values()].filter((f) => f.read),
  writers: () => [...registry.values()].filter((f) => f.write),
};

const CAPS = WRITER_CAPABILITIES;
formats.register({ id: 'xyz', name: 'XYZ', extensions: ['xyz'], read: readXYZ, write: (s) => writeXYZ(s, { extended: false }), description: 'Plain XYZ (multi-frame)', capabilities: CAPS.xyz });
formats.register({ id: 'extxyz', name: 'Extended XYZ', extensions: ['extxyz'], read: readXYZ, write: (s) => writeXYZ(s, { extended: true }), description: 'XYZ with Lattice/Properties header', capabilities: CAPS.extxyz });
formats.register({ id: 'poscar', name: 'VASP POSCAR', extensions: ['vasp', 'poscar'], filenames: ['POSCAR', 'CONTCAR', 'XDATCAR'], read: readPOSCAR, write: writePOSCAR, description: 'VASP 4/5 POSCAR, CONTCAR, XDATCAR', capabilities: CAPS.poscar });
formats.register({ id: 'cif', name: 'CIF', extensions: ['cif', 'mcif'], read: readCIF, write: writeCIF, description: 'Crystallographic Information File (symmetry expanded)', capabilities: CAPS.cif });
formats.register({ id: 'pdb', name: 'PDB', extensions: ['pdb', 'ent'], read: readPDB, write: writePDB, description: 'Protein Data Bank (ATOM/HETATM, CRYST1, MODEL)', capabilities: CAPS.pdb });
formats.register({ id: 'xsd', name: 'Materials Studio XSD', extensions: ['xsd'], read: readXSD, write: writeXSD, mime: 'application/xml', description: 'Materials Studio XSD (3D atomistic document; save as .xsd)', capabilities: CAPS.xsd });
formats.register({ id: 'json', name: 'Facet JSON', extensions: ['json'], read: readJSON, write: writeJSON, mime: 'application/json', description: 'Native structure JSON', capabilities: CAPS.json });

export function detectFormat(filename = '', text = '') {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const upper = base.toUpperCase();
  for (const f of registry.values()) if (f.filenames.some((n) => upper.startsWith(n))) return f.id;
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  for (const f of registry.values()) if (f.extensions.includes(ext)) return f.id;
  // sniff content
  const head = text.slice(0, 2000);
  if (/^\s*[{[]/.test(head)) return 'json';
  if (/^\s*</.test(head) && /<XSD|<!DOCTYPE XSD/.test(head)) return 'xsd';
  if (/^data_|_cell[._]length_a/m.test(head)) return 'cif';
  if (/^(ATOM  |HETATM|CRYST1)/m.test(head)) return 'pdb';
  if (/^\s*\d+\s*\n/.test(head)) return 'xyz';
  const lines = head.split(/\r?\n/);
  if (lines.length > 7 && Number.isFinite(parseFloat(lines[1])) && lines.slice(2, 5).every((l) => l.trim().split(/\s+/).length >= 3)) return 'poscar';
  return null;
}

/** Parse text into a Structure. Throws Error with a helpful message, or Error.project for project files. */
export function parseStructure(text, filename = '', format = null) {
  const id = format ?? detectFormat(filename, text);
  if (!id) throw new Error(`Could not tell the format of "${filename || 'pasted text'}". Supported: ${formats.readers().map((f) => f.name).join(', ')}.`);
  const fmt = registry.get(id);
  if (!fmt?.read) throw new Error(`No reader for format "${id}".`);
  const finish = (s) => {
    if (!s?.length) throw new Error('The file was read but contains no atoms.');
    checkFinite(s, fmt.name ?? id);
    if (!s.info.source) s.info.source = id;
    return s;
  };
  const s = fmt.read(text, filename);
  return typeof s?.then === 'function' ? s.then(finish) : finish(s);   // async readers (e.g. server formats) give a Promise
}

/** Final guard: every position of every frame must be a finite number (readers from plugins included). */
function checkFinite(s, name) {
  const check = (p, frame) => {
    for (let i = 0; i < p.length; i++) {
      if (!Number.isFinite(p[i])) {
        throw new Error(`${name}: atom ${Math.floor(i / 3) + 1}${frame ? ` in frame ${frame + 1}` : ''} has an invalid position (${p[i]}). Check the coordinates in the file.`);
      }
    }
  };
  check(s._base ?? s.positions, 0);
  (s.frames ?? []).forEach((f, k) => check(f.positions, k + 1));
  if (s.cell && !s.cell.every((r) => r.every(Number.isFinite))) throw new Error(`${name}: the unit cell contains invalid numbers.`);
}

/**
 * Write `structure` (its current frame for the single-frame formats) with the `formatId` writer. Synchronous:
 * `text` is a string, or a Promise for formats written by the server; `warnings` and `notes` are always arrays,
 * computed here by exportReport (for server formats too, from the capabilities GET /formats gave them; the server
 * gets the whole structure and, like every Python writer, writes frame 0, so that is the frame they describe).
 * @returns {{text: string | Promise<string>, filename: string, mime: string, warnings: string[], notes: string[]}}
 */
export function exportStructure(structure, formatId) {
  const fmt = registry.get(formatId);
  if (!fmt?.write) throw new Error(`No writer for format "${formatId}".`);
  const ext = fmt.extensions[0] ?? formatId;
  const base = slug(structure.name);   // the same name (and 'untitled' fallback) as the PNG / GLB exports of this structure
  const filename = formatId === 'poscar' ? `${base}.vasp` : `${base}.${ext}`;
  const text = fmt.write(structure);
  const { warnings, notes } = exportReport(structure, formatId);
  return { text, filename, mime: fmt.mime, warnings, notes };
}

// ------------------------------------------------------------------------------------------------- export check
/** The words for "the other formats" in the advice of the warnings and notes. */
const KEEPERS = 'use POSCAR, Extended XYZ or Facet JSON to keep them';
const AXES = 'abc';

/** `x` (>= 0) with `d` decimals, rounding halves up (the same digits as the Python twin). */
function fixed(x, d) {
  const scale = 10 ** d;
  const q = Math.floor(x * scale + 0.5);
  return d ? `${Math.floor(q / scale)}.${String(q % scale).padStart(d, '0')}` : String(q);
}

const isNumber = (x) => typeof x === 'number' && Number.isFinite(x);
const isList = (v) => Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));

/** The sites whose occupancy is a number further than OCCUPANCY_TOLERANCE from 1. */
function partlyOccupied(s) {
  const col = s.props?.occupancy;
  if (!isList(col)) return 0;
  let q = 0;
  for (const v of col) if (isNumber(v) && Math.abs(v - 1) > OCCUPANCY_TOLERANCE) q++;
  return q;
}

/** Whether props.velocities holds a finite number other than zero. */
function hasVelocities(s) {
  const col = s.props?.velocities;
  if (!isList(col)) return false;
  for (const row of col) for (const x of isList(row) ? row : [row]) if (isNumber(x) && x !== 0) return true;
  return false;
}

/** The calculated results the extended XYZ writer writes for the first frame only: columns, then info keys. */
function resultNames(s, columns) {
  const names = columns.filter((c) => RESULT_PROPS.includes(c.name)).map((c) => c.name);
  for (const [k, v] of Object.entries(s.info ?? {})) if (RESULT_INFO.includes(k) && formatInfoValue(k, v) !== null) names.push(k);
  return names;
}

/** The export check of writer `id` with capabilities `caps` (F0-D §3.12.2; the Python twin is `_report`). */
function report(s, id, caps, frame) {
  const n = s.nFrames;
  const k = s._frameIndex(frame ?? 'current');
  const F = caps.label;
  const cell = s._frameCell(k);
  const warnings = [], notes = [];
  // W1, W2 (W3, a cell-less structure boxed by the writer, is Python only: the web POSCAR and CIF writers need a cell)
  if (caps.frames === 'one' && n > 1) warnings.push(`${F} holds one frame: wrote frame ${k + 1} of ${n}`);
  if (caps.cell === false && cell) warnings.push(`${F} does not store the unit cell; use Extended XYZ to keep it`);
  // W4-W6: constraints
  const c = constraintSummary(s);
  const m = c.fixed + c.partial;
  if (m && caps.constraints === 'none') {
    warnings.push(`${m} atom(s) are fixed or partly fixed (selective dynamics), but ${F} cannot store constraints; ${KEEPERS}`);
  }
  if (m && caps.constraints === 'cartesian') {
    let mask = [], tightened = 0;
    try { ({ mask, tightened } = latticeToCartesianMask(moveFlags(s), s._frameCell(0))); } catch { /* a cell that cannot be inverted: the writer fails as well */ }
    if (tightened) {
      warnings.push(`${F} stores constraints along x, y and z (ASE move_mask): the partial constraints of ${tightened} atom(s) are along cell vectors that are not x, y or z and were tightened; POSCAR keeps them exactly`);
    }
    const partial = mask.filter((r) => r.some(Boolean) && !r.every(Boolean)).length;
    if (partial) {
      warnings.push(`${F} stores these constraints as ASE FixCartesian masks because ${partial} atom(s) are only partly fixed; ASE's VASP writer ignores FixCartesian and would write every atom as free, so export POSCAR from Facet for VASP`);
    }
  }
  if (c.partial && caps.constraints === 'atoms') {
    warnings.push(`${c.partial} atom(s) are fixed along some directions only; ${F} fixes whole atoms, so they are written as fixed`);
  }
  // W7: occupancies
  const q = partlyOccupied(s);
  if (q && caps.occupancy === false) warnings.push(`${q} site(s) are partially occupied, but ${F} cannot store occupancy; they are written as full atoms`);
  // W8, W9: the columns and frames of the extended XYZ writer
  if (id === 'extxyz') {
    const { columns, skipped } = extxyzColumns(s);
    for (const [key, reason] of skipped) warnings.push(`property '${key}' was not written: ${reason}`);
    if (n > 1) {
      const names = resultNames(s, columns);
      if (names.length) {
        const one = names.length === 1;
        warnings.push(`${names.join(', ')} ${one ? 'is' : 'are'} known only for frame 1 and ${one ? 'was' : 'were'} written for that frame only`);
      }
    }
  }
  // W10: a left-handed cell
  if (caps.handedness && cell && det3(cell) < 0) {
    warnings.push('the cell is left-handed (negative volume); VASP stops on such cells, so swap two cell vectors first');
  }
  // Materials Studio XSD (docs/design/xsd-export §5.1, §5.4): symbols that are not elements, the cell as written
  let orientation = null;
  if (id === 'xsd') {
    const odd = nonElements(s.symbols);
    if (odd.length) {
      const count = s.symbols.filter((sym) => odd.includes(sym)).length;
      warnings.push(`${count} atom(s) have a symbol that is not a chemical element (${odd.join(', ')}); Materials Studio may not recognise them`);
    }
    if (cell) { try { orientation = cellOrientation(cell); } catch { /* a cell without volume: the writer fails as well */ } }
    if (orientation === 'left-handed') {
      warnings.push('the cell is left-handed (negative volume) and is written as it is; Materials Studio may show its mirror image');
    }
  }
  // W11: overlapping atoms, with the periodicity the written file has (positions that are not finite: no check)
  const finite = Array.prototype.every.call(s._framePositions(k), Number.isFinite);
  let skippedCheck = false;
  if (caps.overlap && finite) {
    if (s.length > OVERLAP_CHECK_MAX_ATOMS) skippedCheck = true;
    else {
      const pbc = { periodic: [true, true, true], stored: [0, 1, 2].map((a) => !!s.pbc?.[a]), none: [false, false, false] }[caps.pbc];
      const pairs = closeContacts(k === s.frame ? s : s.getFrame(k), { pbc });
      if (pairs.length) {
        const [i, j, d] = pairs[0];
        warnings.push(`${pairs.length} pair(s) of atoms are closer than ${SURFACE_DEFAULTS.overlapDistance} Å (e.g. atoms ${i + 1} and ${j + 1}, ${fixed(d, 2)} Å apart)`);
      }
    }
  }
  // N1-N3
  if (caps.order === 'species' && s.length) {
    const idx = poscarOrder(s.symbols, null, speciesBlocks(s));
    if (idx.some((v, t) => v !== t)) notes.push(`${F} groups atoms by element, so the atom order in the file differs from the order in the structure; sort the atoms by species to make them match`);
  }
  if (orientation === 'rotated') {
    notes.push("the cell is written in Materials Studio's orientation (c along z, b in the yz plane): the structure is turned as a whole and the fractional coordinates are unchanged");
  }
  if ((id === 'poscar' || id === 'xsd') && cell && finite) {
    for (let axis = 0; axis < 3; axis++) {
      if (s.pbc?.[axis]) continue;
      const gap = findVacuumGap(s, axis, { minWidth: 0, frame: k, periodicOnly: false });
      if (gap) notes.push(`${F} is always periodic: ${AXES[axis]} was not periodic and is written as a cell vector with a ${fixed(gap.width, 1)} Å gap between periodic images`);
    }
  }
  // lead decision L-01: a note when the file drops the velocities; a format that does not declare the optional
  // capability gets none (nothing is guessed)
  if (caps.velocities != null && hasVelocities(s)) {
    if (caps.velocities === false) notes.push(`the atoms have velocities, but ${F} cannot store them; ${KEEPERS}`);
    // the writer's own rule: three finite numbers for every atom, or none
    else if (id === 'poscar' && !velocityRows(s)) notes.push(`the velocities were not written: ${F} needs three finite numbers for every atom`);
  }
  if (skippedCheck) notes.push(`the overlap check was skipped for more than ${String(OVERLAP_CHECK_MAX_ATOMS).replace(/\B(?=(\d{3})+$)/g, ' ')} atoms`);
  return { warnings, notes };
}

/**
 * What writing `s` as `formatId` loses or changes: `{warnings, notes}` (word for word Python's
 * facet.io.export_report). Warnings change a calculation or lose data: a single-frame format, the unit cell,
 * constraints, partial occupancies, props Extended XYZ cannot write, results known only for the first frame, a
 * left-handed cell, atoms closer than 0.5 Å; for Materials Studio XSD also atoms fixed along some directions only
 * (written as fixed) and symbols that are not elements. Notes do not: the POSCAR atom order, a non-periodic axis
 * written as a POSCAR or XSD cell vector, the cell of an XSD file turned into Materials Studio's orientation,
 * velocities a format cannot store (or POSCAR velocities that are not three finite numbers for every atom), a
 * skipped overlap check (more than 200 000 atoms). `frame` is the frame the file holds (default: the
 * current frame, which the web writers write; frame 0 for a format the server writes, as the Python writers and
 * the server's own report do). Synchronous for every format (server formats use the capabilities copied from
 * GET /formats); a format without capabilities gives empty lists, an unknown one throws.
 * @returns {{warnings: string[], notes: string[]}}
 */
export function exportReport(s, formatId, { frame } = {}) {
  const fmt = registry.get(formatId);
  if (!fmt?.write) throw new Error(`No writer for format "${formatId}".`);
  if (!fmt.capabilities) return { warnings: [], notes: [] };
  return report(s, formatId, fmt.capabilities, frame ?? (fmt.server ? 0 : null));
}
