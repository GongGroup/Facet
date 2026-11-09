/**
 * Planar Delaunay triangulation for the adsorption-site finder: Bowyer–Watson in plain doubles.
 *
 *     const triangles = delaunay(xs, ys);              // [[i, j, k], ...]: counter-clockwise triples of point indices
 *     const [x, y, r] = circumcenter(ax, ay, bx, by, cx, cy);
 *
 * The site finder (`core/sites.js`, M5 §3.3) triangulates the periodically tiled site atoms in the plane of the
 * surface frame and merges triangles whose circumcircles (nearly) coincide into hollow sites. This module is a
 * line-by-line translation of the Python twin `crystallume/core/delaunay.py`: the same steps in the same order and
 * the same arithmetic in the same order, so that both languages compute identical doubles and return the identical
 * list of triangles (the same triangles, in the same order, each starting at the same vertex), also for degenerate
 * inputs such as square or honeycomb grids, whose triangulation is not unique.
 *
 * The rules (M5 §3.3.2) are fixed; do not reorder the arithmetic:
 * - Predicates: orient(a, b, c) = (bx − ax)(cy − ay) − (by − ay)(cx − ax), positive when a, b, c turn
 *   counter-clockwise, and incircle(a, b, c, d), the 3×3 determinant with d as the origin, positive when d lies inside
 *   the circumcircle of the counter-clockwise triangle a, b, c. Plain double arithmetic only: no `Math.fround`, no
 *   reordered or combined expressions. A point is outside an edge only when orient < −1e-12 and inside a
 *   circumcircle only when incircle > 1e-9: ties count as outside, so a cocircular group keeps the triangulation that
 *   was made first.
 * - Super triangle: (midx − 20s, midy − 20s), (midx + 20s, midy − 20s), (midx, midy + 20s) with s = max(span, 1),
 *   the larger side of the bounding box of the points; the triangles that use one of its vertices are dropped at
 *   the end. The result therefore covers the convex hull except for a few nearly flat triangles along it whose
 *   circumcircle reaches a super vertex (the tiling margin of the site finder keeps them far from the cell it reads).
 * - Insertion order: the snake (boustrophedon) order of a square grid of side `orderCell`: the points sorted by
 *   (gy, gx if gy is even else −gx, index) with gx = floor((x − min x) / orderCell) (gy alike).
 * - Location: a visibility walk from the triangle made last; more than 4·T + 10 steps (T = triangles made so far) is
 *   an internal error.
 * - Cavity: a search with a stack (last in, first out) from the triangle that contains the point over the neighbours
 *   whose circumcircle strictly contains it; the boundary edges are collected in the order of the cavity triangles,
 *   each in the counter-clockwise order of its triangle, and become the new triangles (a, b, p).
 *
 * The points must be distinct: two points closer than `tolerance` are an internal error (an Error; the site finder
 * drops occluded site atoms before it triangulates, M5 §3.2.3). Fewer than three points, or points that all lie on
 * one line, give no triangles. The module reads no defaults: the site finder passes `SURFACE_DEFAULTS.siteOrderCell`
 * (3.0 Å) and `SURFACE_DEFAULTS.positionTolerance` (1e-5 Å, the default of `tolerance`) itself.
 * Expected cost O(n log n). Imports nothing.
 */

/** A point is outside an edge only when orient < −EPS_ORIENT (M5 §3.3.2). */
const EPS_ORIENT = 1e-12;
/** A point is inside a circumcircle only when incircle > EPS_CIRCLE (M5 §3.3.2). */
const EPS_CIRCLE = 1e-9;

// ------------------------------------------------------------------------------------------------- arguments
/** A value in an error message, written like the Python twin does (numbers plainly, other values as JSON). */
function show(v) {
  if (typeof v === 'number') return String(v);
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

/** `values` (an array or a typed array of numbers) as a new array of finite numbers. */
function floats(values, name) {
  if (!Array.isArray(values) && !(ArrayBuffer.isView(values) && !(values instanceof DataView))) {
    throw new TypeError(`${name} must be a list of numbers`);
  }
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== 'number') throw new TypeError(`${name}[${i}] must be a number (got ${show(v)})`);
    if (!Number.isFinite(v)) throw new Error(`${name}[${i}] must be a finite number (got ${show(v)})`);
    out.push(v);
  }
  return out;
}

function positive(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number (got ${show(value)})`);
  }
  return value;
}

/**
 * Throw an Error naming the first two points (in input order) that are closer than `tol`.
 * A hash grid of cells of side `tol`: two points closer than `tol` lie in the same or in neighbouring cells.
 */
function checkDistinct(xs, ys, tol) {
  const tol2 = tol * tol;
  const cells = new Map();
  for (let i = 0; i < xs.length; i++) {
    const gx = Math.floor(xs[i] / tol);
    const gy = Math.floor(ys[i] / tol);
    for (let ex = gx - 1; ex <= gx + 1; ex++) {
      for (let ey = gy - 1; ey <= gy + 1; ey++) {
        for (const j of cells.get(`${ex},${ey}`) ?? []) {
          const dx = xs[i] - xs[j];
          const dy = ys[i] - ys[j];
          if (dx * dx + dy * dy < tol2) throw new Error(`delaunay: points ${j} and ${i} coincide`);
        }
      }
    }
    const key = `${gx},${gy}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  }
}

const minOf = (a) => { let m = a[0]; for (let i = 1; i < a.length; i++) if (a[i] < m) m = a[i]; return m; };
const maxOf = (a) => { let m = a[0]; for (let i = 1; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };

// ------------------------------------------------------------------------------------------------ predicates
/** Twice the signed area of the triangle a, b, c: positive when it turns counter-clockwise. */
function orient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Positive when d lies inside the circumcircle of the counter-clockwise triangle a, b, c (d is the origin). */
function incircle(ax, ay, bx, by, cx, cy, dx, dy) {
  const adx = ax - dx;
  const ady = ay - dy;
  const bdx = bx - dx;
  const bdy = by - dy;
  const cdx = cx - dx;
  const cdy = cy - dy;
  const ad = adx * adx + ady * ady;
  const bd = bdx * bdx + bdy * bdy;
  const cd = cdx * cdx + cdy * cdy;
  return ad * (bdx * cdy - cdx * bdy) + bd * (cdx * ady - adx * cdy) + cd * (adx * bdy - bdx * ady);
}

/** The insertion order: grid rows bottom-up, alternately left to right and right to left (boustrophedon). */
function snakeOrder(xs, ys, cell) {
  const x0 = minOf(xs);
  const y0 = minOf(ys);
  const keys = [];
  for (let i = 0; i < xs.length; i++) {
    const gx = Math.floor((xs[i] - x0) / cell);
    const gy = Math.floor((ys[i] - y0) / cell);
    keys.push([gy, gy % 2 === 0 ? gx : -gx, i]);
  }
  keys.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  return keys.map((key) => key[2]);
}

// --------------------------------------------------------------------------------------------- triangulation
/**
 * Delaunay triangulation of the points (xs[i], ys[i]): counter-clockwise triples [i, j, k] of point indices.
 *
 * `orderCell` (Å) is the side of the grid of the snake insertion order (the site finder passes
 * `SURFACE_DEFAULTS.siteOrderCell`); it changes which triangulation a cocircular group gets, never the triangles of
 * points in general position. Points closer than `tolerance` (Å) throw an Error. The triangles come in the order in
 * which they were made; the Python twin returns the same list.
 */
export function delaunay(xs, ys, orderCell = 3.0, { tolerance = 1e-5 } = {}) {
  const X = floats(xs, 'xs');
  const Y = floats(ys, 'ys');
  if (X.length !== Y.length) throw new Error(`xs and ys must have the same length (got ${X.length} and ${Y.length})`);
  const cell = positive(orderCell, 'orderCell');
  const tol = positive(tolerance, 'tolerance');
  checkDistinct(X, Y, tol);
  const n = X.length;
  if (n < 3) return [];
  const minx = minOf(X);
  const maxx = maxOf(X);
  const miny = minOf(Y);
  const maxy = maxOf(Y);
  const span = Math.max(maxx - minx, maxy - miny, 1.0);
  const midx = (minx + maxx) / 2;
  const midy = (miny + maxy) / 2;
  const order = snakeOrder(X, Y, cell);
  // the super triangle: vertices n, n + 1 and n + 2, counter-clockwise
  X.push(midx - 20 * span, midx + 20 * span, midx);
  Y.push(midy - 20 * span, midy - 20 * span, midy + 20 * span);
  const tv = [[n, n + 1, n + 2]];   // the vertices of every triangle made, counter-clockwise
  const tn = [[-1, -1, -1]];        // tn[t][k]: the triangle across the edge opposite vertex k (-1: none)
  const alive = [true];
  let last = 0;
  for (const p of order) {
    const px = X[p];
    const py = Y[p];
    // locate: walk from the triangle made last towards p
    let t = last;
    let steps = 0;
    for (;;) {
      steps += 1;
      if (steps > 4 * tv.length + 10) {
        throw new Error(`delaunay: point location did not terminate (point ${p})`);
      }
      const v = tv[t];
      let moved = false;
      for (let k = 0; k < 3; k++) {
        const a = v[(k + 1) % 3];
        const b = v[(k + 2) % 3];
        if (orient(X[a], Y[a], X[b], Y[b], px, py) < -EPS_ORIENT) {
          const nb = tn[t][k];
          if (nb >= 0) {
            t = nb;
            moved = true;
            break;
          }
        }
      }
      if (!moved) break;
    }
    // cavity: t and the triangles whose circumcircle strictly contains p, searched with a stack
    const cav = [t];
    const incav = new Set([t]);
    const stack = [t];
    while (stack.length > 0) {
      const u = stack.pop();
      for (let k = 0; k < 3; k++) {
        const nb = tn[u][k];
        if (nb < 0 || incav.has(nb)) continue;
        const [a, b, c] = tv[nb];
        if (incircle(X[a], Y[a], X[b], Y[b], X[c], Y[c], px, py) > EPS_CIRCLE) {
          incav.add(nb);
          cav.push(nb);
          stack.push(nb);
        }
      }
    }
    // boundary edges (a, b), counter-clockwise in their cavity triangle, with the triangle outside them
    const boundary = [];
    for (const u of cav) {
      const v = tv[u];
      for (let k = 0; k < 3; k++) {
        const nb = tn[u][k];
        if (incav.has(nb)) continue;
        boundary.push([v[(k + 1) % 3], v[(k + 2) % 3], nb]);
      }
    }
    for (const u of cav) alive[u] = false;
    // new triangles (a, b, p); across (a, b) lies the triangle outside the cavity
    const start = new Map();
    const made = [];
    for (const [a, b, nb] of boundary) {
      const idx = tv.length;
      tv.push([a, b, p]);
      tn.push([-1, -1, nb]);   // opposite a: the edge (b, p); opposite b: (p, a); opposite p: (a, b)
      alive.push(true);
      made.push(idx);
      if (nb >= 0) {
        const w = tv[nb];
        for (let k = 0; k < 3; k++) {
          const e0 = w[(k + 1) % 3];
          const e1 = w[(k + 2) % 3];
          if ((e0 === a && e1 === b) || (e0 === b && e1 === a)) {
            tn[nb][k] = idx;
            break;
          }
        }
      }
      start.set(a, idx);
    }
    // link the new triangles around p: (a, b, p) shares the edge (b, p) with the one that starts at b
    for (const idx of made) {
      const b = tv[idx][1];
      const j = start.get(b);
      if (j !== undefined) {
        tn[idx][0] = j;
        tn[j][1] = idx;
      }
    }
    last = made[made.length - 1];
  }
  const out = [];
  for (let i = 0; i < tv.length; i++) {
    const v = tv[i];
    if (alive[i] && v[0] < n && v[1] < n && v[2] < n) out.push([v[0], v[1], v[2]]);
  }
  return out;
}

/**
 * [x, y, r]: the centre and the radius of the circle through the points a, b and c.
 * The same arithmetic as the Python twin; collinear points throw an Error.
 */
export function circumcenter(ax, ay, bx, by, cx, cy) {
  bx = bx - ax;
  by = by - ay;
  cx = cx - ax;
  cy = cy - ay;
  const d = 2.0 * (bx * cy - by * cx);
  if (d === 0) throw new Error('circumcenter: the three points are collinear');
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d;
  const uy = (bx * c2 - cx * b2) / d;
  return [ax + ux, ay + uy, Math.sqrt(ux * ux + uy * uy)];
}
