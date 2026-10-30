/**
 * Viewer — owns the WebGL renderer, cameras, controls, light rig, post-processing and the drawn
 * representation of one Structure. Driven entirely by a `scene` settings object (see settings.js).
 *
 * Events:
 *   'hover'       {index, x, y}                       pointer over a displayed atom (index −1: none)
 *   'atomclick'   {index, mode, shiftKey, x, y}       click without drag (index −1: empty space); mode is
 *                                                     'replace', 'add' (Shift) or 'toggle' (Ctrl/⌘), and
 *                                                     shiftKey is true for the last two
 *   'atomdblclick' {index, mode, altKey, x, y}        double-click on a displayed atom (Alt: the element)
 *   'atomcontext' {index, x, y, clientX, clientY}     right-click without drag (index −1: empty space);
 *                                                     x/y are relative to the viewport element
 *   'boxselect'   {indices, mode, add, shape}         a rectangle (drag) or lasso (Q+drag) finished with tool
 *                                                     'select'; indices are unique source (structure) indices,
 *                                                     add = mode is not 'replace', shape 'rect' | 'lasso'
 *   'frame' i | 'play' bool | 'selection' srcIndices | 'render' | 'measure' list | 'camera' | 'model' model | 'error' err
 *
 * Mouse, as in Materials Studio: left button selects (see _setupPointer), right-drag rotates, middle-drag
 * pans, the wheel or both buttons together zoom. Without a middle button (trackpads, a Magic Mouse) Alt/⌥+drag
 * pans, and on a Mac Control+drag rotates as a right-drag does. Touch, and a pen tip without modifiers: one
 * finger rotates, two pan and pinch, a tap selects.
 * Keyboard, while the canvas has focus: arrows turn the model 45° about the screen axes, Shift/Alt+arrows
 * pan, +/− zoom; those keys do not reach the global shortcuts. `holdKeys` (X, Y, Z, R, Q, E) change
 * what a drag does while held; `heldKeyUsed(k)` tells the shortcut router that a drag used one, so that
 * releasing it does not also run the key's own shortcut.
 * `tool` is the app's active tool ('select' | 'measure' | …); box and lasso selection run only with 'select'.
 * The app keeps it current by setting `toolProvider = () => app.tool` (or by assigning `tool`).
 * `helpers` = the building blocks styles receive as ctx.helpers (buildAtoms, buildBonds, …).
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
import { styles, atomRadius, segmentsFor, autoPolyhedraCenters, buildAtoms, buildBonds, buildLines, buildPolyhedra, writeAtomMatrices, writeBondMatrices } from './styles.js';
import { computeColors } from './colors.js';
import { createMaterial, updateMaterial, isSeeThrough, materials } from './materials.js';
import { LightRig } from './lighting.js';
import { PostPipeline } from './post.js';
import { makeBackground } from './background.js';
import { AxisGizmo, axisColors } from './gizmo.js';
import { makeScene } from './settings.js';
import { drawLegends } from './legend.js';

const sig = (o) => JSON.stringify(o ?? null);
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const KEY_TURN = 45, KEY_PAN = 40, KEY_ZOOM = 1.2;
/** A press that moves less than this (CSS px) is a click; two clicks this close in time and place are a double-click. */
const CLICK_PX = 5, DOUBLE_MS = 450, DOUBLE_PX = 6;
/** Keys held down to change what a drag does: X/Y/Z + right-drag, R (zoom box), Q (lasso), E (rectangle) + left-drag. */
const HOLD_KEYS = new Set(['x', 'y', 'z', 'r', 'q', 'e']);
const SVG_NS = 'http://www.w3.org/2000/svg';
/** A Mac, where Control-click is the right (secondary) click; the same test as ui/keys.js. */
const IS_MAC = /mac|iphone|ipad/i.test(globalThis.navigator?.platform ?? globalThis.navigator?.userAgent ?? '');
/** Selection mode of a click or drag from its modifier keys: Ctrl/⌘ toggles, Shift adds. */
const selectMode = (e) => (e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace');
/** Even-odd test of a point against a polygon [[x, y], …]. */
function inPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Above this many drawn atoms the cell letters clear the atoms' bounding box instead of each atom. */
const LETTER_DISC_LIMIT = 20000;

/**
 * Selection / hover halo: a Fresnel rim on the back faces of a slightly larger sphere, so the atom
 * keeps its own colour and only its outline lights up in the accent colour.
 */
function rimMaterial(strength) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color('#e8a33d') }, strength: { value: strength } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          mv = instanceMatrix * mv;
          n = mat3(instanceMatrix) * n;
        #endif
        mv = modelViewMatrix * mv;
        vN = normalize(normalMatrix * n);
        vV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color; uniform float strength;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float d = abs(dot(normalize(vN), normalize(vV)));
        float a = pow(1.0 - d, 2.0) * smoothstep(0.0, 0.18, d) * strength;
        gl_FragColor = vec4(color, clamp(a, 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.BackSide, toneMapped: false,
  });
}

export class Viewer extends Emitter {
  constructor(container) {
    super();
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const el = this.renderer.domElement;
    el.className = 'viewer-canvas';
    el.tabIndex = 0;
    el.setAttribute('role', 'application');
    el.setAttribute('aria-label', '3D structure view. Arrow keys rotate by 45 degrees, Shift or Alt+arrows pan, +/- zoom');
    container.appendChild(el);
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
    // contact-shadow floor; oriented to the view "up" in _updateFloor
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22, side: THREE.DoubleSide }));
    this.floor.receiveShadow = true;
    this.floor.visible = false;
    this.floor.userData.noInk = true;
    this.scene3.add(this.floor);

    this.structure = null;
    this.settings = makeScene();
    this.model = null;
    this.rep = null;
    this.cellObj = null;
    this.measureObj = null;
    this.atomMaterial = null;
    this.bondMaterial = null;
    this.selection = new Set();
    this.hoverIndex = -1;
    this.measurements = [];
    this.bounds = { center: new THREE.Vector3(), radius: 5 };
    this.playing = false;
    this.fps = 12;
    this._sigs = {};
    this._dirty = true;
    this._camAnim = null;
    this._trash = [];
    this._tempOrtho = false;
    this._viewUp = null;
    this.width = 1; this.height = 1;
    /** Space (CSS px) that fitting keeps clear on each side, e.g. for floating toolbars: {x, y}. */
    this.fitMargins = { x: 0, y: 0 };
    this.resolution = new THREE.Vector2(1, 1);
    this._tool = 'select';
    this.toolProvider = null;
    this.holdKeys = HOLD_KEYS;
    this._held = new Set();       // hold keys down now
    this._heldUsed = new Set();   // hold keys that took part in a press since they went down
    this._ptrs = new Map();       // pointerId → press being tracked (see _ptrDown)
    this._lastTap = null;
    this.helpers = { buildAtoms, buildBonds, buildLines, buildPolyhedra, atomRadius, segmentsFor };

    // shared halo resources: one geometry, one material and one growable instanced mesh per kind
    this._haloGeo = new THREE.SphereGeometry(1, 32, 20);
    this._halo = { select: this._makeHalo(rimMaterial(2.0)), hover: this._makeHalo(rimMaterial(0.9)) };

    this._setupControls('orbit');
    this._setupPointer();
    this._setupKeys();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();
    this._last = performance.now();
    this._frameAcc = 0;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    el.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.emit('error', new Error('The graphics context was lost. Reload the page to continue.')); });
  }

  /** The active tool: from `toolProvider()` when the app set one, otherwise the value last assigned. */
  get tool() {
    const t = typeof this.toolProvider === 'function' ? this.toolProvider() : null;
    return t || this._tool;
  }
  set tool(t) { this._tool = t || 'select'; }

  // ------------------------------------------------------------------ setup
  _setupControls(kind) {
    const old = this.controls;
    const target = old ? old.target.clone() : new THREE.Vector3();
    old?.dispose();
    if (kind === 'trackball') {
      const c = new TrackballControls(this.camera, this.renderer.domElement);
      c.rotateSpeed = 3; c.zoomSpeed = 1.4; c.dynamicDampingFactor = 0.15;
      c.keys = [];   // its A/S/D hold keys would change what a drag does
      // its pan ran several times too far (its damping repeats the whole offset each frame) and crawled in an
      // orthographic view: the viewer pans instead, for the mouse and for two fingers (_ptrMove)
      c.noPan = true;
      this.controls = c;
    } else {
      const c = new OrbitControls(this.camera, this.renderer.domElement);
      c.enableDamping = true; c.dampingFactor = 0.12; c.rotateSpeed = 0.9; c.zoomSpeed = 1.1; c.screenSpacePanning = true;
      this.controls = c;
    }
    // right-drag rotates, as in Materials Studio; the middle button and Alt never reach the controls and the
    // left button only for a pen tip or a Mac's Control-drag (_ptrDown); _rotateWith adjusts this per press
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.target.copy(target);
    this.controlsKind = kind;
    this._syncControlsUp();
    this.controls.addEventListener('change', () => { this._dirty = true; this.emit('camera'); });
    this.controls.addEventListener('start', () => {
      this._camAnim = null;
      // an axis view's temporary orthographic camera lasts until the next free rotation
      const st = this.controls.state;
      if (this._tempOrtho && (st === 0 || st === 3)) this._leaveTempOrtho();
    });
  }

  /** OrbitControls orbits around the "up" it saw when created; keep it in step with camera.up. */
  _syncControlsUp() {
    const c = this.controls;
    if (!c?._quat || !c._quatInverse) return;
    const up = this.camera.up.clone();
    if (up.lengthSq() < 1e-10) return;
    c._quat.setFromUnitVectors(up.normalize(), new THREE.Vector3(0, 1, 0));
    c._quatInverse.copy(c._quat).invert();
  }

  /**
   * Mouse buttons as in Materials Studio. Left: click selects (Shift adds, Ctrl/⌘ toggles, empty space
   * clears), drag draws a selection rectangle (Q held: a lasso; R held: a box to zoom into), double-click
   * selects the bonded fragment (Alt: every atom of the element). Right: drag rotates (Alt: pans; X/Y/Z
   * held: turns about that screen axis), click opens the atom menu. Middle-drag pans; the wheel, or the
   * left and right buttons dragged together, zoom. For trackpads and mice without a middle button, Alt/⌥
   * + left-drag pans too, and on a Mac Control works as the right button (Control+drag rotates,
   * Control-click opens the menu), as Control-click does everywhere on a Mac. Touch and a pen tip without
   * modifiers keep the camera controls' gestures, and a tap selects.
   */
  _setupPointer() {
    const el = this.renderer.domElement;
    let raf = 0, lastMove = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });   // no autoscroll when the middle button pans
    // the controls are off during a press (a pan with the wheel button held, a box…), so they leave the wheel alone:
    // a nudge of the wheel must not scroll the page around the view instead
    el.addEventListener('wheel', (e) => { if (this._ptrs.size) e.preventDefault(); }, { passive: false });
    el.addEventListener('pointermove', (e) => {
      lastMove = e;
      if (e.buttons) { if (this.hoverIndex !== -1) this._setHover(-1, e); return; }
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; const ev = lastMove; const i = this.pickAtom(ev.clientX, ev.clientY); this._setHover(i, ev); });
    });
    el.addEventListener('pointerleave', (e) => this._setHover(-1, e));
    // a capture listener on the container runs before the camera controls (on the canvas) see a press;
    // moves and releases are followed on the window, in its capture phase, ahead of the controls too
    this.container.addEventListener('pointerdown', (e) => this._ptrDown(e), true);
    this._ptrMove = this._ptrMove.bind(this);
    this._ptrUp = this._ptrUp.bind(this);
    this._ptrCancel = (e) => this._ptrUp(e, true);
  }

  _setupKeys() {
    // hold keys are followed on the window, wherever the focus is: a drag in the view reads them
    const hold = (e, down) => {
      const k = e.key?.toLowerCase();
      if (!HOLD_KEYS.has(k)) return;
      if (!down) this._held.delete(k);
      else if (!e.repeat) { this._held.add(k); this._heldUsed.delete(k); }
    };
    addEventListener('keydown', (e) => {
      hold(e, true);
      if (e.key === 'Escape' && this._cancelShapes()) { e.preventDefault(); e.stopPropagation(); }   // (not also clearing the selection)
    }, true);
    addEventListener('keyup', (e) => hold(e, false), true);
    addEventListener('blur', () => { this._held.clear(); for (const id of [...this._ptrs.keys()]) this._endPress(id); });
    this.renderer.domElement.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || !this.structure) return;
      const k = e.key;
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      let done = true;
      if (arrow) {
        const [sx, sy] = arrow;
        if (e.shiftKey || e.altKey) this.panBy(sx * KEY_PAN, sy * KEY_PAN);
        // ←/→ turn about the screen's vertical axis, ↑/↓ about its horizontal one; a held arrow turns step by step
        else if (!(e.repeat && this._camAnim)) this.rotateScreen(sx ? 'y' : 'x', (sx || sy) * KEY_TURN);
      } else if (e.altKey) done = false;
      else if (k === '+' || k === '=') this.zoomBy(KEY_ZOOM);
      else if (k === '-' || k === '_') this.zoomBy(1 / KEY_ZOOM);
      else done = false;
      if (done) { e.preventDefault(); e.stopPropagation(); }
    });
  }

  /** True when hold key `k` took part in a press (a drag or click in the view) since it went down. */
  heldKeyUsed(k) { return this._heldUsed.has(String(k).toLowerCase()); }

  _setHover(i, e) {
    if (i === this.hoverIndex && i === -1) return;
    const changed = i !== this.hoverIndex;
    this.hoverIndex = i;
    if (changed) { this._writeHalos(); this._dirty = true; }
    const r = this.container.getBoundingClientRect();
    this.emit('hover', { index: i, x: e.clientX - r.left, y: e.clientY - r.top });
  }

  /** A left press released without dragging, or a tap: the axis gizmo, else 'atomclick'. Returns the picked index (null: the gizmo took it). */
  _click(e, mode = selectMode(e)) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const gx = e.clientX - r.left, gy = r.bottom - e.clientY;
    if (this.settings.display.axes && gx < this.gizmo.size + 8 && gy < this.gizmo.size + 8 && gx > 8 && gy > 8) {
      const nx = ((gx - 8) / this.gizmo.size) * 2 - 1, ny = ((gy - 8) / this.gizmo.size) * 2 - 1;
      const hit = this.gizmo.pick(nx, ny);
      if (hit) { this.setViewDirection(hit.dir.toArray(), null, true); return null; }
    }
    const i = this.pickAtom(e.clientX, e.clientY);
    this.emit('atomclick', { index: i, mode, shiftKey: mode !== 'replace', x: e.clientX - r.left, y: e.clientY - r.top });
    return i;
  }

  /** A click, and also an 'atomdblclick' when it closely follows the previous click on an atom. */
  _tap(e) {
    const now = performance.now(), last = this._lastTap;
    const double = !!last && now - last.t < DOUBLE_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_PX;
    this._lastTap = double ? null : { t: now, x: e.clientX, y: e.clientY };
    const mode = selectMode(e);
    const i = this._click(e, mode);
    if (!double || i == null || i < 0) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.emit('atomdblclick', { index: i, mode, altKey: e.altKey, x: e.clientX - r.left, y: e.clientY - r.top });
  }

  _context(e) {
    const r = this.container.getBoundingClientRect();
    const index = this.pickAtom(e.clientX, e.clientY);
    this.emit('atomcontext', { index, x: e.clientX - r.left, y: e.clientY - r.top, clientX: e.clientX, clientY: e.clientY });
  }

  /**
   * Start following a press on the canvas. Its `kind`: 'left' (selection, see _leftPress), 'axis' (X/Y/Z +
   * right-drag), 'pan' (middle, or Alt with the left or right button), 'chord' (left and right together:
   * zoom) or 'controls' (the camera controls drag; a release without moving is a tap, or the atom menu for
   * the right button). `button` is the press's button, with a Mac's Control+left counted as the right one.
   */
  _ptrDown(e) {
    if (e.target !== this.renderer.domElement) return;
    const touch = e.pointerType === 'touch';
    // a mouse or pen goes down only with no button held: a press still followed lost its release
    for (const [id, q] of this._ptrs) if (!touch && q.type === e.pointerType) this._endPress(id);
    if (!touch && [...this._ptrs.values()].some((q) => q.type !== 'touch')) return;
    if (!touch && e.button !== 0 && e.button !== 1 && e.button !== 2) return;   // back / forward buttons
    for (const k of this._held) this._heldUsed.add(k);   // a hold key used here does not run its own shortcut
    const button = IS_MAC && !touch && e.button === 0 && e.ctrlKey && !e.metaKey ? 2 : e.button;
    const p = { id: e.pointerId, type: e.pointerType, button, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: performance.now(), far: false, kind: 'controls' };
    const held = (k) => this._held.has(k);
    if (touch) {
      // a second finger makes both presses a pan or pinch, not taps
      for (const q of this._ptrs.values()) if (q.type === 'touch') { q.far = true; p.far = true; }
    } else if (button === 0 && e.altKey && !['r', 'q', 'e'].some(held)) {
      this._panPress(e, p);   // Alt/⌥+drag: a pan without a middle button (a click stays a click)
    } else if (button === 0 && (e.pointerType === 'mouse' || e.shiftKey || e.ctrlKey || e.metaKey || ['r', 'q', 'e'].some(held))) {
      this._leftPress(e, p);
    } else if (button === 2 && ['x', 'y', 'z'].some(held)) {
      e.preventDefault();
      p.kind = 'axis'; p.axis = ['x', 'y', 'z'].find(held);
      this._holdControls(p);
      this._capture(p);
    } else if (button === 1 || (button === 2 && e.altKey)) {
      this._panPress(e, p);
    } else this._rotateWith(e);
    this._ptrs.set(e.pointerId, p);
    if (this._ptrs.size === 1) {
      addEventListener('pointermove', this._ptrMove, true);
      addEventListener('pointerup', this._ptrUp, true);
      addEventListener('pointercancel', this._ptrCancel, true);
    }
  }

  /** Left press: a click, a selection rectangle (or a lasso with Q held) with the Select tool, a zoom box with R held. */
  _leftPress(e, p) {
    e.preventDefault();   // no text selection while dragging; the canvas still takes the focus for its keys
    this.renderer.domElement.focus?.({ preventScroll: true });
    p.kind = 'left';
    this._holdControls(p);
    this._capture(p);
    const select = this.tool === 'select' && !!this.model?.n;
    p.shape = this._held.has('r') ? 'zoom' : !select ? null : this._held.has('q') ? 'lasso' : 'rect';
    p.pts = [[e.clientX, e.clientY]];
  }

  /**
   * Pan press (middle button, or Alt with the left or right one). The viewer pans rather than the camera
   * controls: the model stays under the pointer and stops with it (the controls' damping made it trail and
   * glide on), whatever the controls and projection.
   */
  _panPress(e, p) {
    e.preventDefault();
    this.renderer.domElement.focus?.({ preventScroll: true });
    p.kind = 'pan';
    this._holdControls(p);
    this._capture(p);
  }

  /**
   * A press the camera controls drag (the right button, a Mac's Control+left, a pen tip): make it rotate.
   * OrbitControls pans instead while Ctrl, ⌘ or Shift is held; the viewer has its own pans, so map the button to
   * a pan that those keys turn back into the rotation.
   */
  _rotateWith(e) {
    const c = this.controls, key = e.button === 0 ? 'LEFT' : e.button === 2 ? 'RIGHT' : null;
    if (!c.mouseButtons || !key) return;
    const swapped = this.controlsKind !== 'trackball' && (e.ctrlKey || e.metaKey || e.shiftKey);
    c.mouseButtons[key] = swapped ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  }

  /** Keep the camera controls out of press p until it ends. */
  _holdControls(p) {
    if (p.restore) return;
    const c = this.controls, was = c.enabled;
    c.enabled = false;
    p.restore = () => { c.enabled = was; };
  }

  /** Send press p's events to the container while it lasts, even when the pointer leaves the view. */
  _capture(p) {
    try { this.container.setPointerCapture?.(p.id); p.captured = true; } catch { /* not capturable */ }
  }

  _ptrMove(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p) return;
    if (!p.far && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) >= CLICK_PX) p.far = true;
    const dx = e.clientX - p.lx, dy = e.clientY - p.ly;
    p.lx = e.clientX; p.ly = e.clientY;
    if (p.type === 'touch') {
      // the camera controls handle touch, except the trackball's two-finger pan: the model follows the fingers' midpoint
      if (this.controlsKind === 'trackball' && (dx || dy) && [...this._ptrs.values()].filter((q) => q.type === 'touch').length === 2) this.panBy(dx / 2, dy / 2);
      return;
    }
    // the left and right buttons pressed together zoom, whichever went down first (the second button
    // of a mouse arrives as a move, not as a press)
    if (p.type === 'mouse' && (e.buttons & 3) === 3 && (p.kind === 'left' || (p.button === 2 && (p.kind === 'controls' || p.kind === 'pan')))) {
      p.kind = 'chord'; p.far = true;
      this._holdControls(p);
      this._removeShape(p);
    }
    if (p.cancelled) return;
    if (p.kind === 'pan') { if (dx || dy) this.panBy(dx, dy); return; }
    if (p.kind === 'chord') { if (dy) this.zoomBy(Math.exp(-dy * 0.01)); return; }
    if (p.kind === 'axis') {
      // the same speed as a free rotation: dragging across the view's height turns about 320°
      const deg = ((p.axis === 'x' ? dy : p.axis === 'y' ? dx : -dx) * 0.9 * 360) / Math.max(1, this.height);
      if (deg) this.rotateScreen(p.axis, deg, { animate: false });
      return;
    }
    if (p.kind === 'left' && p.far && p.shape) this._drawShape(p, e);
  }

  /** The last button of a press was released (cancelled: the browser took the pointer, or Esc). */
  _ptrUp(e, cancelled = false) {
    const p = this._ptrs.get(e.pointerId);
    if (!p) return;
    this._endPress(e.pointerId);
    if (cancelled || p.cancelled || p.kind === 'chord' || (p.kind === 'pan' && p.button === 1)) return;   // (Alt+right-click: the menu)
    if (!p.far && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < CLICK_PX) {
      if (p.button === 2) this._context(e);
      else if (p.button === 0 && (p.kind !== 'controls' || performance.now() - p.t0 < 500)) this._tap(e);
      return;
    }
    if (p.kind !== 'left' || !p.shape) return;
    if (p.shape === 'zoom') { this.zoomToRect(p.x0, p.y0, e.clientX, e.clientY); return; }
    const indices = p.shape === 'lasso' ? this.atomsInPolygon([...p.pts, [e.clientX, e.clientY]]) : this.atomsInRect(p.x0, p.y0, e.clientX, e.clientY);
    const mode = selectMode(e);
    this.emit('boxselect', { indices, mode, add: mode !== 'replace', shape: p.shape });
  }

  /** Stop following press `id`: give the controls back (before their own release handler runs) and remove its shape. */
  _endPress(id) {
    const p = this._ptrs.get(id);
    if (!p) return;
    this._ptrs.delete(id);
    if (!this._ptrs.size) {
      removeEventListener('pointermove', this._ptrMove, true);
      removeEventListener('pointerup', this._ptrUp, true);
      removeEventListener('pointercancel', this._ptrCancel, true);
    }
    p.restore?.();
    this._removeShape(p);
    if (p.captured) { try { this.container.releasePointerCapture?.(id); } catch { /* already released */ } }
  }

  /** Esc during a drag drops its rectangle, lasso or zoom box; true when there was one. */
  _cancelShapes() {
    let any = false;
    for (const p of this._ptrs.values()) if (p.kind === 'left' && !p.cancelled && p.far && p.shape) { p.cancelled = true; this._removeShape(p); any = true; }
    return any;
  }

  /** Draw press p's rectangle, zoom box or lasso up to pointer event e (their looks come from app.css). */
  _drawShape(p, e) {
    const host = this.container.getBoundingClientRect();
    if (p.shape === 'lasso') {
      const last = p.pts[p.pts.length - 1];
      if (Math.hypot(e.clientX - last[0], e.clientY - last[1]) >= 3) p.pts.push([e.clientX, e.clientY]);
      if (!p.el) {
        p.el = document.createElementNS(SVG_NS, 'svg');
        p.el.setAttribute('class', 'viewer-lasso');
        p.el.setAttribute('aria-hidden', 'true');
        Object.assign(p.el.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', zIndex: 6, pointerEvents: 'none', overflow: 'visible' });
        p.el.appendChild(document.createElementNS(SVG_NS, 'polygon'));
        this.container.appendChild(p.el);
      }
      p.el.firstChild.setAttribute('points', p.pts.map(([x, y]) => `${(x - host.left).toFixed(1)},${(y - host.top).toFixed(1)}`).join(' '));
      return;
    }
    if (!p.el) {
      p.el = document.createElement('div');
      p.el.className = p.shape === 'zoom' ? 'viewer-boxselect zoom' : 'viewer-boxselect';
      p.el.setAttribute('aria-hidden', 'true');
      Object.assign(p.el.style, { position: 'absolute', zIndex: 6, pointerEvents: 'none' });
      this.container.appendChild(p.el);
    }
    Object.assign(p.el.style, {
      left: `${Math.min(p.x0, e.clientX) - host.left}px`, top: `${Math.min(p.y0, e.clientY) - host.top}px`,
      width: `${Math.abs(e.clientX - p.x0)}px`, height: `${Math.abs(e.clientY - p.y0)}px`,
    });
  }

  _removeShape(p) { p.el?.remove(); p.el = null; }

  /** Unique source indices of the displayed atoms whose centres project inside a client-space rectangle. */
  atomsInRect(x0, y0, x1, y1) {
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    return this._atomsWhere((x, y) => x >= xa && x <= xb && y >= ya && y <= yb);
  }

  /** Unique source indices of the displayed atoms whose centres project inside a client-space polygon [[x, y], …], as a lasso draws it. */
  atomsInPolygon(points) {
    const pts = (Array.isArray(points) ? points : []).filter((q) => Number.isFinite(q?.[0]) && Number.isFinite(q?.[1]));
    if (pts.length < 3) return [];
    let xa = Infinity, xb = -Infinity, ya = Infinity, yb = -Infinity;
    for (const [x, y] of pts) { xa = Math.min(xa, x); xb = Math.max(xb, x); ya = Math.min(ya, y); yb = Math.max(yb, y); }
    return this._atomsWhere((x, y) => x >= xa && x <= xb && y >= ya && y <= yb && inPolygon(pts, x, y));
  }

  /** Sorted unique source indices of the displayed atoms in front of the camera whose centres project to client (x, y) with test(x, y). */
  _atomsWhere(test) {
    const m = this.model;
    if (!m?.n) return [];
    const r = this.renderer.domElement.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const e = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const p = m.positions, out = new Set();
    for (let i = 0; i < m.n; i++) {
      const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) continue;
      const cz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
      if (cz < -1 || cz > 1) continue;
      const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w, cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      if (test(r.left + ((cx + 1) / 2) * r.width, r.top + ((1 - cy) / 2) * r.height)) out.add(m.src[i]);
    }
    return [...out].sort((a, b) => a - b);
  }

  // ------------------------------------------------------------------ public API
  setStructure(structure, { resetCamera = true } = {}) {
    this.structure = structure;
    this._sigs = {};
    if (resetCamera) { this.measurements = []; this.selection.clear(); }
    this._noRefit = resetCamera;
    try { this.applySettings(this.settings, { force: true }); } finally { this._noRefit = false; }
    if (resetCamera) this.resetView(false);
    this.emit('model', this.model);
  }

  /** Apply a full scene-settings object; rebuilds only what changed. */
  applySettings(settings, { force = false } = {}) {
    this.settings = settings;
    const st = settings.style, d = settings.display;
    const S = {
      camera: sig([d.projection, d.fov, d.controls]),
      model: sig([d.supercell, d.wrap, d.boundaryAtoms, d.completeBonds, d.bonds, d.hiddenElements, styles.get(st.rep)?.wantsImages ? st.polyhedra?.centers : null]),
      frame: sig(this.structure?.frame),
      colors: sig([st.colorScheme, st.monoColor, st.colorOverrides, st.property]),
      geom: sig([st.rep, st.radiusSource, st.bondRadius, st.bondColor, st.bondUniformColor, st.lineWidth, st.quality, st.polyhedra, d.bonds?.show]),
      radii: sig([st.atomScale, st.radiusOverrides]),
      material: sig([st.material, st.bondMaterial]),
      matParams: sig([st.roughness, st.metalness, st.opacity]),
      lights: sig(settings.lighting),
      post: sig(settings.post),
      bg: sig([d.background, settings.post?.fog]),
      cell: sig(d.cell),
    };
    const ch = (k) => force || S[k] !== this._sigs[k];
    if (ch('camera')) this._applyCamera(d);
    if (this.structure) {
      const prev = this.model ? { model: this.model, radii: this.radii } : null;
      const modelChanged = ch('model') || ch('frame');
      const rebuild = modelChanged || ch('colors') || ch('geom') || ch('material');
      if (modelChanged) this._buildModel();
      if (modelChanged || ch('colors')) this._computeColors();
      if (rebuild) this._buildRep();
      else {
        if (ch('radii') && !this._updateRadii()) this._buildRep();
        if (ch('matParams')) this._updateMaterialParams();
      }
      if (modelChanged || ch('cell')) this._buildCell();
      if (modelChanged) this._buildMeasurements();
      // grow the view when the drawing no longer fits (not for plain trajectory frames or new structures)
      const frameOnly = !force && ch('frame') && !ch('model') && !ch('geom') && !ch('radii');
      if (!this._noRefit && !frameOnly && (modelChanged || ch('geom') || ch('radii'))) this._maybeRefit(prev);
    }
    if (ch('lights')) { this.lights.apply(settings.lighting); this._applyShadows(); this._updateFloor(); }
    if (ch('post') || ch('camera')) this.post.configure(settings.post, false);
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

  setSelection(srcIndices) { this.selection = new Set(srcIndices); this._writeHalos(); this._dirty = true; this.emit('selection', [...this.selection]); }

  // ------------------------------------------------------------------ building
  _buildModel() {
    const s = this.structure, st = this.settings.style, d = this.settings.display;
    const style = styles.get(st.rep) ?? styles.get('ballstick');
    let model = buildDisplayModel(s, d, {});
    if (style.wantsImages && model.periodic && !d.completeBonds) {
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
    const cut = model.truncated ? sig([model.requestedSupercell, model.supercell, s.length]) : null;
    if (cut && cut !== this._cutWarned) this.emit('error', new Error(`Showing a ${model.supercell.join('×')} supercell instead of ${model.requestedSupercell.join('×')} to stay under 2 million drawn atoms.`));
    this._cutWarned = cut;
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

  /** Dispose replaced objects / materials after the next frame, so shader programs they share with their replacements stay compiled. */
  _flushTrash() {
    const t = this._trash;
    if (!t.length) return;
    this._trash = [];
    for (const x of t) {
      if (x.isMaterial) { if (x !== this.atomMaterial && x !== this.bondMaterial) x.dispose(); }
      else this._disposeObject(x);
    }
  }

  _computeRadii() {
    const st = this.settings.style, m = this.model;
    const radii = new Float32Array(m.n);
    const rcache = new Map();
    for (let i = 0; i < m.n; i++) {
      const s = m.symbols[i];
      if (!rcache.has(s)) rcache.set(s, atomRadius(s, st));
      radii[i] = rcache.get(s);
    }
    let rmax = 0;
    for (const r of rcache.values()) rmax = Math.max(rmax, r);
    this.radii = radii;
    this.maxRadius = rmax;
  }

  _matParams() {
    const st = this.settings.style;
    return { roughness: st.roughness ?? undefined, metalness: st.metalness ?? undefined, opacity: st.opacity };
  }

  /** Bonds under see-through atoms (glass, x-ray) get their own opaque material unless style.bondMaterial says otherwise. */
  _makeBondMaterial(atomMat, params) {
    const pref = this.settings.style.bondMaterial ?? 'auto';
    this._bondAuto = false;
    if (pref === 'same') return atomMat;
    if (pref !== 'auto' && materials.get(pref)) return pref === atomMat.userData.preset ? atomMat : createMaterial(pref, params);
    if (!isSeeThrough(atomMat)) return atomMat;
    this._bondAuto = true;
    return createMaterial('standard', { roughness: params.roughness, metalness: params.metalness, opacity: 1 });
  }

  _buildRep() {
    const st = this.settings.style, d = this.settings.display;
    const style = styles.get(st.rep) ?? styles.get('ballstick');
    const m = this.model;
    this._computeRadii();
    const oldRep = this.rep, oldAtom = this.atomMaterial, oldBond = this.bondMaterial;
    const params = this._matParams();
    // new materials first; the old ones are disposed after the next frame (keeps shader programs alive)
    const atomMaterial = createMaterial(st.material, params);
    const bondMaterial = this._makeBondMaterial(atomMaterial, params);
    const ctx = {
      model: m, colors: this.colors, radii: this.radii, settings: st, atomMaterial, bondMaterial,
      segments: segmentsFor(m.n, st.quality), showBonds: d.bonds?.show !== false && style.bonds, resolution: this.resolution, THREE,
      helpers: this.helpers,
    };
    let rep;
    try {
      rep = style.build(ctx);
      if (!rep?.isObject3D) throw new Error('build() did not return a THREE.Object3D');
    } catch (err) {
      console.error(err);
      this.emit('error', new Error(`The "${style.name}" style failed to draw: ${err.message}`));
      rep = new THREE.Group();
    }
    const noShadow = !!materials.get(st.material)?.transparent;
    rep.traverse((o) => {
      if (o.material === atomMaterial || o.material === bondMaterial) o.userData.sharedMaterial = true;
      if (noShadow && o.material === atomMaterial) o.castShadow = false;
    });
    this.atomMaterial = atomMaterial;
    this.bondMaterial = bondMaterial;
    this.rep = rep;
    this.root.add(rep);
    if (oldRep) { oldRep.parent?.remove(oldRep); this._trash.push(oldRep); }
    if (oldAtom) this._trash.push(oldAtom);
    if (oldBond && oldBond !== oldAtom) this._trash.push(oldBond);
    this._writeHalos();
    this._updateFloor();
    this._dirty = true;
  }

  /** atomScale / radiusOverrides changed: rewrite instance matrices in place when the style allows it. */
  _updateRadii() {
    const st = this.settings.style, m = this.model;
    const style = styles.get(st.rep);
    if (!style?.inPlaceRadii || !this.rep || !m) return false;
    const meshes = [];
    this.rep.traverse((o) => { if (o.isInstancedMesh && (o.userData.role === 'atoms' || o.userData.role === 'bonds')) meshes.push(o); });
    if (meshes.some((o) => o.userData.role === 'atoms' && o.count !== m.n)) return false;
    if (meshes.some((o) => o.userData.role === 'bonds' && o.userData.bondRadius === undefined)) return false;
    this._computeRadii();
    const ctx = { model: m, colors: null, radii: this.radii, settings: st };
    for (const o of meshes) {
      if (o.userData.role === 'atoms') writeAtomMatrices(o, m, this.radii);
      else if (st.bondColor !== 'uniform') writeBondMatrices(o, ctx, o.userData.bondRadius);
    }
    this._writeHalos();
    this._updateFloor();
    this._dirty = true;
    return true;
  }

  /** roughness / metalness / opacity changed: update the materials in place (no shader rebuild). */
  _updateMaterialParams() {
    if (!this.atomMaterial || !this.rep) return;
    const params = this._matParams();
    let ok = updateMaterial(this.atomMaterial, params);
    if (ok && this.bondMaterial && this.bondMaterial !== this.atomMaterial) {
      ok = updateMaterial(this.bondMaterial, this._bondAuto ? { roughness: params.roughness, metalness: params.metalness, opacity: 1 } : params);
    }
    if (!ok) { this._buildRep(); return; }
    this._dirty = true;
  }

  /** Refit (animated) when the drawing used to fit the view and no longer does, e.g. ball & stick → space-filling. */
  _maybeRefit(prev) {
    if (!prev?.model || !this.model || this._camAnim || !this._hasView) return;
    if (prev.model === this.model && prev.radii === this.radii) return;
    const before = this._ndcExtent(prev.model, prev.radii), after = this._ndcExtent(this.model, this.radii);
    if (before <= 1 && after > 1 && after > before + 1e-3) this.fitView(true);
  }

  /** Largest |NDC| reached by the model's atoms (sphere radii included); > 1 means something is cut off. */
  _ndcExtent(model, radii) {
    if (!model?.n || model.n > 200000) return 0;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorldInverse.elements, p = model.positions;
    const persp = cam.isPerspectiveCamera;
    const tanH = Math.tan(((cam.fov ?? 30) * DEG) / 2), aspect = this.width / this.height;
    const halfH = persp ? 0 : (cam.top - cam.bottom) / 2 / (cam.zoom || 1), halfW = persp ? 0 : (cam.right - cam.left) / 2 / (cam.zoom || 1);
    let ext = 0;
    for (let i = 0; i < model.n; i++) {
      const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
      const vx = e[0] * x + e[4] * y + e[8] * z + e[12], vy = e[1] * x + e[5] * y + e[9] * z + e[13], vz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const r = radii?.[i] ?? 0;
      if (persp) {
        const depth = -vz;
        if (depth <= r) return Infinity;
        const hy = depth * tanH, hx = hy * aspect;
        ext = Math.max(ext, (Math.abs(vx) + r) / hx, (Math.abs(vy) + r) / hy);
      } else ext = Math.max(ext, (Math.abs(vx) + r) / halfW, (Math.abs(vy) + r) / halfH);
    }
    return ext;
  }

  _makeHalo(material) {
    const mesh = new THREE.InstancedMesh(this._haloGeo, material, 16);
    mesh.count = 1;
    mesh.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0));   // keeps the program compiled while idle
    mesh.frustumCulled = false;
    mesh.userData.noInk = true;
    mesh.userData.sharedMaterial = true;
    mesh.renderOrder = 10;
    mesh.name = 'halo';
    this.root.add(mesh);
    return mesh;
  }

  _writeHalo(kind, indices, grow) {
    let mesh = this._halo[kind];
    if (indices.length > mesh.instanceMatrix.count) {
      const next = new THREE.InstancedMesh(this._haloGeo, mesh.material, Math.max(indices.length, mesh.instanceMatrix.count * 2));
      Object.assign(next, { frustumCulled: false, renderOrder: mesh.renderOrder, name: mesh.name });
      Object.assign(next.userData, mesh.userData);
      this.root.remove(mesh);
      mesh.dispose();
      this.root.add(next);
      this._halo[kind] = mesh = next;
    }
    const mtx = new THREE.Matrix4(), p = this.model?.positions;
    if (!indices.length || !p) { mesh.count = 1; mesh.setMatrixAt(0, mtx.makeScale(0, 0, 0)); }
    else {
      mesh.count = indices.length;
      indices.forEach((i, k) => {
        const r = Math.max(this.radii?.[i] ?? 0.3, 0.18) * grow + 0.05;
        mtx.makeScale(r, r, r).setPosition(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
        mesh.setMatrixAt(k, mtx);
      });
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Rewrite selection and hover halos (no new materials or geometry). */
  _writeHalos() {
    if (!this._halo) return;
    const m = this.model;
    const sel = [];
    if (m && this.selection.size) for (let i = 0; i < m.n; i++) if (this.selection.has(m.src[i])) sel.push(i);
    this._writeHalo('select', sel, 1.25);
    const h = this.hoverIndex;
    this._writeHalo('hover', m && h >= 0 && h < m.n ? [h] : [], 1.32);
    this._dirty = true;
  }

  /** Re-read theme colours (accent, fonts) and refresh the halos; the shell calls this on theme changes. */
  _updateHalos() {
    this._css = null;
    const accent = this._cssTheme().accent;
    for (const k of Object.keys(this._halo ?? {})) this._halo[k].material.uniforms.color.value.set(accent);
    this._writeHalos();
  }

  _cssTheme() {
    if (!this._css) {
      this._css = {
        accent: cssVar('--accent', '#e8a33d'), accentStrong: cssVar('--accent-strong', '#c27c12'),
        font: cssVar('--font-ui', 'system-ui, sans-serif'),
      };
      for (const k of Object.keys(this._halo ?? {})) this._halo[k].material.uniforms.color.value.set(this._css.accent);
    }
    return this._css;
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
    // a cell grid of more than a few thousand boxes is unreadable (and slow): draw the outline instead
    const which = c.which === 'grid' && N[0] * N[1] * N[2] > 4096 ? 'supercell' : c.which;
    if (which === 'grid') { for (let a = 0; a < N[0]; a++) for (let b = 0; b < N[1]; b++) for (let cc = 0; cc < N[2]; cc++) box([a, b, cc], [1, 1, 1]); }
    else if (which === 'supercell') box([0, 0, 0], N);
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
    const bgs = this.settings.display.background;
    const bg = makeBackground(bgs);
    this.scene3.background = bg.background;
    this.renderer.setClearColor(bg.fogColor, bg.alpha);
    this._fogColor = bg.fogColor;
    const fog = this.settings.post?.fog;
    this.scene3.fog = fog?.enabled ? new THREE.Fog(bg.fogColor, 1, 100) : null;
    this.overlayDark = luminance(bg.fogColor) < 0.4;
    this.post.setTransparent(bg.alpha < 1);
  }

  /** The floor's "up": the c axis of periodic structures, otherwise the up of the last reset view (+Y by default). */
  _floorUp() {
    const cell = this.model?.periodic ? this.model.cell : null;
    if (cell) {
      const c = new THREE.Vector3(...cell[2]);
      if (c.lengthSq() > 1e-8) return c.normalize();
    }
    return (this._viewUp?.lengthSq() > 1e-8 ? this._viewUp.clone() : new THREE.Vector3(0, 1, 0)).normalize();
  }

  _updateFloor() {
    this._fitShadowCamera();
    const sh = this.settings.lighting?.shadows;
    this.floor.visible = !!(sh?.enabled && sh?.floor && this.model?.n);
    if (!this.model?.n) return;
    const up = this._floorUp();
    const p = this.model.positions, radii = this.radii?.length === this.model.n ? this.radii : null;
    let lo = Infinity, loCentre = Infinity;
    for (let i = 0; i < this.model.n; i++) {
      const h = p[3 * i] * up.x + p[3 * i + 1] * up.y + p[3 * i + 2] * up.z;
      loCentre = Math.min(loCentre, h);
      lo = Math.min(lo, h - (radii ? radii[i] : 0));
    }
    // just under the lowest atom surface (and never closer than 0.8 Å below the lowest centre)
    const level = Math.min(loCentre - 0.8, lo - 0.3);
    const c = this.bounds.center;
    const r = this.bounds.radius;
    this.floor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
    this.floor.position.copy(c).addScaledVector(up, level - c.dot(up));
    this.floor.scale.set(r * 12, r * 12, 1);
    this.floor.updateMatrixWorld();
    this._dirty = true;
  }

  /** Shadow camera tight around the model (sharper shadow map); depth range long enough to reach the floor. */
  _fitShadowCamera() {
    const cam = this.lights.key?.shadow?.camera;
    if (!cam) return;
    const r = this.bounds.radius, R = r + (this.maxRadius ?? 1) + 1;
    const D = (this.lights.radius ?? r) * 4;   // LightRig keeps its lights 4 radii from the centre
    Object.assign(cam, { left: -R, right: R, top: R, bottom: -R, near: Math.max(0.05, D - R - 1), far: D + R * 4 + 2 });
    cam.updateProjectionMatrix();
    this._applyShadows();
  }

  /** Soft shadows (softness > 1.5) use variance shadow maps blurred over a world-space width; PCF otherwise. */
  _applyShadows() {
    const sh = this.settings.lighting?.shadows ?? {};
    const softness = sh.softness ?? 3;
    const type = softness > 1.5 ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    const sm = this.renderer.shadowMap;
    if (sm.type !== type) {
      sm.type = type;
      // the shadow-map type is part of every lit shader; three does not notice the change on its own
      if (sh.enabled) this.scene3.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
    }
    const shadow = this.lights.key?.shadow;
    if (!shadow) return;
    if (type === THREE.VSMShadowMap) {
      const cam = shadow.camera;
      const texel = (cam.right - cam.left) / (shadow.mapSize.x || 2048);
      shadow.radius = clamp((softness * 0.05) / Math.max(texel, 1e-4), 1, 24);
      shadow.blurSamples = 16;
    } else shadow.radius = softness;
  }

  _buildMeasurements() {
    this._disposeObject(this.measureObj); this.measureObj = null;
    if (!this.model) return;
    const m = this.model;
    const pts = [];
    for (const ms of this.measurements) {
      ms.idx = (Array.isArray(ms.keys) ? ms.keys : []).map((k) => m.keys.get(k) ?? -1);
      // an unknown type or a wrong number of atoms (a hand-edited or newer file) is kept but never drawn
      ms.valid = measureArity(ms.type) === ms.idx.length && ms.idx.every((i) => i >= 0);
      if (!ms.valid) { ms.value = undefined; continue; }
      const P = ms.idx.map((i) => new THREE.Vector3(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]));
      try { ms.value = measureValue(ms.type, P); } catch { ms.value = NaN; }
      if (!Number.isFinite(ms.value)) { ms.valid = false; ms.value = undefined; continue; }
      for (let k = 0; k + 1 < P.length; k++) pts.push(P[k], P[k + 1]);
    }
    if (pts.length) {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineDashedMaterial({ color: this._cssTheme().accent, dashSize: 0.18, gapSize: 0.12, depthTest: false, transparent: true, toneMapped: false });
      this.measureObj = new THREE.LineSegments(g, mat);
      this.measureObj.computeLineDistances();
      this.measureObj.renderOrder = 20;
      this.root.add(this.measureObj);
    }
    this.emit('measure', this.measurements);
    this._dirty = true;
  }

  /** Measure between drawn atoms: type 'distance' | 'angle' | 'dihedral' with 2 | 3 | 4 display indices. Returns the entry. */
  addMeasurement(type, displayIndices) {
    const n = measureArity(type);
    if (!n) throw new Error(`Unknown measurement “${typeof type === 'string' ? type : typeof type}”: use distance, angle or dihedral.`);
    if (!this.model) throw new Error('Load a structure first.');
    const idx = Array.isArray(displayIndices) ? displayIndices : [];
    if (idx.length !== n) throw new Error(`${type === 'angle' ? 'An' : 'A'} ${type} needs ${n} atoms (got ${idx.length}).`);
    const bad = idx.find((i) => !Number.isInteger(i) || i < 0 || i >= this.model.n);
    if (bad !== undefined) throw new Error(`No drawn atom with index ${bad} (0–${this.model.n - 1}).`);
    const ms = { id: Math.random().toString(36).slice(2, 8), type, keys: idx.map((i) => keyOf(this.model, i)) };
    this.measurements.push(ms);
    this._buildMeasurements();
    return ms;
  }

  removeMeasurement(id) { this.measurements = this.measurements.filter((m) => m.id !== id); this._buildMeasurements(); }
  clearMeasurements() { this.measurements = []; this._buildMeasurements(); }

  // ------------------------------------------------------------------ camera
  _applyCamera(d) {
    this.persp.fov = d.fov ?? 30;
    if (d.projection === 'orthographic') this._tempOrtho = false;
    const kind = d.controls ?? 'orbit';
    if (kind !== this.controlsKind) this._setupControls(kind);
    this._useCamera(d.projection === 'orthographic' || this._tempOrtho);
    this.resize();
  }

  /** Switch between the perspective and orthographic camera, keeping position, target and framing. */
  _useCamera(ortho) {
    const want = ortho ? this.ortho : this.persp;
    if (want === this.camera) return false;
    const fovH = Math.tan((this.persp.fov * DEG) / 2);
    want.position.copy(this.camera.position);
    want.quaternion.copy(this.camera.quaternion);
    want.up.copy(this.camera.up);
    if (want.isOrthographicCamera) {
      this._orthoHalf = this.camera.position.distanceTo(this.controls.target) * fovH;
      want.zoom = 1;
    } else {
      const h = (this._orthoHalf ?? 10) / (this.camera.zoom || 1);
      const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
      want.position.copy(this.controls.target).addScaledVector(dir, h / fovH);
    }
    this.camera = want;
    this.controls.object = want;
    this._syncControlsUp();
    this._updateOrtho();
    this.post.setCamera(want);
    this.controls.update?.();
    this._dirty = true;
    return true;
  }

  /** Back from an axis view's temporary orthographic camera to the scene's projection. */
  _leaveTempOrtho() {
    if (!this._tempOrtho) return;
    this._tempOrtho = false;
    this._useCamera(this.settings.display.projection === 'orthographic');
  }

  _cell() {
    if (this.model) return this.model.cell ?? null;
    const s = this.structure;
    return s?.cell && s.cell.every((v) => Math.hypot(...v) > 1e-6) ? s.cell : null;
  }

  defaultView() {
    const s = this.structure, cell = this._cell();
    if (s?.periodic && cell && (this.model?.periodic ?? true)) {
      const [A, , C] = cell.map((v) => new THREE.Vector3(...v).normalize());
      const twoD = s.pbc[2] === false;
      const up = C.clone();
      const w0 = A.clone().addScaledVector(up, -A.dot(up)).normalize();
      const v = new THREE.Vector3().crossVectors(up, w0);
      if (twoD) return { dir: up.clone().multiplyScalar(1).addScaledVector(v, -0.75).addScaledVector(w0, 0.25).normalize(), up: v.clone() };
      return { dir: w0.clone().multiplyScalar(0.42).addScaledVector(v, -1).addScaledVector(up, 0.38).normalize(), up };
    }
    return { dir: new THREE.Vector3(0.45, 0.38, 1).normalize(), up: new THREE.Vector3(0, 1, 0) };
  }

  /** View size left for the model once the fit margins are taken off (never under half the view). */
  _fitArea(w = this.width, h = this.height) {
    const { x = 0, y = 0 } = this.fitMargins ?? {};
    return [Math.max(w * 0.5, w - 2 * x), Math.max(h * 0.5, h - 2 * y)];
  }
  /** Perspective camera distance per unit of radius that fits a sphere into a w × h view. */
  _fitFactor(w = this.width, h = this.height) {
    const [ew, eh] = this._fitArea(w, h);
    const t = Math.tan((this.persp.fov * DEG) / 2);
    return Math.max(1 / Math.sin(Math.atan((t * eh) / h)), 1 / Math.sin(Math.atan((t * ew) / h)));
  }
  /** Orthographic half-height per unit of radius that fits a sphere into a w × h view. */
  _orthoFactor(w = this.width, h = this.height) {
    const [ew, eh] = this._fitArea(w, h);
    return Math.max(h / eh, h / ew);
  }

  _fitDistance(radius) {
    radius += this.maxRadius ?? 0;
    return radius * this._fitFactor() * 1.02;
  }

  /**
   * After the view changed size, zoom so it shows what it showed before: a view that gets narrower
   * (a panel opened, the window shrank) zooms out instead of cutting the model off at the sides.
   */
  _keepFraming(w0, h0) {
    if (!this._hasView) return;
    if (this.camera.isOrthographicCamera) {
      const k = this._orthoFactor() / this._orthoFactor(w0, h0);
      if (Number.isFinite(k) && Math.abs(k - 1) > 1e-6) this._orthoHalf = (this._orthoHalf ?? 10) * k;
      return;
    }
    const k = this._fitFactor() / this._fitFactor(w0, h0);
    if (!Number.isFinite(k) || Math.abs(k - 1) < 1e-6) return;
    const t = this.controls.target;
    this.camera.position.sub(t).multiplyScalar(k).add(t);
    const a = this._camAnim;
    if (a) { a.p0.sub(a.c0).multiplyScalar(k).add(a.c0); a.p1.sub(a.c1).multiplyScalar(k).add(a.c1); }
    this.controls.update?.();
  }

  resetView(animate = true) {
    this._leaveTempOrtho();
    const v = this.defaultView();
    this._viewUp = v.up.clone();
    this.setViewDirection(v.dir.toArray(), v.up.toArray(), animate, true);
    this._updateFloor();
  }

  fitView(animate = true) {
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    this.setViewDirection(dir.toArray(), this.camera.up.toArray(), animate, true);
  }

  /** dir: vector from target to camera. */
  setViewDirection(dir, up = null, animate = true, refit = false) {
    const target = refit ? this.bounds.center.clone() : this.controls.target.clone();
    const d = new THREE.Vector3(...dir).normalize();
    if (d.lengthSq() < 0.5) return;
    let u = up ? new THREE.Vector3(...up).normalize() : this.camera.up.clone();
    if (u.lengthSq() < 0.5 || Math.abs(u.dot(d)) > 0.98) u = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    u.addScaledVector(d, -u.dot(d)).normalize();
    const dist = refit || !this._hasView ? this._fitDistance(this.bounds.radius) : this.camera.position.distanceTo(this.controls.target);
    const pos = target.clone().addScaledVector(d, dist);
    if (this.camera.isOrthographicCamera && refit) { this._orthoHalf = (this.bounds.radius + (this.maxRadius ?? 0)) * 1.05 * this._orthoFactor(); this.camera.zoom = 1; this._updateOrtho(); }
    this._hasView = true;
    if (!animate) {
      this._camAnim = null;
      this.camera.position.copy(pos); this.camera.up.copy(u); this.controls.target.copy(target);
      this.camera.lookAt(target); this._syncControlsUp(); this.controls.update(); this._dirty = true; this.emit('camera'); return;
    }
    this._camAnim = {
      t0: performance.now(), dur: 420,
      p0: this.camera.position.clone(), p1: pos, u0: this.camera.up.clone(), u1: u, c0: this.controls.target.clone(), c1: target,
    };
  }

  /**
   * Look along a cell axis (a/b/c) or a Cartesian axis (x/y/z), optionally negated ('-a').
   * With display.orthoAxisViews the view uses an orthographic camera (atom columns line up) until the
   * next free rotation.
   */
  setView(axis) {
    const cell = this._cell();
    const cart = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    let dir, up;
    const neg = String(axis).startsWith('-');
    const ax = String(axis).replace('-', '');
    if ('abc'.includes(ax) && ax.length === 1 && cell) {
      dir = cell['abc'.indexOf(ax)];
      up = ax === 'c' ? cell[1] : cell[2];
    } else {
      dir = cart[ax] ?? [0, 0, 1];
      up = ax === 'z' ? [0, 1, 0] : [0, 0, 1];
    }
    if (neg) dir = dir.map((v) => -v);
    const d = this.settings.display;
    if (d.orthoAxisViews !== false && !d.turntable && d.projection !== 'orthographic') {
      this._tempOrtho = true;
      this._useCamera(true);
    }
    this.setViewDirection(dir, up, true, true);
  }

  focusAtom(i) {
    const p = this.model.positions;
    const c = new THREE.Vector3(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
    this._camAnim = { t0: performance.now(), dur: 380, p0: this.camera.position.clone(), p1: this.camera.position.clone().add(c.clone().sub(this.controls.target)), u0: this.camera.up.clone(), u1: this.camera.up.clone(), c0: this.controls.target.clone(), c1: c };
  }

  zoomBy(f) {
    if (!(f > 0)) return;
    if (this.camera.isOrthographicCamera) { this.camera.zoom *= f; this.camera.updateProjectionMatrix(); }
    else { const t = this.controls.target; this.camera.position.sub(t).multiplyScalar(1 / f).add(t); }
    if (this._camAnim) this._camAnim.p1.sub(this._camAnim.c1).multiplyScalar(this.camera.isOrthographicCamera ? 1 : 1 / f).add(this._camAnim.c1);
    this.controls.update?.();
    this._dirty = true;
    this.emit('camera');
  }

  /**
   * Orbit around the target: dAz° to the camera's right (the model turns left), dEl° upwards. Steps
   * accumulate while a previous one is still animating; elevation stops 5° short of the poles.
   */
  orbitBy(dAz = 0, dEl = 0, { animate = true } = {}) {
    if (!dAz && !dEl) return;
    this._leaveTempOrtho();
    const a = this._camAnim;
    const target = (a ? a.c1 : this.controls.target).clone();
    const from = (a ? a.p1 : this.camera.position).clone();
    const up = (a ? a.u1 : this.camera.up).clone().normalize();
    const off = from.sub(target);
    if (dAz) off.applyAxisAngle(up, dAz * DEG);
    if (dEl) {
      const theta = Math.acos(clamp(off.dot(up) / (off.length() || 1), -1, 1));
      const next = clamp(theta - dEl * DEG, 5 * DEG, 175 * DEG);
      const right = new THREE.Vector3().crossVectors(up, off);
      if (right.lengthSq() > 1e-12) off.applyAxisAngle(right.normalize(), next - theta);
    }
    const p1 = target.clone().add(off);
    if (!animate) {
      this._camAnim = null;
      this.camera.position.copy(p1); this.camera.up.copy(up); this.controls.target.copy(target); this.camera.lookAt(target);
      this.controls.update?.(); this._dirty = true; this.emit('camera'); return;
    }
    this._camAnim = { t0: performance.now(), dur: 160, p0: this.camera.position.clone(), p1, u0: this.camera.up.clone(), u1: up, c0: this.controls.target.clone(), c1: target };
  }

  /**
   * Turn the model deg° about a screen axis — 'x' (right), 'y' (up) or 'z' (towards the viewer), right-hand
   * rule — like a trackball, with no pole to stop at (arrow keys, X/Y/Z + right-drag). Steps accumulate
   * while a previous one is still animating.
   */
  rotateScreen(axis, deg, { animate = true } = {}) {
    if (!deg || !['x', 'y', 'z'].includes(axis)) return;
    this._leaveTempOrtho();
    const a = this._camAnim;
    const target = (a ? a.c1 : this.controls.target).clone();
    const off = (a ? a.p1 : this.camera.position).clone().sub(target);
    const back = off.clone().normalize();
    if (back.lengthSq() < 0.5) return;
    const right = new THREE.Vector3().crossVectors((a ? a.u1 : this.camera.up), back);
    if (right.lengthSq() < 1e-12) right.set(1, 0, 0).addScaledVector(back, -back.x);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(back, right);
    // the camera turns the other way round the target
    const q = new THREE.Quaternion().setFromAxisAngle(axis === 'x' ? right : axis === 'y' ? up : back, -deg * DEG);
    const p1 = target.clone().add(off.applyQuaternion(q)), u1 = up.applyQuaternion(q);
    if (!animate) {
      this._camAnim = null;
      this.camera.position.copy(p1); this.camera.up.copy(u1); this.controls.target.copy(target); this.camera.lookAt(target);
      this._syncControlsUp(); this.controls.update?.(); this._dirty = true; this.emit('camera'); return;
    }
    this._camAnim = { t0: performance.now(), dur: 200, p0: this.camera.position.clone(), p1, u0: this.camera.up.clone(), u1, c0: this.controls.target.clone(), c1: target };
  }

  /** Centre a client-space rectangle and zoom until it fills the view (R+drag). */
  zoomToRect(x0, y0, x1, y1) {
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    if (!(w >= 2 || h >= 2)) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.panBy(r.left + r.width / 2 - (x0 + x1) / 2, r.top + r.height / 2 - (y0 + y1) / 2);
    this.zoomBy(clamp(Math.min(r.width / Math.max(w, 1), r.height / Math.max(h, 1)), 1, 40));
  }

  /** Move the model on screen by (dx, dy) CSS pixels (+x right, +y down). */
  panBy(dx = 0, dy = 0) {
    if (!dx && !dy) return;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const perPx = cam.isOrthographicCamera
      ? (cam.top - cam.bottom) / (cam.zoom || 1) / this.height
      : (2 * cam.position.distanceTo(this.controls.target) * Math.tan((cam.fov * DEG) / 2)) / this.height;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const delta = right.multiplyScalar(-dx * perPx).addScaledVector(upv, dy * perPx);
    cam.position.add(delta); this.controls.target.add(delta);
    const a = this._camAnim;
    if (a) { a.p0.add(delta); a.p1.add(delta); a.c0.add(delta); a.c1.add(delta); }
    this.controls.update?.();
    this._dirty = true;
    this.emit('camera');
  }

  /**
   * Position, up, target and zoom of the scene's camera. During an axis view's temporary orthographic
   * camera the state is converted to the equivalent perspective framing (zoom 1), because the scene
   * (and so a reopened project) still uses the perspective camera.
   */
  getCameraState() {
    const cam = this.camera, target = this.controls.target;
    if (this._tempOrtho && cam.isOrthographicCamera) {
      const half = (this._orthoHalf ?? 10) / (cam.zoom || 1);
      const dist = half / Math.tan((this.persp.fov * DEG) / 2);
      const dir = new THREE.Vector3().subVectors(cam.position, target);
      if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
      const pos = target.clone().addScaledVector(dir.normalize(), dist);
      return { position: pos.toArray(), up: cam.up.toArray(), target: target.toArray(), zoom: 1 };
    }
    return { position: cam.position.toArray(), up: cam.up.toArray(), target: target.toArray(), zoom: cam.zoom ?? 1 };
  }

  setCameraState(c) {
    if (!c?.position) return;
    this._leaveTempOrtho();   // a saved state describes the scene's own projection
    this._camAnim = null;
    this.camera.position.fromArray(c.position); this.camera.up.fromArray(c.up ?? [0, 1, 0]); this.controls.target.fromArray(c.target ?? [0, 0, 0]);
    if (c.zoom && this.camera.isOrthographicCamera) { this.camera.zoom = c.zoom; this.camera.updateProjectionMatrix(); }
    this.camera.lookAt(this.controls.target); this._syncControlsUp(); this.controls.update(); this._hasView = true; this._dirty = true;
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
    if (w > 16 && h > 16) {   // (a hidden or collapsed view keeps the framing of its last real size)
      const f = this._frameSize;
      if (f && (f[0] !== w || f[1] !== h)) this._keepFraming(f[0], f[1]);
      this._frameSize = [w, h];
    }
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.overlay.width = w * pr; this.overlay.height = h * pr;
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    this._updateOrtho();
    this.resolution.set(w, h);
    this.root.traverse((o) => { if (o.material?.isLineMaterial) o.material.resolution.set(w, h); });
    this.post.setSize(w, h);
    this.controls.handleResize?.();   // TrackballControls measures the view for its rotation centre
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
      // performance.now(), not the frame timestamp: that can predate an animation started in between frames
      const t = clamp((performance.now() - a.t0) / a.dur, 0, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // interpolate around the target to keep distance smooth
      const c = a.c0.clone().lerp(a.c1, e);
      const d0 = a.p0.clone().sub(a.c0), d1 = a.p1.clone().sub(a.c1);
      const len = d0.length() + (d1.length() - d0.length()) * e;
      const dir = d0.normalize().lerp(d1.clone().normalize(), e);
      if (dir.lengthSq() < 1e-8) dir.copy(d1).normalize();
      dir.normalize();
      this.camera.position.copy(c).addScaledVector(dir, len);
      const up = a.u0.clone().lerp(a.u1, e);
      this.camera.up.copy(up.lengthSq() > 1e-8 ? up.normalize() : a.u1);
      this.controls.target.copy(c);
      this.camera.lookAt(c);
      this._syncControlsUp();
      if (t >= 1) { this._camAnim = null; this.emit('camera'); }
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
    this.post.setViewHeight(2 * this._viewHalfHeight());
    // a model that fills the frame would turn wide bloom into a full-screen haze: tighten the spread
    if (this.post.bloom) {
      const cover = (this.bounds.radius + (this.maxRadius ?? 0)) / Math.max(1e-6, this._viewHalfHeight());
      this.post.setBloomScale(cover > 0.45 ? Math.max(0.2, 0.45 / cover) : 1);
    }
  }

  /** Half the visible height (Å) at the target distance. */
  _viewHalfHeight() {
    const cam = this.camera;
    if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / 2 / (cam.zoom || 1);
    return cam.position.distanceTo(this.controls.target) * Math.tan((cam.fov * DEG) / 2);
  }

  render({ gizmo = true, overlay = true } = {}) {
    this._updateClipping();
    this.lights.update(this.camera);
    const live = !!this.model;
    for (const k in this._halo) this._halo[k].visible = live;
    if (!live) this.floor.visible = false;
    try {
      if (this.post.active) this.post.render();
      else { this.renderer.setRenderTarget(null); this.renderer.render(this.scene3, this.camera); }
      if (gizmo && this.settings.display.axes) {
        const cell = this._cell();
        const dark = { dark: !!this.overlayDark };
        if (cell) this.gizmo.setAxes(cell, ['a', 'b', 'c'], dark); else this.gizmo.setAxes([[1, 0, 0], [0, 1, 0], [0, 0, 1]], ['x', 'y', 'z'], dark);
        this.gizmo.render(this.renderer, this.camera, 8, 8);
      }
    } catch (err) {
      console.error(err);
    }
    this._flushTrash();
    if (overlay) this.drawOverlay(this.overlay.getContext('2d'), this.renderer.getPixelRatio());
    this._dirty = !overlay;   // a frame drawn for an export left the overlay canvas on the previous model
    this.emit('render');
  }

  project(x, y, z, w, h) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h, v.z];
  }

  /** Overlay pixels per Å at the target depth (exact for the orthographic camera). */
  pixelsPerAngstrom(h = this.height) {
    return h / 2 / Math.max(1e-6, this._viewHalfHeight());
  }

  /**
   * Labels, measurement values, cell axis letters, colour legend and scale bar on a 2D canvas.
   * opt.export: drawing into an image export (no status bar to keep clear of).
   */
  drawOverlay(g, scale = 1, w = this.width * scale, h = this.height * scale, opt = {}) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    const m = this.model;
    if (!m) return;
    const d = this.settings.display;
    const dark = this.overlayDark;
    const css = this._cssTheme();
    const fg = dark ? '#f1f3f5' : '#14171b', halo = dark ? 'rgba(10,12,15,.85)' : 'rgba(255,255,255,.9)';
    const fontFam = css.font;
    const text = (t, x, y, size, color = fg, weight = 500) => {
      g.font = `${weight} ${size * scale}px ${fontFam}`;
      g.lineWidth = 3 * scale; g.strokeStyle = halo; g.lineJoin = 'round';
      g.strokeText(t, x, y); g.fillStyle = color; g.fillText(t, x, y);
    };
    this.camera.updateMatrixWorld();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // cell letters reserve their spots first, so atom labels skip them instead of stacking on them
    const occ = this._occupancy(w, h, scale);
    if (d.cell?.show && d.cell?.labels && m.cell) this._drawCellLetters(g, scale, w, h, text, fg, occ, opt);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (d.labels && d.labels !== 'none') this._drawLabels(g, scale, w, h, fg, halo, fontFam, occ);
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const accent = css.accentStrong;
    for (const ms of this.measurements) {
      if (!ms.valid || !Number.isFinite(ms.value)) continue;
      const P = ms.idx.map((i) => this.project(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2], w, h));
      const mid = ms.type === 'distance' ? [(P[0][0] + P[1][0]) / 2, (P[0][1] + P[1][1]) / 2] : P[ms.type === 'angle' ? 1 : 1].slice(0, 2);
      const label = ms.type === 'distance' ? `${ms.value.toFixed(3)} Å` : `${ms.value.toFixed(1)}°`;
      text(label, mid[0], mid[1] - 12 * scale, 12.5, accent, 700);
    }
    const mode = d.legend === true ? 'always' : d.legend === false ? 'none' : (d.legend ?? 'auto');
    const info = this.colors?.legend;
    const legend = info && mode !== 'none' && (info.kind === 'gradient' || mode === 'always') ? info : null;
    const ppa = d.scaleBar ? this.pixelsPerAngstrom(h) : null;
    if (legend || ppa) {
      const traj = !opt.export && (this.structure?.nFrames ?? 1) > 1;
      drawLegends(g, { legend, pxPerAngstrom: ppa, width: w, height: h, scale, dark, font: fontFam, right: opt.export ? 16 : 14, bottom: opt.export ? 16 : (traj ? 96 : 38) });
    }
  }

  /**
   * Atom labels: only atoms whose centre is not covered by a nearer atom, nearest first, skipping any
   * label that would overlap one already placed (coarse occupancy grid); farther labels fade.
   */
  _drawLabels(g, scale, w, h, fg, halo, fontFam, occ = this._occupancy(w, h, scale)) {
    const m = this.model, d = this.settings.display, cam = this.camera;
    const showAll = m.n <= 600;
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    const vw = cam.matrixWorldInverse.elements;
    const persp = cam.isPerspectiveCamera;
    const tanH = Math.tan(((cam.fov ?? 30) * DEG) / 2);
    const orthoHalf = persp ? 0 : (cam.top - cam.bottom) / 2 / (cam.zoom || 1);
    const p = m.positions, cand = [];
    for (let i = 0; i < m.n; i++) {
      if (!showAll && !this.selection.has(m.src[i])) continue;
      const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (cw <= 0) continue;
      const nz = (vp[2] * x + vp[6] * y + vp[10] * z + vp[14]) / cw;
      if (nz < -1 || nz > 1) continue;
      const sx = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw + 1) / 2 * w;
      const sy = (1 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw) / 2 * h;
      const depth = -(vw[2] * x + vw[6] * y + vw[10] * z + vw[14]);
      const unit = persp ? h / 2 / Math.max(1e-6, depth * tanH) : h / 2 / Math.max(1e-6, orthoHalf);
      cand.push({ i, sx, sy, depth, r: (this.radii?.[i] ?? 0.3) * unit });
    }
    if (!cand.length) return;
    cand.sort((a, b) => a.depth - b.depth);
    const dmin = cand[0].depth, dspan = Math.max(1e-6, cand[cand.length - 1].depth - dmin);
    // nearer atoms' discs by screen cell (occlusion) and placed label boxes (overlap)
    const C = 32 * scale, cols = Math.max(1, Math.ceil(w / C)), rows = Math.max(1, Math.ceil(h / C));
    const discs = new Map();
    const size = (d.labelSize ?? 12) * scale;
    g.font = `600 ${size}px ${fontFam}`;
    g.lineWidth = 3 * scale; g.strokeStyle = halo; g.lineJoin = 'round'; g.fillStyle = fg;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const c of cand) {
      const ci = Math.floor(c.sx / C), cj = Math.floor(c.sy / C);
      let hidden = false;
      const list = ci >= 0 && ci < cols && cj >= 0 && cj < rows ? discs.get(cj * cols + ci) : null;
      if (list) for (const q of list) if ((q.x - c.sx) ** 2 + (q.y - c.sy) ** 2 < (q.r * 0.92) ** 2) { hidden = true; break; }
      // register this atom's disc (it hides atoms further back), clipped to a sane footprint
      const rr = Math.min(c.r, 8 * C);
      const i0 = Math.max(0, Math.floor((c.sx - rr) / C)), i1 = Math.min(cols - 1, Math.floor((c.sx + rr) / C));
      const j0 = Math.max(0, Math.floor((c.sy - rr) / C)), j1 = Math.min(rows - 1, Math.floor((c.sy + rr) / C));
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const k = jj * cols + ii;
        let arr = discs.get(k);
        if (!arr) discs.set(k, arr = []);
        arr.push({ x: c.sx, y: c.sy, r: c.r });
      }
      if (hidden) continue;
      const t = d.labels === 'element' ? m.symbols[c.i] : d.labels === 'index' ? String(m.src[c.i]) : `${m.symbols[c.i]}${m.src[c.i]}`;
      const tw = g.measureText(t).width + 4 * scale, th = size + 2 * scale;
      const box = [c.sx - tw / 2, c.sy - th / 2, c.sx + tw / 2, c.sy + th / 2];
      if (!occ.free(...box)) continue;
      occ.mark(...box);
      g.globalAlpha = 1 - 0.5 * ((c.depth - dmin) / dspan);
      g.strokeText(t, c.sx, c.sy); g.fillText(t, c.sx, c.sy);
    }
    g.globalAlpha = 1;
  }

  /** Coarse occupancy grid over the overlay (6 px cells): placed letters and labels reserve their boxes. */
  _occupancy(w, h, scale) {
    const L = 6 * scale, cols = Math.max(1, Math.ceil(w / L)), rows = Math.max(1, Math.ceil(h / L));
    const used = new Uint8Array(cols * rows);
    const span = (x0, y0, x1, y1) => [Math.max(0, Math.floor(x0 / L)), Math.min(cols - 1, Math.floor(x1 / L)), Math.max(0, Math.floor(y0 / L)), Math.min(rows - 1, Math.floor(y1 / L))];
    return {
      free(x0, y0, x1, y1) {
        const [a0, a1, b0, b1] = span(x0, y0, x1, y1);
        for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) if (used[j * cols + i]) return false;
        return true;
      },
      mark(x0, y0, x1, y1) {
        const [a0, a1, b0, b1] = span(x0, y0, x1, y1);
        for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) used[j * cols + i] = 1;
      },
    };
  }

  /**
   * Screen discs [x, y, r, …] (overlay pixels) of the drawn atoms in front of the camera. Large models
   * return null plus `pad`: callers then use the projected bounding box, grown by the largest atom.
   */
  _screenDiscs(w, h) {
    const m = this.model, cam = this.camera;
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    const vw = cam.matrixWorldInverse.elements;
    const persp = cam.isPerspectiveCamera;
    const tanH = Math.tan(((cam.fov ?? 30) * DEG) / 2);
    const orthoUnit = persp ? 0 : h / 2 / Math.max(1e-6, (cam.top - cam.bottom) / 2 / (cam.zoom || 1));
    const unitAt = (depth) => (persp ? h / 2 / Math.max(1e-6, depth * tanH) : orthoUnit);
    const proj = (x, y, z) => {
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (cw <= 0) return null;
      return [((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw + 1) / 2 * w, (1 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw) / 2 * h, -(vw[2] * x + vw[6] * y + vw[10] * z + vw[14])];
    };
    if (m.n > LETTER_DISC_LIMIT) {
      // the 8 corners of the atoms' bounding box; `pad` covers the largest atom at the nearest corner
      const b = this.bounds, pts = [];
      let pad = 0;
      if (b.min && b.max) for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
        const q = proj(x, y, z);
        if (!q) continue;
        pts.push([q[0], q[1]]);
        pad = Math.max(pad, (this.maxRadius ?? 0) * unitAt(q[2]));
      }
      return { discs: null, hullPts: pts, pad };
    }
    // runs on every frame while letters are shown: plain arithmetic, no per-atom allocations
    const p = m.positions, radii = this.radii, out = new Float32Array(3 * m.n);
    let k = 0;
    for (let i = 0; i < m.n; i++) {
      const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      const depth = -(vw[2] * x + vw[6] * y + vw[10] * z + vw[14]);
      if (cw <= 0 || depth <= 0) continue;
      out[k++] = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw + 1) / 2 * w;
      out[k++] = (1 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw) / 2 * h;
      out[k++] = (radii?.[i] ?? 0.3) * unitAt(depth);
    }
    return { discs: out.subarray(0, k), hullPts: [], pad: 0 };
  }

  /**
   * O, a, b, c at the ends of the displayed (super)cell edges. Each letter sits on the ray from the view
   * centre through its edge end, just outside both the cell outline and every atom disc on that ray, so
   * it never lands on an atom or its label. A letter that would hit another one (or the axis gizmo, or
   * the canvas edge) turns around the centre in small steps; one far from its edge end gets a faint
   * leader. The letters' boxes are reserved in `occ` before the atom labels are placed.
   */
  _drawCellLetters(g, scale, w, h, text, fg, occ, opt = {}) {
    const m = this.model, c = this.settings.display.cell;
    const [A, B, C] = m.cell;
    const N = c.which === 'supercell' || c.which === 'grid' ? m.supercell : [1, 1, 1];
    const P = (a, b, cc) => this.project(a * A[0] + b * B[0] + cc * C[0], a * A[1] + b * B[1] + cc * C[1], a * A[2] + b * B[2] + cc * C[2], w, h);
    const corners = [];
    for (const a of [0, N[0]]) for (const b of [0, N[1]]) for (const cc of [0, N[2]]) corners.push(P(a, b, cc));
    if (corners.some((q) => q[2] < -1 || q[2] > 1)) return;
    const shape = this._screenDiscs(w, h);
    const hull = convexHull(corners.map((q) => [q[0], q[1]]).concat(shape.hullPts));
    const D = shape.discs, nd = D ? D.length / 3 : 0;
    const ctr = this.project(this.bounds.center.x, this.bounds.center.y, this.bounds.center.z, w, h);
    const rho = 8 * scale, gap = 4 * scale, clear = rho + gap;   // letter half-size and clearance
    // distance from the centre along (ux, uy) at which a letter clears the outline and every atom
    const clearAt = (ux, uy) => {
      let t = (hull.length > 2 ? rayExit(hull, ctr[0], ctr[1], ux, uy) ?? 0 : 0) + shape.pad + clear;
      for (let k = 0; k < nd; k++) {
        const dx = D[3 * k] - ctr[0], dy = D[3 * k + 1] - ctr[1], R = D[3 * k + 2] + clear;
        const tca = dx * ux + dy * uy, d2 = dx * dx + dy * dy - tca * tca;
        if (d2 >= R * R) continue;
        const far = tca + Math.sqrt(R * R - d2);
        if (far > t) t = far;
      }
      return t;
    };
    // radius of the largest atom drawn over a screen point (the corner atom a leader starts outside of)
    const coverAt = (x, y) => {
      let r = 0;
      for (let k = 0; k < nd; k++) {
        const dx = D[3 * k] - x, dy = D[3 * k + 1] - y, R = D[3 * k + 2];
        if (dx * dx + dy * dy < R * R) r = Math.max(r, R - Math.hypot(dx, dy));
      }
      return r;
    };
    const gz = this.gizmo.size * scale;
    const gizmo = this.settings.display.axes && (opt.export ? opt.gizmo : true) ? [8 * scale, h - 8 * scale - gz, 8 * scale + gz, h - 8 * scale] : null;
    const placed = [];
    const ok = (x, y) => {
      if (x < rho || y < rho || x > w - rho || y > h - rho) return false;
      if (gizmo && x + rho > gizmo[0] && x - rho < gizmo[2] && y + rho > gizmo[1] && y - rho < gizmo[3]) return false;
      return placed.every((p) => Math.hypot(p[0] - x, p[1] - y) >= 2 * rho + 2 * scale);
    };
    const STEPS = [0, 15, -15, 30, -30, 45, -45, 60, -60, 90, -90];
    const place = (q, fallbackDir) => {
      let ux = q[0] - ctr[0], uy = q[1] - ctr[1];
      if (Math.hypot(ux, uy) < 1e-3) [ux, uy] = fallbackDir;
      const base = Math.atan2(uy, ux);
      let first = null;
      for (const deg of STEPS) {
        const ang = base + deg * DEG, vx = Math.cos(ang), vy = Math.sin(ang);
        const t = clearAt(vx, vy), x = ctr[0] + vx * t, y = ctr[1] + vy * t;
        first ??= [x, y];
        if (ok(x, y)) return [x, y];
      }
      // no free spot on the canvas: keep the letter on screen next to its edge end (if that is visible)
      if (q[0] < 0 || q[1] < 0 || q[0] > w || q[1] > h) return null;
      return [clamp(first[0], rho, w - rho), clamp(first[1], rho, h - rho)];
    };
    const draw = (q, spot, label, size, color, weight, leaderColor) => {
      const [x, y] = spot;
      const dist = Math.hypot(x - q[0], y - q[1]);
      const r0 = coverAt(q[0], q[1]);
      if (leaderColor && dist > r0 + clear + 10 * scale) {
        // faint leader from the edge end (outside its corner atom) to the letter
        const vx = (x - q[0]) / dist, vy = (y - q[1]) / dist;
        g.save();
        g.strokeStyle = leaderColor; g.globalAlpha = 0.45; g.lineWidth = 1 * scale; g.setLineDash([3 * scale, 3 * scale]);
        g.beginPath(); g.moveTo(q[0] + vx * r0, q[1] + vy * r0); g.lineTo(x - vx * rho, y - vy * rho); g.stroke();
        g.restore();
      }
      text(label, x, y, size, color, weight);
      placed.push([x, y]);
      occ.mark(x - rho, y - rho, x + rho, y + rho);
    };
    const O = P(0, 0, 0);
    const o = place(O, [-1, 1]);
    if (o) draw(O, o, 'O', 12, fg, 600, fg);
    const [ca, cb, cc] = axisColors(this.overlayDark);
    [[[N[0], 0, 0], 'a', ca], [[0, N[1], 0], 'b', cb], [[0, 0, N[2]], 'c', cc]].forEach(([idx, l, col]) => {
      const q = P(...idx);
      const spot = place(q, [q[0] - O[0], q[1] - O[1]]);
      if (spot) draw(q, spot, l, 14, col, 700, col);
    });
  }

  // ------------------------------------------------------------------ export
  /**
   * High-resolution PNG. Returns a Blob. With `transparent` the background is left out (bloom and
   * depth of field keep the alpha). Labels, legend and scale bar are drawn in at the same scale.
   */
  async screenshot({ scale = 2, transparent = false, gizmo = false, maxSize = 8192 } = {}) {
    const pr0 = this.renderer.getPixelRatio();
    const w0 = this.width, h0 = this.height;
    scale = Math.min(scale, maxSize / Math.max(w0, h0));
    const W = Math.round(w0 * scale), H = Math.round(h0 * scale);
    const bg = this.scene3.background, clearA = this.renderer.getClearAlpha(), postT = this.post.transparent;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.post.setSize(W, H);
    const lineMats = [];
    this.root.traverse((o) => { if (o.material?.isLineMaterial) { lineMats.push([o.material, o.material.linewidth]); o.material.resolution.set(W, H); o.material.linewidth *= scale; } });
    const ink = this.post.ink;
    const inkT = ink?.uniforms.thickness.value;
    if (ink) ink.uniforms.thickness.value = inkT * scale;
    if (transparent) { this.scene3.background = null; this.renderer.setClearAlpha(0); this.post.setTransparent(true); }
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const g = out.getContext('2d');
    try {
      this.render({ gizmo, overlay: false });
      g.drawImage(this.renderer.domElement, 0, 0);
      const ov = document.createElement('canvas'); ov.width = W; ov.height = H;
      this.drawOverlay(ov.getContext('2d'), scale, W, H, { export: true, gizmo });
      g.drawImage(ov, 0, 0);
    } finally {
      this.scene3.background = bg; this.renderer.setClearAlpha(clearA); this.post.setTransparent(postT);
      if (ink) ink.uniforms.thickness.value = inkT;
      lineMats.forEach(([mat, lw]) => { mat.linewidth = lw; });
      this.renderer.setPixelRatio(pr0);
      this.resize();
      this.render();
    }
    return new Promise((res) => out.toBlob(res, 'image/png'));
  }

  /** Small JPEG data URL for project thumbnails. */
  thumbnail(w = 320, h = 200, quality = 0.82) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    this.render({ gizmo: false, overlay: false });
    const src = this.renderer.domElement;
    const s = Math.max(w / src.width, h / src.height);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(src, (w - src.width * s) / 2, (h - src.height * s) / 2, src.width * s, src.height * s);
    this.render();   // draw the normal view (gizmo, labels, cell letters) again now, so view and overlay never disagree
    return c.toDataURL('image/jpeg', quality);
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
    this._flushTrash();
    this._haloGeo.dispose();
    for (const k in this._halo) this._halo[k].material.dispose();
    this.renderer.dispose();
  }
}

function luminance(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

/** 2D convex hull (monotone chain), counter-clockwise in screen coordinates. */
function convexHull(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of P) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Distance along the ray (ox, oy) + t·(ux, uy) to where it leaves the convex polygon (origin inside). */
function rayExit(hull, ox, oy, ux, uy) {
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den;
    const s = ((a[0] - ox) * uy - (a[1] - oy) * ux) / den;
    if (t >= 0 && s >= -1e-6 && s <= 1 + 1e-6 && (best === null || t > best)) best = t;
  }
  return best;
}

/** Number of atoms each measurement type takes. */
// Null prototype: names inherited from Object.prototype ('toString', '__proto__', …) are not measurement types.
export const MEASURE_ARITY = Object.freeze(Object.assign(Object.create(null), { distance: 2, angle: 3, dihedral: 4 }));
/** Arity of a measurement type; undefined for anything that is not exactly one of the type names (arrays, objects, symbols…). */
export const measureArity = (type) => (typeof type === 'string' ? MEASURE_ARITY[type] : undefined);

/** Distance (Å) or angle / dihedral (°) of points P; NaN for an unknown type or the wrong number of points. */
export function measureValue(type, P) {
  if (measureArity(type) !== P?.length) return NaN;
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
