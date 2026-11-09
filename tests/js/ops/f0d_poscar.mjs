// F0-D POSCAR: JS halves of the ops in tests/ops/f0d_poscar.py (see its docstring), for the shared cases
// tests/data/surface/f0d/poscar.json, with the same arguments, results and argument errors. They test
// web/js/io/poscar.js; written files are compared through the canonical form of acceptance scenario S14
// (poscarCanonical, exported for tests/js/io_poscar.test.mjs).
import { op } from '../cases.mjs';
import { FLAG_RE } from '../../../crystallume/web/js/core/constraints.js';
import { getWarnings } from '../../../crystallume/web/js/core/structure.js';
import { readPOSCAR, writePOSCAR } from '../../../crystallume/web/js/io/poscar.js';

const LINES = /\r\n|\r|\n/;
const NUMBER = /^[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eEdD][-+]?[0-9]+)?$/;

function take(args, name, allowed, required = []) {
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k)).sort();
  if (unknown.length) throw new Error(`${name}: unknown args ${unknown.join(', ')}`);
  for (const k of required) if (!(k in args)) throw new Error(`${name}: missing arg ${k}`);
  return args;
}

// ------------------------------------------------------------------------------------------- canonical form
function canonNumber(w) {
  if (!NUMBER.test(w)) return w;
  const t = Number(w.replace(/[dD]/, 'e')).toFixed(10);
  return /^-[0.]*$/.test(t) ? t.slice(1) : t;
}

function canonFlag(w) {
  const m = FLAG_RE.exec(w);
  return m ? m[1].toUpperCase() : w;
}

const first = (ws) => (ws.length ? ws[0][0] : '');

/** The canonical form of POSCAR text (acceptance scenario S14): equal forms mean "the same file". */
export function poscarCanonical(text) {
  const lines = text.split(LINES);
  const words = (k) => (k < lines.length ? lines[k].match(/[^ \t\f\v]+/g) ?? [] : []);
  const out = [words(0).join(' ')];
  for (const k of [1, 2, 3, 4]) out.push(words(k).map(canonNumber).join(' '));
  let k = 5;
  if (words(k).length && !/^[-+]?[0-9]/.test(words(k)[0])) { out.push(words(k).join(' ')); k++; }
  const counts = words(k);
  out.push(counts.join(' '));
  const n = counts.filter((c) => /^[0-9]+$/.test(c)).reduce((a, c) => a + parseInt(c, 10), 0);
  k++;
  const selective = ['s', 'S'].includes(first(words(k)));
  if (selective) { out.push('Selective dynamics'); k++; }
  out.push(first(words(k)).toUpperCase());
  k++;
  for (let i = 0; i < n; i++) {
    const w = words(k + i);
    const row = w.slice(0, 3).map(canonNumber);
    if (selective) row.push(...w.slice(3, 6).map(canonFlag));
    out.push(row.join(' '));
  }
  k += n;
  if (['L', 'l'].includes(first(words(k)))) k += 8;
  if (k < lines.length) {
    const mode = ['', 'C', 'c', 'K', 'k'].includes(first(words(k))) ? 'C' : 'D';
    let rows = [];
    for (let i = 0; i < n; i++) {
      const w = words(k + 1 + i);
      if (w.length < 3 || !w.slice(0, 3).every((x) => NUMBER.test(x))) { rows = null; break; }
      rows.push(w.slice(0, 3).map(canonNumber));
    }
    if (rows && rows.some((r) => r.some((x) => Number(x) !== 0))) {
      out.push(`velocities ${mode}`);
      for (const r of rows) out.push(r.join(' '));
    }
  }
  return out;
}

/** The lines where two canonical forms differ (`line 3: '...' / '...'`), and a length difference. */
function diff(a, b) {
  const out = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) out.push(`line ${i + 1}: '${a[i]}' / '${b[i]}'`);
  if (a.length !== b.length) out.push(`${a.length} lines / ${b.length} lines`);
  return out;
}

function textInput(inp, name) {
  if (inp.kind !== 'text' && inp.kind !== 'file') throw new Error(`${name}: needs a text or file input`);
  return inp.text;
}

const rows = (p) => Array.from({ length: p.length / 3 }, (_, i) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]]);
const cellOf = (c) => (c ? c.map((r) => Array.from(r)) : null);

// ------------------------------------------------------------------------------------------------------- ops
op('poscarCanon', (inp, args) => {
  take(args, 'poscarCanon', []);
  return { value: poscarCanonical(textInput(inp, 'poscarCanon')) };
});

op('poscarWrite', (inp, args) => {
  take(args, 'poscarWrite', ['order', 'append']);
  const s = inp.kind === 'text' || inp.kind === 'file' ? readPOSCAR(inp.text) : inp.structure.clone();
  for (const item of args.append ?? []) {
    if (!Array.isArray(item) || item.length !== 2) throw new Error('poscarWrite: append must be a list of [symbol, [x, y, z]]');
    s.addAtom(item[0], item[1]);
  }
  const text = writePOSCAR(s, 'order' in args ? { order: args.order } : {});
  return { text, value: poscarCanonical(text), structure: readPOSCAR(text) };
});

op('poscarFrames', (inp, args) => {
  take(args, 'poscarFrames', []);
  const s = readPOSCAR(textInput(inp, 'poscarFrames'));
  const frames = [{ positions: rows(s._base), cell: cellOf(s._baseCell) }];
  for (const f of s.frames) frames.push({ positions: rows(f.positions), cell: cellOf(f.cell ?? s._baseCell) });
  return { structure: s, value: { frames, ownCells: s.frames.map((f) => f.cell != null) } };
});

op('poscarRoundtrip', (inp, args) => {
  take(args, 'poscarRoundtrip', []);
  const original = textInput(inp, 'poscarRoundtrip');
  const s = readPOSCAR(original);
  const text = writePOSCAR(s);
  const back = readPOSCAR(text);
  let shift = 0;
  for (let i = 0; i < s.length; i++) {
    const a = s.pos(i), b = back.pos(i);
    shift = Math.max(shift, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  const flags = (x) => JSON.stringify(x.props.selective_dynamics ?? null);
  return {
    text, structure: back, value: {
      canonicalDiff: diff(poscarCanonical(original), poscarCanonical(text)),
      maxShift: shift,
      sameFlags: flags(back) === flags(s),
      sameSymbols: JSON.stringify(back.symbols) === JSON.stringify(s.symbols),
      pbc: back.pbc,
      readNotes: getWarnings(s.info),
    },
  };
});
