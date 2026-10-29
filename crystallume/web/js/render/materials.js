/**
 * Material ("shading") presets. Instance colours multiply the material colour, so every preset
 * keeps a white base colour.
 *   materials.register({ id, name, description, swatch, create(params, { THREE }) => THREE.Material,
 *                        update?(material, params), transparent?, prefersDark?, facets?, faces? })
 * params = { roughness, metalness, opacity, envIntensity }
 * Slider changes (roughness / metalness / opacity) are applied to the existing material through
 * `updateMaterial()`: the preset's own `update()` when given, otherwise in place for materials built
 * with `applyCommon()`; anything else is rebuilt. `prefersDark` marks presets that read best on a
 * dark background (the appearance panel uses it for hints). `facets: { detail, radial }` asks for
 * low-poly geometry (atoms as icospheres of that detail, bonds as prisms with `radial` sides);
 * `faces(common, { THREE })` builds the material of coordination-polyhedron faces (`common` holds
 * vertexColors, opacity and the other face settings), for presets whose faces should match the atoms.
 */
import * as THREE from '../../vendor/three/three.module.js';

const registry = new Map();
export const materials = {
  register(m) {
    // every caller gets create(params, { THREE }), also callers that pass only params
    const create = m.create;
    if (typeof create === 'function' && !create.withEnv) {
      m.create = function (params = {}, env) { return create.call(this, params ?? {}, env ?? { THREE }); };
      m.create.withEnv = true;
    }
    registry.set(m.id, m);
    return () => { if (registry.get(m.id) === m) registry.delete(m.id); };
  },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
};

const toonGradients = new Map();
/** Cel-shading ramp: the tones are spread evenly over N·L from −1 to 1 (so [a, b] splits at the terminator). */
function getToonGradient(tones = [90, 170, 255]) {
  const key = tones.join();
  if (toonGradients.has(key)) return toonGradients.get(key);
  const tex = new THREE.DataTexture(new Uint8Array(tones), tones.length, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  toonGradients.set(key, tex);
  return tex;
}

export function applyCommon(mat, p, defaults = {}) {
  // remember the preset's own values so a slider reset (null) can return to them later
  mat.userData.defaults = {
    roughness: defaults.roughness ?? mat.roughness, metalness: defaults.metalness ?? mat.metalness,
    transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite,
  };
  setCommon(mat, p);
  return mat;
}

function setCommon(mat, p) {
  const d = mat.userData.defaults;
  if ('roughness' in mat && d.roughness !== undefined) mat.roughness = p.roughness ?? d.roughness;
  if ('metalness' in mat && d.metalness !== undefined) mat.metalness = p.metalness ?? d.metalness;
  const opacity = p.opacity ?? 1;
  const wasTransparent = mat.transparent;
  if (opacity < 1) { mat.transparent = true; mat.opacity = opacity; mat.depthWrite = opacity > 0.6; }
  else { mat.transparent = d.transparent; mat.opacity = d.opacity; mat.depthWrite = d.depthWrite; }
  // `transparent` selects a different shader variant; everything else is a uniform
  if (wasTransparent !== mat.transparent) mat.needsUpdate = true;
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
  // thin, pale-tinted glass with a little self-light: reads as glass on dark backgrounds and keeps
  // light elements light; bonds behind it stay visible (the viewer gives them an opaque material)
  create: (p) => {
    const m = applyCommon(new THREE.MeshPhysicalMaterial({ roughness: 0.06, metalness: 0, transmission: 0.65, thickness: 0.3, ior: 1.35, clearcoat: 1, clearcoatRoughness: 0.04, attenuationDistance: 20 }), p);
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), 0.3);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.1;');
    };
    m.customProgramCacheKey = () => 'glass-tint';
    return m;
  },
});
materials.register({
  id: 'crystal', name: 'Crystal', description: 'Clear, lightly tinted glass for light backgrounds: airy body, crisp highlights',
  swatch: 'radial-gradient(circle at 35% 30%, #fff 0, #fff 6%, rgba(130,170,235,.5) 22%, rgba(90,130,210,.75) 80%, #3f5f9e 100%)',
  create: (p) => {
    const m = applyCommon(new THREE.MeshPhysicalMaterial({ roughness: 0.04, metalness: 0, transmission: 1, thickness: 0.8, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.03 }), p);
    // a quarter of the way to white: element colours tint the glass instead of filling it
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), 0.25);');
    };
    m.customProgramCacheKey = () => 'crystal-tint';
    return m;
  },
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
  id: 'poster', name: 'Poster', description: 'Two-tone cel shading with a crisp highlight — bold with an outline',
  swatch: 'radial-gradient(circle at 34% 30%, #fff 0 9%, transparent 10%), linear-gradient(135deg, #f0705a 0 58%, #b84a3c 58%)',
  create: (p) => {
    const m = applyCommon(new THREE.MeshToonMaterial({ gradientMap: getToonGradient([120, 255]) }), p);
    // a hard specular dot from the key light (the first directional light), added as emission
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  totalEmissiveRadiance += vec3(0.6) * smoothstep(0.972, 0.978, dot(normal, normalize(directionalLights[0].direction + geometryViewDir)));
#endif`);
    };
    m.customProgramCacheKey = () => 'poster-glint';
    return m;
  },
});
materials.register({
  id: 'flat', name: 'Flat', description: 'Unlit solid colour — for diagrams and outlines',
  swatch: 'linear-gradient(#e8a33d, #e8a33d)',
  create: (p) => applyCommon(new THREE.MeshBasicMaterial({}), p),
});
materials.register({
  id: 'glow', name: 'Glow', description: 'Self-illuminated; enable bloom for halos', prefersDark: true,
  swatch: 'radial-gradient(circle at 50% 50%, #fff 0, #ffe6a8 20%, #ff9b2e 55%, rgba(255,120,0,0) 100%)',
  create: (p) => {
    const m = applyCommon(new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 }), p);
    m.onBeforeCompile = (sh) => {
      // emission ≈ 0.45 × colour, capped in luminance so white / pale elements do not flood the bloom
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vec3 glowE = vColor.rgb * 0.45;
  float glowL = dot(glowE, vec3(0.2126, 0.7152, 0.0722));
  totalEmissiveRadiance += glowE * min(1.0, 0.16 / max(glowL, 1e-4));
#endif`);
    };
    m.customProgramCacheKey = () => 'glow2';
    return m;
  },
});
materials.register({
  id: 'xray', name: 'X-ray', description: 'Fresnel rim, see-through; great on dark backgrounds', prefersDark: true,
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

materials.register({
  id: 'facet', name: 'Facet', description: 'Low-poly facets: atoms as faceted icospheres, bonds as prisms',
  swatch: 'conic-gradient(from 15deg at 46% 42%, #b9e3d8, #7fbfb0, #5a9b8f, #87c7b9, #c3e9df, #6daa9d, #b9e3d8)',
  facets: { detail: 1, radial: 6 },
  create: (p) => applyCommon(new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0, flatShading: true }), p),
});

// ------------------------------------------------------------------ drawn materials (wash, ink, pencil, screentone)
/**
 * Uniforms shared by the drawn materials; the viewer keeps them current. `uRes` is the drawing-buffer size,
 * `uPixel` the device pixels per CSS pixel (export scale included, so strokes and grain keep their size in
 * high-resolution exports) and `uPaper` the paper colour (linear), taken from a light background.
 */
export const drawnUniforms = { uRes: { value: new THREE.Vector2(1, 1) }, uPixel: { value: 1 }, uPaper: { value: new THREE.Color('#faf7f0') } };

const DRAWN_PARS = `
uniform vec2 uRes; uniform float uPixel; uniform vec3 uPaper;
varying vec2 vCenterPx; varying vec2 vSeed;
float dHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float dNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dHash(i), dHash(i + vec2(1.0, 0.0)), u.x), mix(dHash(i + vec2(0.0, 1.0)), dHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float dFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * dNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
// coloured-pencil strokes: wavy, broken lines, spacing CSS px apart at angle ang, width a fraction of the spacing
float dHatch(vec2 q, float ang, float spacing, float width, float seed) {
  vec2 d = vec2(cos(ang), sin(ang));
  float along = dot(q, d), t = dot(q, vec2(-d.y, d.x)) / spacing;
  float row = floor(t + 0.5);
  t += 0.22 * (dNoise(vec2(along / 46.0, row * 1.7 + seed)) - 0.5);
  float aa = fwidth(t) + 1e-3, dist = abs(t - floor(t + 0.5));
  float on = 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, dist);
  on *= smoothstep(0.16, 0.48, dNoise(vec2(along / 22.0, row * 3.1 + seed)));
  return on * (0.6 + 0.4 * dNoise(q / 1.3 + seed));
}`;

/**
 * Each part (atom or bond) anchors its strokes and blotches at its own centre on screen, so they move with
 * the part instead of swimming across it, and every instance gets its own seed.
 */
const DRAWN_VS = (src) => src
  .replace('#include <common>', '#include <common>\nuniform vec2 uRes;\nvarying vec2 vCenterPx; varying vec2 vSeed;')
  .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 cc = vec4(0.0, 0.0, 0.0, 1.0);
    #ifdef USE_INSTANCING
      cc = instanceMatrix * cc;
      vSeed = vec2(float(gl_InstanceID) * 0.618034, float(gl_InstanceID) * 0.381966);
    #else
      vSeed = vec2(0.0);
    #endif
    cc = projectionMatrix * modelViewMatrix * cc;
    vCenterPx = (cc.xy / cc.w * 0.5 + 0.5) * uRes;
  }`);

/** Shading from the key light (the first directional light) as a half-Lambert term: 0 facing away … 1 facing it. */
const KEY_LIGHT = `
  #if NUM_DIR_LIGHTS > 0
    float lit = dot(normal, directionalLights[0].direction) * 0.5 + 0.5;
  #else
    float lit = dot(normal, geometryViewDir) * 0.5 + 0.5;
  #endif
  float rimT = 1.0 - abs(dot(normal, geometryViewDir));
  vec2 q = (gl_FragCoord.xy - vCenterPx) / uPixel;`;

const f3 = (v) => v.toFixed(3);
/**
 * Pigment on paper: the colour of a layer of pigment `dens` thick is paper × colour^(k·dens), so thin washes
 * stay pale and dense ones deepen. Three washes are laid wet on dry: an uneven first wash over the whole
 * part (thinner in the highlight, pooled at the outer edge), a hard-edged wash over the shadow side and one
 * over the core shadow, each with a darker line where it dried. Noise bends the edges and the paper
 * granulates the pigment. `soft` widens the edges of the later washes (wet in wet instead of wet on dry).
 */
const washShader = ({ w1, w2, w3, pool, edge, line, grain, k, soft = 0.02 }) => `{
  ${KEY_LIGHT}
  float shade = 1.0 - smoothstep(0.25, 0.95, lit);
  float n1 = dFbm(q / 26.0 + vSeed * 13.0), n2 = dFbm(q / 15.0 + vSeed * 29.0 + 3.7), n3 = dFbm(q / 11.0 + vSeed * 41.0 + 9.1);
  float dens = ${f3(w1)} * (0.7 + 0.6 * n1) * mix(1.0, 0.45, smoothstep(0.86, 0.99, lit));
  dens += ${f3(pool)} * smoothstep(${f3(edge)}, 0.985, rimT);
  float t2 = 0.38 + 0.22 * (n2 - 0.5), m2 = smoothstep(t2 - ${f3(soft)}, t2 + ${f3(soft)}, shade);
  dens += ${f3(w2)} * m2 + ${f3(line)} * m2 * (1.0 - smoothstep(t2 + ${f3(soft)}, t2 + ${f3(soft + 0.08)}, shade));
  float t3 = 0.72 + 0.16 * (n3 - 0.5), m3 = smoothstep(t3 - ${f3(1.5 * soft)}, t3 + ${f3(1.5 * soft)}, shade);
  dens += ${f3(w3)} * m3 + ${f3(0.7 * line)} * m3 * (1.0 - smoothstep(t3 + ${f3(1.5 * soft)}, t3 + ${f3(1.5 * soft + 0.08)}, shade));
  dens *= ${f3(1 - grain)} + ${f3(2 * grain)} * dNoise(q / 1.4 + vSeed * 7.0);
  outgoingLight = uPaper * pow(clamp(diffuseColor.rgb, vec3(0.004), vec3(1.0)), vec3(${f3(k)} * dens));
}`;

/** Coloured pencil: a light first layer, hatching that thickens into cross-hatching in shadow, and a pressed contour. */
const PENCIL_SHADER = `{
  ${KEY_LIGHT}
  float shade = 1.0 - smoothstep(0.18, 0.95, lit);
  float s = vSeed.x * 5.0;
  float c = dHatch(q, 1.0, 6.5, 0.45, s) * smoothstep(0.05, 0.32, shade);
  c = max(c, dHatch(q, -0.6, 7.0, 0.42, s + 3.0) * smoothstep(0.45, 0.72, shade));
  c = max(c, dHatch(q, 0.3, 4.6, 0.4, s + 7.0) * smoothstep(0.76, 0.96, shade));
  c = max(c, smoothstep(0.78, 0.98, rimT) * 0.55 * (0.6 + 0.4 * dNoise(q / 1.5)));
  vec3 pig = diffuseColor.rgb;
  vec3 base = mix(uPaper, uPaper * pig, 0.34);
  vec3 stroke = mix(pig, pig * pig, 0.45 + 0.45 * shade);
  outgoingLight = mix(base, stroke, clamp(c, 0.0, 1.0) * 0.95);
}`;

/**
 * Manga screentone: a 45° dot screen laid over the page (aligned across parts, as a printed sheet is) whose dots
 * grow with the element's tone and the shade; the core shadow is solid ink.
 */
const SCREENTONE_SHADER = `{
  ${KEY_LIGHT}
  float shade = 1.0 - smoothstep(0.2, 0.95, lit);
  float tone = smoothstep(0.04, 0.5, 1.0 - dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
  float dens = clamp(0.4 * tone + 0.7 * shade * shade, 0.0, 1.0) * (1.0 - smoothstep(0.84, 0.95, lit));
  vec2 g = mat2(0.7071, 0.7071, -0.7071, 0.7071) * (gl_FragCoord.xy / uPixel) / 4.5;
  float d = length(fract(g) - 0.5), r = 0.64 * sqrt(dens), aa = fwidth(d) + 1e-3;
  float ink = (1.0 - smoothstep(r - aa, r + aa, d)) * step(0.03, dens);
  ink = max(ink, smoothstep(0.88, 0.92, shade));
  outgoingLight = mix(uPaper, vec3(0.03), ink);
}`;

/** A Lambert material whose colour is replaced by `body` (GLSL run where the lit colour is final). */
function drawnMaterial(key, body, common = {}) {
  const m = new THREE.MeshLambertMaterial(common);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, drawnUniforms);
    sh.vertexShader = DRAWN_VS(sh.vertexShader);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${DRAWN_PARS}`)
      .replace('#include <opaque_fragment>', `${body}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

const drawn = (id, name, description, swatch, body) => materials.register({
  id, name, description, swatch,
  create: (p) => applyCommon(drawnMaterial(id, body), p),
  faces: (common) => drawnMaterial(id, body, common),
});
drawn('wash', 'Watercolour', 'Transparent washes on paper: pale where lit, pigment pooling at the edges',
  'radial-gradient(circle at 42% 38%, #f6efe2 0, #b9d8d0 30%, #7fb6a8 72%, #4f8f82 92%, #f6efe2 96%)',
  washShader({ w1: 0.28, w2: 0.34, w3: 0.3, pool: 0.5, edge: 0.88, line: 0.3, grain: 0.12, k: 1.6 }));
drawn('sumi', 'Ink wash', 'Ink on rice paper: soft gradations, blotches and dark pooled edges',
  'radial-gradient(circle at 42% 38%, #f2ede1 0, #b8b3aa 34%, #6f6b66 74%, #2c2a27 92%, #f2ede1 96%)',
  washShader({ w1: 0.32, w2: 0.48, w3: 0.45, pool: 0.85, edge: 0.84, line: 0.22, grain: 0.18, k: 1.35, soft: 0.07 }));
drawn('pencil', 'Pencil', 'Coloured-pencil hatching on paper, cross-hatched in shadow',
  'repeating-linear-gradient(60deg, #fbf9f4 0 2px, #7fb6a8 2px 3.5px), #fbf9f4',
  PENCIL_SHADER);
drawn('screentone', 'Screentone', 'Manga screentone: halftone dots for shade, solid ink in the core shadow',
  'radial-gradient(circle at 34% 30%, #fff 0 22%, transparent 24%), radial-gradient(#141414 32%, transparent 36%) 0 0 / 5px 5px, #fff',
  SCREENTONE_SHADER);

export function createMaterial(id, params = {}) {
  const m = registry.get(id) ?? registry.get('standard');
  const mat = m.create(params, { THREE });
  mat.userData.preset = m.id;
  mat.userData.params = { ...params };
  if (m.faces) mat.userData.faces = (common) => m.faces(common, { THREE });
  return mat;
}

/**
 * Apply new roughness / metalness / opacity to an existing material without recompiling its shader.
 * Returns false when the material cannot be updated in place (create a new one instead).
 */
export function updateMaterial(mat, params = {}) {
  const m = registry.get(mat?.userData?.preset);
  if (!m) return false;
  if (m.update) { if (m.update(mat, params, { THREE }) === false) return false; }
  else if (mat.userData.defaults) setCommon(mat, params);
  else return false;
  mat.userData.params = { ...params };
  return true;
}

/** True when objects behind this material should stay visible (transmission, additive or always transparent). */
export function isSeeThrough(mat) {
  return !!mat && ((mat.transmission ?? 0) > 0 || mat.blending === THREE.AdditiveBlending || !!registry.get(mat.userData?.preset)?.transparent);
}
