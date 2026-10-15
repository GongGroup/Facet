/** PDB reader (ATOM/HETATM, CRYST1, MODEL frames) and writer. */
import { Structure } from '../core/structure.js';
import { cellFromParams, cellParams } from '../core/util.js';
import { normalizeSymbol } from '../core/elements.js';

export function readPDB(text, filename = '') {
  const models = [];
  let cur = null, cell = null, title = '';
  const residues = [];
  for (const line of text.split(/\r?\n/)) {
    const rec = line.slice(0, 6).trim();
    if (rec === 'TITLE' || rec === 'COMPND' || rec === 'HEADER') { if (!title) title = line.slice(10).trim(); continue; }
    if (rec === 'CRYST1') {
      const a = +line.slice(6, 15), b = +line.slice(15, 24), c = +line.slice(24, 33);
      const al = +line.slice(33, 40), be = +line.slice(40, 47), ga = +line.slice(47, 54);
      if (a > 1.5 && b > 1.5 && c > 1.5) cell = cellFromParams(a, b, c, al || 90, be || 90, ga || 90);
      continue;
    }
    if (rec === 'MODEL') { cur = { symbols: [], pos: [] }; models.push(cur); continue; }
    if (rec === 'ENDMDL') { cur = null; continue; }
    if (rec === 'ATOM' || rec === 'HETATM') {
      if (!cur) { cur = { symbols: [], pos: [] }; models.push(cur); }
      const name = line.slice(12, 16).trim();
      const el = line.slice(76, 78).trim();
      let sym = el ? normalizeSymbol(el) : null;
      if (!sym || sym === 'X') {
        // atom names: first char is element for standard residues unless it starts with a digit
        const n = name.replace(/^\d+/, '');
        sym = normalizeSymbol(rec === 'ATOM' ? n[0] : n);
      }
      cur.symbols.push(sym);
      cur.pos.push([+line.slice(30, 38), +line.slice(38, 46), +line.slice(46, 54)]);
      if (models.length === 1) residues.push(line.slice(17, 20).trim());
    }
  }
  if (!models.length || !models[0].symbols.length) throw new Error('PDB: no ATOM or HETATM records found.');
  const m0 = models[0];
  const s = new Structure({ name: title || filename.replace(/\.[^.]+$/, '') || 'PDB structure', symbols: m0.symbols, positions: m0.pos, cell, pbc: cell ? [true, true, true] : [false, false, false], info: { source: 'pdb' }, props: { residue: residues } });
  if (models.every((m) => m.symbols.length === m0.symbols.length)) s.frames = models.slice(1).map((m) => ({ positions: new Float64Array(m.pos.flat()) }));
  return s;
}

export function writePDB(s) {
  const out = [`TITLE     ${s.name}`.slice(0, 80), 'REMARK   1 Created by AtomScope'];
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
