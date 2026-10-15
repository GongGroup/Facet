/** VASP POSCAR / CONTCAR / XDATCAR reader and POSCAR writer. */
import { Structure } from '../core/structure.js';
import { det3, fracToCart } from '../core/util.js';
import { normalizeSymbol } from '../core/elements.js';

export function readPOSCAR(text, filename = '') {
  const lines = text.split(/\r?\n/);
  let l = 0;
  const comment = lines[l++].trim();
  let scale = parseFloat(lines[l++]);
  const cell = [0, 1, 2].map(() => lines[l++].trim().split(/\s+/).slice(0, 3).map(Number));
  if (cell.some((r) => r.length < 3 || r.some((v) => !Number.isFinite(v)))) throw new Error('POSCAR: could not read the three lattice vectors (lines 3–5).');
  let tok = lines[l].trim().split(/\s+/);
  let species;
  if (tok.every((t) => /^[A-Za-z]/.test(t))) { species = tok.map((t) => normalizeSymbol(t.split('/')[0].split('_')[0])); l++; tok = lines[l].trim().split(/\s+/); }
  else {
    // VASP 4: species from comment line, else dummy
    const fromComment = comment.split(/\s+/).filter((t) => /^[A-Z][a-z]?$/.test(t));
    species = fromComment.length >= tok.length ? fromComment.slice(0, tok.length) : tok.map(() => 'X');
  }
  const counts = tok.map((t) => parseInt(t, 10));
  if (counts.some((c) => !Number.isFinite(c))) throw new Error('POSCAR: could not read the atom counts line.');
  l++;
  const symbols = [];
  species.forEach((sp, i) => { for (let k = 0; k < counts[i]; k++) symbols.push(sp); });
  const n = symbols.length;
  // scale
  if (scale < 0) {
    const vol = Math.abs(det3(cell));
    scale = Math.cbrt(-scale / vol);
  }
  const C = cell.map((r) => r.map((v) => v * scale));

  const readBlock = (start) => {
    let k = start;
    let line = lines[k].trim();
    if (/^s/i.test(line)) { k++; line = lines[k].trim(); }
    const direct = /^[dD]/.test(line) || /configuration/i.test(line);
    k++;
    const pos = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) {
      const t = (lines[k + i] ?? '').trim().split(/\s+/).map(Number);
      if (t.length < 3 || t.slice(0, 3).some((v) => !Number.isFinite(v))) throw new Error(`POSCAR: bad coordinate line ${k + i + 1}.`);
      const p = direct ? fracToCart(t, C) : t.slice(0, 3).map((v) => v * scale);
      pos.set(p, 3 * i);
    }
    return { pos, next: k + n };
  };

  const first = readBlock(l);
  const s = new Structure({ name: comment || filename || 'POSCAR', symbols, positions: first.pos, cell: C, pbc: [true, true, true], info: { source: 'poscar' } });
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
