/**
 * CIF reader (with symmetry expansion) and P1 CIF writer.
 * Supports `_symmetry_equiv_pos_as_xyz`, `_space_group_symop_operation_xyz`,
 * fractional or Cartesian sites, uncertainties like 3.905(2), quoted and multi-line values, and
 * CIF2/mmCIF dotted tags (`_cell.length_a` reads as `_cell_length_a`), like the Python reader.
 *   readCIF(text)    → the first data block with atom sites (info.warning names the others)
 *   readCIFAll(text) → one Structure per data block with atom sites
 */
import { Structure, fixDegenerateCell, addWarning } from '../core/structure.js';
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
  const tag = (s) => s.toLowerCase().replace(/\./g, '_');   // CIF2/mmCIF dotted tags
  while (i < t.length) {
    const tok = t[i];
    if (!tok.q && /^data_/i.test(tok.v)) { block = { name: tok.v.slice(5), items: new Map(), loops: [] }; blocks.push(block); i++; continue; }
    if (!block) { block = { name: 'unnamed', items: new Map(), loops: [] }; blocks.push(block); }
    if (!tok.q && lc(tok.v) === 'loop_') {
      i++;
      const cols = [];
      while (i < t.length && !t[i].q && t[i].v.startsWith('_')) cols.push(tag(t[i++].v));
      const vals = [];
      while (i < t.length && !(!t[i].q && (t[i].v.startsWith('_') || /^loop_$/i.test(t[i].v) || /^data_/i.test(t[i].v)))) vals.push(t[i++].v);
      const rows = [];
      for (let r = 0; r + cols.length <= vals.length; r += cols.length) rows.push(vals.slice(r, r + cols.length));
      block.loops.push({ cols, rows });
      continue;
    }
    if (!tok.q && tok.v.startsWith('_')) {
      const key = tag(tok.v);
      const val = t[i + 1];
      if (val && !(!val.q && (val.v.startsWith('_') || /^loop_$/i.test(val.v)))) { block.items.set(key, val.v); i += 2; }
      else { block.items.set(key, '?'); i++; }
      continue;
    }
    i++;
  }
  return blocks;
}

/** A CIF number without its standard uncertainty: "3.905(2)" → 3.905; "?" and "." → NaN. */
const num = (s) => {
  if (s == null || s === '?' || s === '.') return NaN;
  const t = String(s).trim().replace(/\(\d+\)$/, '');
  return t === '' ? NaN : Number(t);
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

const hasSites = (b) => b.loops.some((l) => l.cols.some((c) => c.startsWith('_atom_site_fract') || c.startsWith('_atom_site_cartn')));
const SYMOP = /_symmetry_equiv_pos_as_xyz|_space_group_symop_operation_xyz/;
const isIdentity = (R) => R.every((r, i) => r.every((v, j) => Math.abs(v - (j === i ? 1 : 0)) < 1e-9));

/** Snap fractional coordinates within tol of a multiple of 1/12 or 1/8 (0.3333 → 1/3), as the Python reader. */
function snap(f, tol) {
  return f.map((v) => {
    for (const den of [12, 8]) { const t = Math.round(v * den) / den; if (Math.abs(v - t) < tol) return t; }
    return v;
  });
}
const wrap01 = (v) => { let g = v - Math.floor(v); if (g >= 1 - 1e-8 || Math.abs(g) < 1e-8) g = 0; return g; };

/**
 * Apply the symmetry operations to every site and merge duplicates of the same element (sites with
 * different species on one position, as in mixed occupancy, are all kept). Duplicates are found with a
 * periodic bucket grid, so the cost is ~linear in the number of generated atoms.
 */
function expandSites(sites, ops, tol) {
  const nc = Math.max(1, Math.floor(1 / Math.max(tol, 1e-6)));
  const lim = tol + 1e-7;
  const buckets = new Map();
  const out = [];
  const cellOf = (g) => g.map((v) => ((Math.floor(v * nc) % nc) + nc) % nc);
  for (const s of sites) {
    for (const R of ops) {
      const g = applySymop(R, s.f).map(wrap01);
      const [bx, by, bz] = cellOf(g);
      let dup = false;
      for (let dz = -1; dz <= 1 && !dup; dz++) for (let dy = -1; dy <= 1 && !dup; dy++) for (let dx = -1; dx <= 1 && !dup; dx++) {
        const arr = buckets.get(((bx + dx + nc) % nc) + nc * (((by + dy + nc) % nc) + nc * ((bz + dz + nc) % nc)));
        if (!arr) continue;
        for (const idx of arr) {
          const o = out[idx];
          if (o.sym !== s.sym) continue;
          let same = true;
          for (let k = 0; k < 3 && same; k++) { const d = o.f[k] - g[k]; if (Math.abs(d - Math.round(d)) >= lim) same = false; }
          if (same) { dup = true; break; }
        }
      }
      if (dup) continue;
      const key = bx + nc * (by + nc * bz);
      let arr = buckets.get(key);
      if (!arr) buckets.set(key, (arr = []));
      arr.push(out.length);
      out.push({ f: g, sym: s.sym, label: s.label, occ: s.occ });
    }
  }
  return out;
}

/** One data block → Structure (symmetry expanded). */
function blockToStructure(block, filename = '') {
  const it = block.items;
  const get = (...keys) => { for (const k of keys) if (it.has(k)) return it.get(k); return undefined; };
  const a = num(get('_cell_length_a')), b = num(get('_cell_length_b')), c = num(get('_cell_length_c'));
  const al = num(get('_cell_angle_alpha')) || 90, be = num(get('_cell_angle_beta')) || 90, ga = num(get('_cell_angle_gamma')) || 90;
  const hasCell = [a, b, c].every(Number.isFinite);
  const where = block.name && block.name !== 'unnamed' ? ` (data_${block.name})` : '';
  let cell = hasCell ? cellFromParams(a, b, c, al, be, ga) : null;
  const info = { source: 'cif' };
  if (cell) {
    const fix = fixDegenerateCell(cell, [true, true, true], []);
    if (!fix.cell) throw new Error(`CIF${where}: the cell lengths and angles do not form a valid cell (a=${a}, b=${b}, c=${c}, α=${al}, β=${be}, γ=${ga}).`);
    cell = fix.cell;
  }

  const siteLoop = block.loops.find((l) => l.cols.some((x) => x.startsWith('_atom_site_fract') || x.startsWith('_atom_site_cartn')));
  if (!siteLoop) throw new Error(`CIF${where}: no _atom_site loop with coordinates found.`);
  const col = (name) => siteLoop.cols.indexOf(name);
  const iType = col('_atom_site_type_symbol'), iLabel = col('_atom_site_label');
  const fx = col('_atom_site_fract_x'), fy = col('_atom_site_fract_y'), fz = col('_atom_site_fract_z');
  const cx = col('_atom_site_cartn_x'), cy = col('_atom_site_cartn_y'), cz = col('_atom_site_cartn_z');
  const iOcc = col('_atom_site_occupancy');
  if (fx >= 0 && (fy < 0 || fz < 0)) throw new Error(`CIF${where}: the atom site loop is missing _atom_site_fract_y or _z.`);
  if (fx >= 0 && !cell) throw new Error(`CIF${where}: fractional atom sites need _cell_length_a, _b and _c.`);

  const symLoop = block.loops.find((l) => l.cols.some((x) => SYMOP.test(x)));
  let ops = [[[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]];
  if (symLoop) {
    const k = symLoop.cols.findIndex((x) => SYMOP.test(x));
    const list = symLoop.rows.map((r) => r[k]).filter((x) => x && x !== '?' && x !== '.');
    if (list.length) ops = list.map(parseSymop);
  } else {
    const single = get('_symmetry_equiv_pos_as_xyz', '_space_group_symop_operation_xyz');
    if (single && single !== '?') ops = [parseSymop(single)];
  }
  const sg = get('_symmetry_space_group_name_h-m', '_space_group_name_h-m_alt', '_space_group_name_h-m');
  if (!symLoop && ops.length === 1 && sg && !/^p\s*1$/i.test(String(sg).trim())) addWarning(info, `no symmetry operations listed for ${String(sg).trim()}; atoms used as listed (P1)`);

  const sites = siteLoop.rows.map((r) => {
    const label = iLabel >= 0 ? r[iLabel] : '';
    const sym = normalizeSymbol(iType >= 0 && r[iType] !== '?' && r[iType] !== '.' ? r[iType] : label);
    let f;
    if (fx >= 0) f = [num(r[fx]), num(r[fy]), num(r[fz])];
    else if (cell) f = cartToFrac([num(r[cx]), num(r[cy]), num(r[cz])], inv3(cell));
    else f = [num(r[cx]), num(r[cy]), num(r[cz])];
    return { label, sym, f, occ: iOcc >= 0 ? num(r[iOcc]) : 1 };
  }).filter((s) => s.f.every(Number.isFinite));
  if (!sites.length) throw new Error(`CIF${where}: no atom site has usable coordinates.`);

  let list;
  if (cell) {
    // a P1 list (identity only) is used as given: only exact repeats, like a site at 0 and at 1, are merged
    const p1 = ops.length === 1 && isIdentity(ops[0]);
    const tol = p1 ? 1e-4 : 1e-3;
    list = expandSites(p1 ? sites : sites.map((s) => ({ ...s, f: snap(s.f, tol) })), ops, tol);
  } else list = sites;
  const symbols = list.map((s) => s.sym), labels = list.map((s) => s.label), occ = list.map((s) => s.occ);
  const positions = cell ? list.map((s) => fracToCart(s.f, cell)) : list.map((s) => s.f);
  const name = get('_chemical_name_mineral', '_chemical_name_common', '_chemical_name_systematic', '_chemical_formula_sum') ?? block.name ?? filename;
  info.spacegroup = sg; info.block = block.name;
  const sgn = get('_symmetry_int_tables_number', '_space_group_it_number');
  if (sgn && Number.isFinite(num(sgn))) info.spacegroupNumber = num(sgn);
  const props = { label: labels };
  if (occ.some((o) => Number.isFinite(o) && Math.abs(o - 1) > 1e-6)) {
    props.occupancy = occ.map((o) => (Number.isFinite(o) ? o : 1));
    addWarning(info, 'partially occupied sites (all kept)');
  }
  return new Structure({ name: String(name).trim() || 'CIF structure', symbols, positions, cell, pbc: cell ? [true, true, true] : [false, false, false], info, props });
}

/** Every data block that has atom sites, as Structures (symmetry expanded). */
export function readCIFAll(text, filename = '') {
  const blocks = parseCIF(text).filter(hasSites);
  if (!blocks.length) throw new Error('CIF: no data block with atom sites (_atom_site_fract_x or _atom_site_Cartn_x) found.');
  return blocks.map((b) => blockToStructure(b, filename));
}

/** The first data block with atom sites; info.warning says when the file holds more. */
export function readCIF(text, filename = '') {
  const all = parseCIF(text);
  if (!all.length) throw new Error('CIF: no data block found.');
  const blocks = all.filter(hasSites);
  if (!blocks.length) throw new Error('CIF: no data block with atom sites (_atom_site_fract_x or _atom_site_Cartn_x) found.');
  const s = blockToStructure(blocks[0], filename);
  if (blocks.length > 1) addWarning(s.info, `${blocks.length} data blocks; loaded ${blocks[0].name && blocks[0].name !== 'unnamed' ? blocks[0].name : s.name}`);
  return s;
}

export function writeCIF(s) {
  if (!s.cell) throw new Error('CIF needs a unit cell. Export a molecule as XYZ or PDB instead.');
  const p = cellParams(s.cell);
  const frac = s.fracPositions();
  const f = (v) => v.toFixed(6);
  const out = [
    `data_${(s.formula() || 'structure').replace(/\s+/g, '_')}`,
    `_audit_creation_method 'Crystallume'`,
    `_chemical_formula_sum '${s.formula()}'`,
    `_cell_length_a ${f(p.a)}`, `_cell_length_b ${f(p.b)}`, `_cell_length_c ${f(p.c)}`,
    `_cell_angle_alpha ${f(p.alpha)}`, `_cell_angle_beta ${f(p.beta)}`, `_cell_angle_gamma ${f(p.gamma)}`,
    `_symmetry_space_group_name_H-M 'P 1'`, `_symmetry_Int_Tables_number 1`, '',
    'loop_', '_symmetry_equiv_pos_as_xyz', "'x, y, z'", '',
    'loop_', '_atom_site_label', '_atom_site_type_symbol', '_atom_site_fract_x', '_atom_site_fract_y', '_atom_site_fract_z', '_atom_site_occupancy',
  ];
  const counter = {};
  const occ = Array.isArray(s.props?.occupancy) && s.props.occupancy.length === s.length ? s.props.occupancy : null;
  for (let i = 0; i < s.length; i++) {
    const sym = s.symbols[i];
    counter[sym] = (counter[sym] ?? 0) + 1;
    const o = occ && Number.isFinite(+occ[i]) ? +occ[i] : 1;
    out.push(`${sym}${counter[sym]} ${sym} ${f(frac[3 * i])} ${f(frac[3 * i + 1])} ${f(frac[3 * i + 2])} ${o === 1 ? '1.0' : o.toFixed(4)}`);
  }
  return out.join('\n') + '\n';
}
