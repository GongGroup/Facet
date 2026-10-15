/**
 * Post-processing pipeline: ambient occlusion (GTAO), ink outlines (depth + normal edge detection),
 * depth of field, bloom, tone mapping (OutputPass) and vignette. When every effect is off the
 * viewer renders directly for maximum speed.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { EffectComposer } from '../../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../../vendor/three/addons/postprocessing/ShaderPass.js';
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
  }

  setCamera(camera) { this.camera = camera; if (this.settings) this.configure(this.settings, true); }

  setSize(w, h) {
    this.size.set(w, h);
    const pr = this.renderer.getPixelRatio();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    if (this.normalTarget) this.normalTarget.setSize(Math.floor(w * pr), Math.floor(h * pr));
    if (this.ink) this.ink.uniforms.resolution.value.set(w * pr, h * pr);
  }

  dispose() {
    this.composer?.dispose?.();
    this.composer?.renderTarget1?.dispose(); this.composer?.renderTarget2?.dispose();
    this.gtao?.dispose?.(); this.bloom?.dispose?.();
    this.normalTarget?.dispose();
    this.composer = null; this.gtao = this.bloom = this.ink = this.bokeh = this.vignette = null; this.normalTarget = null;
  }

  /** (Re)build passes. Cheap uniform changes are applied in place when the pass set is unchanged. */
  configure(post, force = false) {
    const sig = JSON.stringify([!!post.ao?.enabled, !!post.outline?.enabled, !!post.bloom?.enabled, !!post.dof?.enabled, !!post.vignette?.enabled, this.camera.isOrthographicCamera]);
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
    this.composer.addPass(new RenderPass(scene, camera));
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
    if (post.dof?.enabled) {
      this.bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.002, maxblur: 0.008 });
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
  }

  _update(post) {
    if (this.gtao) {
      const r = post.ao.radius ?? 0.6;
      this.gtao.updateGtaoMaterial({ radius: r, distanceExponent: 1.4, thickness: r * 1.5, scale: 1, samples: post.ao.samples ?? 16, distanceFallOff: 1, screenSpaceRadius: false });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.gtao.blendIntensity = post.ao.intensity ?? 1;
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
      this.bloom.radius = post.bloom.radius ?? 0.4;
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
