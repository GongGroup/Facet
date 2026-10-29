/**
 * Representations ("drawing styles"). A style turns a display model into Three.js objects.
 *   styles.register({ id, name, description, icon, defaults, bonds: bool, inPlaceRadii?: bool, build(ctx) => THREE.Object3D })
 * ctx = { model, colors (Float32Array linear), radii (Float32Array), settings (style settings),
 *         atomMaterial, bondMaterial, segments, facets, showBonds, resolution, THREE,
 *         helpers: { buildAtoms, buildBonds, buildLines, buildPolyhedra, atomRadius, segmentsFor } }
 * `facets` ({ detail, radial } or null) comes from a low-poly material: buildAtoms then draws icospheres of
 * that detail and buildBonds prisms with `radial` sides.
 * `inPlaceRadii: true` promises that only meshes built by helpers.buildAtoms / buildBonds depend on the
 * radii, so the viewer may rewrite their instance matrices instead of rebuilding when atom sizes change.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { ConvexGeometry } from '../../vendor/three/addons/geometries/ConvexGeometry.js';
import { LineSegments2 } from '../../vendor/three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from '../../vendor/three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from '../../vendor/three/addons/lines/LineMaterial.js';
import { mergeGeometries } from '../../vendor/three/addons/utils/BufferGeometryUtils.js';
import { element, ANIONS, METALS } from '../core/elements.js';

const registry = new Map();
export const styles = {
  register(s) { registry.set(s.id, s); return () => registry.delete(s.id); },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
};

/**
 * Drawn radius of an element. `settings.radiusOverrides[symbol]` (Å) replaces the table value and is
 * scaled by atomScale exactly like it.
 */
export function atomRadius(sym, settings) {
  const scale = settings.atomScale ?? 1;
  const o = settings.radiusOverrides?.[sym];
  const uniform = settings.radiusSource === 'uniform';
  if (typeof o === 'number' && Number.isFinite(o) && o > 0) return o * (uniform ? Math.max(1, scale) : scale);
  const e = element(sym);
  switch (settings.radiusSource) {
    case 'vdw': return e.rvdw * scale;
    case 'covalent': return e.rcov * scale;
    case 'uniform': return (settings.bondRadius ?? 0.2) * Math.max(1, scale);
    default: return e.ratom * scale;
  }
}

export function segmentsFor(n, quality = 'auto') {
  const q = quality === 'auto' ? (n <= 600 ? 'high' : n <= 6000 ? 'medium' : n <= 40000 ? 'low' : 'draft') : quality;
  return { high: [48, 32, 24], medium: [32, 22, 16], low: [18, 12, 10], draft: [10, 7, 6] }[q] ?? [32, 22, 16];
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _c = new THREE.Color();

/** (Re)write the instance matrices of an atoms mesh from positions and radii. */
export function writeAtomMatrices(mesh, model, radii) {
  const p = model.positions;
  for (let i = 0; i < model.n; i++) {
    const r = radii[i];
    _m.makeScale(r, r, r).setPosition(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
    mesh.setMatrixAt(i, _m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.boundingSphere = null;
}

export function buildAtoms({ model, colors, radii, atomMaterial, segments, facets }) {
  const geo = facets ? new THREE.IcosahedronGeometry(1, facets.detail ?? 1) : new THREE.SphereGeometry(1, segments[0], segments[1]);
  const mesh = new THREE.InstancedMesh(geo, atomMaterial, Math.max(1, model.n));
  mesh.count = model.n;
  writeAtomMatrices(mesh, model, radii);
  for (let i = 0; i < model.n; i++) mesh.setColorAt(i, _c.setRGB(colors[3 * i], colors[3 * i + 1], colors[3 * i + 2]));
  if (!model.n) mesh.count = 0;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'atoms';
  mesh.userData.role = 'atoms';
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * (Re)write bond cylinder matrices (and colours unless `colors` is null). Split bonds put the colour
 * boundary where the two spheres would meet, so both halves stay visible.
 */
export function writeBondMatrices(mesh, { model, colors, radii, settings }, bondRadius) {
  const b = model.bonds;
  const split = settings.bondColor !== 'uniform';
  const uni = new THREE.Color(settings.bondUniformColor ?? '#9aa1ab').convertSRGBToLinear();
  const p = model.positions;
  let k = 0;
  const place = (ax, ay, az, bx, by, bz, color) => {
    _d.set(bx - ax, by - ay, bz - az);
    const len = _d.length();
    if (len < 1e-6) _m.makeScale(0, 0, 0);
    else {
      _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
      _p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      _s.set(bondRadius, len, bondRadius);
      _m.compose(_p, _q, _s);
    }
    mesh.setMatrixAt(k, _m);
    if (colors) mesh.setColorAt(k, color);
    k++;
  };
  for (let t = 0; t < b.count; t++) {
    const i = b.pairs[2 * t], j = b.pairs[2 * t + 1];
    const ax = p[3 * i], ay = p[3 * i + 1], az = p[3 * i + 2], bx = p[3 * j], by = p[3 * j + 1], bz = p[3 * j + 2];
    if (split) {
      // split point weighted by radii so each half is visible beyond its sphere
      const ri = radii?.[i] ?? 0, rj = radii?.[j] ?? 0, len = Math.hypot(bx - ax, by - ay, bz - az) || 1;
      const f = Math.min(0.85, Math.max(0.15, 0.5 + (ri - rj) / (2 * len)));
      const mx = ax + (bx - ax) * f, my = ay + (by - ay) * f, mz = az + (bz - az) * f;
      place(ax, ay, az, mx, my, mz, colors && _c.setRGB(colors[3 * i], colors[3 * i + 1], colors[3 * i + 2]));
      place(mx, my, mz, bx, by, bz, colors && _c.setRGB(colors[3 * j], colors[3 * j + 1], colors[3 * j + 2]));
    } else place(ax, ay, az, bx, by, bz, uni);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (colors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.boundingSphere = null;
}

/** Cylinders split in two halves, each coloured like its atom (or one uniform colour). */
export function buildBonds(ctx, bondRadius) {
  const { model, bondMaterial, settings, segments, facets } = ctx;
  const split = settings.bondColor !== 'uniform';
  const geo = new THREE.CylinderGeometry(1, 1, 1, facets?.radial ?? segments[2], 1, true);
  const count = model.bonds.count * (split ? 2 : 1);
  const mesh = new THREE.InstancedMesh(geo, bondMaterial, Math.max(1, count));
  mesh.count = count;
  writeBondMatrices(mesh, ctx, bondRadius);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'bonds';
  mesh.userData.role = 'bonds';
  mesh.userData.bondRadius = bondRadius;
  if (!count) mesh.visible = false;
  return mesh;
}

export function buildLines({ model, colors, settings }, resolution) {
  const b = model.bonds, p = model.positions;
  const pos = new Float32Array(b.count * 12), col = new Float32Array(b.count * 12);
  for (let t = 0; t < b.count; t++) {
    const i = b.pairs[2 * t], j = b.pairs[2 * t + 1];
    const m = [(p[3 * i] + p[3 * j]) / 2, (p[3 * i + 1] + p[3 * j + 1]) / 2, (p[3 * i + 2] + p[3 * j + 2]) / 2];
    pos.set([p[3 * i], p[3 * i + 1], p[3 * i + 2], ...m, ...m, p[3 * j], p[3 * j + 1], p[3 * j + 2]], 12 * t);
    const ci = [colors[3 * i], colors[3 * i + 1], colors[3 * i + 2]], cj = [colors[3 * j], colors[3 * j + 1], colors[3 * j + 2]];
    col.set([...ci, ...ci, ...cj, ...cj], 12 * t);
  }
  const g = new LineSegmentsGeometry();
  g.setPositions(pos);
  g.setColors(col);
  const mat = new LineMaterial({ vertexColors: true, linewidth: settings.lineWidth ?? 2.5, worldUnits: false });
  mat.resolution.copy(resolution);
  const lines = new LineSegments2(g, mat);
  lines.name = 'lines';
  lines.userData.role = 'lines';
  return lines;
}

/** Pick polyhedron centres automatically: cations with 4–8 anion neighbours on average. */
export function autoPolyhedraCenters(model) {
  const b = model.bonds;
  const cnAnion = new Map(), count = new Map();
  const cn = new Int32Array(model.n);
  for (let t = 0; t < b.count; t++) {
    const i = b.pairs[2 * t], j = b.pairs[2 * t + 1];
    if (ANIONS.has(model.symbols[j]) && !ANIONS.has(model.symbols[i])) cn[i]++;
    if (ANIONS.has(model.symbols[i]) && !ANIONS.has(model.symbols[j])) cn[j]++;
  }
  for (let i = 0; i < model.n; i++) {
    const s = model.symbols[i];
    if (ANIONS.has(s) && !METALS.has(s)) continue;
    cnAnion.set(s, (cnAnion.get(s) ?? 0) + cn[i]);
    count.set(s, (count.get(s) ?? 0) + 1);
  }
  const out = [];
  for (const [s, c] of count) { const avg = cnAnion.get(s) / c; if (avg >= 3.5 && avg <= 8.5) out.push(s); }
  return out;
}

function isFlat(pts) {
  const [a, b] = pts;
  let c = null, n = null;
  for (let k = 2; k < pts.length && !n; k++) { const t = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(pts[k], a)); if (t.lengthSq() > 1e-4) { n = t.normalize(); c = pts[k]; } }
  if (!n) return true;
  return pts.every((q) => Math.abs(new THREE.Vector3().subVectors(q, a).dot(n)) < 0.15);
}

/**
 * Polyhedron faces follow the atoms' shading: flat looks get flat faces, cel looks cel faces, presets with
 * their own face material (drawn looks) that one, the rest a light gloss.
 */
function polyhedraMaterial(atomMaterial, opacity) {
  const common = {
    vertexColors: true, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity >= 0.95,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  };
  if (atomMaterial?.userData?.faces) return atomMaterial.userData.faces(common);
  if (atomMaterial?.isMeshBasicMaterial) return new THREE.MeshBasicMaterial(common);
  if (atomMaterial?.isMeshToonMaterial) return new THREE.MeshToonMaterial({ ...common, gradientMap: atomMaterial.gradientMap });
  return new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.35, metalness: 0, clearcoat: 0.4 });
}

export function buildPolyhedra({ model, colors, settings, atomMaterial }) {
  const pset = settings.polyhedra ?? {};
  const centers = new Set(pset.centers === 'auto' || !pset.centers ? autoPolyhedraCenters(model) : pset.centers);
  const nbrs = Array.from({ length: model.n }, () => []);
  const b = model.bonds;
  for (let t = 0; t < b.count; t++) { const i = b.pairs[2 * t], j = b.pairs[2 * t + 1]; nbrs[i].push(j); nbrs[j].push(i); }
  const geos = [];
  const p = model.positions;
  const group = new THREE.Group();
  group.name = 'polyhedra';
  for (let i = 0; i < model.n; i++) {
    if (!centers.has(model.symbols[i]) || nbrs[i].length < 4) continue;
    const pts = nbrs[i].map((j) => new THREE.Vector3(p[3 * j], p[3 * j + 1], p[3 * j + 2]));
    if (isFlat(pts)) continue;
    let g;
    try { g = new ConvexGeometry(pts); } catch { continue; }
    if (!g.attributes.position || g.attributes.position.count < 3) continue;
    g.deleteAttribute('uv');
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let k = 0; k < c.length; k += 3) { c[k] = colors[3 * i]; c[k + 1] = colors[3 * i + 1]; c[k + 2] = colors[3 * i + 2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geos.push(g);
  }
  if (!geos.length) return group;
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const opacity = pset.opacity ?? 0.55;
  const mesh = new THREE.Mesh(merged, polyhedraMaterial(atomMaterial, opacity));
  mesh.name = 'polyhedra-faces';
  mesh.userData.role = 'polyhedra';
  mesh.receiveShadow = true;
  mesh.castShadow = opacity > 0.7;
  group.add(mesh);
  if (pset.edges !== false) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 20), new THREE.LineBasicMaterial({ color: pset.edgeColor ?? '#22262c', transparent: true, opacity: 0.55 }));
    edges.name = 'polyhedra-edges';
    group.add(edges);
  }
  return group;
}

const ICON = (body) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6">${body}</svg>`;

styles.register({
  id: 'ballstick', inPlaceRadii: true, name: 'Ball & stick', description: 'Atoms as spheres joined by cylinders', bonds: true,
  icon: ICON('<line x1="9" y1="21" x2="22" y2="10" stroke-width="3"/><circle cx="9" cy="21" r="5.5" fill="currentColor" fill-opacity=".25"/><circle cx="22.5" cy="9.5" r="4.5" fill="currentColor" fill-opacity=".25"/>'),
  defaults: { radiusSource: 'atomic', atomScale: 0.42, bondRadius: 0.13 },
  build(ctx) {
    const g = new THREE.Group();
    g.add(buildAtoms(ctx));
    if (ctx.showBonds) g.add(buildBonds(ctx, ctx.settings.bondRadius ?? 0.13));
    return g;
  },
});
styles.register({
  id: 'spacefill', inPlaceRadii: true, name: 'Space-filling', description: 'Van der Waals spheres (CPK model)', bonds: false,
  icon: ICON('<circle cx="12" cy="17" r="8" fill="currentColor" fill-opacity=".25"/><circle cx="21" cy="13" r="7" fill="currentColor" fill-opacity=".25"/>'),
  defaults: { radiusSource: 'vdw', atomScale: 1 },
  build: (ctx) => { const g = new THREE.Group(); g.add(buildAtoms(ctx)); return g; },
});
styles.register({
  id: 'spheres', inPlaceRadii: true, name: 'Atomic spheres', description: 'Touching atomic-radius spheres — ideal for metals and close packing', bonds: false,
  icon: ICON('<circle cx="10" cy="12" r="5.5" fill="currentColor" fill-opacity=".25"/><circle cx="21" cy="12" r="5.5" fill="currentColor" fill-opacity=".25"/><circle cx="15.5" cy="21.5" r="5.5" fill="currentColor" fill-opacity=".25"/>'),
  defaults: { radiusSource: 'atomic', atomScale: 1 },
  build: (ctx) => { const g = new THREE.Group(); g.add(buildAtoms(ctx)); return g; },
});
styles.register({
  id: 'licorice', inPlaceRadii: true, name: 'Licorice', description: 'Uniform rounded sticks', bonds: true,
  icon: ICON('<path d="M7 23 L16 12 L25 18" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".5"/>'),
  defaults: { radiusSource: 'uniform', atomScale: 1, bondRadius: 0.2 },
  build(ctx) {
    const r = ctx.settings.bondRadius ?? 0.2;
    const g = new THREE.Group();
    g.add(buildAtoms(ctx));
    if (ctx.showBonds) g.add(buildBonds(ctx, r));
    return g;
  },
});
styles.register({
  id: 'wireframe', inPlaceRadii: true, name: 'Wireframe', description: 'Bonds as lines; fast for very large systems', bonds: true, lines: true,
  icon: ICON('<path d="M6 22 L13 10 L20 18 L27 8"/><circle cx="6" cy="22" r="1.4" fill="currentColor"/><circle cx="13" cy="10" r="1.4" fill="currentColor"/><circle cx="20" cy="18" r="1.4" fill="currentColor"/><circle cx="27" cy="8" r="1.4" fill="currentColor"/>'),
  defaults: { radiusSource: 'covalent', atomScale: 0.12, lineWidth: 2.5 },
  build(ctx) {
    const g = new THREE.Group();
    const atoms = buildAtoms(ctx);
    g.add(atoms);
    if (ctx.showBonds && ctx.model.bonds.count) g.add(buildLines(ctx, ctx.resolution));
    return g;
  },
});
styles.register({
  id: 'polyhedra', inPlaceRadii: true, name: 'Polyhedral', description: 'Coordination polyhedra around cations, VESTA style', bonds: true, wantsImages: true,
  icon: ICON('<path d="M16 4 L27 12 L23 26 L9 26 L5 12 Z" fill="currentColor" fill-opacity=".22"/><path d="M16 4 L16 17 L27 12 M16 17 L9 26 M16 17 L23 26 M16 17 L5 12" stroke-opacity=".55"/>'),
  defaults: { radiusSource: 'atomic', atomScale: 0.3, bondRadius: 0.09 },
  build(ctx) {
    const g = new THREE.Group();
    g.add(buildAtoms(ctx));
    if (ctx.showBonds) g.add(buildBonds(ctx, ctx.settings.bondRadius ?? 0.09));
    g.add(buildPolyhedra(ctx));
    return g;
  },
});
