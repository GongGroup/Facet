/**
 * Lighting presets and the light rig.
 *
 * Directions are camera-relative when `follow` is on: azimuth 0° = from the viewer, +90° = from the
 * right; elevation +90° = from above. Presets: lighting.register({ id, name, description, ...LightingSettings })
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
    key: L(2.4, '#fff4e6', -38, 34), fill: L(0.75, '#dbe6ff', 52, 8), rim: L(1.3, '#ffffff', 155, 38), extra: [], env: { enabled: true, intensity: 0.55 } },
  { id: 'headlight', name: 'Headlight', description: 'One light from the viewer, like VESTA and Jmol', swatch: ['#ffffff', '#f2f2f2', '#cfcfcf'],
    hemi: { intensity: 0, sky: '#ffffff', ground: '#888888' }, ambient: { intensity: 0.55, color: '#ffffff' },
    key: L(2.3, '#ffffff', 8, 12), fill: L(0, '#ffffff', 0, 0), rim: L(0, '#ffffff', 180, 0), extra: [], env: { enabled: false, intensity: 0 } },
  { id: 'three-point', name: 'Three-point', description: 'Classic photographic key / fill / back light', swatch: ['#ffffff', '#c9d6ea', '#5f6b7c'],
    hemi: { intensity: 0.15, sky: '#ffffff', ground: '#444b55' }, ambient: { intensity: 0.08, color: '#ffffff' },
    key: L(2.8, '#ffffff', -45, 30), fill: L(0.9, '#e8eefc', 48, 0), rim: L(2.0, '#ffffff', 180, 32), extra: [], env: { enabled: true, intensity: 0.3 } },
  { id: 'softbox', name: 'Soft daylight', description: 'Big overhead sky light and gentle bounce — low contrast', swatch: ['#f4f8ff', '#e6ddd2', '#b7c3cf'],
    hemi: { intensity: 1.05, sky: '#eef4ff', ground: '#b8a998' }, ambient: { intensity: 0.05, color: '#ffffff' },
    key: L(1.25, '#ffffff', -20, 62), fill: L(0.25, '#ffffff', 60, 10), rim: L(0.3, '#ffffff', 170, 30), extra: [], env: { enabled: true, intensity: 0.8 } },
  { id: 'dramatic', name: 'Dramatic', description: 'Hard side key and a cool rim against darkness', swatch: ['#ffffff', '#1a1d22', '#9fc2ff'],
    hemi: { intensity: 0.02, sky: '#ffffff', ground: '#000000' }, ambient: { intensity: 0.03, color: '#ffffff' },
    key: L(3.4, '#ffffff', -72, 22), fill: L(0.12, '#ffffff', 60, 0), rim: L(2.8, '#b9d1ff', 160, 12), extra: [], env: { enabled: true, intensity: 0.12 } },
  { id: 'sunset', name: 'Golden hour', description: 'Low warm sun with a blue-hour fill', swatch: ['#ffb36b', '#7aa0ff', '#3a3f63'],
    hemi: { intensity: 0.3, sky: '#ffd5ad', ground: '#3a3f63' }, ambient: { intensity: 0.04, color: '#ffffff' },
    key: L(2.8, '#ffb070', -62, 12), fill: L(0.85, '#7aa0ff', 60, 10), rim: L(1.5, '#ff9a5a', 172, 20), extra: [], env: { enabled: true, intensity: 0.25 } },
  { id: 'cool-lab', name: 'Cool lab', description: 'Clean bluish-white, slightly clinical', swatch: ['#eaf4ff', '#cfe6ff', '#9fb3c8'],
    hemi: { intensity: 0.55, sky: '#e8f4ff', ground: '#9fb3c8' }, ambient: { intensity: 0.05, color: '#ffffff' },
    key: L(1.9, '#eef6ff', -30, 42), fill: L(0.6, '#cfe6ff', 42, 6), rim: L(0.8, '#ffffff', 165, 30), extra: [], env: { enabled: true, intensity: 0.5 } },
  { id: 'flat', name: 'Flat', description: 'Mostly ambient — for cel shading and diagrams', swatch: ['#ffffff', '#ffffff', '#e5e5e5'],
    hemi: { intensity: 0.2, sky: '#ffffff', ground: '#dddddd' }, ambient: { intensity: 1.35, color: '#ffffff' },
    key: L(1.3, '#ffffff', -30, 40), fill: L(0, '#ffffff', 0, 0), rim: L(0, '#ffffff', 180, 0), extra: [], env: { enabled: false, intensity: 0 } },
  { id: 'neon', name: 'Neon', description: 'Magenta and cyan coloured side lights', swatch: ['#ff3fd4', '#3fe9ff', '#090a12'],
    hemi: { intensity: 0, sky: '#ffffff', ground: '#000000' }, ambient: { intensity: 0.04, color: '#ffffff' },
    key: L(0.5, '#ffffff', 0, 60), fill: L(0, '#ffffff', 0, 0), rim: L(0.8, '#ffffff', 180, 20),
    extra: [L(3.2, '#ff3fd4', -85, 8), L(3.2, '#3fe9ff', 85, 8)], env: { enabled: true, intensity: 0.08 } },
  { id: 'ibl', name: 'Environment only', description: 'Image-based lighting from a virtual room, no direct lights', swatch: ['#ffffff', '#d9d9d9', '#9a9a9a'],
    hemi: { intensity: 0, sky: '#ffffff', ground: '#000000' }, ambient: { intensity: 0, color: '#ffffff' },
    key: L(0, '#ffffff', -30, 30), fill: L(0, '#ffffff', 0, 0), rim: L(0, '#ffffff', 180, 0), extra: [], env: { enabled: true, intensity: 1.25 } },
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

function dirFromAngles(az, el) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}

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
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.settings = null;
    this.center = new THREE.Vector3();
    this.radius = 10;
  }

  _dir() { const l = new THREE.DirectionalLight(0xffffff, 1); l.target = this.target; return l; }

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
    this.scene.environment = s.env?.enabled ? this.envTexture : null;
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
    if (s.follow !== false) {
      // hemisphere "up" follows the camera so the sky stays above the viewer
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      this.hemi.position.copy(up);
    } else this.hemi.position.set(0, 1, 0);
  }
}
