/** VASP POSCAR / CONTCAR / XDATCAR reader and POSCAR writer. */
import { Structure, fixDegenerateCell, addWarning } from '../core/structure.js';
import { num } from './index.js';
import { det3, fracToCart } from '../core/util.js';
import { normalizeSymbol } from '../core/elements.js';

/**
 * Scale line (line 2): one universal factor, a negative target volume, or three factors that scale the
 * x, y and z Cartesian components separately (VASP 6; same as the Python reader).
 */
export function readPOSCAR(text, filename = '') {
  const lines = text.split(/\r?\n/);
  if (lines.filter((x) => x.trim()).length < 7) throw new Error('POSCAR: the file is too short (needs a comment, scale, three lattice vectors, counts and coordinates).');
  let l = 0;
  const comment = lines[l++].trim();
  const scaleToks = lines[l].trim().split(/\s+/).filter((t) => !t.startsWith('!')).slice(0, 3);
  const scales = scaleToks.length >= 3 ? scaleToks.map((t) => num(t, 'POSCAR', l + 1)) : [num(scaleToks[0], 'POSCAR', l + 1)];
  l++;
  const cell = [0, 1, 2].map(() => {
    const t = (lines[l] ?? '').trim().split(/\s+/);
    if (t.length < 3) throw new Error(`POSCAR: line ${l + 1}: a lattice vector needs three numbers, found "${(lines[l] ?? '').trim().slice(0, 40)}"`);
    const v = t.slice(0, 3).map((x) => num(x, 'POSCAR', l + 1));
    l++;
    return v;
  });
  let tok = (lines[l] ?? '').trim().split(/\s+/);
  let species;
  const info = { source: 'poscar' };
  if (tok[0] && !/^[-+]?\d/.test(tok[0])) { species = tok.map((t) => normalizeSymbol(t.split('/')[0].split('_')[0])); l++; tok = (lines[l] ?? '').trim().split(/\s+/); }
  else species = null;
  const countToks = tok.filter((t) => t && !t.startsWith('!'));
  const counts = countToks.map((t) => {
    if (!/^\d+$/.test(t)) throw new Error(`POSCAR: line ${l + 1}: expected atom counts (whole numbers), found "${t}"`);
    return parseInt(t, 10);
  });
  if (!counts.length) throw new Error(`POSCAR: line ${l + 1}: expected atom counts.`);
  if (!species) {
    // VASP 4: species from the comment line, else dummy
    const fromComment = comment.split(/[\s,]+/).filter((t) => /^[A-Z][a-z]?$/.test(t));
    if (fromComment.length >= counts.length) species = fromComment.slice(0, counts.length);
    else { species = counts.map(() => 'X'); addWarning(info, 'VASP 4 POSCAR without element names; species set to X'); }
  }
  if (species.length !== counts.length) throw new Error(`POSCAR: line ${l + 1}: ${species.length} element names but ${counts.length} atom counts.`);
  l++;
  const symbols = [];
  species.forEach((sp, i) => { for (let k = 0; k < counts[i]; k++) symbols.push(sp); });
  const n = symbols.length;
  // scaling (VASP semantics)
  let factor;
  if (scales.length === 3) factor = scales;
  else if (scales[0] < 0) {
    const vol = Math.abs(det3(cell));
    if (!(vol > 0)) throw new Error('POSCAR: a negative scale (target volume) needs a non-degenerate cell.');
    const f = Math.cbrt(-scales[0] / vol); factor = [f, f, f];
  } else factor = [scales[0], scales[0], scales[0]];
  const C = cell.map((r) => r.map((v, k) => v * factor[k]));

  const readBlock = (start) => {
    let k = start;
    let line = (lines[k] ?? '').trim();
    if (/^s/i.test(line)) { k++; line = (lines[k] ?? '').trim(); }
    const cart = /^[ck]/i.test(line);   // anything else (Direct, configuration=) is fractional
    k++;
    const pos = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) {
      const raw = lines[k + i];
      if (raw == null || !raw.trim()) throw new Error(`POSCAR: file ended early at line ${k + i + 1} (expected ${n} coordinate lines, found ${i}).`);
      const t = raw.trim().split(/\s+/);
      if (t.length < 3) throw new Error(`POSCAR: line ${k + i + 1}: expected three coordinates, found "${raw.trim().slice(0, 40)}"`);
      const v = t.slice(0, 3).map((x) => num(x, 'POSCAR', k + i + 1));
      pos.set(cart ? v.map((x, j) => x * factor[j]) : fracToCart(v, C), 3 * i);
    }
    return { pos, next: k + n };
  };

  const first = readBlock(l);
  const fix = fixDegenerateCell(C, [true, true, true], first.pos);
  addWarning(info, fix.warning);
  const s = new Structure({ name: comment || filename || 'POSCAR', symbols, positions: first.pos, cell: fix.cell, pbc: fix.pbc, info });
  // XDATCAR: further "Direct configuration=" blocks
  let k = first.next;
  while (k < lines.length) {
    while (k < lines.length && !/configuration/i.test(lines[k])) k++;
    if (k >= lines.length) break;
    const b = readBlock(k);
    s.frames.push({ positions: b.pos });
    k = b.next;
  }
  return s;
}

export function writePOSCAR(s) {
  if (!s.cell) throw new Error('POSCAR needs a unit cell. Add a cell or export as XYZ instead.');
  const order = [];
  const species = [];
  for (const sp of s.symbols) if (!species.includes(sp)) species.push(sp);
  for (const sp of species) s.symbols.forEach((x, i) => { if (x === sp) order.push(i); });
  const frac = s.fracPositions();
  const lines = [s.name || s.formula(), '1.0'];
  for (const r of s.cell) lines.push('  ' + r.map((v) => v.toFixed(10).padStart(16)).join(' '));
  lines.push('  ' + species.join('  '));
  lines.push('  ' + species.map((sp) => s.symbols.filter((x) => x === sp).length).join('  '));
  lines.push('Direct');
  for (const i of order) lines.push('  ' + [0, 1, 2].map((k) => frac[3 * i + k].toFixed(10).padStart(14)).join(' '));
  return lines.join('\n') + '\n';
}
