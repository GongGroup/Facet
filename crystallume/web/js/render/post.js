/**
 * Post-processing pipeline: ambient occlusion (GTAO), ink outlines (depth + normal edge detection),
 * depth of field, bloom, tone mapping (OutputPass) and vignette. When every effect is off the
 * viewer renders directly for maximum speed.
 *
 * Transparent renders (background mode 'transparent' or a transparent export, see setTransparent):
 * bloom and depth of field write opaque pixels, so the scene alpha is saved before them and restored
 * at the end (glow keeps a matching partial alpha).
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
      gl_FragColor = vec4(mix(base.rgb, inkColor, edge), max(base.a, edge));
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
  }

  /** The frame is composited over something (transparent background or export): keep alpha through bloom / DOF. */
  setTransparent(on) {
    this.transparent = !!on;
    const need = this.transparent && !!(this.bloom || this.bokeh);
    if (this.saveAlpha) this.saveAlpha.enabled = need;
    if (this.restoreAlpha) this.restoreAlpha.enabled = need;
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
    if (this.ink) this.ink.uniforms.resolution.value.set(w * pr, h * pr);
    if (this.bokeh) this.bokeh.uniforms.aspect.value = w / Math.max(1, h);
  }

  dispose() {
    this.composer?.dispose?.();
    this.composer?.renderTarget1?.dispose(); this.composer?.renderTarget2?.dispose();
    this.gtao?.dispose?.(); this.bloom?.dispose?.(); this.saveAlpha?.dispose();
    this.normalTarget?.dispose();
    this.composer = null; this.renderPass = this.gtao = this.bloom = this.ink = this.bokeh = this.vignette = null; this.normalTarget = null;
    this.saveAlpha = this.restoreAlpha = null; this._aoState = null;
  }

  /** (Re)build passes. Cheap uniform changes are applied in place when the pass set is unchanged. */
  configure(post, force = false) {
    // the camera type is not part of the pass set: setCamera() retargets the passes in place
    const sig = JSON.stringify([!!post.ao?.enabled, !!post.outline?.enabled, !!post.bloom?.enabled, !!post.dof?.enabled, !!post.vignette?.enabled]);
    this.settings = post;
    const any = post.ao?.enabled || post.outline?.enabled || post.bloom?.enabled || post.dof?.enabled || post.vignette?.enabled;
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
    if (post.dof?.enabled || post.bloom?.enabled) {
      this.saveAlpha = new SaveAlphaPass();
      this.composer.addPass(this.saveAlpha);
    }
    if (post.dof?.enabled) {
      this.bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.002, maxblur: 0.008 });
      // the stock pass assumes a perspective camera and reads camera.aspect, which an orthographic one lacks
      this.bokeh.materialBokeh.defines.PERSPECTIVE_CAMERA = camera.isPerspectiveCamera ? 1 : 0;
      this.bokeh.uniforms.aspect.value = w / h;
      const bokehRender = this.bokeh.render.bind(this.bokeh);
      this.bokeh.render = (...args) => hideDuring(this.scene, () => bokehRender(...args));
      this.composer.addPass(this.bokeh);
    }
    if (post.bloom?.enabled) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.4, 0.8);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
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
  }

  setFocus(distance) {
    if (this.bokeh) this.bokeh.uniforms.focus.value = distance;
  }

  render() {
    const cam = this.camera;
    if (this.ink) {
      const r = this.renderer;
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
    this.composer.render();
  }
}
