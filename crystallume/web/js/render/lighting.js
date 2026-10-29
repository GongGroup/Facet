/**
 * Lighting presets, environment maps and the light rig.
 *
 * Directions are camera-relative when `follow` is on: azimuth 0° = from the viewer, +90° = from the
 * right; elevation +90° = from above. Presets: lighting.register({ id, name, description, ...LightingSettings })
 *
 * Environment (image-based) light: lighting.env = { enabled, intensity, map, rotation }. `map` names an
 * entry of `environmentMaps` (default 'room'); `rotation` turns it about the vertical axis (degrees).
 * With `follow` on, the environment turns with the camera too, so reflections stay put relative to the
 * key light while you orbit. Plugins can add maps:
 *   environmentMaps.register({ id, name, description, build: () => THREE.Scene })
 */
import * as THREE from '../../vendor/three/three.module.js';
import { RoomEnvironment } from '../../vendor/three/addons/environments/RoomEnvironment.js';

const registry = new Map();
export const lightingPresets = {
  register(p) { registry.set(p.id, p); return () => registry.delete(p.id); },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
};

const L = (intensity, color, azimuth, elevation) => ({ intensity, color, azimuth, elevation });

[
  { id: 'studio', name: 'Studio', description: 'Warm key, cool fill and a rim light over a soft environment', swatch: ['#fff3e2', '#d8e4ff', '#8a96a8'],
    hemi: { intensity: 0.35, sky: '#ffffff', ground: '#6b7280' }, ambient: { intensity: 0.05, color: '#ffffff' },
    key: L(2.4, '#fff4e6', -38, 34), fill: L(0.75, '#dbe6ff', 52, 8), rim: L(1.3, '#ffffff', 155, 38), extra: [], env: { enabled: true, intensity: 0.55, map: 'room' } },
  { id: 'headlight', name: 'Headlight', description: 'One light from the viewer, like VESTA and Jmol', swatch: ['#ffffff', '#f2f2f2', '#cfcfcf'],
    hemi: { intensity: 0, sky: '#ffffff', ground: '#888888' }, ambient: { intensity: 0.55, color: '#ffffff' },
    key: L(2.3, '#ffffff', 8, 12), fill: L(0, '#ffffff', 0, 0), rim: L(0, '#ffffff', 180, 0), extra: [], env: { enabled: false, intensity: 0, map: 'room' } },
  { id: 'three-point', name: 'Three-point', description: 'Classic photographic key / fill / back light', swatch: ['#ffffff', '#c9d6ea', '#5f6b7c'],
    hemi: { intensity: 0.15, sky: '#ffffff', ground: '#444b55' }, ambient: { intensity: 0.08, color: '#ffffff' },
    key: L(2.8, '#ffffff', -45, 30), fill: L(0.9, '#e8eefc', 48, 0), rim: L(2.0, '#ffffff', 180, 32), extra: [], env: { enabled: true, intensity: 0.3, map: 'studio' } },
  { id: 'softbox', name: 'Soft daylight', description: 'Big overhead sky light and gentle bounce — low contrast', swatch: ['#f4f8ff', '#e6ddd2', '#b7c3cf'],
    hemi: { intensity: 1.05, sky: '#eef4ff', ground: '#b8a998' }, ambient: { intensity: 0.05, color: '#ffffff' },
    key: L(1.25, '#ffffff', -20, 62), fill: L(0.25, '#ffffff', 60, 10), rim: L(0.3, '#ffffff', 170, 30), extra: [], env: { enabled: true, intensity: 0.8, map: 'sky' } },
  { id: 'dramatic', name: 'Dramatic', description: 'Hard side key and a cool rim against darkness', swatch: ['#ffffff', '#1a1d22', '#9fc2ff'],
    hemi: { intensity: 0.02, sky: '#ffffff', ground: '#000000' }, ambient: { intensity: 0.03, color: '#ffffff' },
    key: L(3.4, '#ffffff', -72, 22), fill: L(0.12, '#ffffff', 60, 0), rim: L(2.8, '#b9d1ff', 160, 12), extra: [], env: { enabled: true, intensity: 0.12, map: 'dark' } },
  { id: 'sunset', name: 'Golden hour', description: 'Low warm sun with a blue-hour fill', swatch: ['#ffb36b', '#7aa0ff', '#3a3f63'],
    hemi: { intensity: 0.3, sky: '#ffd5ad', ground: '#3a3f63' }, ambient: { intensity: 0.04, color: '#ffffff' },
    key: L(2.8, '#ffb070', -62, 12), fill: L(0.85, '#7aa0ff', 60, 10), rim: L(1.5, '#ff9a5a', 172, 20), extra: [], env: { enabled: true, intensity: 0.25, map: 'sunset' } },
  { id: 'cool-lab', name: 'Cool lab', description: 'Clean bluish-white, slightly clinical', swatch: ['#eaf4ff', '#cfe6ff', '#9fb3c8'],
    hemi: { intensity: 0.55, sky: '#e8f4ff', ground: '#9fb3c8' }, ambient: { intensity: 0.05, color: '#ffffff' },
    key: L(1.9, '#eef6ff', -30, 42), fill: L(0.6, '#cfe6ff', 42, 6), rim: L(0.8, '#ffffff', 165, 30), extra: [], env: { enabled: true, intensity: 0.5, map: 'studio' } },
  { id: 'warm-studio', name: 'Warm studio', description: 'Warm key, cool fill and a bright rim over studio reflections — for glossy renders with floor shadows', swatch: ['#fff1e0', '#e8eefc', '#8a8178'],
    hemi: { intensity: 0.35, sky: '#ffffff', ground: '#8a8178' }, ambient: { intensity: 0.06, color: '#ffffff' },
    key: L(2.7, '#fff1e0', -45, 40), fill: L(0.85, '#e8eefc', 48, 2), rim: L(1.8, '#ffffff', 175, 32), extra: [], env: { enabled: true, intensity: 0.6, map: 'studio' } },
  { id: 'soft-studio', name: 'Soft studio', description: 'Bright, low-contrast studio light with lifted shadows — for light backgrounds', swatch: ['#fffaf2', '#eef3ff', '#c9ced6'],
    hemi: { intensity: 0.6, sky: '#ffffff', ground: '#c3c9d2' }, ambient: { intensity: 0.08, color: '#ffffff' },
    key: L(2.1, '#fff8ef', -36, 40), fill: L(0.85, '#eef3ff', 55, 4), rim: L(0.9, '#ffffff', 160, 32), extra: [], env: { enabled: true, intensity: 0.45, map: 'room' } },
  { id: 'window', name: 'Window light', description: 'Warm light from a high window with a soft bounce — for still-life renders with shadows', swatch: ['#fff1de', '#f4efe8', '#b9a99a'],
    hemi: { intensity: 0.9, sky: '#f4efe8', ground: '#b9a99a' }, ambient: { intensity: 0.05, color: '#ffffff' },
    key: L(1.8, '#fff1de', -45, 50), fill: L(0.25, '#ffffff', 60, 10), rim: L(0.3, '#ffffff', 170, 30), extra: [], env: { enabled: true, intensity: 0.8, map: 'sky' } },
  { id: 'night', name: 'Night', description: 'Key light and a strong cool rim that lifts the model off a dark background', swatch: ['#ffffff', '#9cc0ff', '#141b26'],
    hemi: { intensity: 0.25, sky: '#c9d8ff', ground: '#1b2230' }, ambient: { intensity: 0.04, color: '#ffffff' },
    key: L(2.5, '#fffaf2', -40, 34), fill: L(0.45, '#b9c9ff', 52, 0), rim: L(2.4, '#a8c6ff', 165, 24), extra: [], env: { enabled: true, intensity: 0.35, map: 'studio' } },
  { id: 'poster', name: 'Poster', description: 'Strong key over a warm sky and cool ground light — two clear tones for cel shading', swatch: ['#ffffff', '#fff6e8', '#9fb1d4'],
    hemi: { intensity: 0.45, sky: '#fff6e8', ground: '#9fb1d4' }, ambient: { intensity: 0.75, color: '#ffffff' },
    key: L(2.3, '#ffffff', -40, 45), fill: L(0, '#ffffff', 0, 0), rim: L(0, '#ffffff', 180, 0), extra: [], env: { enabled: false, intensity: 0, map: 'room' } },
  { id: 'paper', name: 'Paper', description: 'Daylight from the upper left over a soft ambient — for watercolour, ink and pencil', swatch: ['#fffdf8', '#f3efe6', '#d9d2c5'],
    hemi: { intensity: 0.35, sky: '#ffffff', ground: '#d9d2c5' }, ambient: { intensity: 0.6, color: '#ffffff' },
    key: L(1.6, '#fffaf2', -42, 46), fill: L(0, '#ffffff', 0, 0), rim: L(0, '#ffffff', 180, 0), extra: [], env: { enabled: false, intensity: 0, map: 'room' } },
  { id: 'flat', name: 'Flat', description: 'Mostly ambient — for cel shading and diagrams', swatch: ['#ffffff', '#ffffff', '#e5e5e5'],
    hemi: { intensity: 0.2, sky: '#ffffff', ground: '#dddddd' }, ambient: { intensity: 1.35, color: '#ffffff' },
    key: L(1.3, '#ffffff', -30, 40), fill: L(0, '#ffffff', 0, 0), rim: L(0, '#ffffff', 180, 0), extra: [], env: { enabled: false, intensity: 0, map: 'room' } },
  { id: 'neon', name: 'Neon', description: 'Magenta and cyan coloured side lights', swatch: ['#ff3fd4', '#3fe9ff', '#090a12'],
    hemi: { intensity: 0, sky: '#ffffff', ground: '#000000' }, ambient: { intensity: 0.04, color: '#ffffff' },
    key: L(0.5, '#ffffff', 0, 60), fill: L(0, '#ffffff', 0, 0), rim: L(0.8, '#ffffff', 180, 20),
    extra: [L(3.2, '#ff3fd4', -85, 8), L(3.2, '#3fe9ff', 85, 8)], env: { enabled: true, intensity: 0.08, map: 'dark' } },
  { id: 'ibl', name: 'Environment', description: 'Image-based lighting from a virtual room, no direct lights', swatch: ['#ffffff', '#d9d9d9', '#9a9a9a'],
    hemi: { intensity: 0, sky: '#ffffff', ground: '#000000' }, ambient: { intensity: 0, color: '#ffffff' },
    key: L(0, '#ffffff', -30, 30), fill: L(0, '#ffffff', 0, 0), rim: L(0, '#ffffff', 180, 0), extra: [], env: { enabled: true, intensity: 1.25, map: 'room' } },
].forEach((p) => lightingPresets.register(p));

/** Turn a preset into a full lighting-settings object (keeps shadows/exposure etc. from `base`). */
export function presetToSettings(id, base = {}) {
  const p = registry.get(id) ?? registry.get('studio');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  return {
    ...base, preset: p.id,
    hemi: clone(p.hemi), ambient: clone(p.ambient), key: clone(p.key), fill: clone(p.fill), rim: clone(p.rim),
    extra: clone(p.extra ?? []), env: clone(p.env),
    ...(p.exposure ? { exposure: p.exposure } : {}),
  };
}

/** Unit vector for an azimuth/elevation pair (degrees), in the rig's frame (camera frame when following). */
export function dirFromAngles(az, el) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}

/** Inverse of dirFromAngles: {azimuth, elevation} in degrees for a direction [x, y, z]. */
export function anglesFromDir([x, y, z]) {
  const n = Math.hypot(x, y, z) || 1;
  return { azimuth: Math.atan2(x / n, z / n) * 180 / Math.PI, elevation: Math.asin(Math.max(-1, Math.min(1, y / n))) * 180 / Math.PI };
}

// ------------------------------------------------------------------ environment maps
const envRegistry = new Map();
export const environmentMaps = {
  register(m) { envRegistry.set(m.id, m); return () => envRegistry.delete(m.id); },
  get: (id) => envRegistry.get(id),
  list: () => [...envRegistry.values()],
};
export const DEFAULT_ENV_MAP = 'room';

/** A sky dome: colours blend from `bottom` through `horizon` to `top` by height (linear values may exceed 1). */
function dome(top, horizon, bottom, gain = 1) {
  const g = new THREE.SphereGeometry(50, 48, 24);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const T = new THREE.Color(top), M = new THREE.Color(horizon), B = new THREE.Color(bottom), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    if (y >= 0) c.copy(M).lerp(T, Math.pow(y, 0.6)); else c.copy(M).lerp(B, Math.min(1, -y * 3));
    col.set([c.r * gain, c.g * gain, c.b * gain], 3 * i);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false }));
}

/** A round softbox with a soft edge, facing the origin from direction (az, el) at distance 20. */
function softbox(az, el, radius, intensity, color = '#ffffff', { sx = 1, sy = 1 } = {}) {
  const g = new THREE.RingGeometry(0.001, radius, 40, 6);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i)) / radius;
    const f = 1 - THREE.MathUtils.smoothstep(r, 0.55, 1);
    col.set([f, f, f], 3 * i);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  m.color.set(color).multiplyScalar(intensity);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(dirFromAngles(az, el).multiplyScalar(20));
  mesh.lookAt(0, 0, 0);
  mesh.scale.set(sx, sy, 1);
  return mesh;
}

const sceneOf = (...objs) => { const sc = new THREE.Scene(); sc.add(...objs); return sc; };

[
  { id: 'room', name: 'Room', description: 'A neutral virtual room: even, soft reflections', build: () => new RoomEnvironment() },
  { id: 'studio', name: 'Studio softboxes', description: 'Grey studio with large softboxes: crisp highlights on metal and glass',
    build: () => sceneOf(dome('#4a4e55', '#2c2f34', '#1a1c1f', 1.3),
      softbox(-40, 35, 6.5, 9, '#fff6ea'), softbox(55, 8, 5, 3, '#e4ecff'), softbox(0, 82, 8, 3.5), softbox(160, 25, 6, 7, '#ffffff', { sx: 0.35, sy: 1.6 })) },
  { id: 'sky', name: 'Sky', description: 'Bright overcast sky over warm ground: soft and natural',
    build: () => sceneOf(dome('#a9c8ee', '#eef2f6', '#8a7b6b', 1.25), softbox(-30, 55, 3, 14, '#fff3dc')) },
  { id: 'sunset', name: 'Sunset', description: 'A low orange sun under a violet sky',
    build: () => sceneOf(dome('#3f3c7c', '#ff9d60', '#2a2233', 0.9), softbox(-62, 8, 11, 2.2, '#ff9a5a'), softbox(-62, 8, 3.2, 26, '#ffc185')) },
  { id: 'dark', name: 'Dark studio', description: 'A black room with one softbox and a cool rim strip: dramatic reflections',
    build: () => sceneOf(dome('#0a0b0d', '#050506', '#020203', 1), softbox(-72, 22, 5.5, 8, '#ffffff'), softbox(160, 12, 6, 6, '#b9d1ff', { sx: 0.3, sy: 1.5 })) },
].forEach((m) => environmentMaps.register(m));

const _Y = new THREE.Vector3(0, 1, 0), _qm = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _e = new THREE.Euler();

export class LightRig {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'lights';
    scene.add(this.group);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.1);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    this.target = new THREE.Object3D();
    scene.add(this.target);
    this.key = this._dir(); this.fill = this._dir(); this.rim = this._dir();
    this.extras = [];
    this.group.add(this.ambient, this.hemi, this.key, this.fill, this.rim);
    this.key.castShadow = false;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.03;
    this._envCache = new Map();
    this.envTexture = this.environment(DEFAULT_ENV_MAP);
    this.settings = null;
    this.center = new THREE.Vector3();
    this.radius = 10;
  }

  _dir() { const l = new THREE.DirectionalLight(0xffffff, 1); l.target = this.target; return l; }

  /** Pre-filtered texture for an environment map id (built once per renderer, then cached). */
  environment(id) {
    const key = environmentMaps.get(id) ? id : DEFAULT_ENV_MAP;
    if (this._envCache.has(key)) return this._envCache.get(key);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const sc = environmentMaps.get(key).build(THREE);
    const tex = pmrem.fromScene(sc, 0.04).texture;
    pmrem.dispose();
    sc.traverse?.((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this._envCache.set(key, tex);
    return tex;
  }

  setBounds(center, radius) {
    this.center.copy(center); this.radius = radius;
    this.target.position.copy(center);
    const cam = this.key.shadow.camera;
    const r = radius * 1.25;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.1; cam.far = radius * 8;
    cam.updateProjectionMatrix();
  }

  apply(s) {
    this.settings = s;
    const set = (light, p) => { light.intensity = p?.intensity ?? 0; light.color.set(p?.color ?? '#ffffff'); light.visible = light.intensity > 0; };
    this.ambient.intensity = s.ambient?.intensity ?? 0; this.ambient.color.set(s.ambient?.color ?? '#fff');
    this.hemi.intensity = s.hemi?.intensity ?? 0; this.hemi.color.set(s.hemi?.sky ?? '#fff'); this.hemi.groundColor.set(s.hemi?.ground ?? '#444');
    set(this.key, s.key); set(this.fill, s.fill); set(this.rim, s.rim);
    // extras
    for (const l of this.extras) this.group.remove(l);
    this.extras = (s.extra ?? []).map((p) => { const l = this._dir(); set(l, p); l.userData.p = p; this.group.add(l); return l; });
    let env = null;
    if (s.env?.enabled) {
      try { env = this.environment(s.env.map ?? DEFAULT_ENV_MAP); } catch (e) { console.warn('environment map failed', e); env = this.envTexture; }
    }
    this.scene.environment = env;
    this.scene.environmentIntensity = s.env?.intensity ?? 1;
    const sh = s.shadows ?? {};
    this.key.castShadow = !!sh.enabled && this.key.visible;
    this.key.shadow.radius = sh.softness ?? 3;
    this.renderer.shadowMap.enabled = !!sh.enabled;
    this.renderer.toneMappingExposure = s.exposure ?? 1;
    const tm = { none: THREE.NoToneMapping, linear: THREE.LinearToneMapping, reinhard: THREE.ReinhardToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, cineon: THREE.CineonToneMapping };
    this.renderer.toneMapping = tm[s.toneMapping] ?? THREE.NeutralToneMapping;
  }

  /** Position lights for the current camera. */
  update(camera) {
    const s = this.settings;
    if (!s) return;
    const q = s.follow !== false ? camera.quaternion : new THREE.Quaternion();
    const place = (light, p) => {
      if (!p) return;
      const d = dirFromAngles(p.azimuth ?? 0, p.elevation ?? 0).applyQuaternion(q);
      light.position.copy(this.center).addScaledVector(d, this.radius * 4);
    };
    place(this.key, s.key); place(this.fill, s.fill); place(this.rim, s.rim);
    for (const l of this.extras) place(l, l.userData.p);
    if (this.scene.environment) {
      // texture lookup = R(-e) · worldDir (three.js), and we want envDir = Ry(-rotation) · q⁻¹ · worldDir
      _qm.setFromAxisAngle(_Y, -(s.env?.rotation ?? 0) * Math.PI / 180).multiply(_qi.copy(q).invert());
      _e.setFromQuaternion(_qm, 'XYZ');
      this.scene.environmentRotation.set(-_e.x, -_e.y, -_e.z, 'XYZ');
    }
    if (s.follow !== false) {
      // hemisphere "up" follows the camera so the sky stays above the viewer
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      this.hemi.position.copy(up);
    } else this.hemi.position.set(0, 1, 0);
  }
}
