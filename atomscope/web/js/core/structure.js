/**
 * Structure model (mirrors `atomscope.structure/1`, see docs/SCHEMA.md).
 * Positions are stored as a flat Float64Array (x0,y0,z0,x1,...) for speed.
 */
import { element, normalizeSymbol, PAULING } from './elements.js';
import { inv3, det3, cartToFrac, fracToCart, cellParams } from './util.js';

export class Structure {
  constructor({ name = 'Untitled', symbols = [], positions = null, cell = null, pbc = null, frames = null, props = {}, info = {} } = {}) {
    this.name = name;
    this.symbols = symbols.map(normalizeSymbol);
    const n = this.symbols.length;
    this.positions = positions instanceof Float64Array ? positions : flatten(positions ?? [], n);
    this.cell = cell ? cell.map((r) => r.map(Number)) : null;
    this.pbc = pbc ?? (this.cell ? [true, true, true] : [false, false, false]);
    /** frames: [{positions: Float64Array, cell?}] — frame 0 is always the base positions */
    this.frames = frames ?? [];
    this.props = props;
    this.info = info;
    this.frame = 0;
    this._base = this.positions;
    this._baseCell = this.cell;
  }

  static fromJSON(o) {
    if (o instanceof Structure) return o;
    const s = new Structure({
      name: o.name ?? 'Untitled', symbols: o.symbols ?? [], positions: o.positions, cell: o.cell ?? null,
      pbc: o.pbc ?? null, props: o.props ?? {}, info: o.info ?? {},
    });
    s.frames = (o.frames ?? []).map((f) => ({ positions: flatten(f.positions, s.symbols.length), cell: f.cell ?? null }));
    return s;
  }

  toJSON({ precision = 6 } = {}) {
    const r = (v) => Number(v.toFixed(precision));
    const p = this._base;
    const positions = [];
    for (let i = 0; i < p.length; i += 3) positions.push([r(p[i]), r(p[i + 1]), r(p[i + 2])]);
    const out = {
      schema: 'atomscope.structure/1', name: this.name, symbols: this.symbols.slice(), positions,
      cell: this._baseCell ? this._baseCell.map((row) => row.map(r)) : null, pbc: this.pbc.slice(),
    };
    if (this.frames.length) {
      out.frames = this.frames.map((f) => {
        const pos = [];
        for (let i = 0; i < f.positions.length; i += 3) pos.push([r(f.positions[i]), r(f.positions[i + 1]), r(f.positions[i + 2])]);
        return f.cell ? { positions: pos, cell: f.cell } : { positions: pos };
      });
    }
    if (Object.keys(this.props).length) out.props = this.props;
    if (Object.keys(this.info).length) out.info = this.info;
    return out;
  }

  clone() { return Structure.fromJSON(this.toJSON({ precision: 10 })); }

  get length() { return this.symbols.length; }
  get nFrames() { return 1 + this.frames.length; }
  get periodic() { return !!this.cell && this.pbc.some(Boolean); }

  /** Select a trajectory frame (0 = base). */
  setFrame(i) {
    i = Math.max(0, Math.min(this.nFrames - 1, i | 0));
    this.frame = i;
    if (i === 0) { this.positions = this._base; this.cell = this._baseCell; }
    else { this.positions = this.frames[i - 1].positions; this.cell = this.frames[i - 1].cell ?? this._baseCell; }
  }

  pos(i) { const p = this.positions; return [p[3 * i], p[3 * i + 1], p[3 * i + 2]]; }

  composition() {
    const c = {};
    for (const s of this.symbols) c[s] = (c[s] ?? 0) + 1;
    return c;
  }

  /**
   * Chemical formula. Organic (contains C and H): Hill order. Otherwise cations first, ordered by
   * Pauling electronegativity (SrTiO3, NaCl, MoS2). `reduce` divides by the greatest common divisor.
   */
  formula({ reduce = false, hill = false } = {}) {
    const c = this.composition();
    let keys = Object.keys(c);
    if (hill || (c.C && c.H)) keys = c.C ? ['C', ...(c.H ? ['H'] : []), ...keys.filter((k) => k !== 'C' && k !== 'H').sort()] : keys.sort();
    else keys.sort((a, b) => (PAULING[a] ?? 2) - (PAULING[b] ?? 2) || a.localeCompare(b));
    let div = 1;
    if (reduce) {
      const g = (a, b) => (b ? g(b, a % b) : a);
      div = Object.values(c).reduce(g);
    }
    return keys.map((k) => k + (c[k] / div === 1 ? '' : c[k] / div)).join('');
  }

  elements() { return [...new Set(this.symbols)]; }

  volume() { return this.cell ? Math.abs(det3(this.cell)) : null; }

  density() {
    const v = this.volume();
    if (!v) return null;
    const m = this.symbols.reduce((acc, s) => acc + element(s).mass, 0);
    return (m * 1.66053906660) / v; // g/cm^3
  }

  cellParams() { return this.cell ? cellParams(this.cell) : null; }

  bounds() {
    const p = this.positions, n = this.length;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
      const v = p[3 * i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
    if (!n) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 1 };
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    return { min, max, center, radius: Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2) };
  }

  fracPositions() {
    if (!this.cell) return null;
    const inv = inv3(this.cell);
    const out = new Float64Array(this.positions.length);
    for (let i = 0; i < this.length; i++) {
      const f = cartToFrac(this.pos(i), inv);
      out.set(f, 3 * i);
    }
    return out;
  }

  /** New structure repeated nx*ny*nz times (requires a cell). Frames are dropped. */
  repeat(nx = 1, ny = 1, nz = 1) {
    if (!this.cell) throw new Error('repeat() needs a unit cell');
    const [A, B, C] = this.cell;
    const n = this.length, symbols = [], pos = new Float64Array(n * nx * ny * nz * 3);
    let o = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
      const t = [i * A[0] + j * B[0] + k * C[0], i * A[1] + j * B[1] + k * C[1], i * A[2] + j * B[2] + k * C[2]];
      for (let a = 0; a < n; a++) {
        symbols.push(this.symbols[a]);
        pos[o++] = this.positions[3 * a] + t[0];
        pos[o++] = this.positions[3 * a + 1] + t[1];
        pos[o++] = this.positions[3 * a + 2] + t[2];
      }
    }
    const props = {};
    for (const [k, v] of Object.entries(this.props)) if (Array.isArray(v) && v.length === n) props[k] = Array.from({ length: nx * ny * nz }, () => v).flat();
    return new Structure({
      name: `${this.name} (${nx}×${ny}×${nz})`, symbols, positions: pos,
      cell: [A.map((v) => v * nx), B.map((v) => v * ny), C.map((v) => v * nz)], pbc: this.pbc.slice(), props, info: { ...this.info },
    });
  }

  /** Wrap atoms back into the cell (in place). */
  wrap() {
    if (!this.cell) return this;
    const inv = inv3(this.cell);
    for (let i = 0; i < this.length; i++) {
      const f = cartToFrac(this.pos(i), inv).map((v, k) => (this.pbc[k] ? v - Math.floor(v + 1e-9) : v));
      this.positions.set(fracToCart(f, this.cell), 3 * i);
    }
    return this;
  }

  /** Remove atoms by index (in place, all frames). */
  deleteAtoms(indices) {
    const del = new Set(indices);
    const keep = [];
    for (let i = 0; i < this.length; i++) if (!del.has(i)) keep.push(i);
    const pick = (arr) => { const out = new Float64Array(keep.length * 3); keep.forEach((i, o) => out.set(arr.subarray(3 * i, 3 * i + 3), 3 * o)); return out; };
    this.symbols = keep.map((i) => this.symbols[i]);
    this._base = pick(this._base);
    this.frames = this.frames.map((f) => ({ ...f, positions: pick(f.positions) }));
    for (const [k, v] of Object.entries(this.props)) if (Array.isArray(v)) this.props[k] = keep.map((i) => v[i]);
    this.setFrame(Math.min(this.frame, this.nFrames - 1));
    return this;
  }

  setSymbols(indices, symbol) {
    const s = normalizeSymbol(symbol);
    for (const i of indices) this.symbols[i] = s;
    return this;
  }

  addAtom(symbol, xyz) {
    this.symbols.push(normalizeSymbol(symbol));
    const grow = (arr) => { const out = new Float64Array(arr.length + 3); out.set(arr); out.set(xyz, arr.length); return out; };
    this._base = grow(this._base);
    this.frames = this.frames.map((f) => ({ ...f, positions: grow(f.positions) }));
    this.setFrame(this.frame);
    return this.length - 1;
  }

  translate(v) {
    const all = [this._base, ...this.frames.map((f) => f.positions)];
    for (const p of all) for (let i = 0; i < p.length; i += 3) { p[i] += v[0]; p[i + 1] += v[1]; p[i + 2] += v[2]; }
    return this;
  }

  summary() {
    const cp = this.cellParams();
    return {
      name: this.name, formula: this.formula(), natoms: this.length, nframes: this.nFrames,
      periodic: this.periodic, cell: cp, volume: this.volume(), density: this.density(), composition: this.composition(),
    };
  }
}

function flatten(positions, n) {
  if (positions instanceof Float64Array) return positions;
  const out = new Float64Array(n * 3);
  if (!positions) return out;
  if (positions.length === n * 3 && typeof positions[0] === 'number') { out.set(positions); return out; }
  for (let i = 0; i < n; i++) {
    const p = positions[i] ?? [0, 0, 0];
    out[3 * i] = +p[0]; out[3 * i + 1] = +p[1]; out[3 * i + 2] = +p[2];
  }
  return out;
}
