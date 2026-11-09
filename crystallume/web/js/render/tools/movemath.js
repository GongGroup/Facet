/**
 * Interaction math of the Move tool (M4 §3.11, §5.1): the frames the handles follow, the screen-space layout and hit
 * test of the handles, drag deltas and rotation angles, fine and snapped increments, and snap targets.
 *
 * Pure functions on plain [x, y, z] arrays: no DOM, no three.js and no viewer state, so all of it runs in node.
 * render/tools/move.js draws the handles, owns the pointer events and the preview session, and hands these functions
 * what the viewer computes (L-F0-40):
 * - `project(x, y, z) → [sx, sy, …]`: drawn coordinates to CSS px. hitHandle compares it with the pointer, so both
 *   must be in one space (the pointer context's `x, y` and `project`, both relative to the canvas);
 * - `worldPerPixel`: Å per CSS px at the pivot (`viewer.worldPerPixel(pivot)`). The handles keep a constant screen
 *   size, so L px of a handle are L · worldPerPixel Å in the scene;
 * - for drags, a view `{ viewDir, pointOnPlane(x, y, point, normal), pointOnLine(x, y, origin, dir), project,
 *   worldPerPixel }`: `viewDir` is the unit vector from the camera into the scene; the two functions are the viewer's
 *   (null when the ray is parallel to the plane or line, or meets the plane behind the camera). They get the drag
 *   pointer as given (client coordinates for the viewer's) and plain arrays, and may return arrays or {x, y, z}
 *   objects (THREE.Vector3); `pointOnLine` returns `{ point, s }`. Drags use `project` only for snap targets and for
 *   an edge-on ring started without its `hit` (the ring point nearest the press pointer, so that pointer must then be
 *   in `project`'s space); everything else depends on pointer differences only.
 *
 * Positions are the drawn (Float64) ones of the pivot and the grab point. A translation Δ is the same vector in the
 * stored coordinates; a rotation is an angle (degrees, right-handed) about a frame axis, which the tool applies about
 * its own pivot in the editing frame (M4 §3.7.2). The snap step and the fine factor come from the caller
 * (`SURFACE_DEFAULTS.snapTranslate`, `snapRotate`, `fineFactor`, or the HUD), never from literals here; pixel sizes and
 * thresholds exist only on the web side and live in MOVE_TOOL (M4 §3.1), which render/tools/move.js re-exports.
 */
import { SURFACE_DEFAULTS as D } from '../../core/defaults.js';

const DEG = Math.PI / 180;
/** Vectors shorter than this (Å, or px for screen vectors) have no direction. */
const TINY = 1e-12;
/** A candidate frame or ring axis whose part normal to the axis is below this fraction of its length is parallel to it. */
const IN_PLANE = 1e-6;
/** A plane handle is the surface plane when its normal and the surface normal are this close to parallel (|cos|). */
const PARALLEL = 1e-6;
/** The edge-on ring tangent is measured over ± this fraction of the ring radius. */
const TANGENT_STEP = 1e-3;
/** A projected tangent or quadrilateral this many times smaller than the face-on one is degenerate. */
const DEGENERATE = 1e-9;
/** A snap step whose reciprocal is within this of an integer k is 1/k (0.1, 0.05, 0.25 …). */
const RECIPROCAL_TIE = 1e-12;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

/**
 * Pixel sizes (CSS px) and thresholds of the Move tool's handles, M4 §3.11.1. `pick` / `pickTouch` are the hit
 * tolerances for the mouse and for touch and pen. The cosines are of the angle between a direction and the line of
 * sight: an arrow hides when its axis is within 8° of it (|û·d̂| > hideArrowCos), a square when its normal is more than
 * 82° from it (|n̂·d̂| < hideSquareCos); an axis drag keeps its last value above axisParallelCos; below edgeOnCos a
 * direct drag falls back to the screen plane and a ring to the tangent method. snapRadius is the snap-target radius;
 * rotations below minAngle (degrees) count as no rotation.
 */
export const MOVE_TOOL = deepFreeze({
  arrow: { from: 14, shaftTo: 72, to: 88, shaftRadius: 1.5, coneRadius: 5, pick: 8, pickTouch: 16 },
  square: { size: 14, offset: 24, pick: 3, pickTouch: 8 },
  ring: { radius: 60, tube: 1.5, segments: 64, pick: 7, pickTouch: 14 },
  center: { radius: 8, pick: 10, pickTouch: 18 },
  labelGap: 6,
  hoverScale: 1.6,
  hideArrowCos: 0.990,
  hideSquareCos: Math.cos(82 * DEG),
  axisParallelCos: 0.996,
  edgeOnCos: 0.2,
  snapRadius: 12,
  minAngle: 1e-6,
});

/** Frame choices (HUD `Frame`, preference `moveFrame`); 'auto' = Surface when there is a surface, else Cartesian. */
export const FRAMES = Object.freeze(['auto', 'surface', 'cartesian', 'lattice']);
/** Axis letters of each frame. */
export const FRAME_LABELS = deepFreeze({ surface: ['u', 'v', 'n'], cartesian: ['x', 'y', 'z'], lattice: ['a', 'b', 'c'] });
/** Plane handle k is spanned by these two frame axes (k is the axis not in it: plane 2 is the u–v square). */
export const PLANE_AXES = deepFreeze([[1, 2], [0, 2], [0, 1]]);
/** What a press takes, first to last: the handles, then a selected atom (M4 §3.11.1). */
export const HANDLE_PRIORITY = Object.freeze(['center', 'plane', 'axis', 'ring', 'atom']);
/** HUD `Handles` choices: all of them, the translation handles (centre, squares, arrows) or the rings. */
export const HANDLE_SETS = Object.freeze(['both', 'move', 'rotate']);
/** Drag kinds: an arrow, a square, the centre disc, a selected atom, a ring. */
export const DRAG_KINDS = Object.freeze(['axis', 'plane', 'center', 'direct', 'ring']);

const CARTESIAN = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// ------------------------------------------------------------------------------------------------- vectors

/** A value in an error message (numbers plainly, other values as JSON). */
function repr(v) {
  if (typeof v === 'number') return String(v);
  if (v === undefined) return 'undefined';
  if (typeof v === 'function') return 'a function';
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

const quote = (list) => list.map((s) => `'${s}'`).join(', ');

/** [x, y, z] from an array, a typed array or an {x, y, z} object; throws for anything else or non-finite values. */
function vec(p, what) {
  let x, y, z;
  if (Array.isArray(p) || ArrayBuffer.isView(p)) [x, y, z] = [p[0], p[1], p[2]];
  else if (p !== null && typeof p === 'object') ({ x, y, z } = p);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
  throw new TypeError(`${what} must be a finite 3-vector (got ${repr(p)})`);
}

/** [x, y] from an array or an {x, y} object; throws for anything else or non-finite values. */
function vec2(p, what) {
  let x, y;
  if (Array.isArray(p) || ArrayBuffer.isView(p)) [x, y] = [p[0], p[1]];
  else if (p !== null && typeof p === 'object') ({ x, y } = p);
  if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
  throw new TypeError(`${what} must be a finite screen point [x, y] (got ${repr(p)})`);
}

/** A point the view returned: [x, y, z], or null when it gave none (or nothing finite). */
function viewPoint(p) {
  if (p == null) return null;
  try { return vec(p, 'point'); } catch { return null; }
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
/** a + s·b */
const axpy = (a, s, b) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
/** The part of v normal to the unit vector n. */
const reject = (v, n) => axpy(v, -dot(v, n), n);

function unit(a, what) {
  const L = norm(a);
  if (!(L > TINY)) throw new RangeError(`${what} must not be a zero vector`);
  return scale(a, 1 / L);
}

/** The three frame axes as unit vectors; they must be independent. */
function axesOf(axes) {
  if (!Array.isArray(axes) || axes.length !== 3) throw new TypeError(`axes must be three 3-vectors (got ${repr(axes)})`);
  const E = axes.map((e, k) => unit(vec(e, `axes[${k}]`), `axes[${k}]`));
  if (!(Math.abs(dot(E[0], cross(E[1], E[2]))) > DEGENERATE)) throw new RangeError('axes must not be coplanar');
  return E;
}

/** Cell rows as [[x, y, z] × 3], or null for a missing cell. */
function cellRows(cell) {
  if (cell == null) return null;
  if (!Array.isArray(cell) || cell.length !== 3) throw new TypeError(`cell must be three 3-vectors (got ${repr(cell)})`);
  return cell.map((r, k) => vec(r, `cell[${k}]`));
}

function axisIndex(k, what) {
  if (k === 0 || k === 1 || k === 2) return k;
  throw new RangeError(`${what} must be 0, 1 or 2 (got ${repr(k)})`);
}

function positive(x, what) {
  if (typeof x === 'number' && Number.isFinite(x) && x > 0) return x;
  throw new RangeError(`${what} must be a positive number (got ${repr(x)})`);
}

/** A projection wrapper: p → [sx, sy], or null when the projection gives nothing finite. */
function projector(project) {
  if (typeof project !== 'function') throw new TypeError(`project must be a function (x, y, z) → [sx, sy] (got ${repr(project)})`);
  return (p) => {
    const r = project(p[0], p[1], p[2]);
    if (r == null) return null;
    const x = r[0] ?? r.x, y = r[1] ?? r.y;
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  };
}

// --------------------------------------------------------------------------------------------------- frames

/** The unit surface normal of a `surfaceNormal()` result when it is a surface (U1: there is a vacuum gap), else null. */
function surfaceNormalOf(surface) {
  if (!surface || !surface.surface || surface.normal == null) return null;
  return unit(vec(surface.normal, 'surface.normal'), 'surface.normal');
}

/** [u, v, n]: n the surface normal, u the first in-plane cell vector (a, else b) projected on the plane, v = n × u. */
function surfaceAxes(n, axis, rows) {
  const candidates = [];
  if (rows) rows.forEach((r, k) => { if (k !== axis) candidates.push(r); });
  candidates.push(...CARTESIAN);
  for (const c of candidates) {
    const L = norm(c);
    const u = reject(c, n);
    const Lu = norm(u);
    if (L > TINY && Lu > IN_PLANE * L) {
      const uu = scale(u, 1 / Lu);
      return [uu, cross(n, uu), n];
    }
  }
  throw new RangeError('no axis normal to the surface normal');
}

/** [â, b̂, ĉ], or null without a usable cell. */
function latticeAxes(rows) {
  if (!rows || rows.some((r) => !(norm(r) > TINY))) return null;
  const E = rows.map((r) => scale(r, 1 / norm(r)));
  return Math.abs(dot(E[0], cross(E[1], E[2]))) > DEGENERATE ? E : null;
}

/**
 * The axes of a Move-tool frame (M4 §3.3): Surface [u, v, n] (n = the surface normal, u = a projected on the surface
 * plane, or b when a is along n, v = n × u), Cartesian [x̂, ŷ, ẑ] or Lattice [â, b̂, ĉ]. `surface` is the
 * `surfaceNormal(s)` result: the Surface frame needs `surface.surface` (a vacuum gap, U1); when its `axis` is known,
 * u comes from the first other cell vector. A frame that is not available falls back to 'auto' = Surface when there
 * is a surface, else Cartesian; the result says which frame was used.
 * @returns {{ frame: 'surface'|'cartesian'|'lattice', axes: number[][], labels: string[] }}
 */
export function frameAxes(frame = 'auto', { cell = null, surface = null } = {}) {
  if (!FRAMES.includes(frame)) throw new RangeError(`frame must be one of ${quote(FRAMES)} (got ${repr(frame)})`);
  const rows = cellRows(cell);
  const n = surfaceNormalOf(surface);
  const lattice = frame === 'lattice' ? latticeAxes(rows) : null;
  let use = frame;
  if ((use === 'surface' && !n) || (use === 'lattice' && !lattice)) use = 'auto';
  if (use === 'auto') use = n ? 'surface' : 'cartesian';
  const axes = use === 'surface' ? surfaceAxes(n, surface.axis, rows) : use === 'lattice' ? lattice : CARTESIAN.map((r) => r.slice());
  return { frame: use, axes, labels: FRAME_LABELS[use].slice() };
}

/** Components of d on the basis e0, e1, e2 (d = Σ α_k e_k; the dual basis). */
function dualComponents(d, [e0, e1, e2]) {
  const c12 = cross(e1, e2), c20 = cross(e2, e0), c01 = cross(e0, e1);
  const det = dot(e0, c12);
  return [dot(d, c12) / det, dot(d, c20) / det, dot(d, c01) / det];
}

/** Components of d (a vector in the plane of ei, ej) on ei, ej. */
function planeComponents(d, ei, ej) {
  const a = dot(ei, ei), b = dot(ei, ej), c = dot(ej, ej), det = a * c - b * b;
  const p = dot(d, ei), q = dot(d, ej);
  return [(c * p - b * q) / det, (a * q - b * p) / det];
}

/**
 * The contravariant components of a displacement in a frame: [α, β, γ] with Δ = α·ê1 + β·ê2 + γ·ê3 (M4 §3.11.3, D19).
 * In the Lattice frame these are Δ's fractional coordinates times the axis lengths; they are not the projections Δ·ê
 * unless the axes are orthogonal. The HUD reads Δ in these components.
 */
export function frameComponents(delta, axes) {
  return dualComponents(vec(delta, 'delta'), axesOf(axes));
}

// ------------------------------------------------------------------------------------------------- snapping

/**
 * `value` rounded to a multiple of `step`, halves away from zero (dragging left and right snap alike). Decimal steps
 * (0.1, 0.05, 0.25 …) divide by their integer reciprocal, so 3 × 0.1 gives 0.3 and not 0.30000000000000004. A step
 * of 0 (or null) leaves the value as it is.
 */
export function snapToStep(value, step) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`value must be a finite number (got ${repr(value)})`);
  if (step == null || step === 0) return value;
  if (typeof step !== 'number' || !Number.isFinite(step) || step < 0) {
    throw new RangeError(`a snap step must be a positive number or 0 (got ${repr(step)})`);
  }
  const k = Math.round(1 / step);
  const r = step < 1 && k > 1 && Math.abs(k * step - 1) < RECIPROCAL_TIE
    ? Math.round(Math.abs(value) * k) / k
    : Math.round(Math.abs(value) / step) * step;
  const out = value < 0 ? -r : r;
  return out === 0 ? 0 : out;
}

/** Per-axis translation steps [s0, s1, s2] from a number (all axes) or a list of three (0 or null = not snapped). */
function stepsOf(snap) {
  if (snap == null || snap === false) return [0, 0, 0];
  if (typeof snap === 'number') { snapToStep(0, snap); return [snap, snap, snap]; }
  if (Array.isArray(snap) && snap.length === 3) {
    return snap.map((s) => { if (s == null) return 0; snapToStep(0, s); return s; });
  }
  throw new TypeError(`snap must be a step, a list of three steps or 0 (got ${repr(snap)})`);
}

/**
 * Steps for the Lattice frame's optional `Snap: 1/n of a, b` (M4 §3.11.3, D19): [|a|/n_a, |b|/n_b, step], n_a and n_b
 * the diagonal of `info.supercellMatrix` (or the legacy `info.supercell` [n_a, n_b, n_c]), so that one step is one
 * 1×1 lattice vector (1/3 of a on p(3×3)). Null without a cell or for a non-diagonal matrix, where 1/n of a is not a
 * lattice vector of the 1×1 cell. `step` is the step along c.
 */
export function latticeSnapSteps(cell, supercellMatrix, step = 0) {
  const rows = cellRows(cell);
  if (!rows || supercellMatrix == null) return null;
  let n;
  if (Array.isArray(supercellMatrix) && supercellMatrix.length === 3 && supercellMatrix.every((v) => typeof v === 'number')) {
    n = supercellMatrix;
  } else if (Array.isArray(supercellMatrix) && supercellMatrix.length === 3 && supercellMatrix.every((r) => Array.isArray(r) && r.length === 3)) {
    const M = supercellMatrix;
    if ([0, 1, 2].some((i) => [0, 1, 2].some((j) => i !== j && M[i][j] !== 0))) return null;
    n = [M[0][0], M[1][1], M[2][2]];
  } else {
    throw new TypeError(`supercellMatrix must be a 3×3 integer matrix or a list of three integers (got ${repr(supercellMatrix)})`);
  }
  if (!Number.isInteger(n[0]) || !Number.isInteger(n[1]) || n[0] < 1 || n[1] < 1) return null;
  snapToStep(0, step);
  return [norm(rows[0]) / n[0], norm(rows[1]) / n[1], step ?? 0];
}

/**
 * Pull a translation onto the nearest snap target (M4 §2.1). The reference point (the pivot, or the anchor atom) ends
 * at P = ref + delta. Mode 'point' (screen-plane drags) moves P onto a target T; mode 'plane' (drags in the surface
 * plane) aligns only the position in that plane and keeps the height along `normal`: P → T + ((P − T)·n̂) n̂. A target
 * captures when that snapped position is within `radius` px of P on screen (for 'plane' this compares P with T lifted
 * to P's height, so a CO 1.85 Å above a top site snaps from an oblique view too); the nearest one wins, ties the first.
 * Targets are [x, y, z] points or `{ position }` objects (`registerSnapTargets`).
 * @returns {{ delta: number[], target: number | null, distance: number | null }}
 */
export function snapToTarget(ref, delta, targets, { project, mode = 'point', normal = null, radius = MOVE_TOOL.snapRadius } = {}) {
  const d = vec(delta, 'delta');
  const P = axpy(vec(ref, 'ref'), 1, d);
  if (mode !== 'point' && mode !== 'plane') throw new RangeError(`mode must be 'point' or 'plane' (got ${repr(mode)})`);
  const n = mode === 'plane' ? unit(vec(normal, 'normal'), 'normal') : null;
  const r = positive(radius, 'radius');
  const at = projector(project);
  const none = { delta: d, target: null, distance: null };
  if (targets == null) return none;
  if (!Array.isArray(targets)) throw new TypeError(`targets must be a list of points (got ${repr(targets)})`);
  const sp = at(P);
  if (!sp) return none;
  let best = null;
  targets.forEach((t, i) => {
    const T = vec(t?.position ?? t, `targets[${i}]`);
    const corr = n ? reject(sub(T, P), n) : sub(T, P);
    const st = at(axpy(P, 1, corr));
    if (!st) return;
    const dist = Math.hypot(st[0] - sp[0], st[1] - sp[1]);
    if (dist <= r && (!best || dist < best.distance)) best = { index: i, distance: dist, corr };
  });
  if (!best) return none;
  return { delta: axpy(d, 1, best.corr), target: best.index, distance: best.distance };
}

// --------------------------------------------------------------------------------------------------- angles

/**
 * The signed angle (degrees, (−180, 180]) that turns `from` into `to` about `axis`, right-handed: both vectors are
 * first projected on the plane normal to the axis. Null when either has no part in that plane.
 */
export function angleAbout(from, to, axis) {
  const u = unit(vec(axis, 'axis'), 'axis');
  const a = reject(vec(from, 'from'), u), b = reject(vec(to, 'to'), u);
  if (!(norm(a) > TINY) || !(norm(b) > TINY)) return null;
  const deg = Math.atan2(dot(u, cross(a, b)), dot(a, b)) / DEG;
  return deg <= -180 ? deg + 360 : deg;
}

/** d wrapped into (−180, 180]. */
function wrap180(d) {
  let x = d % 360;
  if (x > 180) x -= 360;
  else if (x <= -180) x += 360;
  return x;
}

/**
 * A ring drag's total angle after a new raw reading: the step from the previous reading is taken the short way round,
 * so the total runs on past ±180° (170°, 175°, −178°, −170° add up to 20°).
 */
export function accumulateAngle(total, prevRaw, raw) {
  return total + wrap180(raw - prevRaw);
}

// -------------------------------------------------------------------------------------------------- handles

/**
 * Which handles show for these frame axes and view direction (M4 §3.11.1): an arrow hides when its axis is within 8°
 * of the line of sight, a square when its normal is more than 82° from it (edge-on); rings always show (edge-on as a
 * line). `show` is the HUD's Handles choice. Drawing and hitHandle use the same rule.
 * @returns {{ center: boolean, axis: boolean[], plane: boolean[], ring: boolean[] }}
 */
export function handleVisibility(axes, viewDir, show = 'both') {
  if (!HANDLE_SETS.includes(show)) throw new RangeError(`show must be one of ${quote(HANDLE_SETS)} (got ${repr(show)})`);
  const E = axesOf(axes);
  const d = unit(vec(viewDir, 'viewDir'), 'viewDir');
  const move = show !== 'rotate', rotate = show !== 'move';
  return {
    center: move,
    axis: E.map((e) => move && Math.abs(dot(e, d)) <= MOVE_TOOL.hideArrowCos),
    plane: PLANE_AXES.map(([i, j]) => move && Math.abs(dot(unit(cross(E[i], E[j]), 'plane normal'), d)) >= MOVE_TOOL.hideSquareCos),
    ring: E.map(() => rotate),
  };
}

/** Distance from screen point m to segment ab, and the segment parameter of the nearest point. */
function segmentDistance(m, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const f = L2 > 0 ? Math.min(1, Math.max(0, ((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / L2)) : 0;
  return { distance: Math.hypot(m[0] - a[0] - f * dx, m[1] - a[1] - f * dy), f };
}

/** Distance from m to a convex screen quadrilateral: 0 inside, else to its nearest edge. */
function quadDistance(m, quad) {
  let pos = false, neg = false, edge = Infinity, area = 0;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i], b = quad[(i + 1) % quad.length];
    const z = (b[0] - a[0]) * (m[1] - a[1]) - (b[1] - a[1]) * (m[0] - a[0]);
    if (z > 0) pos = true;
    else if (z < 0) neg = true;
    area += a[0] * b[1] - b[0] * a[1];
    edge = Math.min(edge, segmentDistance(m, a, b).distance);
  }
  return pos && neg ? edge : Math.abs(area) > DEGENERATE ? 0 : edge;
}

/** e1, e2 spanning the plane of ring k, with e1 × e2 = ê_k (so +θ runs from e1 to e2). */
function ringBasis(E, k) {
  const u = E[k];
  for (const c of [E[(k + 1) % 3], E[(k + 2) % 3], ...CARTESIAN]) {
    const p = reject(c, u), L = norm(p);
    if (L > IN_PLANE * norm(c)) {
      const e1 = scale(p, 1 / L);
      return [e1, cross(u, e1)];
    }
  }
  throw new RangeError('no direction normal to the ring axis');
}

/**
 * The point of ring k nearest to screen point m: the screen distance to the projected ring (a closed polyline of
 * MOVE_TOOL.ring.segments sides), the ring point there (drawn coordinates) and the screen tangent (unit) pointing the
 * way the point moves for +θ. Null when part of the ring does not project.
 */
function ringNearest(m, C, E, k, wpp, at) {
  const [e1, e2] = ringBasis(E, k);
  const R = MOVE_TOOL.ring.radius * wpp, N = MOVE_TOOL.ring.segments;
  const onRing = (t) => axpy(axpy(C, R * Math.cos(t), e1), R * Math.sin(t), e2);
  const pts = [];
  for (let i = 0; i < N; i++) {
    const p = at(onRing((2 * Math.PI * i) / N));
    if (!p) return null;
    pts.push(p);
  }
  let best = null;
  for (let i = 0; i < N; i++) {
    const { distance, f } = segmentDistance(m, pts[i], pts[(i + 1) % N]);
    if (!best || distance < best.distance) best = { distance, i, f };
  }
  const t = ((best.i + best.f) * 2 * Math.PI) / N;
  const point = onRing(t);
  const T = axpy(scale(e1, -Math.sin(t)), Math.cos(t), e2);
  const h = TANGENT_STEP * R;
  const p1 = at(axpy(point, -h, T)), p2 = at(axpy(point, h, T));
  let tau = p1 && p2 ? [p2[0] - p1[0], p2[1] - p1[1]] : null;
  if (!tau || Math.hypot(tau[0], tau[1]) <= DEGENERATE * ((2 * h) / wpp)) {
    // exactly edge-on, at an end of the projected line: the segment's own direction
    const a = pts[best.i], b = pts[(best.i + 1) % N];
    tau = [b[0] - a[0], b[1] - a[1]];
  }
  const L = Math.hypot(tau[0], tau[1]);
  return { distance: best.distance, point, tangent: L > TINY ? [tau[0] / L, tau[1] / L] : [1, 0] };
}

/**
 * The handle under a screen point, in screen space (M4 §3.11.1): the centre disc, the three plane squares, the three
 * arrows and the three rings, each within its tolerance (the larger `pickTouch` one for touch and pen), the hidden
 * ones left out (handleVisibility). Priority: centre > squares > arrows > rings; within a kind the nearest wins
 * (of squares the pointer is inside, the one whose centre is nearer), ties the lower index.
 *
 * `pointer` and `project` share one CSS-px space; `pivot` is the drawn pivot, `axes` the frame axes,
 * `worldPerPixel` Å per px at the pivot.
 * @returns {null | { kind: 'center', distance } | { kind: 'plane', plane, axes: [i, j], distance }
 *   | { kind: 'axis', axis, distance } | { kind: 'ring', axis, distance, point, tangent }}
 */
export function hitHandle(pointer, { pivot, axes, viewDir, worldPerPixel, project, show = 'both', touch = false } = {}) {
  const m = vec2(pointer, 'pointer');
  const C = vec(pivot, 'pivot');
  const E = axesOf(axes);
  const wpp = positive(worldPerPixel, 'worldPerPixel');
  const at = projector(project);
  const vis = handleVisibility(E, viewDir, show);
  const tol = (h) => (touch ? h.pickTouch : h.pick);
  const T = MOVE_TOOL;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  if (vis.center) {
    const c = at(C);
    const distance = c ? dist(m, c) : Infinity;
    if (distance <= tol(T.center)) return { kind: 'center', distance };
  }

  let best = null;
  const o = T.square.offset, h = T.square.size / 2;
  PLANE_AXES.forEach(([i, j], k) => {
    if (!vis.plane[k]) return;
    const corner = (a, b) => at(axpy(axpy(C, a * wpp, E[i]), b * wpp, E[j]));
    const quad = [corner(o - h, o - h), corner(o + h, o - h), corner(o + h, o + h), corner(o - h, o + h)];
    if (quad.some((p) => !p)) return;
    const distance = quadDistance(m, quad);
    if (distance > tol(T.square)) return;
    const mid = corner(o, o);
    const centre = mid ? dist(m, mid) : Infinity;
    if (!best || distance < best.distance || (distance === best.distance && centre < best.centre)) {
      best = { kind: 'plane', plane: k, axes: [i, j], distance, centre };
    }
  });
  if (best) return { kind: 'plane', plane: best.plane, axes: best.axes, distance: best.distance };

  E.forEach((e, k) => {
    if (!vis.axis[k]) return;
    const a = at(axpy(C, T.arrow.from * wpp, e)), b = at(axpy(C, T.arrow.to * wpp, e));
    if (!a || !b) return;
    const { distance } = segmentDistance(m, a, b);
    if (distance <= tol(T.arrow) && (!best || distance < best.distance)) best = { kind: 'axis', axis: k, distance };
  });
  if (best) return best;

  E.forEach((e, k) => {
    if (!vis.ring[k]) return;
    const near = ringNearest(m, C, E, k, wpp, at);
    if (near && near.distance <= tol(T.ring) && (!best || near.distance < best.distance)) {
      best = { kind: 'ring', axis: k, distance: near.distance, point: near.point, tangent: near.tangent };
    }
  });
  return best;
}

/**
 * What a press takes (M4 §3.11.1): the handle `hitHandle` found, else the atom of the viewer's `Hit` when it is
 * selected (`selected`: a Set of atom indices or a predicate), else nothing (the viewer box-selects as usual).
 * @returns {object | { kind: 'atom', atom } | null}
 */
export function pressTarget(handle, hit, selected) {
  if (handle) return handle;
  const atom = hit?.atom ?? null;
  if (!atom) return null;
  const src = atom.src ?? atom.index;
  const isSelected = typeof selected === 'function' ? selected(src) : !!selected?.has?.(src);
  return isSelected ? { kind: 'atom', atom } : null;
}

// ---------------------------------------------------------------------------------------------------- drags

function viewOf(view) {
  if (!view || typeof view.pointOnPlane !== 'function' || typeof view.pointOnLine !== 'function') {
    throw new TypeError('view must have pointOnPlane(x, y, point, normal) and pointOnLine(x, y, origin, dir)');
  }
  return view;
}

const viewDirOf = (view) => unit(vec(view.viewDir, 'view.viewDir'), 'view.viewDir');

/**
 * The plane a selected atom is dragged in (M4 §3.11.2, D9): through the grab point and along the surface (normal n̂,
 * the height stays) when there is a surface (`surface` = `surfaceNormal(s)` with `surface: true`, U1), the HUD's
 * `Screen plane` is off and the view is not edge-on (|n̂·d̂| ≥ MOVE_TOOL.edgeOnCos); otherwise the screen plane
 * (normal −d̂). `edgeOn` marks the automatic fallback (HUD: `Edge-on view: dragging in the screen plane`).
 * @returns {{ mode: 'surface' | 'screen', normal: number[], edgeOn: boolean }}
 */
export function directDragPlane({ surface = null, viewDir, screenPlane = false } = {}) {
  const d = unit(vec(viewDir, 'viewDir'), 'viewDir');
  const n = surfaceNormalOf(surface);
  if (n && !screenPlane) {
    if (Math.abs(dot(n, d)) >= MOVE_TOOL.edgeOnCos) return { mode: 'surface', normal: n, edgeOn: false };
    return { mode: 'screen', normal: scale(d, -1), edgeOn: true };
  }
  return { mode: 'screen', normal: scale(d, -1), edgeOn: false };
}

/**
 * Where the pointer is along the line origin + s·axis (Å from origin, axis made unit): `view.pointOnLine` of the
 * viewer. Null when the axis is within about 5° of the line of sight (|û·d̂| > MOVE_TOOL.axisParallelCos), where the
 * reading is unstable, or when the view gives no point; an axis drag then keeps its last value.
 */
export function axisParam(view, pointer, origin, axis) {
  viewOf(view);
  const m = vec2(pointer, 'pointer'), O = vec(origin, 'origin'), u = unit(vec(axis, 'axis'), 'axis');
  if (Math.abs(dot(u, viewDirOf(view))) > MOVE_TOOL.axisParallelCos) return null;
  const q = view.pointOnLine(m[0], m[1], O, u);
  if (!q) return null;
  const p = viewPoint(q.point);
  if (p) return dot(sub(p, O), u);
  return Number.isFinite(q.s) ? q.s : null;
}

function planePoint(view, m, point, normal) {
  return viewPoint(view.pointOnPlane(m[0], m[1], point, normal));
}

/**
 * Start a drag at a press (M4 §3.11.2). `spec`:
 * - `kind`: one of DRAG_KINDS, or taken from `hit` (a hitHandle result, whose tangent an edge-on ring uses; a
 *   pressTarget atom gives 'direct');
 * - `pointer`: the press position [x, y]; `view`: the view (see the file comment); `axes`: the frame axes;
 * - `pivot`: the drawn pivot C (every kind but 'direct', where it is optional);
 * - `axis` (arrows, rings) or `plane` (squares): the handle index, else from `hit`;
 * - `grab`: the drawn position of the pressed atom's copy ('direct');
 * - `surface`: the `surfaceNormal(s)` result ('direct'; also tells which square is the surface plane for targets);
 * - `screenPlane`: the HUD's `Screen plane` toggle ('direct');
 * - `ref`: the point that snaps to targets (default the pivot, else the grab point).
 * The drag plane, the mode and the edge-on fallbacks are fixed here: arrows read `pointOnLine` through C; squares the
 * plane through C spanned by their two axes; the centre the screen plane through C; a selected atom the
 * directDragPlane through the grab point; a ring the plane through C normal to its axis (|û·d̂| > edgeOnCos), else the
 * tangent method (the ring's screen tangent τ at the grab point and its screen radius ρ = MOVE_TOOL.ring.radius).
 * Returns the drag state for dragTo: `kind`, `mode` ('surface'|'screen' for atoms, 'plane'|'tangent' for rings),
 * `edgeOn`, `normal` (the drag plane's), `axis` (unit, arrows and rings), `pivot`, `result` (the latest dragTo
 * result); fields starting with `_` are private.
 */
export function beginDrag(spec = {}) {
  const hit = spec.hit ?? null;
  const kind = spec.kind ?? (hit?.kind === 'atom' ? 'direct' : hit?.kind);
  if (!DRAG_KINDS.includes(kind)) throw new RangeError(`kind must be one of ${quote(DRAG_KINDS)} (got ${repr(kind)})`);
  const view = viewOf(spec.view);
  const m0 = vec2(spec.pointer, 'pointer');
  const E = axesOf(spec.axes);
  const d = viewDirOf(view);
  const C = kind === 'direct' && spec.pivot == null ? null : vec(spec.pivot, 'pivot');
  const st = {
    kind, mode: null, edgeOn: false, normal: null, axis: null, axisIndex: null, plane: null, pivot: C, result: null,
    _view: view, _axes: E, _pointer: m0, _origin: C, _zero: null, _last: 0, _eff: 0,
    _inPlane: null, _keepHeight: false, _target: null, _ref: null, _tangent: null,
  };
  const surfaceN = surfaceNormalOf(spec.surface ?? null);
  if (kind === 'axis' || kind === 'ring') {
    const k = axisIndex(spec.axis ?? hit?.axis, 'axis');
    st.axisIndex = k;
    st.axis = E[k];
  }
  if (kind === 'axis') {
    st._zero = axisParam(view, m0, C, st.axis);
  } else if (kind === 'ring') {
    if (Math.abs(dot(st.axis, d)) > MOVE_TOOL.edgeOnCos) {
      st.mode = 'plane';
      const q = planePoint(view, m0, C, st.axis);
      st._zero = q && norm(reject(sub(q, C), st.axis)) > TINY ? sub(q, C) : null;
    } else {
      st.mode = 'tangent';
      st._zero = m0;
      if (hit?.kind === 'ring' && hit.tangent) st._tangent = vec2(hit.tangent, 'hit.tangent');
      else {
        if (typeof view.worldPerPixel !== 'function') throw new TypeError('view must have worldPerPixel(point) for an edge-on ring');
        const near = ringNearest(m0, C, E, st.axisIndex, positive(view.worldPerPixel(C), 'worldPerPixel'), projector(view.project));
        st._tangent = near ? near.tangent : [1, 0];
      }
      const L = Math.hypot(st._tangent[0], st._tangent[1]);
      st._tangent = L > TINY ? [st._tangent[0] / L, st._tangent[1] / L] : [1, 0];
    }
  } else {
    st._last = [0, 0, 0];
    st._eff = [0, 0, 0];
    if (kind === 'plane') {
      const k = axisIndex(spec.plane ?? hit?.plane, 'plane');
      const [i, j] = PLANE_AXES[k];
      st.plane = k;
      st._inPlane = [i, j];
      st.normal = unit(cross(E[i], E[j]), 'plane normal');
      if (surfaceN && Math.abs(dot(st.normal, surfaceN)) >= 1 - PARALLEL) st._target = { mode: 'plane', normal: surfaceN };
    } else if (kind === 'center') {
      st.normal = scale(d, -1);
      st._target = { mode: 'point' };
    } else {
      st._origin = vec(spec.grab, 'grab');
      const plane = directDragPlane({ surface: spec.surface ?? null, viewDir: d, screenPlane: !!spec.screenPlane });
      st.mode = plane.mode;
      st.edgeOn = plane.edgeOn;
      st.normal = plane.normal;
      st._keepHeight = plane.mode === 'surface';
      st._target = plane.mode === 'surface' ? { mode: 'plane', normal: plane.normal } : { mode: 'point' };
    }
    st._zero = planePoint(view, m0, st._origin, st.normal);
  }
  st._ref = vec(spec.ref ?? C ?? st._origin, 'ref');
  st.result = output(st, 0, null, MOVE_TOOL.snapRadius, false);
  return st;
}

/** The raw reading at pointer m relative to the press (scalar for arrows and rings, vector otherwise), or null. */
function rawValue(st, m) {
  const view = st._view;
  if (st.kind === 'axis') {
    const s = axisParam(view, m, st._origin, st.axis);
    if (s === null) return null;
    if (st._zero === null) st._zero = s;
    return s - st._zero;
  }
  if (st.kind === 'ring') {
    if (st.mode === 'tangent') {
      return (((m[0] - st._zero[0]) * st._tangent[0] + (m[1] - st._zero[1]) * st._tangent[1]) / MOVE_TOOL.ring.radius) / DEG;
    }
    const q = planePoint(view, m, st.pivot, st.axis);
    if (!q) return null;
    const v = sub(q, st.pivot);
    if (st._zero === null) {
      if (!(norm(reject(v, st.axis)) > TINY)) return null;
      st._zero = v;
      st._last = 0;
    }
    return angleAbout(st._zero, v, st.axis);
  }
  const q = planePoint(view, m, st._origin, st.normal);
  if (!q) return null;
  if (st._zero === null) st._zero = q;
  return reject(sub(q, st._zero), st.normal);
}

/** The drag's output for its current effective value: grid snapping, then snap targets. */
function output(st, snap, targets, snapRadius, kept) {
  if (st.kind === 'ring') {
    if (Array.isArray(snap)) throw new TypeError(`a ring drag snaps to one angle step in degrees (got ${repr(snap)})`);
    const step = snap == null || snap === false ? 0 : snap;
    const angle = snapToStep(st._eff, step);
    return { kind: 'ring', angle, axis: st.axis.slice(), pivot: st.pivot.slice(), moved: Math.abs(angle) > MOVE_TOOL.minAngle, snapped: step > 0, target: null, kept };
  }
  const steps = stepsOf(snap);
  const E = st._axes;
  let delta, snapped;
  if (st.kind === 'axis') {
    const step = steps[st.axisIndex];
    snapped = step > 0;
    delta = scale(st.axis, snapToStep(st._eff, step));
  } else if (st.kind === 'plane') {
    const [i, j] = st._inPlane;
    snapped = steps[i] > 0 || steps[j] > 0;
    if (snapped) {
      const [a, b] = planeComponents(st._eff, E[i], E[j]);
      delta = axpy(scale(E[i], snapToStep(a, steps[i])), snapToStep(b, steps[j]), E[j]);
    } else delta = st._eff.slice();
  } else {
    snapped = steps.some((s) => s > 0);
    if (snapped) {
      const c = dualComponents(st._eff, E).map((v, k) => snapToStep(v, steps[k]));
      delta = axpy(axpy(scale(E[0], c[0]), c[1], E[1]), c[2], E[2]);
      if (st._keepHeight) delta = reject(delta, st.normal);
    } else delta = st._eff.slice();
  }
  let target = null;
  if (targets != null && st._target) {
    if (typeof st._view.project !== 'function') throw new TypeError('view must have project(x, y, z) for snap targets');
    const res = snapToTarget(st._ref, delta, targets, { project: st._view.project, mode: st._target.mode, normal: st._target.normal, radius: snapRadius });
    delta = res.delta;
    target = res.target;
  }
  return { kind: st.kind, delta, moved: norm(delta) > D.positionTolerance, snapped, target, kept };
}

/**
 * Follow the pointer (M4 §3.11.2–3.11.3): read the drag at `pointer`, add the change since the last reading times
 * `fine` (Shift or the HUD's Fine: `SURFACE_DEFAULTS.fineFactor`; 1 otherwise), so that switching fine on or off
 * never jumps, then snap: `snap` is the HUD step while Ctrl/⌘ or Snap is on (Å, or a list of three per-axis steps,
 * for translations; degrees for rings; 0 = off). Translations snap along the arrow, on the square's two axes, or on
 * the contravariant components of all three frame axes (centre, atoms; an atom dragged along the surface keeps its
 * height); snapping filters the output and never changes the accumulated value. Then `targets` (null while Alt is
 * held): screen-plane drags snap to the nearest target point, drags in the surface plane to its in-plane position
 * (snapToTarget); arrows, other squares and rings have no targets.
 * The result (also kept as `state.result`): `{ kind, delta }` for translations or `{ kind: 'ring', angle, axis,
 * pivot }`, plus `moved` (false: nothing to apply, cancel on release), `snapped`, `target` (index or null) and
 * `kept` (the pointer gave no reading, e.g. an arrow along the line of sight, so the last value stands).
 */
export function dragTo(state, pointer, { fine = 1, snap = 0, targets = null, snapRadius = MOVE_TOOL.snapRadius } = {}) {
  if (!state || !DRAG_KINDS.includes(state.kind) || !state._view) throw new TypeError('state must come from beginDrag()');
  const m = vec2(pointer, 'pointer');
  const f = positive(fine, 'fine');
  const raw = rawValue(state, m);
  const kept = raw === null;
  if (!kept) {
    if (state.kind === 'ring') {
      const step = state.mode === 'plane' ? wrap180(raw - state._last) : raw - state._last;
      state._eff += step * f;
    } else if (state.kind === 'axis') {
      state._eff += (raw - state._last) * f;
    } else {
      state._eff = axpy(state._eff, f, sub(raw, state._last));
    }
    state._last = raw;
  }
  state.result = output(state, snap, targets, snapRadius, kept);
  return state.result;
}
