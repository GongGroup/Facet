/** Nanocluster generators (icosahedra, cuboctahedra, decahedra, octahedra, tetrahedra, spheres, fullerene). */
import { Structure } from '../core/structure.js';
import { element, normalizeSymbol } from '../core/elements.js';

const FCC_A = { Au: 4.078, Ag: 4.086, Cu: 3.615, Pt: 3.924, Pd: 3.891, Ni: 3.524, Al: 4.05, Pb: 4.95, Ir: 3.839, Rh: 3.803, Ca: 5.588, Sr: 6.08, Ar: 5.26, Ne: 4.43, Kr: 5.72, Xe: 6.2, Co: 3.54, Fe: 3.65 };

/** Nearest-neighbour distance used for an element's clusters. */
export function nnDistance(sym) {
  if (FCC_A[sym]) return FCC_A[sym] / Math.SQRT2;
  return 2 * element(sym).rcov;
}

const registry = new Map();
export const clusters = {
  register(c) { registry.set(c.id, c); return () => registry.delete(c.id); },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
};

function fromPoints(points, sym, name, kind) {
  return new Structure({ name, symbols: points.map(() => sym), positions: points, info: { source: `builder:${kind}`, cluster: kind } });
}

function dedupe(points, tol = 1e-3) {
  const out = [], seen = new Set();
  for (const p of points) {
    const k = p.map((v) => Math.round(v / tol)).join(',');
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

const PHI = (1 + Math.sqrt(5)) / 2;
function icosahedronVertices() {
  const v = [];
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) { v.push([0, s1, s2 * PHI], [s1, s2 * PHI, 0], [s2 * PHI, 0, s1]); }
  const r = Math.hypot(1, PHI);
  return v.map((p) => p.map((x) => x / r));
}

function shellPoints(vertices, edgeLen, n, faces, quads = []) {
  // vertices on unit radius; returns points for shell n (n>=1): vertices, edge points, face points
  const pts = [];
  const V = vertices.map((p) => p.map((x) => x * n));
  pts.push(...V);
  const edges = new Set();
  for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
    const d = Math.hypot(V[i][0] - V[j][0], V[i][1] - V[j][1], V[i][2] - V[j][2]);
    if (Math.abs(d - edgeLen * n) < 1e-6 * n + 1e-6) edges.add(`${i},${j}`);
  }
  for (const e of edges) {
    const [i, j] = e.split(',').map(Number);
    for (let k = 1; k < n; k++) pts.push(V[i].map((x, c) => x + (V[j][c] - x) * k / n));
  }
  for (const [a, b, c] of faces) {
    for (let i = 1; i < n; i++) for (let j = 1; i + j < n; j++) {
      pts.push(V[a].map((x, q) => x + (V[b][q] - x) * i / n + (V[c][q] - x) * j / n));
    }
  }
  for (const [a, b, , d] of quads) {
    for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) pts.push(V[a].map((x, q) => x + (V[b][q] - x) * i / n + (V[d][q] - x) * j / n));
  }
  return pts;
}

function trianglesOf(vertices, edgeLen) {
  const n = vertices.length, faces = [];
  const close = (i, j) => Math.abs(Math.hypot(...vertices[i].map((x, k) => x - vertices[j][k])) - edgeLen) < 1e-6;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) if (close(i, j) && close(j, k) && close(i, k)) faces.push([i, j, k]);
  return faces;
}

/** Mackay icosahedron, ASE convention: shells=1 → 1 atom, 2 → 13, 3 → 55, 4 → 147. */
export function icosahedron(sym, shells, d) {
  const verts = icosahedronVertices();
  const edge = 1 / Math.sin(2 * Math.PI / 5); // edge of a unit-circumradius icosahedron (1.05146)
  // scale so that the surface nearest-neighbour distance equals d
  const R = d / edge;
  const faces = trianglesOf(verts, edge);
  let pts = [[0, 0, 0]];
  for (let n = 1; n < shells; n++) pts.push(...shellPoints(verts, edge, n, faces));
  pts = pts.map((p) => p.map((x) => x * R));
  return dedupe(pts);
}

/** fcc lattice points (integer coords, even sum) in units of d/√2 */
function fccPoints(L) {
  const out = [];
  for (let x = -L; x <= L; x++) for (let y = -L; y <= L; y++) for (let z = -L; z <= L; z++) if (((x + y + z) & 1) === 0) out.push([x, y, z]);
  return out;
}

export function cuboctahedron(sym, shells, d) {
  const k = shells - 1;
  const s = d / Math.SQRT2;
  // cube |x_i| <= k intersected with the {111} planes |x|+|y|+|z| <= 2k
  return fccPoints(k).filter(([x, y, z]) => Math.abs(x) + Math.abs(y) + Math.abs(z) <= 2 * k).map((p) => p.map((v) => v * s));
}

export function octahedron(sym, layers, d) {
  const L = 2 * layers, s = d / Math.SQRT2;
  return fccPoints(L).filter(([x, y, z]) => Math.abs(x) + Math.abs(y) + Math.abs(z) <= L).map((p) => p.map((v) => v * s));
}

export function tetrahedron(sym, m, d) {
  const s = d / Math.SQRT2;
  const a1 = [0, 1, 1], a2 = [1, 0, 1], a3 = [1, 1, 0];
  const pts = [];
  for (let i = 0; i <= m; i++) for (let j = 0; i + j <= m; j++) for (let k = 0; i + j + k <= m; k++) pts.push([0, 1, 2].map((q) => (i * a1[q] + j * a2[q] + k * a3[q]) * s));
  const c = pts.reduce((acc, p) => acc.map((v, q) => v + p[q] / pts.length), [0, 0, 0]);
  return pts.map((p) => p.map((v, q) => v - c[q]));
}

export function sphere(sym, radius, d) {
  const s = d / Math.SQRT2;
  const L = Math.ceil(radius / s) + 1;
  return fccPoints(L).map((p) => p.map((v) => v * s)).filter((p) => Math.hypot(...p) <= radius + 1e-6);
}

/** Ino decahedron as 5 strained fcc tetrahedra sharing the 5-fold axis; m = atoms along an edge − 1. */
export function decahedron(sym, m, d) {
  const L = m * d, h = L / 2, R = L / (2 * Math.sin(Math.PI / 5));
  const T = [0, 0, h], B = [0, 0, -h];
  const P = Array.from({ length: 5 }, (_, k) => [R * Math.cos(2 * Math.PI * k / 5), R * Math.sin(2 * Math.PI * k / 5), 0]);
  const pts = [];
  for (let s = 0; s < 5; s++) {
    const Q1 = P[s], Q2 = P[(s + 1) % 5];
    for (let i = 0; i <= m; i++) for (let j = 0; i + j <= m; j++) for (let k = 0; i + j + k <= m; k++) {
      const l = m - i - j - k;
      pts.push([0, 1, 2].map((q) => (i * T[q] + j * B[q] + k * Q1[q] + l * Q2[q]) / m));
    }
  }
  return dedupe(pts, 1e-3);
}

export function c60() {
  const pts = [];
  const base = [[0, 1, 3 * PHI], [1, 2 + PHI, 2 * PHI], [PHI, 2, PHI ** 3]];
  for (const b of base) {
    const perms = [[b[0], b[1], b[2]], [b[1], b[2], b[0]], [b[2], b[0], b[1]]];
    for (const p of perms) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push([p[0] * sx, p[1] * sy, p[2] * sz]);
  }
  return dedupe(pts, 1e-4).map((p) => p.map((v) => v * 0.715));
}

clusters.register({ id: 'icosahedron', name: 'Mackay icosahedron', sizeLabel: 'Shells', min: 2, max: 9, default: 3, build: icosahedron, description: '13, 55, 147, 309… atoms (5-fold symmetric)' });
clusters.register({ id: 'cuboctahedron', name: 'Cuboctahedron', sizeLabel: 'Shells', min: 2, max: 9, default: 3, build: cuboctahedron, description: 'fcc-based, 13, 55, 147… atoms' });
clusters.register({ id: 'decahedron', name: 'Ino decahedron', sizeLabel: 'Edge length (atoms − 1)', min: 1, max: 8, default: 3, build: decahedron, description: 'Five twinned fcc tetrahedra' });
clusters.register({ id: 'octahedron', name: 'Octahedron', sizeLabel: 'Layers', min: 1, max: 8, default: 2, build: octahedron, description: 'fcc {111}-faceted, 19, 85, 231… atoms' });
clusters.register({ id: 'tetrahedron', name: 'Tetrahedron', sizeLabel: 'Edge length (atoms − 1)', min: 1, max: 12, default: 4, build: tetrahedron, description: 'Tetrahedral numbers: 4, 10, 20, 35…' });
clusters.register({ id: 'sphere', name: 'fcc sphere', sizeLabel: 'Radius (Å)', min: 3, max: 30, default: 8, step: 0.5, build: sphere, description: 'All fcc sites within a radius' });
clusters.register({ id: 'fullerene', name: 'C₆₀ fullerene', sizeLabel: null, build: () => c60(), fixedElement: 'C', description: 'Buckminsterfullerene, truncated icosahedron' });

export function buildCluster(kind, { element: el = 'Au', size, d } = {}) {
  const c = registry.get(kind);
  if (!c) throw new Error(`Unknown cluster kind "${kind}"`);
  const sym = normalizeSymbol(c.fixedElement ?? el);
  const nn = d ?? nnDistance(sym);
  const pts = c.build(sym, size ?? c.default, nn);
  const label = c.fixedElement ? 'C60' : `${sym}${pts.length}`;
  return fromPoints(pts, sym, `${label} ${c.name.toLowerCase()}`, kind);
}
