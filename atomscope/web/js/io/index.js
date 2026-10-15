/**
 * Format registry. Readers/writers can be added at runtime by plugins:
 *   formats.register({ id, name, extensions, read(text, filename) => Structure, write(structure) => string })
 * Formats without a JS reader can be delegated to the Python server (see storage/server.js).
 */
import { readXYZ, writeXYZ } from './xyz.js';
import { slug } from '../core/util.js';
import { readPOSCAR, writePOSCAR } from './poscar.js';
import { readCIF, writeCIF } from './cif.js';
import { readPDB, writePDB } from './pdb.js';
import { readJSON, writeJSON } from './jsonfmt.js';

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
  register(fmt) {
    if (!fmt?.id) throw new Error('format needs an id');
    registry.set(fmt.id, { extensions: [], filenames: [], mime: 'text/plain', ...fmt });
    return () => registry.delete(fmt.id);
  },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
  readers: () => [...registry.values()].filter((f) => f.read),
  writers: () => [...registry.values()].filter((f) => f.write),
};

formats.register({ id: 'xyz', name: 'XYZ', extensions: ['xyz'], read: readXYZ, write: (s) => writeXYZ(s, { extended: false }), description: 'Plain XYZ (multi-frame)' });
formats.register({ id: 'extxyz', name: 'Extended XYZ', extensions: ['extxyz'], read: readXYZ, write: (s) => writeXYZ(s, { extended: true }), description: 'XYZ with Lattice/Properties header' });
formats.register({ id: 'poscar', name: 'VASP POSCAR', extensions: ['vasp', 'poscar'], filenames: ['POSCAR', 'CONTCAR', 'XDATCAR'], read: readPOSCAR, write: writePOSCAR, description: 'VASP 4/5 POSCAR, CONTCAR, XDATCAR' });
formats.register({ id: 'cif', name: 'CIF', extensions: ['cif', 'mcif'], read: readCIF, write: writeCIF, description: 'Crystallographic Information File (symmetry expanded)' });
formats.register({ id: 'pdb', name: 'PDB', extensions: ['pdb', 'ent'], read: readPDB, write: writePDB, description: 'Protein Data Bank (ATOM/HETATM, CRYST1, MODEL)' });
formats.register({ id: 'json', name: 'AtomScope JSON', extensions: ['json'], read: readJSON, write: writeJSON, mime: 'application/json', description: 'Native structure JSON' });

export function detectFormat(filename = '', text = '') {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const upper = base.toUpperCase();
  for (const f of registry.values()) if (f.filenames.some((n) => upper.startsWith(n))) return f.id;
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  for (const f of registry.values()) if (f.extensions.includes(ext)) return f.id;
  // sniff content
  const head = text.slice(0, 2000);
  if (/^\s*[{[]/.test(head)) return 'json';
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

export function exportStructure(structure, formatId) {
  const fmt = registry.get(formatId);
  if (!fmt?.write) throw new Error(`No writer for format "${formatId}".`);
  const ext = fmt.extensions[0] ?? formatId;
  const base = slug(structure.name);   // the same name (and 'untitled' fallback) as the PNG / GLB exports of this structure
  const filename = formatId === 'poscar' ? `${base}.vasp` : `${base}.${ext}`;
  return { text: fmt.write(structure), filename, mime: fmt.mime };
}
