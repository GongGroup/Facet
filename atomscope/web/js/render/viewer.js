/**
 * Viewer — owns the WebGL renderer, cameras, controls, light rig, post-processing and the drawn
 * representation of one Structure. Driven entirely by a `scene` settings object (see settings.js).
 *
 * Events: 'hover' {index, x, y} | 'atomclick' {index, shiftKey, x, y} | 'frame' i | 'render' | 'measure' list
 *         'camera' | 'model' model | 'error' err
 */
import * as THREE from '../../vendor/three/three.module.js';
import { OrbitControls } from '../../vendor/three/addons/controls/OrbitControls.js';
import { TrackballControls } from '../../vendor/three/addons/controls/TrackballControls.js';
import { LineSegments2 } from '../../vendor/three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from '../../vendor/three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from '../../vendor/three/addons/lines/LineMaterial.js';
import { GLTFExporter } from '../../vendor/three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from '../../vendor/three/addons/utils/BufferGeometryUtils.js';
import { Emitter } from '../core/events.js';
import { element } from '../core/elements.js';
import { buildDisplayModel, modelBounds, keyOf } from './display.js';
import { styles, atomRadius, segmentsFor, autoPolyhedraCenters } from './styles.js';
import { computeColors } from './colors.js';
import { createMaterial, materials } from './materials.js';
import { LightRig } from './lighting.js';
import { PostPipeline } from './post.js';
import { makeBackground } from './background.js';
import { AxisGizmo } from './gizmo.js';
import { makeScene } from './settings.js';

const sig = (o) => JSON.stringify(o ?? null);

export class Viewer extends Emitter {
  constructor(container) {
    super();
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'viewer-canvas';
    this.renderer.domElement.setAttribute('aria-label', '3D structure view');
    container.appendChild(this.renderer.domElement);
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'viewer-overlay';
    container.appendChild(this.overlay);

    this.scene3 = new THREE.Scene();
    this.root = new THREE.Group();
    this.scene3.add(this.root);
    this.persp = new THREE.PerspectiveCamera(30, 1, 0.05, 2000);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.05, 2000);
    this.camera = this.persp;
    this.camera.position.set(0, 0, 30);
    this.lights = new LightRig(this.renderer, this.scene3);
    this.post = new PostPipeline(this.renderer, this.scene3, this.camera);
    this.gizmo = new AxisGizmo();
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.floor.visible = false;
    this.floor.userData.noInk = true;
    this.scene3.add(this.floor);

    this.structure = null;
    this.settings = makeScene();
    this.model = null;
    this.rep = null;
    this.cellObj = null;
    this.halo = null;
    this.hoverHalo = null;
    this.measureObj = null;
    this.selection = new Set();
    this.hoverIndex = -1;
    this.measurements = [];
    this.bounds = { center: new THREE.Vector3(), radius: 5 };
    this.playing = false;
    this.fps = 12;
    this._sigs = {};
    this._dirty = true;
    this._camAnim = null;
    this.width = 1; this.height = 1;
    this.resolution = new THREE.Vector2(1, 1);
    this.tool = 'rotate';

    this._setupControls('orbit');
    this._setupPointer();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();
    this._last = performance.now();
    this._frameAcc = 0;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.emit('error', new Error('The graphics context was lost. Reload the page to continue.')); });
  }

  // ------------------------------------------------------------------ setup
  _setupControls(kind) {
    const old = this.controls;
    const target = old ? old.target.clone() : new THREE.Vector3();
    old?.dispose();
    if (kind === 'trackball') {
      const c = new TrackballControls(this.camera, this.renderer.domElement);
      c.rotateSpeed = 3; c.zoomSpeed = 1.4; c.panSpeed = 0.6; c.dynamicDampingFactor = 0.15;
      this.controls = c;
    } else {
      const c = new OrbitControls(this.camera, this.renderer.domElement);
      c.enableDamping = true; c.dampingFactor = 0.12; c.rotateSpeed = 0.9; c.zoomSpeed = 1.1; c.screenSpacePanning = true;
      this.controls = c;
    }
    this.controls.target.copy(target);
    this.controlsKind = kind;
    this.controls.addEventListener('change', () => { this._dirty = true; this.emit('camera'); });
    this.controls.addEventListener('start', () => { this._camAnim = null; });
  }

  _setupPointer() {
    const el = this.renderer.domElement;
    let down = null, raf = 0, lastMove = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button }; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      if (moved < 5 && dt < 500 && down.b === 0) this._click(e);
      down = null;
    });
    el.addEventListener('pointermove', (e) => {
      lastMove = e;
      if (e.buttons) { if (this.hoverIndex !== -1) this._setHover(-1, e); return; }
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; const ev = lastMove; const i = this.pickAtom(ev.clientX, ev.clientY); this._setHover(i, ev); });
    });
    el.addEventListener('pointerleave', (e) => this._setHover(-1, e));
    el.addEventListener('dblclick', (e) => {
      const i = this.pickAtom(e.clientX, e.clientY);
      if (i >= 0) this.focusAtom(i); else this.fitView(true);
    });
  }

  _setHover(i, e) {
    if (i === this.hoverIndex && i === -1) return;
    const changed = i !== this.hoverIndex;
    this.hoverIndex = i;
    if (changed) { this._updateHalos(); this._dirty = true; }
    const r = this.container.getBoundingClientRect();
    this.emit('hover', { index: i, x: e.clientX - r.left, y: e.clientY - r.top });
  }

  _click(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const gx = e.clientX - r.left, gy = r.bottom - e.clientY;
    if (this.settings.display.axes && gx < this.gizmo.size + 8 && gy < this.gizmo.size + 8 && gx > 8 && gy > 8) {
      const nx = ((gx - 8) / this.gizmo.size) * 2 - 1, ny = ((gy - 8) / this.gizmo.size) * 2 - 1;
      const hit = this.gizmo.pick(nx, ny);
      if (hit) { this.setViewDirection(hit.dir.toArray(), null, true); return; }
    }
    const i = this.pickAtom(e.clientX, e.clientY);
    this.emit('atomclick', { index: i, shiftKey: e.shiftKey || e.metaKey || e.ctrlKey, x: e.clientX - r.left, y: e.clientY - r.top });
  }

  // ------------------------------------------------------------------ public API
  setStructure(structure, { resetCamera = true } = {}) {
    this.structure = structure;
    this._sigs = {};
    if (resetCamera) { this.measurements = []; this.selection.clear(); }
    this.applySettings(this.settings, { force: true });
    if (resetCamera) this.resetView(false);
    this.emit('model', this.model);
  }

  /** Apply a full scene-settings object; rebuilds only what changed. */
  applySettings(settings, { force = false } = {}) {
    this.settings = settings;
    const st = settings.style, d = settings.display;
    const S = {
      camera: sig([d.projection, d.fov, d.controls]),
      model: sig([d.supercell, d.wrap, d.boundaryAtoms, d.completeBonds, d.bonds, d.hiddenElements, styles.get(st.rep)?.wantsImages ? st.polyhedra?.centers : null, this.structure?.frame]),
      colors: sig([st.colorScheme, st.monoColor, st.colorOverrides, st.property]),
      geom: sig([st.rep, st.radiusSource, st.atomScale, st.bondRadius, st.bondColor, st.bondUniformColor, st.lineWidth, st.quality, st.polyhedra, d.bonds?.show]),
      material: sig([st.material, st.roughness, st.metalness, st.opacity]),
      lights: sig(settings.lighting),
      post: sig(settings.post),
      bg: sig([d.background, settings.post?.fog]),
      cell: sig(d.cell),
    };
    const ch = (k) => force || S[k] !== this._sigs[k];
    if (ch('camera')) this._applyCamera(d);
    if (this.structure) {
      const modelChanged = ch('model');
      if (modelChanged) this._buildModel();
      if (modelChanged || ch('colors')) this._computeColors();
      if (modelChanged || ch('colors') || ch('geom') || ch('material')) this._buildRep();
      if (modelChanged || ch('cell')) this._buildCell();
      if (modelChanged) this._buildMeasurements();
    }
    if (ch('lights')) { this.lights.apply(settings.lighting); this._updateFloor(); }
    if (ch('post') || ch('camera')) this.post.configure(settings.post, ch('camera'));
    if (ch('bg')) this._applyBackground();
    this._sigs = S;
    this._dirty = true;
  }

  requestRender() { this._dirty = true; }

  setFrame(i) {
    if (!this.structure) return;
    this.structure.setFrame(i);
    this.applySettings(this.settings);
    this.emit('frame', this.structure.frame);
  }

  play(on = !this.playing) { this.playing = on && (this.structure?.nFrames ?? 1) > 1; this.emit('play', this.playing); }

  setSelection(srcIndices) { this.selection = new Set(srcIndices); this._updateHalos(); this._dirty = true; this.emit('selection', [...this.selection]); }

  // ------------------------------------------------------------------ building
  _buildModel() {
    const s = this.structure, st = this.settings.style, d = this.settings.display;
    const style = styles.get(st.rep) ?? styles.get('ballstick');
    let model = buildDisplayModel(s, d, {});
    if (style.wantsImages && s.periodic && !d.completeBonds) {
      const centers = st.polyhedra?.centers === 'auto' || !st.polyhedra?.centers ? autoPolyhedraCenters(model) : st.polyhedra.centers;
      if (centers.length) model = buildDisplayModel(s, d, { imageCenters: new Set(centers) });
    }
    this.model = model;
    const cn = new Int32Array(model.n);
    for (let b = 0; b < model.bonds.count; b++) { cn[model.bonds.pairs[2 * b]]++; cn[model.bonds.pairs[2 * b + 1]]++; }
    this.cn = cn;
    const b = modelBounds(model);
    this.bounds = { center: new THREE.Vector3(...b.center), radius: b.radius, min: b.min, max: b.max };
    this.lights.setBounds(this.bounds.center, this.bounds.radius);
    this._updateFloor();
    this.emit('model', model);
  }

  _computeColors() { this.colors = computeColors(this.model, this.structure, this.settings.style, this.cn); }

  _disposeObject(obj) {
    obj?.traverse?.((o) => {
      o.geometry?.dispose?.();
      if (o.material && !o.userData.sharedMaterial) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
    });
    obj?.parent?.remove(obj);
  }

  _buildRep() {
    this._disposeObject(this.rep);
    this._disposeObject(this.halo); this.halo = null;
    this._disposeObject(this.hoverHalo); this.hoverHalo = null;
    this.atomMaterial?.dispose();
    const st = this.settings.style, d = this.settings.display;
    const style = styles.get(st.rep) ?? styles.get('ballstick');
    const m = this.model;
    const radii = new Float32Array(m.n);
    const rcache = new Map();
    for (let i = 0; i < m.n; i++) {
      const s = m.symbols[i];
      if (!rcache.has(s)) rcache.set(s, atomRadius(s, st));
      radii[i] = rcache.get(s);
    }
    this.radii = radii;
    let rmax = 0;
    for (const r of rcache.values()) rmax = Math.max(rmax, r);
    this.maxRadius = rmax;
    const matDef = materials.get(st.material);
    this.atomMaterial = createMaterial(st.material, { roughness: st.roughness ?? undefined, metalness: st.metalness ?? undefined, opacity: st.opacity });
    const ctx = {
      model: m, colors: this.colors, radii, settings: st, atomMaterial: this.atomMaterial, bondMaterial: this.atomMaterial,
      segments: segmentsFor(m.n, st.quality), showBonds: d.bonds?.show !== false && style.bonds, resolution: this.resolution, THREE,
    };
    try {
      this.rep = style.build(ctx);
    } catch (err) {
      console.error(err);
      this.emit('error', new Error(`The "${style.name}" style failed to draw: ${err.message}`));
      this.rep = new THREE.Group();
    }
    this.rep.traverse((o) => { if (o.material === this.atomMaterial) o.userData.sharedMaterial = true; if (matDef?.transparent) { o.castShadow = false; } });
    this.root.add(this.rep);
    this._updateHalos();
    this._dirty = true;
  }

  _haloMesh(indices, opacity, color, grow) {
    const geo = new THREE.SphereGeometry(1, 24, 16);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, indices.length));
    mesh.count = indices.length;
    const mtx = new THREE.Matrix4(), p = this.model.positions;
    indices.forEach((i, k) => {
      const r = Math.max(this.radii[i], 0.18) * grow + 0.1;
      mtx.makeScale(r, r, r).setPosition(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
      mesh.setMatrixAt(k, mtx);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.noInk = true;
    mesh.renderOrder = 10;
    mesh.computeBoundingSphere();
    return mesh;
  }

  _updateHalos() {
    if (!this.model) return;
    this._disposeObject(this.halo); this.halo = null;
    this._disposeObject(this.hoverHalo); this.hoverHalo = null;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8a33d';
    if (this.selection.size) {
      const idx = [];
      for (let i = 0; i < this.model.n; i++) if (this.selection.has(this.model.src[i])) idx.push(i);
      if (idx.length) { this.halo = this._haloMesh(idx, 0.42, accent, 1.12); this.root.add(this.halo); }
    }
    if (this.hoverIndex >= 0 && this.hoverIndex < this.model.n) {
      this.hoverHalo = this._haloMesh([this.hoverIndex], 0.25, accent, 1.18);
      this.root.add(this.hoverHalo);
    }
  }

  _buildCell() {
    this._disposeObject(this.cellObj); this.cellObj = null;
    const c = this.settings.display.cell, m = this.model;
    if (!c?.show || !m?.cell) return;
    const [A, B, C] = m.cell, N = m.supercell;
    const corner = (a, b, cc) => [a * A[0] + b * B[0] + cc * C[0], a * A[1] + b * B[1] + cc * C[1], a * A[2] + b * B[2] + cc * C[2]];
    const seg = [];
    const box = (o, s) => {
      const P = (a, b, cc) => corner(o[0] + a * s[0], o[1] + b * s[1], o[2] + cc * s[2]);
      const E = [[[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [0, 1, 0]], [[0, 0, 0], [0, 0, 1]], [[1, 0, 0], [1, 1, 0]], [[1, 0, 0], [1, 0, 1]], [[0, 1, 0], [1, 1, 0]],
        [[0, 1, 0], [0, 1, 1]], [[0, 0, 1], [1, 0, 1]], [[0, 0, 1], [0, 1, 1]], [[1, 1, 0], [1, 1, 1]], [[1, 0, 1], [1, 1, 1]], [[0, 1, 1], [1, 1, 1]]];
      for (const [u, v] of E) seg.push(...P(...u), ...P(...v));
    };
    if (c.which === 'grid') { for (let a = 0; a < N[0]; a++) for (let b = 0; b < N[1]; b++) for (let cc = 0; cc < N[2]; cc++) box([a, b, cc], [1, 1, 1]); }
    else if (c.which === 'supercell') box([0, 0, 0], N);
    else box([0, 0, 0], [1, 1, 1]);
    const g = new LineSegmentsGeometry();
    g.setPositions(new Float32Array(seg));
    const mat = new LineMaterial({ color: new THREE.Color(c.color ?? '#3b4048'), linewidth: c.width ?? 1.6, worldUnits: false, transparent: true, opacity: 0.9 });
    mat.resolution.copy(this.resolution);
    this.cellObj = new LineSegments2(g, mat);
    this.cellObj.name = 'cell';
    this.root.add(this.cellObj);
  }

  _applyBackground() {
    const bg = makeBackground(this.settings.display.background);
    this.scene3.background = bg.background;
    this.renderer.setClearColor(bg.fogColor, bg.alpha);
    this._fogColor = bg.fogColor;
    const fog = this.settings.post?.fog;
    this.scene3.fog = fog?.enabled ? new THREE.Fog(bg.fogColor, 1, 100) : null;
    this.overlayDark = luminance(bg.fogColor) < 0.4;
  }

  _updateFloor() {
    const sh = this.settings.lighting?.shadows;
    this.floor.visible = !!(sh?.enabled && sh?.floor && this.model);
    if (!this.model) return;
    const r = this.bounds.radius;
    this.floor.scale.set(r * 12, r * 12, 1);
    this.floor.position.set(this.bounds.center.x, (this.bounds.min?.[1] ?? -r) - 0.8, this.bounds.center.z);
  }

  _applyCamera(d) {
    const want = d.projection === 'orthographic' ? this.ortho : this.persp;
    this.persp.fov = d.fov ?? 30;
    if (want !== this.camera) {
      want.position.copy(this.camera.position);
      want.quaternion.copy(this.camera.quaternion);
      want.up.copy(this.camera.up);
      if (want.isOrthographicCamera) {
        const dist = this.camera.position.distanceTo(this.controls.target);
        const h = dist * Math.tan((this.persp.fov * Math.PI) / 360);
        want.zoom = 1;
        this._orthoHalf = h;
      } else if (this.camera.isOrthographicCamera) {
        const h = this._orthoHalf / this.camera.zoom;
        const dist = h / Math.tan((this.persp.fov * Math.PI) / 360);
        const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
        want.position.copy(this.controls.target).addScaledVector(dir, dist);
      }
      this.camera = want;
      this.post.camera = want;
      this._setupControls(d.controls ?? 'orbit');
    } else if ((d.controls ?? 'orbit') !== this.controlsKind) {
      this._setupControls(d.controls ?? 'orbit');
    }
    this.resize();
  }

  _buildMeasurements() {
    this._disposeObject(this.measureObj); this.measureObj = null;
    if (!this.model) return;
    const m = this.model;
    const pts = [];
    for (const ms of this.measurements) {
      ms.idx = ms.keys.map((k) => m.keys.get(k) ?? -1);
      ms.valid = ms.idx.every((i) => i >= 0);
      if (!ms.valid) continue;
      const P = ms.idx.map((i) => new THREE.Vector3(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]));
      ms.value = measureValue(ms.type, P);
      for (let k = 0; k + 1 < P.length; k++) pts.push(P[k], P[k + 1]);
    }
    if (pts.length) {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineDashedMaterial({ color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8a33d', dashSize: 0.18, gapSize: 0.12, depthTest: false, transparent: true, toneMapped: false });
      this.measureObj = new THREE.LineSegments(g, mat);
      this.measureObj.computeLineDistances();
      this.measureObj.renderOrder = 20;
      this.root.add(this.measureObj);
    }
    this.emit('measure', this.measurements);
    this._dirty = true;
  }

  addMeasurement(type, displayIndices) {
    const keys = displayIndices.map((i) => keyOf(this.model, i));
    this.measurements.push({ id: Math.random().toString(36).slice(2, 8), type, keys });
    this._buildMeasurements();
  }

  removeMeasurement(id) { this.measurements = this.measurements.filter((m) => m.id !== id); this._buildMeasurements(); }
  clearMeasurements() { this.measurements = []; this._buildMeasurements(); }

  // ------------------------------------------------------------------ camera
  defaultView() {
    const s = this.structure;
    if (s?.periodic) {
      const [A, , C] = s.cell.map((v) => new THREE.Vector3(...v).normalize());
      const twoD = s.pbc[2] === false;
      const up = C.clone();
      const w0 = A.clone().addScaledVector(up, -A.dot(up)).normalize();
      const v = new THREE.Vector3().crossVectors(up, w0);
      if (twoD) return { dir: up.clone().multiplyScalar(1).addScaledVector(v, -0.75).addScaledVector(w0, 0.25).normalize(), up: v.clone() };
      return { dir: w0.clone().multiplyScalar(0.42).addScaledVector(v, -1).addScaledVector(up, 0.38).normalize(), up };
    }
    return { dir: new THREE.Vector3(0.45, 0.38, 1).normalize(), up: new THREE.Vector3(0, 1, 0) };
  }

  _fitDistance(radius) {
    radius += this.maxRadius ?? 0;
    const fov = (this.persp.fov * Math.PI) / 180;
    const aspect = this.width / this.height;
    const fitH = radius / Math.sin(fov / 2);
    const fitW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    return Math.max(fitH, fitW) * 1.02;
  }

  resetView(animate = true) {
    const v = this.defaultView();
    this.setViewDirection(v.dir.toArray(), v.up.toArray(), animate, true);
  }

  fitView(animate = true) {
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    this.setViewDirection(dir.toArray(), this.camera.up.toArray(), animate, true);
  }

  /** dir: vector from target to camera. */
  setViewDirection(dir, up = null, animate = true, refit = false) {
    const target = refit ? this.bounds.center.clone() : this.controls.target.clone();
    const d = new THREE.Vector3(...dir).normalize();
    let u = up ? new THREE.Vector3(...up).normalize() : this.camera.up.clone();
    if (Math.abs(u.dot(d)) > 0.98) u = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    u.addScaledVector(d, -u.dot(d)).normalize();
    const dist = refit || !this._hasView ? this._fitDistance(this.bounds.radius) : this.camera.position.distanceTo(this.controls.target);
    const pos = target.clone().addScaledVector(d, dist);
    if (this.camera.isOrthographicCamera && refit) { this._orthoHalf = (this.bounds.radius + (this.maxRadius ?? 0)) * 1.05 * Math.max(1, this.height / this.width); this.camera.zoom = 1; this._updateOrtho(); }
    this._hasView = true;
    if (!animate) {
      this.camera.position.copy(pos); this.camera.up.copy(u); this.controls.target.copy(target);
      this.camera.lookAt(target); this.controls.update(); this._dirty = true; return;
    }
    this._camAnim = {
      t0: performance.now(), dur: 420,
      p0: this.camera.position.clone(), p1: pos, u0: this.camera.up.clone(), u1: u, c0: this.controls.target.clone(), c1: target,
    };
  }

  setView(axis) {
    const s = this.structure;
    const cart = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    let dir, up;
    const neg = axis.startsWith('-');
    const ax = axis.replace('-', '');
    if ('abc'.includes(ax) && s?.cell) {
      const vec = s.cell['abc'.indexOf(ax)];
      dir = vec;
      up = ax === 'c' ? s.cell[1] : s.cell[2];
    } else {
      dir = cart[ax] ?? [0, 0, 1];
      up = ax === 'z' ? [0, 1, 0] : [0, 0, 1];
    }
    if (neg) dir = dir.map((v) => -v);
    this.setViewDirection(dir, up, true, true);
  }

  focusAtom(i) {
    const p = this.model.positions;
    const c = new THREE.Vector3(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
    this._camAnim = { t0: performance.now(), dur: 380, p0: this.camera.position.clone(), p1: this.camera.position.clone().add(c.clone().sub(this.controls.target)), u0: this.camera.up.clone(), u1: this.camera.up.clone(), c0: this.controls.target.clone(), c1: c };
  }

  zoomBy(f) {
    if (this.camera.isOrthographicCamera) { this.camera.zoom *= f; this.camera.updateProjectionMatrix(); }
    else { const t = this.controls.target; this.camera.position.sub(t).multiplyScalar(1 / f).add(t); }
    this._dirty = true;
  }

  getCameraState() {
    return { position: this.camera.position.toArray(), up: this.camera.up.toArray(), target: this.controls.target.toArray(), zoom: this.camera.zoom ?? 1 };
  }

  setCameraState(c) {
    if (!c?.position) return;
    this.camera.position.fromArray(c.position); this.camera.up.fromArray(c.up ?? [0, 1, 0]); this.controls.target.fromArray(c.target ?? [0, 0, 0]);
    if (c.zoom && this.camera.isOrthographicCamera) { this.camera.zoom = c.zoom; this.camera.updateProjectionMatrix(); }
    this.camera.lookAt(this.controls.target); this.controls.update(); this._hasView = true; this._dirty = true;
  }

  _updateOrtho() {
    const aspect = this.width / this.height;
    const h = this._orthoHalf ?? 10;
    Object.assign(this.ortho, { left: -h * aspect, right: h * aspect, top: h, bottom: -h });
    this.ortho.updateProjectionMatrix();
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(2, Math.floor(r.width)), h = Math.max(2, Math.floor(r.height));
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.overlay.width = w * pr; this.overlay.height = h * pr;
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    this._updateOrtho();
    this.resolution.set(w, h);
    this.root.traverse((o) => { if (o.material?.isLineMaterial) o.material.resolution.set(w, h); });
    this.post.setSize(w, h);
    this._dirty = true;
  }

  // ------------------------------------------------------------------ picking
  pickAtom(clientX, clientY) {
    if (!this.model || !this.model.n) return -1;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, dv = ray.ray.direction;
    const p = this.model.positions;
    let best = -1, bestT = Infinity;
    for (let i = 0; i < this.model.n; i++) {
      const rr = Math.max(this.radii?.[i] ?? 0.3, 0.22);
      const lx = p[3 * i] - o.x, ly = p[3 * i + 1] - o.y, lz = p[3 * i + 2] - o.z;
      const tca = lx * dv.x + ly * dv.y + lz * dv.z;
      if (tca < 0) continue;
      const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
      if (d2 > rr * rr) continue;
      const t = tca - Math.sqrt(rr * rr - d2);
      if (t < bestT) { bestT = t; best = i; }
    }
    return best;
  }

  atomInfo(i) {
    const m = this.model;
    if (!m || i < 0 || i >= m.n) return null;
    const src = m.src[i];
    const el = element(m.symbols[i]);
    const pos = [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]];
    const img = [m.img[3 * i], m.img[3 * i + 1], m.img[3 * i + 2]];
    let frac = null;
    if (m.cell) {
      const inv = new THREE.Matrix3().set(...m.cell[0], ...m.cell[1], ...m.cell[2]).transpose().invert();
      const f = new THREE.Vector3(...pos).applyMatrix3(inv);
      frac = f.toArray();
    }
    return { display: i, index: src, symbol: el.symbol, name: el.name, position: pos, frac, image: img, cn: this.cn?.[i] ?? 0 };
  }

  // ------------------------------------------------------------------ loop
  _loop(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    let moving = false;
    if (this._camAnim) {
      const a = this._camAnim;
      let t = Math.min(1, (now - a.t0) / a.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // interpolate around the target to keep distance smooth
      const c = a.c0.clone().lerp(a.c1, e);
      const d0 = a.p0.clone().sub(a.c0), d1 = a.p1.clone().sub(a.c1);
      const len = d0.length() + (d1.length() - d0.length()) * e;
      const dir = d0.normalize().lerp(d1.clone().normalize(), e);
      if (dir.lengthSq() < 1e-8) dir.copy(d1).normalize();
      dir.normalize();
      this.camera.position.copy(c).addScaledVector(dir, len);
      this.camera.up.copy(a.u0.clone().lerp(a.u1, e).normalize());
      this.controls.target.copy(c);
      this.camera.lookAt(c);
      if (t >= 1) this._camAnim = null;
      moving = true;
    }
    if (this.settings.display.turntable && !this._camAnim) {
      const t = this.controls.target, up = this.camera.up;
      const q = new THREE.Quaternion().setFromAxisAngle(up, dt * 0.45);
      this.camera.position.sub(t).applyQuaternion(q).add(t);
      this.camera.lookAt(t);
      moving = true;
    }
    if (this.controls.update?.() || this.controlsKind === 'trackball') moving = moving || this._dirty;
    if (this.playing && this.structure) {
      this._frameAcc += dt;
      if (this._frameAcc >= 1 / this.fps) {
        this._frameAcc = 0;
        this.setFrame((this.structure.frame + 1) % this.structure.nFrames);
      }
    }
    if (this._dirty || moving) this.render();
  }

  _updateClipping() {
    const D = this.camera.position.distanceTo(this.bounds.center);
    const R = this.bounds.radius * 1.4 + 2;
    const near = Math.max(0.05, D - R * 1.6), far = D + R * 1.6;
    for (const cam of [this.persp, this.ortho]) { cam.near = cam.isOrthographicCamera ? Math.max(0.01, D - R * 2) : near; cam.far = far; cam.updateProjectionMatrix(); }
    if (this.scene3.fog) {
      const s = this.settings.post.fog.strength ?? 0.5;
      const r = this.bounds.radius;
      this.scene3.fog.near = D - r * 0.4;
      this.scene3.fog.far = D + r * (3 - 2 * s);
      this.scene3.fog.color.copy(this._fogColor);
    }
    this.post.setFocus(this.camera.position.distanceTo(this.controls.target));
  }

  render({ gizmo = true, overlay = true } = {}) {
    this._updateClipping();
    this.lights.update(this.camera);
    try {
      if (this.post.active) this.post.render();
      else { this.renderer.setRenderTarget(null); this.renderer.render(this.scene3, this.camera); }
      if (gizmo && this.settings.display.axes) {
        const s = this.structure;
        if (s?.cell) this.gizmo.setAxes(s.cell, ['a', 'b', 'c']); else this.gizmo.setAxes([[1, 0, 0], [0, 1, 0], [0, 0, 1]], ['x', 'y', 'z']);
        this.gizmo.render(this.renderer, this.camera, 8, 8);
      }
    } catch (err) {
      console.error(err);
    }
    if (overlay) this.drawOverlay(this.overlay.getContext('2d'), this.renderer.getPixelRatio());
    this._dirty = false;
    this.emit('render');
  }

  project(x, y, z, w, h) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h, v.z];
  }

  /** Labels, measurement values and cell axis letters on a 2D canvas. */
  drawOverlay(g, scale = 1, w = this.width * scale, h = this.height * scale) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    const m = this.model;
    if (!m) return;
    const d = this.settings.display;
    const dark = this.overlayDark;
    const fg = dark ? '#f1f3f5' : '#14171b', halo = dark ? 'rgba(10,12,15,.85)' : 'rgba(255,255,255,.9)';
    const fontFam = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif';
    const text = (t, x, y, size, color = fg, weight = 500) => {
      g.font = `${weight} ${size * scale}px ${fontFam}`;
      g.lineWidth = 3 * scale; g.strokeStyle = halo; g.lineJoin = 'round';
      g.strokeText(t, x, y); g.fillStyle = color; g.fillText(t, x, y);
    };
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (d.labels && d.labels !== 'none') {
      const limit = 600;
      const showAll = m.n <= limit;
      for (let i = 0; i < m.n; i++) {
        if (!showAll && !this.selection.has(m.src[i])) continue;
        const [x, y, z] = this.project(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2], w, h);
        if (z > 1 || z < -1) continue;
        const t = d.labels === 'element' ? m.symbols[i] : d.labels === 'index' ? String(m.src[i]) : `${m.symbols[i]}${m.src[i]}`;
        text(t, x, y, d.labelSize ?? 12, fg, 600);
      }
    }
    if (d.cell?.show && d.cell?.labels && m.cell) {
      const [A, B, C] = m.cell;
      const o = this.project(0, 0, 0, w, h);
      text('O', o[0] - 10 * scale, o[1] + 10 * scale, 12, fg, 600);
      [[A, 'a', '#e5484d'], [B, 'b', '#30a46c'], [C, 'c', '#3e63dd']].forEach(([v, l, col]) => {
        const p = this.project(v[0] * 1.06, v[1] * 1.06, v[2] * 1.06, w, h);
        text(l, p[0], p[1], 14, col, 700);
      });
    }
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-strong').trim() || '#c27c12';
    for (const ms of this.measurements) {
      if (!ms.valid) continue;
      const P = ms.idx.map((i) => this.project(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2], w, h));
      const mid = ms.type === 'distance' ? [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2] : P[ms.type === 'angle' ? 1 : 1].slice(0, 2);
      const label = ms.type === 'distance' ? `${ms.value.toFixed(3)} Å` : `${ms.value.toFixed(1)}°`;
      text(label, mid[0], mid[1] - 12 * scale, 12.5, accent, 700);
    }
  }

  // ------------------------------------------------------------------ export
  /** High-resolution PNG. Returns a Blob. */
  async screenshot({ scale = 2, transparent = false, gizmo = false, maxSize = 8192 } = {}) {
    const pr0 = this.renderer.getPixelRatio();
    const w0 = this.width, h0 = this.height;
    scale = Math.min(scale, maxSize / Math.max(w0, h0));
    const W = Math.round(w0 * scale), H = Math.round(h0 * scale);
    const bg = this.scene3.background, clearA = this.renderer.getClearAlpha();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.post.setSize(W, H);
    const lineMats = [];
    this.root.traverse((o) => { if (o.material?.isLineMaterial) { lineMats.push([o.material, o.material.linewidth]); o.material.resolution.set(W, H); o.material.linewidth *= scale; } });
    const ink = this.post.ink;
    const inkT = ink?.uniforms.thickness.value;
    if (ink) ink.uniforms.thickness.value = inkT * scale;
    if (transparent) { this.scene3.background = null; this.renderer.setClearAlpha(0); }
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const g = out.getContext('2d');
    try {
      this.render({ gizmo, overlay: false });
      g.drawImage(this.renderer.domElement, 0, 0);
      const ov = document.createElement('canvas'); ov.width = W; ov.height = H;
      this.drawOverlay(ov.getContext('2d'), scale, W, H);
      g.drawImage(ov, 0, 0);
    } finally {
      this.scene3.background = bg; this.renderer.setClearAlpha(clearA);
      if (ink) ink.uniforms.thickness.value = inkT;
      lineMats.forEach(([mat, lw]) => { mat.linewidth = lw; });
      this.renderer.setPixelRatio(pr0);
      this.resize();
      this.render();
    }
    return new Promise((res) => out.toBlob(res, 'image/png'));
  }

  /** Small JPEG data URL for project thumbnails. */
  thumbnail(w = 320, h = 200) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    this.render({ gizmo: false, overlay: false });
    const src = this.renderer.domElement;
    const s = Math.max(w / src.width, h / src.height);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(src, (w - src.width * s) / 2, (h - src.height * s) / 2, src.width * s, src.height * s);
    return c.toDataURL('image/jpeg', 0.82);
  }

  /**
   * Binary glTF (GLB). Meshes are grouped by colour (one material per element colour). Small systems
   * are merged into plain meshes for maximum compatibility; large ones use EXT_mesh_gpu_instancing
   * (Blender ≥ 3.6, three.js, Babylon, model-viewer) to keep files small.
   */
  async exportGLB({ instanced = 'auto' } = {}) {
    const m = this.model;
    const useInst = instanced === 'auto' ? m.n > 1500 : !!instanced;
    const group = new THREE.Group();
    group.name = this.structure?.name ?? 'structure';
    const segs = m.n < 500 ? [28, 18] : m.n < 3000 ? [18, 12] : [12, 8];
    const sphere = new THREE.SphereGeometry(1, segs[0], segs[1]);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, m.n < 3000 ? 14 : 8, 1, true);
    const st = this.settings.style;
    const mats = new Map();
    const matFor = (hex) => {
      if (!mats.has(hex)) mats.set(hex, new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: st.roughness ?? 0.45, metalness: st.metalness ?? 0.05, name: hex }));
      return mats.get(hex);
    };
    const tmp = new THREE.Matrix4(), col = new THREE.Color();
    const geos = [];
    const addGroups = (mesh, baseGeo, label) => {
      const byColor = new Map();
      for (let k = 0; k < mesh.count; k++) {
        mesh.getColorAt(k, col);
        const hex = '#' + col.clone().convertLinearToSRGB().getHexString();
        if (!byColor.has(hex)) byColor.set(hex, []);
        byColor.get(hex).push(k);
      }
      for (const [hex, idx] of byColor) {
        if (useInst) {
          const inst = new THREE.InstancedMesh(baseGeo, matFor(hex), idx.length);
          idx.forEach((k, q) => { mesh.getMatrixAt(k, tmp); inst.setMatrixAt(q, tmp); });
          inst.name = `${label} ${hex}`;
          group.add(inst);
        } else {
          const parts = idx.map((k) => { mesh.getMatrixAt(k, tmp); const g = baseGeo.clone().applyMatrix4(tmp); g.deleteAttribute('uv'); return g; });
          const merged = mergeGeometries(parts, false);
          parts.forEach((g) => g.dispose());
          geos.push(merged);
          const mm = new THREE.Mesh(merged, matFor(hex));
          mm.name = `${label} ${hex}`;
          group.add(mm);
        }
      }
    };
    this.rep.traverse((o) => {
      if (!o.isInstancedMesh) return;
      if (o.userData.role === 'atoms') addGroups(o, sphere, 'atoms');
      else if (o.userData.role === 'bonds') addGroups(o, cyl, 'bonds');
    });
    this.rep.traverse((o) => { if (o.userData.role === 'polyhedra') group.add(new THREE.Mesh(o.geometry.clone(), new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: o.material.opacity, side: THREE.DoubleSide, name: 'polyhedra' }))); });
    if (this.cellObj && m.cell) {
      const [A, B, C] = m.cell;
      const P = (a, b, c) => new THREE.Vector3(a * A[0] + b * B[0] + c * C[0], a * A[1] + b * B[1] + c * C[1], a * A[2] + b * B[2] + c * C[2]);
      const E = [[0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 1, 0], [1, 0, 0, 1, 0, 1], [0, 1, 0, 1, 1, 0], [0, 1, 0, 0, 1, 1], [0, 0, 1, 1, 0, 1], [0, 0, 1, 0, 1, 1], [1, 1, 0, 1, 1, 1], [1, 0, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1]];
      const pts = E.flatMap((e) => [P(e[0], e[1], e[2]), P(e[3], e[4], e[5])]);
      const cell = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: this.settings.display.cell.color ?? '#333' }));
      cell.name = 'unit cell';
      group.add(cell);
    }
    const exporter = new GLTFExporter();
    const buf = await exporter.parseAsync(group, { binary: true });
    geos.forEach((g) => g.dispose());
    sphere.dispose(); cyl.dispose();
    mats.forEach((mt) => mt.dispose());
    return new Blob([buf], { type: 'model/gltf-binary' });
  }

  dispose() {
    this._ro.disconnect();
    this.controls.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}

function luminance(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

export function measureValue(type, P) {
  if (type === 'distance') return P[0].distanceTo(P[1]);
  if (type === 'angle') {
    const a = P[0].clone().sub(P[1]), b = P[2].clone().sub(P[1]);
    return (a.angleTo(b) * 180) / Math.PI;
  }
  const b1 = P[1].clone().sub(P[0]), b2 = P[2].clone().sub(P[1]), b3 = P[3].clone().sub(P[2]);
  const n1 = b1.clone().cross(b2), n2 = b2.clone().cross(b3);
  const m1 = n1.clone().cross(b2.clone().normalize());
  return (Math.atan2(m1.dot(n2), n1.dot(n2)) * 180) / Math.PI;
}
