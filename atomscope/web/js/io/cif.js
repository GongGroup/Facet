/**
 * CIF reader (with symmetry expansion) and P1 CIF writer.
 * Supports `_symmetry_equiv_pos_as_xyz`, `_space_group_symop_operation_xyz`,
 * fractional or Cartesian sites, uncertainties like 3.905(2), quoted and multi-line values.
 */
import { Structure } from '../core/structure.js';
import { cellFromParams, fracToCart, cellParams, inv3, cartToFrac } from '../core/util.js';
import { normalizeSymbol } from '../core/elements.js';

function tokenize(text) {
  const tokens = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(';')) {
      const buf = [line.slice(1)];
      i++;
      while (i < lines.length && !lines[i].startsWith(';')) buf.push(lines[i++]);
      tokens.push({ v: buf.join('\n').trim(), q: true });
      continue;
    }
    let j = 0;
    while (j < line.length) {
      const ch = line[j];
      if (ch === ' ' || ch === '\t') { j++; continue; }
      if (ch === '#') break;
      if (ch === "'" || ch === '"') {
        let k = j + 1;
        while (k < line.length && !(line[k] === ch && (k + 1 >= line.length || /\s/.test(line[k + 1])))) k++;
        tokens.push({ v: line.slice(j + 1, k), q: true });
        j = k + 1;
        continue;
      }
      let k = j;
      while (k < line.length && !/\s/.test(line[k])) k++;
      tokens.push({ v: line.slice(j, k), q: false });
      j = k;
    }
  }
  return tokens;
}

/** Parse into data blocks: [{name, items: Map, loops: [{cols:[], rows:[[]]}]}] */
export function parseCIF(text) {
  const t = tokenize(text);
  const blocks = [];
  let block = null;
  let i = 0;
  const lc = (s) => s.toLowerCase();
  while (i < t.length) {
    const tok = t[i];
    if (!tok.q && /^data_/i.test(tok.v)) { block = { name: tok.v.slice(5), items: new Map(), loops: [] }; blocks.push(block); i++; continue; }
    if (!block) { block = { name: 'unnamed', items: new Map(), loops: [] }; blocks.push(block); }
    if (!tok.q && lc(tok.v) === 'loop_') {
      i++;
      const cols = [];
      while (i < t.length && !t[i].q && t[i].v.startsWith('_')) cols.push(lc(t[i++].v));
      const vals = [];
      while (i < t.length && !(!t[i].q && (t[i].v.startsWith('_') || /^loop_$/i.test(t[i].v) || /^data_/i.test(t[i].v)))) vals.push(t[i++].v);
      const rows = [];
      for (let r = 0; r + cols.length <= vals.length; r += cols.length) rows.push(vals.slice(r, r + cols.length));
      block.loops.push({ cols, rows });
      continue;
    }
    if (!tok.q && tok.v.startsWith('_')) {
      const key = lc(tok.v);
      const val = t[i + 1];
      if (val && !(!val.q && (val.v.startsWith('_') || /^loop_$/i.test(val.v)))) { block.items.set(key, val.v); i += 2; }
      else { block.items.set(key, '?'); i++; }
      continue;
    }
    i++;
  }
  return blocks;
}

const num = (s) => {
  if (s == null || s === '?' || s === '.') return NaN;
  return parseFloat(String(s).replace(/\(\d+\)/, ''));
};

/** "x-y+1/2" -> [cx, cy, cz, t] */
function parseSymExpr(expr) {
  const e = expr.replace(/\s+/g, '').toLowerCase();
  const out = [0, 0, 0, 0];
  const re = /([+-]?)([^+-]+)/g;
  let m;
  while ((m = re.exec(e))) {
    const sign = m[1] === '-' ? -1 : 1;
    let term = m[2];
    const v = term.match(/^([\d.]*\/?[\d.]*)\*?([xyz])$/);
    if (v) {
      const k = 'xyz'.indexOf(v[2]);
      const coef = v[1] ? evalFrac(v[1]) : 1;
      out[k] += sign * coef;
    } else {
      const v2 = term.match(/^([xyz])\*?([\d.]+\/?[\d.]*)?$/);
      if (v2) out['xyz'.indexOf(v2[1])] += sign * (v2[2] ? evalFrac(v2[2]) : 1);
      else out[3] += sign * evalFrac(term);
    }
  }
  return out;
}
function evalFrac(s) {
  if (s.includes('/')) { const [a, b] = s.split('/'); return parseFloat(a) / parseFloat(b); }
  return parseFloat(s);
}

export function parseSymop(op) {
  const parts = op.replace(/^'|'$/g, '').split(',');
  if (parts.length !== 3) throw new Error(`CIF: cannot parse symmetry operation "${op}"`);
  return parts.map(parseSymExpr);
}

function applySymop(R, f) {
  return R.map((r) => r[0] * f[0] + r[1] * f[1] + r[2] * f[2] + r[3]);
}

export function readCIF(text, filename = '') {
  const blocks = parseCIF(text);
  const block = blocks.find((b) => b.loops.some((l) => l.cols.some((c) => c.startsWith('_atom_site_fract') || c.startsWith('_atom_site_cartn')))) ?? blocks[0];
  if (!block) throw new Error('CIF: no data block found.');
  const it = block.items;
  const get = (...keys) => { for (const k of keys) if (it.has(k)) return it.get(k); return undefined; };
  const a = num(get('_cell_length_a')), b = num(get('_cell_length_b')), c = num(get('_cell_length_c'));
  const al = num(get('_cell_angle_alpha')) || 90, be = num(get('_cell_angle_beta')) || 90, ga = num(get('_cell_angle_gamma')) || 90;
  const hasCell = [a, b, c].every(Number.isFinite);
  const cell = hasCell ? cellFromParams(a, b, c, al, be, ga) : null;

  const siteLoop = block.loops.find((l) => l.cols.some((x) => x.startsWith('_atom_site_fract') || x.startsWith('_atom_site_cartn')));
  if (!siteLoop) throw new Error('CIF: no _atom_site loop with coordinates found.');
  const col = (name) => siteLoop.cols.indexOf(name);
  const iType = col('_atom_site_type_symbol'), iLabel = col('_atom_site_label');
  const fx = col('_atom_site_fract_x'), fy = col('_atom_site_fract_y'), fz = col('_atom_site_fract_z');
  const cx = col('_atom_site_cartn_x'), cy = col('_atom_site_cartn_y'), cz = col('_atom_site_cartn_z');
  const iOcc = col('_atom_site_occupancy');

  const symLoop = block.loops.find((l) => l.cols.some((x) => /_symmetry_equiv_pos_as_xyz|_space_group_symop_operation_xyz|_space_group_symop\.operation_xyz/.test(x)));
  let ops = [[[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]];
  if (symLoop) {
    const k = symLoop.cols.findIndex((x) => /_symmetry_equiv_pos_as_xyz|_space_group_symop_operation_xyz|_space_group_symop\.operation_xyz/.test(x));
    ops = symLoop.rows.map((r) => parseSymop(r[k]));
  } else {
    const single = get('_symmetry_equiv_pos_as_xyz', '_space_group_symop_operation_xyz');
    if (single) ops = [parseSymop(single)];
  }

  const sites = siteLoop.rows.map((r) => {
    const label = iLabel >= 0 ? r[iLabel] : '';
    const sym = normalizeSymbol(iType >= 0 && r[iType] !== '?' ? r[iType] : label);
    let f;
    if (fx >= 0) f = [num(r[fx]), num(r[fy]), num(r[fz])];
    else if (cell) f = cartToFrac([num(r[cx]), num(r[cy]), num(r[cz])], inv3(cell));
    else f = [num(r[cx]), num(r[cy]), num(r[cz])];
    return { label, sym, f, occ: iOcc >= 0 ? num(r[iOcc]) : 1 };
  }).filter((s) => s.f.every(Number.isFinite));

  const symbols = [], frac = [], labels = [], occ = [];
  const tol = 1e-3;
  if (cell) {
    for (const s of sites) {
      for (const R of ops) {
        const f = applySymop(R, s.f).map((v) => v - Math.floor(v));
        f.forEach((v, k) => { if (v > 1 - tol) f[k] = 0; });
        const dup = frac.some((g) => {
          for (let k = 0; k < 3; k++) { let d = Math.abs(g[k] - f[k]); d = Math.min(d, 1 - d); if (d > tol) return false; }
          return true;
        });
        if (!dup) { frac.push(f); symbols.push(s.sym); labels.push(s.label); occ.push(s.occ); }
      }
    }
  } else {
    for (const s of sites) { frac.push(s.f); symbols.push(s.sym); labels.push(s.label); occ.push(s.occ); }
  }
  const positions = cell ? frac.map((f) => fracToCart(f, cell)) : frac;
  const name = get('_chemical_name_mineral', '_chemical_name_common', '_chemical_name_systematic', '_chemical_formula_sum') ?? block.name ?? filename;
  const info = { source: 'cif', spacegroup: get('_symmetry_space_group_name_h-m', '_space_group_name_h-m_alt'), block: block.name };
  const sgn = get('_symmetry_int_tables_number', '_space_group_it_number');
  if (sgn) info.spacegroupNumber = +sgn;
  const props = { label: labels };
  if (occ.some((o) => o !== 1 && Number.isFinite(o))) props.occupancy = occ;
  return new Structure({ name: String(name).trim() || 'CIF structure', symbols, positions, cell, pbc: cell ? [true, true, true] : [false, false, false], info, props });
}

export function writeCIF(s) {
  if (!s.cell) throw new Error('CIF needs a unit cell. Export a molecule as XYZ or PDB instead.');
  const p = cellParams(s.cell);
  const frac = s.fracPositions();
  const f = (v) => v.toFixed(6);
  const out = [
    `data_${(s.formula() || 'structure').replace(/\s+/g, '_')}`,
    `_audit_creation_method 'AtomScope'`,
    `_chemical_formula_sum '${s.formula()}'`,
    `_cell_length_a ${f(p.a)}`, `_cell_length_b ${f(p.b)}`, `_cell_length_c ${f(p.c)}`,
    `_cell_angle_alpha ${f(p.alpha)}`, `_cell_angle_beta ${f(p.beta)}`, `_cell_angle_gamma ${f(p.gamma)}`,
    `_symmetry_space_group_name_H-M 'P 1'`, `_symmetry_Int_Tables_number 1`, '',
    'loop_', '_symmetry_equiv_pos_as_xyz', "'x, y, z'", '',
    'loop_', '_atom_site_label', '_atom_site_type_symbol', '_atom_site_fract_x', '_atom_site_fract_y', '_atom_site_fract_z', '_atom_site_occupancy',
  ];
  const counter = {};
  for (let i = 0; i < s.length; i++) {
    const sym = s.symbols[i];
    counter[sym] = (counter[sym] ?? 0) + 1;
    out.push(`${sym}${counter[sym]} ${sym} ${f(frac[3 * i])} ${f(frac[3 * i + 1])} ${f(frac[3 * i + 2])} 1.0`);
  }
  return out.join('\n') + '\n';
}
