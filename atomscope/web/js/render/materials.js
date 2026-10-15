/**
 * Material ("shading") presets. Instance colours multiply the material colour, so every preset
 * keeps a white base colour.
 *   materials.register({ id, name, description, swatch, create(params) => THREE.Material })
 * params = { roughness, metalness, opacity, envIntensity }
 */
import * as THREE from '../../vendor/three/three.module.js';

const registry = new Map();
export const materials = {
  register(m) { registry.set(m.id, m); return () => registry.delete(m.id); },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
};

let toonGradient = null;
function getToonGradient() {
  if (toonGradient) return toonGradient;
  const data = new Uint8Array([90, 170, 255]);
  toonGradient = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  toonGradient.minFilter = toonGradient.magFilter = THREE.NearestFilter;
  toonGradient.needsUpdate = true;
  return toonGradient;
}

function applyCommon(mat, p, defaults = {}) {
  if ('roughness' in mat) mat.roughness = p.roughness ?? defaults.roughness ?? mat.roughness;
  if ('metalness' in mat) mat.metalness = p.metalness ?? defaults.metalness ?? mat.metalness;
  const opacity = p.opacity ?? 1;
  if (opacity < 1) { mat.transparent = true; mat.opacity = opacity; mat.depthWrite = opacity > 0.6; }
  return mat;
}

materials.register({
  id: 'standard', name: 'Satin', description: 'Physically based, gentle highlights — a safe default',
  swatch: 'radial-gradient(circle at 35% 30%, #fff 0, #b9c4d0 18%, #5d6b7a 70%, #2f3740 100%)',
  create: (p) => applyCommon(new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.04 }), p),
});
materials.register({
  id: 'glossy', name: 'Glossy', description: 'Clear-coated plastic with crisp reflections',
  swatch: 'radial-gradient(circle at 33% 28%, #fff 0, #fff 7%, #8fb0d6 16%, #2e5b8f 70%, #0f2440 100%)',
  create: (p) => applyCommon(new THREE.MeshPhysicalMaterial({ roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 }), p),
});
materials.register({
  id: 'matte', name: 'Matte', description: 'Diffuse, no highlights; pairs well with ambient occlusion',
  swatch: 'radial-gradient(circle at 40% 35%, #d9dde2 0, #a7b0ba 45%, #6c7681 100%)',
  create: (p) => applyCommon(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }), p),
});
materials.register({
  id: 'metallic', name: 'Metallic', description: 'Polished metal; needs environment lighting',
  swatch: 'radial-gradient(circle at 35% 30%, #fff 0, #e9d7a6 12%, #a8823d 45%, #3b2a10 100%)',
  create: (p) => applyCommon(new THREE.MeshPhysicalMaterial({ roughness: 0.26, metalness: 0.92, clearcoat: 0.3 }), p),
});
materials.register({
  id: 'glass', name: 'Glass', description: 'Refractive, tinted transmission',
  swatch: 'radial-gradient(circle at 35% 30%, #ffffff 0, #d7f2ff 12%, rgba(120,190,230,.55) 55%, rgba(30,80,120,.8) 100%)',
  create: (p) => applyCommon(new THREE.MeshPhysicalMaterial({ roughness: 0.06, metalness: 0, transmission: 0.9, thickness: 1.4, ior: 1.45, clearcoat: 1, clearcoatRoughness: 0.04, attenuationDistance: 3 }), p),
});
materials.register({
  id: 'pearl', name: 'Pearl', description: 'Iridescent thin-film sheen',
  swatch: 'radial-gradient(circle at 35% 30%, #fff 0, #f4e9ff 15%, #c6d9f5 45%, #a6b9c9 75%, #5d6c7c 100%)',
  create: (p) => applyCommon(new THREE.MeshPhysicalMaterial({ roughness: 0.32, metalness: 0.05, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 620], sheen: 0.6, sheenRoughness: 0.4, clearcoat: 0.5 }), p),
});
materials.register({
  id: 'clay', name: 'Clay', description: 'Soft, chalky surface for studio renders',
  swatch: 'radial-gradient(circle at 40% 35%, #f1e9e1 0, #d6c7b8 45%, #9b8a7b 100%)',
  create: (p) => applyCommon(new THREE.MeshPhysicalMaterial({ roughness: 1, metalness: 0, sheen: 0.4, sheenRoughness: 0.9, sheenColor: new THREE.Color('#ffffff') }), p),
});
materials.register({
  id: 'phong', name: 'Classic', description: 'Blinn–Phong highlight like VESTA and Jmol',
  swatch: 'radial-gradient(circle at 34% 30%, #fff 0, #fff 6%, #e05252 18%, #8c1d1d 75%, #3d0b0b 100%)',
  create: (p) => { const m = new THREE.MeshPhongMaterial({ shininess: 70, specular: new THREE.Color(0x444444) }); return applyCommon(m, p); },
});
materials.register({
  id: 'toon', name: 'Cel', description: 'Three-tone cartoon shading; add an ink outline',
  swatch: 'linear-gradient(135deg, #8fd0a8 0 45%, #5aa77a 45% 75%, #3b7a55 75%)',
  create: (p) => applyCommon(new THREE.MeshToonMaterial({ gradientMap: getToonGradient() }), p),
});
materials.register({
  id: 'flat', name: 'Flat', description: 'Unlit solid colour — for diagrams and outlines',
  swatch: 'linear-gradient(#e8a33d, #e8a33d)',
  create: (p) => applyCommon(new THREE.MeshBasicMaterial({}), p),
});
materials.register({
  id: 'glow', name: 'Glow', description: 'Self-illuminated; enable bloom for halos',
  swatch: 'radial-gradient(circle at 50% 50%, #fff 0, #ffe6a8 20%, #ff9b2e 55%, rgba(255,120,0,0) 100%)',
  create: (p) => {
    const m = applyCommon(new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 }), p);
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n totalEmissiveRadiance += vColor.rgb * 0.75;\n#endif');
    };
    m.customProgramCacheKey = () => 'glow';
    return m;
  },
});
materials.register({
  id: 'xray', name: 'X-ray', description: 'Fresnel rim, see-through; great on dark backgrounds',
  swatch: 'radial-gradient(circle at 50% 50%, rgba(80,200,255,.05) 0, rgba(80,200,255,.25) 55%, #8be4ff 85%, rgba(80,200,255,.1) 100%)',
  transparent: true,
  create: (p) => new THREE.ShaderMaterial({
    uniforms: { power: { value: 2.2 }, strength: { value: 1.4 }, base: { value: 0.06 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main() {
        vec4 mv = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          mv = instanceMatrix * mv;
          n = mat3(instanceMatrix) * n;
        #endif
        mv = modelViewMatrix * mv;
        vN = normalize(normalMatrix * n);
        vV = normalize(-mv.xyz);
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #else
          vC = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float power; uniform float strength; uniform float base;
      varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), power);
        float a = clamp(base + f * strength, 0.0, 1.0);
        gl_FragColor = vec4(vC * (0.35 + f * 1.6), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  }),
});

export function createMaterial(id, params = {}) {
  const m = registry.get(id) ?? registry.get('standard');
  const mat = m.create(params);
  mat.userData.preset = m.id;
  return mat;
}
