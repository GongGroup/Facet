/**
 * Post-processing pipeline: ambient occlusion (GTAO), drop shadows between parts, ink outlines (depth +
 * normal edge detection), depth of field, bloom, tone mapping (OutputPass), paper texture and vignette.
 * When every effect is off the viewer renders directly for maximum speed.
 *
 * The scene is always rendered over transparent black (premultiplied colour plus coverage alpha) and the
 * background is laid under it after tone mapping, so a background shows exactly the colour it was given,
 * as it does in direct rendering (tone mapping the whole frame turned white into #f0f0f0). Refractive
 * materials still see the background: a full-screen layer draws it into three.js's transmission buffer.
 *
 * Transparent renders (background mode 'transparent' or a transparent export, see setTransparent) skip
 * the background. Bloom writes over the alpha channel, so the coverage is saved before it; transparent
 * renders restore it at the end (glow keeps a matching partial alpha).
 */
import * as THREE from '../../vendor/three/three.module.js';
import { EffectComposer } from '../../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../../vendor/three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from '../../vendor/three/addons/postprocessing/Pass.js';
import { OutputPass } from '../../vendor/three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from '../../vendor/three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from '../../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from '../../vendor/three/addons/postprocessing/BokehPass.js';
import { VignetteShader } from '../../vendor/three/addons/shaders/VignetteShader.js';

/** Objects that must not take part in depth/normal-only passes (fat lines are meshes internally). */
export const skipInAuxPass = (o) => o.isLine || o.isLineSegments || o.isPoints || o.isLineSegments2 || o.isLine2 || o.userData.noInk;

function hideDuring(scene, fn) {
  const hidden = [];
  // a textured background is drawn as a 2×2 plane; with an override material it would become a quad at the origin
  const bg = scene.background;
  scene.background = bg?.isColor ? bg : null;
  scene.traverse((o) => { if (o.visible && skipInAuxPass(o)) { hidden.push(o); o.visible = false; } });
  try { return fn(); } finally { hidden.forEach((o) => { o.visible = true; }); scene.background = bg; }
}

const InkShader = {
  uniforms: {
    tDiffuse: { value: null }, tNormal: { value: null }, tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) }, thickness: { value: 1.5 }, inkColor: { value: new THREE.Color(0x111111) },
    cameraNear: { value: 0.1 }, cameraFar: { value: 1000 }, depthSensitivity: { value: 1 }, normalSensitivity: { value: 1 }, strength: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform sampler2D tDepth;
    uniform vec2 resolution; uniform float thickness; uniform vec3 inkColor;
    uniform float cameraNear; uniform float cameraFar; uniform float depthSensitivity; uniform float normalSensitivity; uniform float strength;
    varying vec2 vUv;
    float viewZ(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      #ifdef ORTHO
        return -orthographicDepthToViewZ(d, cameraNear, cameraFar);
      #else
        return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
      #endif
    }
    vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec2 px = thickness / resolution;
      float zc = viewZ(vUv);
      vec3 nc = nrm(vUv);
      float dz = 0.0, dn = 0.0;
      vec2 offs[8];
      offs[0] = vec2(px.x, 0.0); offs[1] = vec2(-px.x, 0.0); offs[2] = vec2(0.0, px.y); offs[3] = vec2(0.0, -px.y);
      offs[4] = px * 0.7071; offs[5] = -px * 0.7071; offs[6] = vec2(px.x, -px.y) * 0.7071; offs[7] = vec2(-px.x, px.y) * 0.7071;
      for (int i = 0; i < 8; i++) {
        float z = viewZ(vUv + offs[i]);
        dz = max(dz, abs(z - zc) / max(zc, 1e-3));
        dn = max(dn, 1.0 - dot(nc, nrm(vUv + offs[i])));
      }
      float edgeD = smoothstep(0.012, 0.03, dz * depthSensitivity);
      float edgeN = smoothstep(0.25, 0.55, dn * normalSensitivity);
      float edge = clamp(max(edgeD, edgeN), 0.0, 1.0) * strength;
      // ink over premultiplied colour: coverage adds up the same way
      gl_FragColor = vec4(mix(base.rgb, inkColor, edge), edge + base.a * (1.0 - edge));
    }`,
};

const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';

/** Copies the current alpha channel into its own target (no swap), for RestoreAlphaShader. */
class SaveAlphaPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1);
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } }, vertexShader: QUAD_VS,
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tDiffuse, vUv).a); }',
    }));
  }
  setSize(w, h) { this.target.setSize(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    this.quad.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    this.quad.render(renderer);
  }
  dispose() { this.target.dispose(); this.quad.material.dispose(); this.quad.dispose(); }
}

/** Puts the saved alpha back; glow over transparent pixels becomes partially opaque (premultiplied, rgb ≤ a). */
const RestoreAlphaShader = {
  uniforms: { tDiffuse: { value: null }, tAlpha: { value: null } },
  vertexShader: QUAD_VS,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tAlpha; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float a0 = texture2D(tAlpha, vUv).r;
      vec3 rgb = max(c.rgb, vec3(0.0));
      // the faint tail of wide bloom mips would otherwise tint the whole frame: fade it out
      float glow = max(rgb.r, max(rgb.g, rgb.b));
      float a = clamp(max(a0, (glow - 0.05) / 0.95), 0.0, 1.0);
      gl_FragColor = vec4(min(rgb, vec3(a)), a);
    }`,
};

/**
 * Layers for drop shadows: every part (an atom or bond instance, or a whole mesh) writes its key and its
 * depth: the depth of its centre for instanced parts, so a sphere is one flat layer like a paper disc and
 * does not shadow itself; the depth of the surface for other meshes (polyhedra). x = depth (view units),
 * y = key + 1, a = 1 where something is drawn.
 */
const LAYER_VS = `
  uniform float keyBase;
  varying float vKey; varying float vDepth;
  void main() {
    vec4 c = vec4(0.0, 0.0, 0.0, 1.0), p = vec4(position, 1.0);
    vKey = keyBase;
    #ifdef USE_INSTANCING
      c = instanceMatrix * c; p = instanceMatrix * p;
      vKey += float(gl_InstanceID);
      vDepth = -(modelViewMatrix * c).z;
    #else
      vDepth = -(modelViewMatrix * p).z;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * p;
  }`;
const LAYER_FS = 'varying float vKey; varying float vDepth; void main() { gl_FragColor = vec4(vDepth, vKey + 1.0, 0.0, 1.0); }';

/**
 * Drop shadows: a pixel is shadowed by the parts that lie in front of it (another key, nearer by more than
 * `bias`) one `offset` towards the light; a disc of taps softens the edge. Parts darken towards the shadow
 * colour; over the background the shadow becomes premultiplied coverage, so the output pass lays the
 * background under it and transparent exports keep it.
 */
const DropShadowShader = {
  uniforms: {
    tDiffuse: { value: null }, tLayer: { value: null }, offset: { value: new THREE.Vector2() }, radius: { value: new THREE.Vector2() },
    opacity: { value: 0.35 }, color: { value: new THREE.Color() }, bias: { value: 0.05 },
  },
  vertexShader: QUAD_VS,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tLayer;
    uniform vec2 offset; uniform vec2 radius; uniform float opacity; uniform vec3 color; uniform float bias;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec4 me = texture2D(tLayer, vUv);
      float depth = me.a > 0.5 ? me.x : 1e20;
      float spin = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
      float s = 0.0;
      for (int i = 0; i < 16; i++) {
        float a = float(i) * 2.3999632 + spin, rr = sqrt((float(i) + 0.5) / 16.0);
        vec4 o = texture2D(tLayer, vUv - offset + vec2(cos(a), sin(a)) * rr * radius);
        s += (o.a > 0.5 && abs(o.y - me.y) > 0.5 && o.x < depth - bias) ? 1.0 : 0.0;
      }
      float k = s / 16.0 * opacity;
      gl_FragColor = vec4(c.rgb * (1.0 - k) + color * k, c.a + (1.0 - c.a) * k);
    }`,
};

/**
 * Tone mapping (as OutputPass) followed by the background: colour = T(premultiplied scene) + (1 − coverage) · bg,
 * in linear light, then the output transfer. bgMode 0 keeps the alpha (transparent renders), 1 lays a
 * colour under the scene, 2 a texture (gradients, sRGB, so they sample linear). With bloom the coverage
 * comes from the alpha saved before it.
 */
const OUTPUT_FS = `
  precision highp float;
  uniform sampler2D tDiffuse; uniform sampler2D tAlpha; uniform sampler2D tBg;
  uniform float savedAlpha; uniform float bgMode; uniform vec3 bgColor; uniform float paper; uniform float aspect;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  varying vec2 vUv;
  float pHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float pNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);
    #ifdef LINEAR_TONE_MAPPING
      gl_FragColor.rgb = LinearToneMapping(gl_FragColor.rgb);
    #elif defined( REINHARD_TONE_MAPPING )
      gl_FragColor.rgb = ReinhardToneMapping(gl_FragColor.rgb);
    #elif defined( CINEON_TONE_MAPPING )
      gl_FragColor.rgb = CineonToneMapping(gl_FragColor.rgb);
    #elif defined( ACES_FILMIC_TONE_MAPPING )
      gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
    #elif defined( AGX_TONE_MAPPING )
      gl_FragColor.rgb = AgXToneMapping(gl_FragColor.rgb);
    #elif defined( NEUTRAL_TONE_MAPPING )
      gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);
    #endif
    if (bgMode > 0.5) {
      float a = clamp(savedAlpha > 0.5 ? texture2D(tAlpha, vUv).r : gl_FragColor.a, 0.0, 1.0);
      vec3 bg = bgMode > 1.5 ? texture2D(tBg, vUv).rgb : bgColor;
      gl_FragColor = vec4(gl_FragColor.rgb + (1.0 - a) * bg, 1.0);
    }
    if (paper > 0.0) {
      // paper: fine tooth, short fibres and uneven sizing, laid out in picture units so exports look the same
      vec2 q = vUv * vec2(aspect, 1.0) * 900.0;
      float tooth = pNoise(q / 2.5) * 0.5 + pNoise(q / 6.0) * 0.3 + pNoise(q * 0.8) * 0.2;
      float fibre = pNoise(vec2(q.x * 0.09 + q.y * 0.03, q.y * 0.55 - q.x * 0.17));
      float cloud = pNoise(q / 110.0) * 0.6 + pNoise(q / 37.0) * 0.4;
      gl_FragColor.rgb *= 1.0 + paper * ((tooth - 0.5) * 0.11 + (fibre - 0.5) * 0.06 + (cloud - 0.5) * 0.07);
    }
    #ifdef SRGB_TRANSFER
      gl_FragColor = sRGBTransferOETF(gl_FragColor);
    #endif
  }`;

class BackgroundOutputPass extends OutputPass {
  constructor() {
    super();
    Object.assign(this.uniforms, { tAlpha: { value: null }, tBg: { value: null }, savedAlpha: { value: 0 }, bgMode: { value: 0 }, bgColor: { value: new THREE.Color() }, paper: { value: 0 }, aspect: { value: 1 } });
    this.material.fragmentShader = OUTPUT_FS;
  }
}

/** Sets the background uniforms (bgMode, bgColor, tBg) for a scene background: null, a Color or a texture. */
function setBackgroundUniforms(u, bg) {
  u.bgMode.value = !bg ? 0 : bg.isColor ? 1 : 2;
  if (bg?.isColor) u.bgColor.value.copy(bg);
  u.tBg.value = bg?.isTexture ? bg : null;
}

/**
 * A full-screen layer that stands in for scene.background while the scene renders over transparent black:
 * it draws nothing into the frame itself (`target`) but paints the background into every other target —
 * three.js's transmission buffer, which glass refracts.
 */
function makeBackgroundLayer() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { tBg: { value: null }, bgMode: { value: 0 }, bgColor: { value: new THREE.Color() }, on: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tBg; uniform float bgMode; uniform vec3 bgColor; uniform float on; varying vec2 vUv;
      void main() { vec3 c = bgMode > 1.5 ? texture2D(tBg, vUv).rgb : bgColor; gl_FragColor = vec4(c * on, on); }`,
    depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.name = 'background-layer';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1e6;
  mesh.visible = false;
  mesh.userData.noInk = true;
  mesh.raycast = () => {};
  mesh.target = null;
  mesh.onBeforeRender = (renderer) => {
    const on = renderer.getRenderTarget() === mesh.target ? 0 : 1;
    if (mat.uniforms.on.value !== on) { mat.uniforms.on.value = on; mat.uniformsNeedUpdate = true; }
  };
  return mesh;
}

/**
 * GTAO blend without negative values: ao^intensity (the stock mix() went negative above 1 → bright fringes after
 * tone mapping). A five-tap rotated blur of about 1.3 px takes out the per-pixel grain the denoiser leaves in
 * contact creases and along silhouettes, which otherwise reads as dotted speckle where spheres touch.
 */
const AO_BLEND_FS = `
  uniform float intensity; uniform sampler2D tDiffuse; varying vec2 vUv;
  void main() {
    vec2 px = 1.0 / vec2(textureSize(tDiffuse, 0));
    vec4 texel = texture2D(tDiffuse, vUv);
    vec3 s = texel.rgb;
    s += texture2D(tDiffuse, vUv + px * vec2( 1.2,  0.4)).rgb;
    s += texture2D(tDiffuse, vUv + px * vec2(-1.2, -0.4)).rgb;
    s += texture2D(tDiffuse, vUv + px * vec2( 0.4, -1.2)).rgb;
    s += texture2D(tDiffuse, vUv + px * vec2(-0.4,  1.2)).rgb;
    vec3 ao = clamp(s * 0.2, 0.0, 1.0);
    gl_FragColor = vec4(pow(ao, vec3(max(intensity, 0.0))), texel.a);
  }`;

/** Largest AO radius (Å) the slider can reach in practice; beyond it GTAO halos and banding appear. */
export const AO_MAX_RADIUS = 1.6;

export class PostPipeline {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.settings = null;
    this.size = new THREE.Vector2(1, 1);
    this.normalMaterial = new THREE.MeshNormalMaterial();
    this.normalTarget = null;
    this.active = false;
    this.transparent = false;
    this.bloomScale = 1;
    this.bgLayer = makeBackgroundLayer();
    scene.add(this.bgLayer);
    this.viewHeight = 10;   // Å visible at the focus distance (drop-shadow offsets are given in Å)
    this.layerTarget = null;
    this._layerMats = [];   // one layer material per drawn mesh, reused frame to frame
  }

  /** Height of the view (Å) at the focus distance; the viewer updates it as the camera moves. */
  setViewHeight(h) { this.viewHeight = h > 0 ? h : this.viewHeight; }

  /** The frame is composited over something (transparent background or export): keep alpha, leave out the background. */
  setTransparent(on) {
    this.transparent = !!on;
    if (this.restoreAlpha) this.restoreAlpha.enabled = this.transparent;
  }

  /** Bloom spread multiplier (the viewer lowers it when the model fills the frame). */
  setBloomScale(k) {
    this.bloomScale = k;
    if (this.bloom && this.settings?.bloom) this.bloom.radius = (this.settings.bloom.radius ?? 0.4) * k;
  }

  /**
   * Point the existing passes at another camera (perspective ⇄ orthographic) instead of rebuilding
   * them: only a few defines change, and three keeps both shader variants of a material compiled, so
   * switching back and forth (axis views) costs no rebuild and, after the first switch, no recompile.
   */
  setCamera(camera) {
    this.camera = camera;
    if (!this.composer) return;
    const persp = camera.isPerspectiveCamera ? 1 : 0;
    const define = (mat, key, on) => {
      if (!mat) return;
      const cur = mat.defines?.[key];
      if (on === null) { if (cur === undefined) return; delete mat.defines[key]; }
      else if (cur === on) return;
      else (mat.defines ??= {})[key] = on;
      mat.needsUpdate = true;
    };
    if (this.renderPass) this.renderPass.camera = camera;
    if (this.gtao) {
      this.gtao.camera = camera;   // near/far and matrices are read from it on every render
      define(this.gtao.gtaoMaterial, 'PERSPECTIVE_CAMERA', persp);
      define(this.gtao.depthRenderMaterial, 'PERSPECTIVE_CAMERA', persp);
    }
    if (this.bokeh) {
      this.bokeh.camera = camera;
      define(this.bokeh.materialBokeh, 'PERSPECTIVE_CAMERA', persp);
    }
    if (this.ink) define(this.ink.material, 'ORTHO', persp ? null : 1);
  }

  setSize(w, h) {
    this.size.set(w, h);
    const pr = this.renderer.getPixelRatio();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    if (this.normalTarget) this.normalTarget.setSize(Math.floor(w * pr), Math.floor(h * pr));
    if (this.layerTarget) this.layerTarget.setSize(Math.floor(w * pr), Math.floor(h * pr));
    if (this.ink) this.ink.uniforms.resolution.value.set(w * pr, h * pr);
    if (this.output) this.output.uniforms.aspect.value = w / Math.max(1, h);
    if (this.bokeh) this.bokeh.uniforms.aspect.value = w / Math.max(1, h);
  }

  dispose() {
    this.composer?.dispose?.();
    this.composer?.renderTarget1?.dispose(); this.composer?.renderTarget2?.dispose();
    this.gtao?.dispose?.(); this.bloom?.dispose?.(); this.saveAlpha?.dispose();
    this.normalTarget?.dispose(); this.layerTarget?.dispose();
    this._layerMats.forEach((m) => m.dispose()); this._layerMats = [];
    this.composer = null; this.renderPass = this.gtao = this.bloom = this.ink = this.bokeh = this.vignette = this.output = this.drop = null;
    this.normalTarget = this.layerTarget = null;
    this.saveAlpha = this.restoreAlpha = null; this._aoState = null;
  }

  /** (Re)build passes. Cheap uniform changes are applied in place when the pass set is unchanged. */
  configure(post, force = false) {
    // the camera type is not part of the pass set: setCamera() retargets the passes in place
    const keys = ['ao', 'outline', 'bloom', 'dof', 'vignette', 'dropShadow', 'paper'];
    const sig = JSON.stringify(keys.map((k) => !!post[k]?.enabled));
    this.settings = post;
    const any = keys.some((k) => post[k]?.enabled);
    this.active = !!any;
    if (!any) { if (this.composer) this.dispose(); this._sig = sig; return; }
    if (force || sig !== this._sig || !this.composer) {
      this.dispose();
      this._build(post);
      this._sig = sig;
    }
    this._update(post);
  }

  _build(post) {
    const { renderer, scene, camera } = this;
    const pr = renderer.getPixelRatio();
    const w = Math.max(1, this.size.x), h = Math.max(1, this.size.y);
    const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (post.ao?.enabled) {
      this.gtao = new GTAOPass(scene, camera, w * pr, h * pr);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      const origOverride = this.gtao.overrideVisibility.bind(this.gtao), origRestore = this.gtao.restoreVisibility.bind(this.gtao);
      this.gtao.overrideVisibility = () => {
        origOverride();
        this._bg = this.scene.background;
        if (!this._bg?.isColor) this.scene.background = null;
        this.scene.traverse((o) => { if (skipInAuxPass(o)) o.visible = false; });
      };
      this.gtao.restoreVisibility = () => { origRestore(); this.scene.background = this._bg; };
      this.gtao.blendMaterial.fragmentShader = AO_BLEND_FS;
      this.gtao.blendMaterial.needsUpdate = true;
      this.composer.addPass(this.gtao);
    }
    if (post.dropShadow?.enabled) {
      this.layerTarget = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.drop = new ShaderPass(DropShadowShader);
      this.drop.uniforms.tLayer.value = this.layerTarget.texture;
      this.composer.addPass(this.drop);
    }
    if (post.outline?.enabled) {
      this.normalTarget = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType });
      this.normalTarget.depthTexture = new THREE.DepthTexture(w * pr, h * pr);
      this.normalTarget.depthTexture.type = THREE.UnsignedIntType;
      this.ink = new ShaderPass(InkShader);
      if (camera.isOrthographicCamera) this.ink.material.defines.ORTHO = 1;
      this.ink.uniforms.tNormal.value = this.normalTarget.texture;
      this.ink.uniforms.tDepth.value = this.normalTarget.depthTexture;
      this.ink.uniforms.resolution.value.set(w * pr, h * pr);
      this.composer.addPass(this.ink);
    }
    if (post.dof?.enabled) {
      this.bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.002, maxblur: 0.008 });
      // the stock pass assumes a perspective camera and reads camera.aspect, which an orthographic one lacks
      this.bokeh.materialBokeh.defines.PERSPECTIVE_CAMERA = camera.isPerspectiveCamera ? 1 : 0;
      // blur the coverage with the (premultiplied) colour instead of making every pixel opaque
      this.bokeh.materialBokeh.fragmentShader = this.bokeh.materialBokeh.fragmentShader.replace('gl_FragColor.a = 1.0;', '');
      this.bokeh.uniforms.aspect.value = w / h;
      const bokehRender = this.bokeh.render.bind(this.bokeh);
      this.bokeh.render = (...args) => hideDuring(this.scene, () => bokehRender(...args));
      this.composer.addPass(this.bokeh);
    }
    if (post.bloom?.enabled) {
      this.saveAlpha = new SaveAlphaPass();
      this.composer.addPass(this.saveAlpha);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.4, 0.8);
      this.composer.addPass(this.bloom);
    }
    this.output = new BackgroundOutputPass();
    this.output.uniforms.aspect.value = w / h;
    this.output.uniforms.savedAlpha.value = this.saveAlpha ? 1 : 0;
    this.output.uniforms.tAlpha.value = this.saveAlpha?.target.texture ?? null;
    this.composer.addPass(this.output);
    if (post.vignette?.enabled) {
      this.vignette = new ShaderPass(VignetteShader);
      this.composer.addPass(this.vignette);
    }
    if (this.saveAlpha) {
      this.restoreAlpha = new ShaderPass(RestoreAlphaShader);
      this.restoreAlpha.uniforms.tAlpha.value = this.saveAlpha.target.texture;
      this.composer.addPass(this.restoreAlpha);
    }
    this.setTransparent(this.transparent);
  }

  _update(post) {
    if (this.gtao) {
      // radius in Å, kept in an artefact-free range; thickness / fall-off / denoising follow it
      const r = Math.min(AO_MAX_RADIUS, Math.max(0.05, +(post.ao.radius ?? 0.6) || 0.6));
      const fallOff = Math.min(1, 0.4 + 0.4 * r);
      const g = { radius: r, distanceExponent: 1.4, thickness: Math.min(r, 1), scale: 1, samples: post.ao.samples ?? 16, screenSpaceRadius: false };
      if (this._aoState?.fallOff !== fallOff) g.distanceFallOff = fallOff;   // this one forces a shader refresh
      this.gtao.updateGtaoMaterial(g);
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6 + 4 * r, rings: 2, samples: r > 1 ? 24 : 16 });
      this.gtao.blendIntensity = Math.max(0, post.ao.intensity ?? 1);
      this._aoState = { fallOff };
    }
    if (this.ink) {
      const o = post.outline;
      this.ink.uniforms.thickness.value = o.thickness ?? 1.5;
      this.ink.uniforms.inkColor.value.set(o.color ?? '#111111').convertSRGBToLinear();
      this.ink.uniforms.depthSensitivity.value = o.sensitivity ?? 1;
      this.ink.uniforms.normalSensitivity.value = o.creases === false ? 0 : (o.sensitivity ?? 1);
      this.ink.uniforms.strength.value = o.strength ?? 1;
    }
    if (this.bloom) {
      this.bloom.strength = post.bloom.strength ?? 0.6;
      this.bloom.radius = (post.bloom.radius ?? 0.4) * this.bloomScale;
      this.bloom.threshold = post.bloom.threshold ?? 0.8;
    }
    if (this.bokeh) {
      this.bokeh.uniforms.aperture.value = (post.dof.aperture ?? 2) * 0.001;
      this.bokeh.uniforms.maxblur.value = post.dof.maxblur ?? 0.01;
    }
    if (this.vignette) {
      this.vignette.uniforms.offset.value = post.vignette.offset ?? 1.0;
      this.vignette.uniforms.darkness.value = post.vignette.darkness ?? 1.1;
    }
    if (this.drop) {
      const d = post.dropShadow;
      this.drop.uniforms.opacity.value = Math.min(1, Math.max(0, d.opacity ?? 0.35));
      this.drop.uniforms.color.value.set(d.color ?? '#1c1a17').convertSRGBToLinear();
    }
    this.output.uniforms.paper.value = post.paper?.enabled ? Math.max(0, post.paper.strength ?? 0.5) : 0;
  }

  /** Render every part's key and depth into the layer target (drop shadows). */
  _renderLayers(cam) {
    const r = this.renderer, scene = this.scene, swapped = [];
    hideDuring(scene, () => {
      let key = 0, i = 0;
      scene.traverseVisible((o) => {
        if (!o.isMesh || o === this.bgLayer) return;
        const mat = this._layerMats[i] ??= new THREE.ShaderMaterial({ uniforms: { keyBase: { value: 0 } }, vertexShader: LAYER_VS, fragmentShader: LAYER_FS, side: THREE.DoubleSide });
        i++;
        mat.uniforms.keyBase.value = key;
        key += (o.isInstancedMesh ? o.count : 1) + 1;
        swapped.push([o, o.material]);
        o.material = mat;
      });
      // a colour background would clear the target to an opaque colour: nothing may be drawn but the parts
      const fog = scene.fog, bg = scene.background, clear = r.getClearColor(new THREE.Color()), clearAlpha = r.getClearAlpha();
      scene.fog = null; scene.background = null;
      r.setClearColor(0x000000, 0);
      try {
        r.setRenderTarget(this.layerTarget);
        r.clear();
        r.render(scene, cam);
      } finally {
        r.setRenderTarget(null);
        r.setClearColor(clear, clearAlpha);
        scene.fog = fog; scene.background = bg;
        swapped.forEach(([o, m]) => { o.material = m; });
      }
    });
    // offsets are given in Å: convert with the height of the view at the focus distance
    const d = this.settings.dropShadow, H = Math.max(1e-6, this.viewHeight), aspect = this.size.x / Math.max(1, this.size.y);
    const a = ((d.angle ?? -55) * Math.PI) / 180, dist = Math.max(0, d.distance ?? 0.3) / H, soft = Math.max(0, d.softness ?? 0.25) / H;
    this.drop.uniforms.offset.value.set((Math.cos(a) * dist) / aspect, Math.sin(a) * dist);
    this.drop.uniforms.radius.value.set(soft / aspect, soft);
  }

  setFocus(distance) {
    if (this.bokeh) this.bokeh.uniforms.focus.value = distance;
  }

  render() {
    const cam = this.camera, r = this.renderer;
    if (this.drop) this._renderLayers(cam);
    if (this.ink) {
      const bg = this.scene.background, ov = this.scene.overrideMaterial, fog = this.scene.fog;
      hideDuring(this.scene, () => {
        this.scene.background = null; this.scene.overrideMaterial = this.normalMaterial; this.scene.fog = null;
        const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
        r.setClearColor(0x7f7fff, 1);
        r.setRenderTarget(this.normalTarget);
        r.clear();
        r.render(this.scene, cam);
        r.setRenderTarget(null);
        r.setClearColor(prevClear, prevAlpha);
        this.scene.background = bg; this.scene.overrideMaterial = ov; this.scene.fog = fog;
      });
      this.ink.uniforms.cameraNear.value = cam.near;
      this.ink.uniforms.cameraFar.value = cam.far;
    }
    // the scene goes over transparent black; the output pass lays the background under it after tone mapping
    const background = this.transparent ? null : this.scene.background;
    setBackgroundUniforms(this.output.uniforms, background);
    if (!background) { this.composer.render(); return; }
    const layer = this.bgLayer;
    setBackgroundUniforms(layer.material.uniforms, background);
    layer.target = this.composer.readBuffer;   // RenderPass draws the frame here
    layer.visible = true;
    const clear = r.getClearColor(new THREE.Color()), clearAlpha = r.getClearAlpha();
    this.scene.background = null;
    r.setClearColor(0x000000, 0);
    try { this.composer.render(); } finally {
      this.scene.background = background;
      r.setClearColor(clear, clearAlpha);
      layer.visible = false;
    }
  }
}
