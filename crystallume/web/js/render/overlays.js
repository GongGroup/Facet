/**
 * Overlays: things drawn over a structure that are not part of it (plane and cell previews, ghosts,
 * site markers, handles, labels, legend rows). `viewer.overlays.add(layer)` puts a layer in one tier:
 *   'scene'  (A) THREE objects inside the 3D scene, with real depth (plane previews, ghosts, cell
 *            outlines). They take no part in the ambient-occlusion, outline, drop-shadow and depth-of-field
 *            passes (userData.noInk), cast and receive no shadows and ignore fog.
 *   'top'    (B) THREE objects drawn after post-processing with their own lights, over everything; with
 *            depth: 'atoms' they hide behind the drawn atoms (a depth pre-pass).
 *   'canvas' (C) draw(g, ctx) on the 2D overlay canvas, after the measurement values and before the legends.
 *   'dom'    (C) an element placed in the viewer's container (never part of an image).
 *   'legend'     rows for the legend stack in the bottom-right corner: items() → [{label, swatch}].
 * Each layer has an export policy: 'never' (the default), 'marker' (in PNG exports only with "Include
 * markers") or 'always'. Thumbnails carry no layers and no halos at all; glTF exports never do.
 *
 * Layer fields (F0-A §3.11.1): { id, owner, tier, object, draw, items, el, export, pickable, pick(ray, ctx),
 * pickIn, onModel(model, viewer), beforeRender(ctx), bounds() → {center, radius}, depth, clearOnSwitch,
 * order, visible, dispose }. A building block may add `attach(viewer, handle)` (called once it is added),
 * `onTheme({dark})` (the background turned dark or light), `set(patch)` for its own fields and other methods
 * (setPoints…), which the handle forwards.
 *
 * Building blocks: markerLayer, planeLayer, cellOutlineLayer, ghostLayer, textLayer. The pure helpers
 * (export policy, colour specs, halo order, index remapping, bounds, ray–sphere picking) are exported for
 * the viewer and for tests.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { LineSegments2 } from '../../vendor/three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from '../../vendor/three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from '../../vendor/three/addons/lines/LineMaterial.js';

export const TIERS = Object.freeze(['scene', 'top', 'canvas', 'dom', 'legend']);
export const EXPORT_POLICIES = Object.freeze(['never', 'marker', 'always']);
export const DEPTHS = Object.freeze(['none', 'atoms']);
/** Halo names the viewer keeps for itself: the selection and the hovered atom (both in the theme's accent colour). */
export const RESERVED_HIGHLIGHTS = Object.freeze(['select', 'hover']);
/** Colour of a named highlight that does not give one (F0-A prescribes no colour for any name). */
export const DEFAULT_HIGHLIGHT_COLOR = Object.freeze({ light: '#7a4fd6', dark: '#b39bff' });
/** Inner line of a two-colour halo rim, on a light and on a dark background, and its opacity. */
export const HALO_EDGE = Object.freeze({ light: '#14171b', dark: '#000000', alpha: 0.65 });
/** Halos are drawn after the atoms, the smaller (lower grow) first; measurement lines (20) come after them. */
export const HALO_ORDER_BASE = 10;

/** Layer fields every tier has, and those of one tier (another tier's name, e.g. textLayer's items, belongs to the building block). */
const COMMON_FIELDS = ['id', 'owner', 'tier', 'export', 'pickable', 'pick', 'pickIn', 'onModel', 'beforeRender', 'bounds', 'clearOnSwitch', 'order', 'visible', 'dispose'];
const TIER_FIELDS = { scene: ['object'], top: ['object', 'depth'], canvas: ['draw'], dom: ['el'], legend: ['items'] };
const FIELDS_OF = Object.fromEntries(Object.entries(TIER_FIELDS).map(([t, f]) => [t, new Set([...COMMON_FIELDS, ...f])]));
/** Building-block hooks: called by Overlays, never forwarded by the handle. */
const HOOKS = new Set(['attach', 'detach', 'onTheme', 'set']);
const SWATCH_KINDS = new Set(['halo', 'dot', 'line']);

// ------------------------------------------------------------------ pure helpers

/** Whether halo `name` (with its export policy) shows in an export of `kind` ('png' | 'thumbnail'). */
export function haloExported(kind, name, policy = 'marker', { selection = true, markers = false } = {}) {
  if (kind !== 'png') return false;            // thumbnails carry no halos at all
  if (name === 'hover') return false;          // the hovered atom is never exported
  if (name === 'select') return selection !== false;
  return policy === 'always' || (policy === 'marker' && !!markers);
}

/** Whether a layer with export policy `policy` shows in an export of `kind` ('png' | 'thumbnail'). */
export function layerExported(kind, policy = 'never', { markers = false } = {}) {
  if (kind !== 'png') return false;            // thumbnails carry no overlays, not even 'always' ones
  return policy === 'always' || (policy === 'marker' && !!markers);
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const FN_RE = /^(?:rgba?|hsla?)\([^()]*\)$/i;
const VAR_RE = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*(.+?))?\s*\)$/;

/** A plain CSS colour THREE.Color understands: #rgb, #rrggbb, rgb()/rgba()/hsl()/hsla() or a colour name. */
export function isPlainColor(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return HEX_RE.test(t) || FN_RE.test(t) || Object.hasOwn(THREE.Color.NAMES, t.toLowerCase());
}

/** A highlight colour: a plain CSS colour, 'var(--token)' (optionally with a fallback) or {light, dark} of those. */
export function isColorSpec(c) {
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const keys = Object.keys(c);
    return keys.length > 0 && keys.every((k) => k === 'light' || k === 'dark') && keys.every((k) => isColorSpec(c[k]) && typeof c[k] === 'string');
  }
  if (typeof c !== 'string') return false;
  const m = VAR_RE.exec(c.trim());
  return m ? (m[2] == null || isPlainColor(m[2])) : isPlainColor(c);
}

/**
 * The plain colour a spec stands for now: {light, dark} by the background (dark: true on a dark one),
 * 'var(--token)' through `css(name)` (the computed value of a CSS custom property), else the colour itself.
 * Anything that does not end in a plain colour gives `fallback`.
 */
export function resolveColor(spec, { dark = false, css = null, fallback = null } = {}) {
  if (spec && typeof spec === 'object') return resolveColor(dark ? (spec.dark ?? spec.light) : (spec.light ?? spec.dark), { dark, css, fallback });
  if (typeof spec !== 'string') return fallback;
  const t = spec.trim();
  const m = VAR_RE.exec(t);
  if (!m) return isPlainColor(t) ? t : fallback;
  let v = '';
  try { v = String(css?.(m[1]) ?? '').trim(); } catch { v = ''; }
  if (isPlainColor(v)) return v;
  return m[2] != null && isPlainColor(m[2]) ? m[2].trim() : fallback;
}

/** Checked options of setHighlight(name, indices, opts), defaults filled in (every call starts from the defaults). */
export function normalizeHighlight(name, { color = DEFAULT_HIGHLIGHT_COLOR, grow = 1.15, opacity = 1, strength = 1.4, contrast = true, export: exp = 'marker' } = {}) {
  const who = `Highlight “${name}”`;
  if (!isColorSpec(color)) throw new TypeError(`${who}: color must be a CSS colour, {light, dark} or 'var(--token)'.`);
  if (typeof grow !== 'number' || !(grow > 0) || !Number.isFinite(grow)) throw new RangeError(`${who}: grow must be a number above 0.`);
  if (typeof opacity !== 'number' || !(opacity >= 0 && opacity <= 1)) throw new RangeError(`${who}: opacity must be between 0 and 1.`);
  if (typeof strength !== 'number' || !(strength >= 0) || !Number.isFinite(strength)) throw new RangeError(`${who}: strength must be 0 or more.`);
  if (!EXPORT_POLICIES.includes(exp)) throw new TypeError(`${who}: export must be never, marker or always.`);
  return { color, grow, opacity, strength, contrast: contrast !== false, export: exp };
}

/** A highlight name, checked: a non-empty string other than the reserved 'select' and 'hover'. */
export function checkHighlightName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('A highlight needs a name (a non-empty string).');
  if (RESERVED_HIGHLIGHTS.includes(name)) throw new Error(`“${name}” is the viewer's own halo; give the highlight another name.`);
  return name;
}

/** The atom (source) indices of a highlight as a Set: any iterable of whole numbers ≥ 0. */
export function highlightIndexSet(name, indices) {
  if (indices == null || typeof indices === 'string' || typeof indices[Symbol.iterator] !== 'function') {
    throw new TypeError(`Highlight “${name}”: pass atom indices as an array (or null to clear it).`);
  }
  const out = new Set();
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0) throw new TypeError(`Highlight “${name}”: atom indices must be whole numbers ≥ 0 (got ${typeof i === 'number' ? i : typeof i}).`);
    out.add(i);
  }
  return out;
}

/**
 * Draw order of halos: renderOrder per name, the smaller (lower grow) first so that an outer halo blends over
 * an inner one; ties by name. entries = [{name, grow}] (the reserved 'select' and 'hover' included).
 */
export function haloOrder(entries) {
  const list = [...entries].filter((e) => e && typeof e.name === 'string').sort((a, b) => (a.grow - b.grow) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return new Map(list.map((e, k) => [e.name, HALO_ORDER_BASE + Math.min(k, 99) / 10]));
}

/**
 * Indices after an edit: `map[old]` is the new index of atom `old`, or anything that is not a whole number
 * ≥ 0 (−1, null, undefined) when it was removed. Returns a new Set.
 */
export function remapIndices(indices, map) {
  const out = new Set();
  for (const i of indices) {
    const j = map?.[i];
    if (Number.isInteger(j) && j >= 0) out.add(j);
  }
  return out;
}

const vec = (p) => (Array.isArray(p) || ArrayBuffer.isView(p) ? [p[0], p[1], p[2]] : [p?.x, p?.y, p?.z]);

/** One sphere containing the spheres [{center: [x, y, z] | {x, y, z}, radius}] (invalid ones skipped); null when none. */
export function unionBounds(list) {
  let c = null, r = 0;
  for (const b of list ?? []) {
    const p = b ? vec(b.center) : null;
    const rb = Number(b?.radius ?? 0);
    if (!p || !p.every(Number.isFinite) || !Number.isFinite(rb) || rb < 0) continue;
    if (!c) { c = p; r = rb; continue; }
    const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    if (d + rb <= r) continue;
    if (d + r <= rb) { c = p; r = rb; continue; }
    const R = (d + r + rb) / 2, f = (R - r) / d;
    c = [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f, c[2] + (p[2] - c[2]) * f];
    r = R;
  }
  return c ? { center: c, radius: r } : null;
}

/**
 * Nearest hit of a ray (THREE.Ray, or {origin, direction} with x/y/z; direction of unit length) on spheres of
 * one radius around points (Float32Array 3n or [[x, y, z], …]); `scale(i)` may enlarge single spheres.
 * Returns {t, index} or null. Spheres behind the ray origin do not count.
 */
export function pickSpheres(ray, points, radius, scale = null) {
  const o = ray?.origin, d = ray?.direction;
  if (!o || !d) return null;
  const flat = ArrayBuffer.isView(points);
  const n = flat ? Math.floor(points.length / 3) : (points?.length ?? 0);
  let best = null;
  for (let i = 0; i < n; i++) {
    const x = flat ? points[3 * i] : points[i][0], y = flat ? points[3 * i + 1] : points[i][1], z = flat ? points[3 * i + 2] : points[i][2];
    const rr = radius * (scale ? scale(i) : 1);
    const lx = x - o.x, ly = y - o.y, lz = z - o.z;
    const tca = lx * d.x + ly * d.y + lz * d.z;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    if (d2 > rr * rr) continue;
    const thc = Math.sqrt(rr * rr - d2);
    let t = tca - thc;
    if (t < 0) t = tca + thc;   // the origin is inside the sphere
    if (t < 0) continue;
    if (!best || t < best.t) best = { t, index: i };
  }
  return best;
}

/** A sphere around flat points (Float32Array 3n or [x, y, z, …]) grown by `pad`: {center, radius}, or null without points. */
export function pointsBounds(flat, pad = 0) {
  const n = Math.floor((flat?.length ?? 0) / 3);
  if (!n) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = flat[3 * i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  let r = 0;
  for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(flat[3 * i] - c[0], flat[3 * i + 1] - c[1], flat[3 * i + 2] - c[2]));
  return { center: c, radius: r + pad };
}

/** End points (24 × xyz) of the 12 edges of the cell spanned by the rows of `cell` from `origin`, as _buildCell draws them. */
export function cellEdges(cell, origin = [0, 0, 0]) {
  const [A, B, C] = cell;
  const P = (a, b, c) => [origin[0] + a * A[0] + b * B[0] + c * C[0], origin[1] + a * A[1] + b * B[1] + c * C[1], origin[2] + a * A[2] + b * B[2] + c * C[2]];
  const E = [[[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [0, 1, 0]], [[0, 0, 0], [0, 0, 1]], [[1, 0, 0], [1, 1, 0]], [[1, 0, 0], [1, 0, 1]], [[0, 1, 0], [1, 1, 0]],
    [[0, 1, 0], [0, 1, 1]], [[0, 0, 1], [1, 0, 1]], [[0, 0, 1], [0, 1, 1]], [[1, 1, 0], [1, 1, 1]], [[1, 0, 1], [1, 1, 1]], [[0, 1, 1], [1, 1, 1]]];
  const out = new Float32Array(72);
  E.forEach(([u, v], k) => { out.set(P(...u), 6 * k); out.set(P(...v), 6 * k + 3); });
  return out;
}

/**
 * Triangles of a planar polygon [[x, y, z], …] (simple, convex or not): {positions: Float32Array, index: number[]}.
 * The plane comes from Newell's normal; a degenerate polygon (collinear points) gives no triangles.
 */
export function triangulatePolygon(points) {
  const P = points.map(vec);
  const n = [0, 0, 0];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const len = Math.hypot(...n);
  const positions = new Float32Array(P.flat());
  if (P.length < 3 || len < 1e-12) return { positions, index: [] };
  const N = new THREE.Vector3(n[0] / len, n[1] / len, n[2] / len);
  const U = new THREE.Vector3().crossVectors(Math.abs(N.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), N).normalize();
  const V = new THREE.Vector3().crossVectors(N, U);
  const flat = P.map((p) => new THREE.Vector2(p[0] * U.x + p[1] * U.y + p[2] * U.z, p[0] * V.x + p[1] * V.y + p[2] * V.z));
  const faces = THREE.ShapeUtils.triangulateShape(flat, []);
  return { positions, index: faces.flat() };
}

/** Rules every 3D overlay object follows (F0-A §3.11.1): no ink/AO passes, no shadows, no fog, no culling; fat lines share the view's resolution. */
export function prepareObject(obj, resolution = null) {
  obj?.traverse?.((o) => {
    o.userData.noInk = true;
    o.castShadow = false;
    o.receiveShadow = false;
    if (o.isInstancedMesh || o.isLineSegments2 || o.isLine2) o.frustumCulled = false;
    for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
      if (m.fog) { m.fog = false; m.needsUpdate = true; }
      if (m.isLineMaterial && resolution) m.uniforms.resolution.value = resolution;
    }
  });
  return obj;
}

/** Dispose an object's geometries and (unshared) materials and take it out of its parent. */
export function disposeObject(obj) {
  obj?.traverse?.((o) => {
    o.geometry?.dispose?.();
    if (o.material && !o.userData.sharedMaterial) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
    if (o.isInstancedMesh) o.dispose?.();
  });
  obj?.parent?.remove(obj);
}

/** Legend rows as overlays give them: [{label, swatch: {kind, color, opacity}}], cleaned (unknown kinds become 'dot'). */
export function legendRows(list) {
  const out = [];
  for (const it of Array.isArray(list) ? list : []) {
    if (!it || it.label == null || it.label === '') continue;
    const sw = it.swatch ?? {};
    const opacity = Number.isFinite(sw.opacity) ? Math.min(1, Math.max(0, sw.opacity)) : 1;
    out.push({ label: String(it.label), swatch: { kind: SWATCH_KINDS.has(sw.kind) ? sw.kind : 'dot', color: isPlainColor(sw.color) ? sw.color.trim() : '#9aa0a6', opacity, dashed: !!sw.dashed } });
  }
  return out;
}

// ------------------------------------------------------------------ halo material

/**
 * Named-highlight halo: a Fresnel rim on the back faces of a sphere a little larger than the atom (as the
 * selection halo). With `contrast` the inner 30 % of the visible ring takes the `edge` colour (a dark line
 * against the atom, F0-A §3.10) and the outer part `color`. Per instance, instanceColor.r carries the atom's
 * share of the halo radius, which places the inner line on the atom's outline whatever its size.
 */
export function haloMaterial({ strength = 1.4, contrast = true, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(DEFAULT_HIGHLIGHT_COLOR.light) }, edge: { value: new THREE.Color(HALO_EDGE.light) },
      strength: { value: strength }, opacity: { value: opacity }, contrast: { value: contrast ? 1 : 0 }, edgeAlpha: { value: HALO_EDGE.alpha },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying float vInner;
      void main() {
        vec4 mv = vec4(position, 1.0);
        vec3 n = normal;
        vInner = 0.8;
        #ifdef USE_INSTANCING
          mv = instanceMatrix * mv;
          n = mat3(instanceMatrix) * n;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vInner = instanceColor.r;
        #endif
        mv = modelViewMatrix * mv;
        vN = normalize(normalMatrix * n);
        vV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color; uniform vec3 edge; uniform float strength; uniform float opacity; uniform float contrast; uniform float edgeAlpha;
      varying vec3 vN; varying vec3 vV; varying float vInner;
      void main() {
        float d = abs(dot(normalize(vN), normalize(vV)));
        float a = pow(1.0 - d, 2.0) * smoothstep(0.0, 0.18, d) * strength;
        vec3 c = color;
        if (contrast > 0.5) {
          // across the visible ring: 0 on the atom's outline, 1 on the halo's
          float rho = sqrt(max(0.0, 1.0 - d * d));
          float t = clamp((rho - vInner) / max(1e-3, 1.0 - vInner), 0.0, 1.0);
          float e = 1.0 - smoothstep(0.24, 0.36, t);
          c = mix(color, edge, e);
          a = mix(a, max(a, edgeAlpha), e);
        }
        gl_FragColor = vec4(c, clamp(a, 0.0, 1.0) * opacity);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.BackSide, toneMapped: false,
  });
}

// ------------------------------------------------------------------ registry

/** The overlays of one viewer (viewer.overlays). */
export class Overlays {
  /** viewer: the Viewer (or a stand-in with container, resolution, requestRender(), on(), _halo, _haloHidden). */
  constructor(viewer = null) {
    this.viewer = viewer;
    /** Tier A: added under the viewer's root, next to the halos. */
    this.sceneGroup = new THREE.Group();
    this.sceneGroup.name = 'overlays';
    /** Tier B: rendered after post-processing, with its own lights (one follows the camera, see Viewer._renderTop). */
    this.topScene = new THREE.Scene();
    this.topScene.name = 'overlays-top';
    this.topLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.topScene.add(new THREE.AmbientLight(0xffffff, 1), this.topLight, this.topLight.target);
    this.topFree = new THREE.Group();     // depth 'none': over everything
    this.topAtoms = new THREE.Group();    // depth 'atoms': hidden behind the atoms
    this.topScene.add(this.topFree, this.topAtoms);
    this._layers = new Map();             // id → record
    this._seq = 0;
    this._model = viewer?.model ?? null;
    this._dark = null;
    viewer?.on?.('model', (m) => this._modelChanged(m));
  }

  _render() { this.viewer?.requestRender?.(); }

  /** Add (or, with an id already in use, replace) a layer. Returns its handle {id, tier, layer, visible, set(patch), setVisible(on), remove(), …}. */
  add(layer) {
    const rec = this._record(layer);
    if (this._layers.has(rec.id)) this.remove(rec.id);
    this._layers.set(rec.id, rec);
    this._mount(rec);
    rec.handle = this._handle(rec);
    try { layer.attach?.(this.viewer, rec.handle); } catch (e) { console.error(`[crystallume] overlay “${rec.id}” failed to attach`, e); }
    if (this._dark != null) this._theme(rec);
    this._render();
    return rec.handle;
  }

  _record(layer) {
    if (!layer || typeof layer !== 'object') throw new TypeError('overlays.add: pass a layer object ({id, tier, …}).');
    const { id } = layer;
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('overlays.add: a layer needs an id (a non-empty string).');
    const who = `Overlay “${id}”`;
    const tier = layer.tier;
    if (!TIERS.includes(tier)) throw new TypeError(`${who}: tier must be one of ${TIERS.join(', ')}.`);
    if (layer.depth !== undefined && layer.depth !== 'none' && tier !== 'top') throw new TypeError(`${who}: depth applies to top layers only.`);
    const rec = {
      id, tier, spec: layer, seq: this._seq++, scopeHidden: false,
      owner: layer.owner ?? null, object: null, draw: null, items: null, el: null,
      export: 'never', pickable: false, pick: null, pickIn: null, onModel: null, beforeRender: null, bounds: null,
      depth: 'none', clearOnSwitch: true, order: 0, visible: true, dispose: null,
    };
    this._assign(rec, layer, true);
    return rec;
  }

  /** Copy the layer fields of `patch` (those of the record's tier) into `rec`, checked. */
  _assign(rec, patch, creating = false) {
    const who = `Overlay “${rec.id}”`;
    const fields = FIELDS_OF[rec.tier];
    const has = (k) => fields.has(k) && Object.hasOwn(patch, k) && patch[k] !== undefined;
    if (has('tier') && patch.tier !== rec.tier) throw new TypeError(`${who}: the tier cannot change; remove the layer and add a new one.`);
    if (has('id') && patch.id !== rec.id) throw new TypeError(`${who}: the id cannot change.`);
    const fn = (k) => { if (has(k) && patch[k] !== null && typeof patch[k] !== 'function') throw new TypeError(`${who}: ${k} must be a function.`); };
    ['draw', 'items', 'pick', 'onModel', 'beforeRender', 'bounds', 'dispose'].forEach(fn);
    if (has('export') && !EXPORT_POLICIES.includes(patch.export)) throw new TypeError(`${who}: export must be never, marker or always.`);
    if (has('depth') && !DEPTHS.includes(patch.depth)) throw new TypeError(`${who}: depth must be 'none' or 'atoms'.`);
    if (has('pickIn') && patch.pickIn !== null && !(Array.isArray(patch.pickIn) && patch.pickIn.every((t) => typeof t === 'string'))) throw new TypeError(`${who}: pickIn must be a list of tool ids or null.`);
    if (has('order') && !Number.isFinite(patch.order)) throw new TypeError(`${who}: order must be a number.`);
    if (has('object') && !(patch.object?.isObject3D)) throw new TypeError(`${who}: object must be a THREE.Object3D.`);
    if (has('el') && !(patch.el && typeof patch.el === 'object' && 'hidden' in patch.el)) throw new TypeError(`${who}: el must be an element.`);
    if (!creating && has('el') && rec.el && rec.el !== patch.el) rec.el.remove?.();
    for (const k of ['owner', 'draw', 'items', 'el', 'export', 'pick', 'onModel', 'beforeRender', 'bounds', 'depth', 'order', 'dispose']) if (has(k)) rec[k] = patch[k];
    if (has('pickIn')) rec.pickIn = patch.pickIn ? [...patch.pickIn] : null;
    if (has('pickable')) rec.pickable = !!patch.pickable;
    if (has('clearOnSwitch')) rec.clearOnSwitch = patch.clearOnSwitch !== false;
    if (has('visible')) rec.visible = patch.visible !== false;
    if (has('object')) {
      const old = rec.object;
      rec.object = patch.object;
      if (!creating && old && old !== rec.object) disposeObject(old);
    }
    if (creating) {
      const need = { scene: 'object', top: 'object', canvas: 'draw', legend: 'items', dom: 'el' }[rec.tier];
      if (!rec[need]) {
        const what = { object: 'a THREE.Object3D in object', draw: 'draw(g, ctx)', items: 'items()', el: 'an element in el' }[need];
        throw new TypeError(`${who}: a ${rec.tier} layer needs ${what}.`);
      }
    }
  }

  /** Put a record's object or element where its tier draws it, with the current visibility. */
  _mount(rec) {
    if (rec.tier === 'scene' || rec.tier === 'top') {
      prepareObject(rec.object, this.viewer?.resolution ?? null);
      const parent = rec.tier === 'scene' ? this.sceneGroup : rec.depth === 'atoms' ? this.topAtoms : this.topFree;
      if (rec.object.parent !== parent) parent.add(rec.object);
    } else if (rec.tier === 'dom') {
      if (rec.el.parentNode !== this.viewer?.container) this.viewer?.container?.appendChild?.(rec.el);
    }
    this._sync(rec);
  }

  /** Apply a record's visibility (its own, and an export scope hiding it). */
  _sync(rec) {
    const on = rec.visible && !rec.scopeHidden;
    if (rec.object) rec.object.visible = on;
    if (rec.el) rec.el.hidden = !rec.visible;   // never part of an image: exports leave it alone
  }

  _handle(rec) {
    const me = this;
    const h = {
      id: rec.id,
      tier: rec.tier,
      get layer() { return rec.spec; },
      get visible() { return rec.visible; },
      get removed() { return me._layers.get(rec.id) !== rec; },
      /** Change layer fields ({visible, export, object, draw, …}); other keys go to the building block's own set(). */
      set(patch = {}) {
        if (me._layers.get(rec.id) !== rec) return h;
        const own = {}, rest = {}, fields = FIELDS_OF[rec.tier];
        for (const [k, v] of Object.entries(patch ?? {})) (fields.has(k) ? own : rest)[k] = v;
        const extra = Object.keys(rest);
        if (extra.length && typeof rec.spec.set !== 'function') throw new TypeError(`Overlay “${rec.id}”: unknown field “${extra[0]}”.`);
        const depthBefore = rec.depth;
        me._assign(rec, own);
        if (extra.length) rec.spec.set(rest);
        if ('object' in own || rec.depth !== depthBefore || 'el' in own) me._mount(rec); else me._sync(rec);
        me._render();
        return h;
      },
      setVisible(on = true) { if (me._layers.get(rec.id) === rec && rec.visible !== !!on) { rec.visible = !!on; me._sync(rec); me._render(); } return h; },
      remove() { if (me._layers.get(rec.id) === rec) me.remove(rec.id); },
    };
    // building-block methods (setPoints, setActive…), with a redraw after each
    for (const k of Object.keys(rec.spec)) {
      if (FIELDS_OF[rec.tier].has(k) || HOOKS.has(k) || k in h || typeof rec.spec[k] !== 'function') continue;
      h[k] = (...a) => { const r = rec.spec[k](...a); me._render(); return r; };
    }
    return h;
  }

  /** The handle of layer `id`, or null. */
  get(id) { return this._layers.get(id)?.handle ?? null; }

  /** The layers, in drawing order (order, then the order they were added): [{id, tier, owner, export, visible, depth, pickable}]. */
  list(tier = null) {
    return this._sorted().filter((r) => !tier || r.tier === tier)
      .map((r) => ({ id: r.id, tier: r.tier, owner: r.owner, export: r.export, visible: r.visible, depth: r.depth, pickable: r.pickable, clearOnSwitch: r.clearOnSwitch }));
  }

  _sorted() { return [...this._layers.values()].sort((a, b) => (a.order - b.order) || (a.seq - b.seq)); }

  /** Remove layer `id` (its dispose(), else its object's geometries and materials). True when there was one. */
  remove(id) {
    const rec = this._layers.get(id);
    if (!rec) return false;
    this._layers.delete(id);
    try { rec.spec.detach?.(); } catch (e) { console.error(e); }
    try {
      if (rec.dispose) rec.dispose();
      else if (rec.object) disposeObject(rec.object);
    } catch (e) { console.error(`[crystallume] overlay “${id}” failed to dispose`, e); }
    rec.object?.parent?.remove(rec.object);
    if (rec.el) rec.el.remove?.();
    this._render();
    return true;
  }

  /** Remove every layer of `owner`; returns how many went. */
  removeOwner(owner) {
    if (owner == null) return 0;
    let n = 0;
    for (const rec of [...this._layers.values()]) if (rec.owner === owner && this.remove(rec.id)) n++;
    return n;
  }

  /** Another structure became the active one: the layers with clearOnSwitch go. */
  switched() {
    for (const rec of [...this._layers.values()]) if (rec.clearOnSwitch) this.remove(rec.id);
  }

  _visible(rec) { return rec.visible && !rec.scopeHidden; }

  _modelChanged(model) {
    if (model === this._model) return;
    this._model = model;
    for (const rec of this._sorted()) {
      if (!rec.onModel) continue;
      try { rec.onModel(model, this.viewer); } catch (e) { console.error(`[crystallume] overlay “${rec.id}” onModel failed`, e); }
    }
    this._render();
  }

  /** Before every frame (after the clipping planes are set): ctx = {camera, width, height, pxPerA(point)}. */
  beforeRender(ctx) {
    for (const rec of this._sorted()) {
      if (!rec.beforeRender || !this._visible(rec)) continue;
      try { rec.beforeRender(ctx); } catch (e) { console.error(`[crystallume] overlay “${rec.id}” beforeRender failed`, e); }
    }
  }

  /** Bounds of the visible layers that give them ([{center, radius}]). */
  bounds() {
    const out = [];
    for (const rec of this._layers.values()) {
      if (!rec.bounds || !this._visible(rec)) continue;
      let b = null;
      try { b = rec.bounds(); } catch (e) { console.error(`[crystallume] overlay “${rec.id}” bounds failed`, e); }
      if (b) out.push(b);
    }
    return out;
  }

  /** `base` ({center: Vector3, radius}) grown to hold the layers' bounds too, for the camera's clipping planes. */
  clipBounds(base) {
    const extra = this.bounds();
    if (!extra.length) return base;
    const u = unionBounds([{ center: base.center, radius: base.radius }, ...extra]);
    return u ? { center: new THREE.Vector3(...u.center), radius: u.radius } : base;
  }

  /** What the top tier needs this frame: any visible layer, and any with depth 'atoms' (the depth pre-pass). */
  topState() {
    let any = false, atoms = false;
    for (const rec of this._layers.values()) {
      if (rec.tier !== 'top' || !this._visible(rec)) continue;
      any = true;
      if (rec.depth === 'atoms') atoms = true;
    }
    return { any, atoms };
  }

  /** Draw the visible canvas layers (ctx: see Viewer.drawOverlay). */
  drawCanvas(g, ctx) {
    for (const rec of this._sorted()) {
      if (rec.tier !== 'canvas' || !this._visible(rec)) continue;
      g.save();
      try { rec.draw(g, ctx); } catch (e) { console.error(`[crystallume] overlay “${rec.id}” failed to draw`, e); } finally { g.restore(); }
    }
  }

  /** Legend rows of the visible legend layers, in layer order. */
  legendItems() {
    const out = [];
    for (const rec of this._sorted()) {
      if (rec.tier !== 'legend' || !this._visible(rec)) continue;
      let list = null;
      try { list = rec.items(); } catch (e) { console.error(`[crystallume] overlay “${rec.id}” items failed`, e); }
      out.push(...legendRows(list));
    }
    return out;
  }

  /** The visible, pickable layers for tool `tool` (pickIn null = every tool), in drawing order. */
  pickables(tool) {
    return this._sorted().filter((r) => this._visible(r) && r.pickable && typeof r.pick === 'function' && (r.pickIn == null || r.pickIn.includes(tool)))
      .map((r) => ({ id: r.id, tier: r.tier, depth: r.depth, pick: r.pick, handle: r.handle }));
  }

  /**
   * Hide what an export of `kind` ('png' | 'thumbnail') leaves out — halos through viewer._haloHidden, layers
   * through their visibility — and return the function that brings it back (call it in a finally).
   * PNG: the selection halo with `selection` (default true), never the hover halo, 'marker' halos and layers
   * with `markers` (default false), 'always' ones always. Thumbnails: no halo and no layer at all.
   */
  exportScope(kind, { selection = true, markers = false } = {}) {
    if (kind !== 'png' && kind !== 'thumbnail') throw new TypeError("exportScope: kind must be 'png' or 'thumbnail'.");
    const opts = { selection, markers };
    const v = this.viewer, hidden = v?._haloHidden, halos = [], layers = [];
    if (hidden) {
      for (const [k, mesh] of Object.entries(v._halo ?? {})) {
        if (!hidden.has(k) && !haloExported(kind, k, mesh?.userData?.export, opts)) { hidden.add(k); halos.push(k); }
      }
    }
    for (const rec of this._layers.values()) {
      if (rec.tier === 'dom' || rec.scopeHidden || layerExported(kind, rec.export, opts)) continue;
      rec.scopeHidden = true;
      this._sync(rec);
      layers.push(rec);
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      for (const k of halos) hidden.delete(k);
      for (const rec of layers) { rec.scopeHidden = false; this._sync(rec); }
    };
  }

  /** The background turned dark (or light): building blocks that adapt their colours do so. */
  theme(dark) {
    this._dark = !!dark;
    for (const rec of this._layers.values()) this._theme(rec);
  }

  _theme(rec) {
    if (typeof rec.spec.onTheme !== 'function') return;
    try { rec.spec.onTheme({ dark: !!this._dark }); } catch (e) { console.error(`[crystallume] overlay “${rec.id}” onTheme failed`, e); }
  }

  /** Remove every layer. */
  dispose() { for (const id of [...this._layers.keys()]) this.remove(id); }
}

// ------------------------------------------------------------------ building blocks

/** Layer fields a building block passes through from its options. */
const passThrough = (o) => {
  const out = {};
  for (const k of ['owner', 'order', 'visible', 'clearOnSwitch', 'onModel', 'beforeRender', 'depth']) if (o[k] !== undefined) out[k] = o[k];
  return out;
};

/** Points as a Float32Array 3n: from [[x, y, z], …], {x, y, z} objects or a flat array. */
function flatPoints(points, who) {
  if (points == null) return new Float32Array(0);
  if (ArrayBuffer.isView(points)) {
    if (points.length % 3) throw new TypeError(`${who}: a flat point list needs 3 numbers per point.`);
    return Float32Array.from(points);
  }
  if (!Array.isArray(points)) throw new TypeError(`${who}: points must be a list of [x, y, z].`);
  const out = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    const v = vec(p);
    if (!v.every(Number.isFinite)) throw new TypeError(`${who}: point ${i} is not [x, y, z] in Å.`);
    out.set(v, 3 * i);
  });
  return out;
}

/** A fat-line material that follows the view's resolution (and the export's, see Viewer.screenshot). */
function lineMaterial({ color, width, dashed = false, opacity = 1, dash = 0.32, gap = 0.22 }, viewer) {
  const m = new LineMaterial({ color: new THREE.Color(color), linewidth: width, worldUnits: false, transparent: true, opacity, dashed, dashSize: dash, gapSize: gap });
  if (viewer?.resolution) m.uniforms.resolution.value = viewer.resolution;
  m.fog = false;
  return m;
}

const MARKER_COLOR = '#d6336c';
const MARKER_EDGE = { light: '#14171b', dark: '#f1f3f5' };
const _mtx = new THREE.Matrix4(), _col = new THREE.Color();

/**
 * Small spheres with a thin outline, e.g. adsorption sites (F0-A §3.11.4): tier 'top' (default) or 'scene',
 * export 'marker'. points: [[x, y, z], …] in drawn (display) coordinates; colors: one CSS colour, one per point,
 * or null. setPoints(points, colors) replaces them; setActive(i) enlarges marker i 1.3× (−1: none).
 * pick(ray) → {t, index, item: [x, y, z]} | null, on spheres of max(radius, 0.25) Å.
 */
export function markerLayer({ id, points = [], colors = null, radius = 0.32, tier = 'top', export: exp = 'marker', pickable = true, pickIn = null, ...more } = {}) {
  const who = `markerLayer “${id}”`;
  if (tier !== 'top' && tier !== 'scene') throw new TypeError(`${who}: tier must be 'top' or 'scene'.`);
  if (!(radius > 0)) throw new RangeError(`${who}: radius must be above 0.`);
  const group = new THREE.Group();
  group.name = `markers ${id}`;
  const geo = new THREE.SphereGeometry(1, 20, 14);
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const edgeMat = new THREE.MeshBasicMaterial({ color: MARKER_EDGE.light, side: THREE.BackSide, toneMapped: false });
  let fill = null, edge = null, pts = new Float32Array(0), active = -1, box = null, viewer = null;
  const n = () => pts.length / 3;
  const place = (i) => {
    const r = radius * (i === active ? 1.3 : 1);
    _mtx.makeScale(r, r, r).setPosition(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
    fill.setMatrixAt(i, _mtx);
    _mtx.makeScale(r * 1.18, r * 1.18, r * 1.18).setPosition(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
    edge.setMatrixAt(i, _mtx);
  };
  const layer = {
    id, tier, object: group, export: exp, pickable, pickIn, ...passThrough(more),
    /** The marker positions (Float32Array 3n, drawn coordinates). */
    get points() { return pts; },
    get active() { return active; },
    setPoints(points, cols = colors) {
      pts = flatPoints(points, who);
      colors = cols;
      box = pointsBounds(pts, radius * 1.3);
      const count = n();
      if (!fill || fill.instanceMatrix.count < count) {
        for (const m of [fill, edge]) if (m) { group.remove(m); m.dispose(); }
        const cap = Math.max(16, count);
        fill = new THREE.InstancedMesh(geo, fillMat, cap);
        edge = new THREE.InstancedMesh(geo, edgeMat, cap);
        for (const m of [fill, edge]) { m.frustumCulled = false; m.userData.noInk = true; m.userData.sharedMaterial = true; }
        fill.name = 'markers'; edge.name = 'marker-outlines';
        edge.renderOrder = -1;
        group.add(edge, fill);
      }
      fill.count = edge.count = count;
      if (active >= count) active = -1;
      for (let i = 0; i < count; i++) {
        place(i);
        const c = typeof cols === 'string' ? cols : Array.isArray(cols) ? cols[i] : null;
        fill.setColorAt(i, _col.set(isPlainColor(c) ? c : MARKER_COLOR));
      }
      if (!count) fill.setColorAt(0, _col.set(MARKER_COLOR));
      fill.instanceMatrix.needsUpdate = edge.instanceMatrix.needsUpdate = true;
      if (fill.instanceColor) fill.instanceColor.needsUpdate = true;
      viewer?.requestRender?.();
    },
    setActive(i = -1) {
      const next = Number.isInteger(i) && i >= 0 && i < n() ? i : -1;
      if (next === active) return;
      const prev = active;
      active = next;
      if (prev >= 0) place(prev);
      if (next >= 0) place(next);
      fill.instanceMatrix.needsUpdate = edge.instanceMatrix.needsUpdate = true;
      viewer?.requestRender?.();
    },
    pick(ray) {
      const hit = pickSpheres(ray, pts, Math.max(radius, 0.25));
      return hit ? { t: hit.t, index: hit.index, item: [pts[3 * hit.index], pts[3 * hit.index + 1], pts[3 * hit.index + 2]] } : null;
    },
    bounds() { return box; },
    onTheme({ dark }) { edgeMat.color.set(dark ? MARKER_EDGE.dark : MARKER_EDGE.light); },
    attach(v) { viewer = v; },
    dispose() {
      for (const m of [fill, edge]) m?.dispose();
      geo.dispose(); fillMat.dispose(); edgeMat.dispose();
      group.parent?.remove(group);
    },
  };
  layer.setPoints(points, colors);
  return layer;
}

const PLANE_COLOR = '#3b82f6';

/**
 * Translucent planar polygons with outlines (tier 'scene'): (hkl) planes, slab thickness frames (M2).
 * polygons: [{points: [[x, y, z], …] (≥ 3, in one plane), color, opacity = 0.22, outline = true, dashed = false}];
 * width: outline width in px. set({polygons, width}) replaces them.
 */
export function planeLayer({ id, polygons = [], width = 1.6, export: exp = 'never', ...more } = {}) {
  const who = `planeLayer “${id}”`;
  const group = new THREE.Group();
  group.name = `planes ${id}`;
  let viewer = null, polys = [], lw = width, box = null;
  const check = (list) => {
    if (!Array.isArray(list)) throw new TypeError(`${who}: polygons must be a list of {points, color, opacity, outline, dashed}.`);
    return list.map((p, k) => {
      if (!Array.isArray(p?.points) || p.points.length < 3) throw new TypeError(`${who}: polygon ${k} needs at least 3 points [x, y, z].`);
      const pts = p.points.map((q, i) => { const v = vec(q); if (!v.every(Number.isFinite)) throw new TypeError(`${who}: polygon ${k}, point ${i} is not [x, y, z] in Å.`); return v; });
      const color = p.color ?? PLANE_COLOR;
      if (!isPlainColor(color)) throw new TypeError(`${who}: polygon ${k} has no valid colour.`);
      const opacity = p.opacity ?? 0.22;
      if (!(opacity >= 0 && opacity <= 1)) throw new RangeError(`${who}: polygon ${k}: opacity must be between 0 and 1.`);
      return { points: pts, color, opacity, outline: p.outline !== false, dashed: !!p.dashed };
    });
  };
  const build = () => {
    for (const c of [...group.children]) disposeObject(c);
    box = pointsBounds(polys.flatMap((p) => p.points.flat()));
    for (const p of polys) {
      const { positions, index } = triangulatePolygon(p.points);
      if (index.length && p.opacity > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        g.setIndex(index);
        g.computeBoundingSphere();
        const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: p.opacity, side: THREE.DoubleSide, depthWrite: false }));
        fill.name = 'plane';
        group.add(fill);
      }
      if (p.outline) {
        const seg = [];
        p.points.forEach((q, i) => seg.push(...q, ...p.points[(i + 1) % p.points.length]));
        const lg = new LineSegmentsGeometry();
        lg.setPositions(new Float32Array(seg));
        const line = new LineSegments2(lg, lineMaterial({ color: p.color, width: lw, dashed: p.dashed, opacity: 0.95 }, viewer));
        if (p.dashed) line.computeLineDistances();
        line.name = 'plane-outline';
        group.add(line);
      }
    }
    prepareObject(group, viewer?.resolution ?? null);
  };
  const layer = {
    id, tier: 'scene', object: group, export: exp, ...passThrough(more),
    get polygons() { return polys; },
    set(patch = {}) {
      for (const k of Object.keys(patch)) if (k !== 'polygons' && k !== 'width') throw new TypeError(`${who}: unknown field “${k}”.`);
      if (patch.width !== undefined) { if (!(patch.width > 0)) throw new RangeError(`${who}: width must be above 0.`); lw = patch.width; }
      if (patch.polygons !== undefined) polys = check(patch.polygons);
      build();
      viewer?.requestRender?.();
    },
    bounds() { return box; },
    attach(v) { viewer = v; build(); },
  };
  polys = check(polygons);
  build();
  return layer;
}

const OUTLINE_COLOR = '#d97706';

/**
 * The 12 edges of a cell (tier 'scene'), as the unit cell is drawn: M1's supercell and redefine-lattice previews.
 * cell: three lattice vectors (rows, Å); origin: corner [x, y, z]; dashed by default. set({cell, origin, color, dashed, width}).
 */
export function cellOutlineLayer({ id, cell, origin = [0, 0, 0], color = OUTLINE_COLOR, dashed = true, width = 1.6, export: exp = 'never', ...more } = {}) {
  const who = `cellOutlineLayer “${id}”`;
  const group = new THREE.Group();
  group.name = `cell outline ${id}`;
  let viewer = null, box = null;
  const o = { cell: null, origin: null, color, dashed: !!dashed, width };
  const checkCell = (c) => {
    if (!Array.isArray(c) || c.length !== 3 || !c.every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) throw new TypeError(`${who}: cell must be three vectors [[ax, ay, az], [bx, by, bz], [cx, cy, cz]].`);
    return c.map((v) => v.slice());
  };
  const build = () => {
    for (const c of [...group.children]) disposeObject(c);
    const edges = cellEdges(o.cell, o.origin);
    box = pointsBounds(edges);
    const g = new LineSegmentsGeometry();
    g.setPositions(edges);
    const line = new LineSegments2(g, lineMaterial({ color: o.color, width: o.width, dashed: o.dashed, opacity: 0.95, dash: 0.4, gap: 0.28 }, viewer));
    if (o.dashed) line.computeLineDistances();
    line.name = 'cell-outline';
    group.add(line);
    prepareObject(group, viewer?.resolution ?? null);
  };
  const apply = (patch) => {
    if (patch.cell !== undefined) o.cell = checkCell(patch.cell);
    if (patch.origin !== undefined) { const v = vec(patch.origin); if (!v.every(Number.isFinite)) throw new TypeError(`${who}: origin must be [x, y, z] in Å.`); o.origin = v; }
    if (patch.color !== undefined) { if (!isPlainColor(patch.color)) throw new TypeError(`${who}: color must be a CSS colour.`); o.color = patch.color; }
    if (patch.dashed !== undefined) o.dashed = !!patch.dashed;
    if (patch.width !== undefined) { if (!(patch.width > 0)) throw new RangeError(`${who}: width must be above 0.`); o.width = patch.width; }
  };
  apply({ cell, origin, color, width });
  const layer = {
    id, tier: 'scene', object: group, export: exp, ...passThrough(more),
    get cell() { return o.cell; },
    get origin() { return o.origin; },
    set(patch = {}) {
      for (const k of Object.keys(patch)) if (!['cell', 'origin', 'color', 'dashed', 'width'].includes(k)) throw new TypeError(`${who}: unknown field “${k}”.`);
      apply(patch);
      build();
      viewer?.requestRender?.();
    },
    bounds() { return box; },
    attach(v) { viewer = v; build(); },
  };
  build();
  return layer;
}

/**
 * A see-through copy of a structure drawn like the current representation (tier 'scene', never exported or
 * picked): the P-ghost preview and M5's hover ghost. It is wrapped with the cuts of the drawn structure, so a
 * ghost adsorbate lands where the slab is drawn. set({structure, opacity}); structure null shows nothing.
 * Rebuilt whenever the drawn model changes (style, display settings).
 */
export function ghostLayer({ id, structure = null, opacity = 0.45, ...more } = {}) {
  const who = `ghostLayer “${id}”`;
  const group = new THREE.Group();
  group.name = `ghost ${id}`;
  let viewer = null, s = structure, op = opacity;
  const userOnModel = more.onModel;
  const checkOpacity = (v) => { if (!(v > 0 && v <= 1)) throw new RangeError(`${who}: opacity must be above 0 and at most 1.`); return v; };
  checkOpacity(op);
  const rebuild = () => {
    for (const c of [...group.children]) disposeObject(c);
    if (!viewer || !s) return;
    let obj = null;
    try { obj = viewer.buildGhost?.(s, { opacity: op }) ?? null; } catch (e) { console.error(`[crystallume] ${who} failed to draw`, e); }
    if (obj) group.add(prepareObject(obj, viewer.resolution ?? null));
    viewer.requestRender?.();
  };
  return {
    id, tier: 'scene', object: group, ...passThrough(more), export: 'never', pickable: false,
    get structure() { return s; },
    set(patch = {}) {
      for (const k of Object.keys(patch)) if (k !== 'structure' && k !== 'opacity') throw new TypeError(`${who}: unknown field “${k}”.`);
      if (patch.opacity !== undefined) op = checkOpacity(patch.opacity);
      if (patch.structure !== undefined) s = patch.structure;
      rebuild();
    },
    onModel(model, v) { rebuild(); userOnModel?.(model, v); },
    attach(v) { viewer = v; rebuild(); },
    dispose() { for (const c of [...group.children]) disposeObject(c); group.parent?.remove(group); },
  };
}

/**
 * Place and draw text items on the overlay canvas: each at its projected position, nudged above, below, right
 * or left when the occupancy grid (cell letters, atom labels and earlier items) is taken there, and drawn where
 * it belongs anyway when nothing is free. Items behind the camera are skipped. Returns the boxes drawn.
 */
export function drawTextItems(g, ctx, items) {
  const placed = [];
  const fg = ctx.dark ? '#f1f3f5' : '#14171b';
  for (const it of items) {
    const [x, y, z] = ctx.project(it.position[0], it.position[1], it.position[2]);
    if (!(z >= -1 && z <= 1) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const size = it.size ?? 12, weight = it.weight ?? 600;
    g.font = `${weight} ${size * ctx.scale}px ${ctx.font}`;
    const tw = g.measureText(it.text).width + 4 * ctx.scale, th = (size + 2) * ctx.scale;
    const spots = [[0, 0], [0, -th], [0, th], [tw * 0.6 + 2 * ctx.scale, 0], [-(tw * 0.6 + 2 * ctx.scale), 0]];
    let at = null;
    for (const [dx, dy] of spots) {
      const box = [x + dx - tw / 2, y + dy - th / 2, x + dx + tw / 2, y + dy + th / 2];
      if (!ctx.occupancy || ctx.occupancy.free(...box)) { at = [x + dx, y + dy, box]; break; }
    }
    if (!at) at = [x, y, [x - tw / 2, y - th / 2, x + tw / 2, y + th / 2]];
    ctx.occupancy?.mark(...at[2]);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    ctx.text(it.text, at[0], at[1], size, it.color ?? fg, weight);
    placed.push({ text: it.text, x: at[0], y: at[1], box: at[2] });
  }
  return placed;
}

/**
 * Text at 3D points on the overlay canvas (tier 'canvas'), clear of atom labels: M4's axis letters, direction
 * labels. items: [{position: [x, y, z], text, color, size = 12, weight = 600}]; export 'never' by default.
 * set({items}) replaces them.
 */
export function textLayer({ id, items = [], export: exp = 'never', ...more } = {}) {
  const who = `textLayer “${id}”`;
  let viewer = null;
  const check = (list) => {
    if (!Array.isArray(list)) throw new TypeError(`${who}: items must be a list of {position, text, color, size}.`);
    return list.map((it, k) => {
      const p = vec(it?.position ?? []);
      if (!p.every(Number.isFinite)) throw new TypeError(`${who}: item ${k} needs a position [x, y, z] in Å.`);
      if (it.color != null && !isPlainColor(it.color)) throw new TypeError(`${who}: item ${k} has no valid colour.`);
      if (it.size != null && !(it.size > 0)) throw new RangeError(`${who}: item ${k}: size must be above 0.`);
      return { position: p, text: String(it.text ?? ''), color: it.color ?? null, size: it.size ?? 12, weight: it.weight ?? 600 };
    }).filter((it) => it.text);
  };
  let list = check(items);
  return {
    id, tier: 'canvas', export: exp, ...passThrough(more),
    get items() { return list; },
    draw(g, ctx) { drawTextItems(g, ctx, list); },
    set(patch = {}) {
      for (const k of Object.keys(patch)) if (k !== 'items') throw new TypeError(`${who}: unknown field “${k}”.`);
      if (patch.items !== undefined) list = check(patch.items);
      viewer?.requestRender?.();
    },
    attach(v) { viewer = v; },
  };
}
