/**
 * PDB reader (ATOM/HETATM, CRYST1, MODEL frames) and writer. The residue names are `props.residue_names`, as in the
 * Python reader, and the notes in `info.warnings` are worded as the Python reader words them.
 */
import { Structure, addWarning } from '../core/structure.js';
import { num } from './index.js';
import { cellFromParams, cellParams } from '../core/util.js';
import { normalizeSymbol } from '../core/elements.js';

const isNum = (t) => t != null && t.trim() !== '' && Number.isFinite(Number(t));

/**
 * One ATOM/HETATM record: { xyz, name, el, res } from the fixed columns (x, y, z in 31–54, atom name
 * 13–16, residue 18–20, element 77–78). A sloppy whitespace-separated line
 * (`ATOM serial name resname [chain] resseq x y z [occ b] [element]`) is read by tokens instead, as the
 * Python reader does: name and residue are the 3rd and 4th tokens, the element is a trailing 1–2 letter token.
 */
function parseAtom(line, lineNo) {
  const fixed = [line.slice(30, 38), line.slice(38, 46), line.slice(46, 54)];
  const cols = (xyz) => ({ xyz, name: line.slice(12, 16).trim(), el: line.slice(76, 78).trim(), res: line.slice(17, 20).trim() });
  if (fixed.every(isNum)) return cols(fixed.map(Number));
  // a line laid out in standard columns (decimal points at 35/43/51) has a bad number: say which
  if ([34, 42, 50].some((k) => line[k] === '.')) return cols(fixed.map((x) => num(x, 'PDB', lineNo)));
  // fallback: the first run of three numbers after the residue number
  const t = line.trim().split(/\s+/);
  const idx = [];
  for (let k = t.length - 1; k > 1; k--) {
    if (isNum(t[k])) idx.push(k);
    else if (idx.length >= 3) break;
  }
  idx.sort((a, b) => a - b);
  if (idx.length >= 3) {
    const start = idx.length >= 4 && !t[idx[0]].includes('.') ? idx[1] : idx[0];
    if (start + 2 < t.length) {
      const xyz = [0, 1, 2].map((d) => num(t[start + d], 'PDB', lineNo));
      // element: a last token after the coordinates such as "O", "FE" or "N1+"
      const last = t.length - 1 > start + 2 ? /^([A-Za-z]{1,2})\d?[+-]?$/.exec(t[t.length - 1]) : null;
      return { xyz, name: start > 2 ? t[2] : '', el: last ? last[1] : '', res: start > 3 ? t[3] : '' };
    }
  }
  const bad = fixed.find((x) => !isNum(x)) ?? '';
  return num(bad, 'PDB', lineNo);   // throws 'PDB: line N: expected a number, found "…"'
}

export function readPDB(text, filename = '') {
  const models = [];
  let cur = null, cell = null, title = '';
  const residues = [];
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    const rec = line.slice(0, 6).toUpperCase();
    const is = (r) => rec.startsWith(r);
    if (is('TITLE') || is('COMPND') || is('HEADER')) { if (!title) title = line.slice(10).trim(); continue; }
    if (is('CRYST1')) {
      let p = [line.slice(6, 15), line.slice(15, 24), line.slice(24, 33), line.slice(33, 40), line.slice(40, 47), line.slice(47, 54)];
      if (!p.slice(0, 3).every(isNum)) p = line.trim().split(/\s+/).slice(1, 7);
      const [a, b, c] = p.slice(0, 3).map((x) => num(x, 'PDB', ln + 1));
      const [al, be, ga] = p.slice(3, 6).map((x) => (isNum(x) ? +x : 90));
      // the 1 Å placeholder box written by many programs is not a real cell
      if (a > 1.5 && b > 1.5 && c > 1.5) {
        const m = cellFromParams(a, b, c, al || 90, be || 90, ga || 90);
        cell = m.every((r) => r.every(Number.isFinite)) ? m : null;
      }
      continue;
    }
    if (is('MODEL')) { cur = { symbols: [], pos: [] }; models.push(cur); continue; }
    if (is('ENDMDL')) { cur = null; continue; }
    if (is('ATOM') || is('HETATM')) {
      const atom = rec.startsWith('ATOM');
      if (!cur) { cur = { symbols: [], pos: [] }; models.push(cur); }
      const { xyz, name, el, res } = parseAtom(line, ln + 1);
      let sym = el ? normalizeSymbol(el) : null;
      if (!sym || sym === 'X') {
        // atom names: first char is element for standard residues unless it starts with a digit
        const n = name.replace(/^\d+/, '') || 'X';
        sym = normalizeSymbol(atom ? n[0] : n);
      }
      cur.symbols.push(sym);
      cur.pos.push(xyz);
      if (models.length === 1) residues.push(res);
    }
  }
  if (!models.length || !models[0].symbols.length) throw new Error('PDB: no ATOM or HETATM records found.');
  const m0 = models[0];
  const s = new Structure({ name: title || filename.replace(/\.[^.]+$/, '') || 'PDB structure', symbols: m0.symbols, positions: m0.pos, cell, pbc: cell ? [true, true, true] : [false, false, false], info: { source: 'pdb' }, props: { residue_names: residues } });
  if (models.every((m) => m.symbols.length === m0.symbols.length)) s.frames = models.slice(1).map((m) => ({ positions: new Float64Array(m.pos.flat()) }));
  else addWarning(s.info, `input contains ${models.length} structures with different atom counts; only the first was loaded`);
  return s;
}

export function writePDB(s) {
  const out = [`TITLE     ${s.name}`.slice(0, 80), 'REMARK   1 Created by Facet'];
  if (s.cell) {
    const p = cellParams(s.cell);
    out.push(`CRYST1${p.a.toFixed(3).padStart(9)}${p.b.toFixed(3).padStart(9)}${p.c.toFixed(3).padStart(9)}${p.alpha.toFixed(2).padStart(7)}${p.beta.toFixed(2).padStart(7)}${p.gamma.toFixed(2).padStart(7)} P 1           1`);
  }
  const multi = s.nFrames > 1, cur = s.frame;
  for (let f = 0; f < s.nFrames; f++) {
    s.setFrame(f);
    if (multi) out.push(`MODEL     ${String(f + 1).padStart(4)}`);
    for (let i = 0; i < s.length; i++) {
      const [x, y, z] = s.pos(i);
      const sym = s.symbols[i];
      const serial = String((i + 1) % 100000).padStart(5);
      const name = (sym.length === 1 ? ' ' + sym : sym).padEnd(4);
      out.push(`HETATM${serial} ${name} MOL A   1    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00  0.00          ${sym.toUpperCase().padStart(2)}`);
    }
    if (multi) out.push('ENDMDL');
  }
  s.setFrame(cur);
  out.push('END');
  return out.join('\n') + '\n';
}
