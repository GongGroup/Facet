/** Orientation gizmo drawn in a corner: x/y/z or a/b/c arrows that follow the camera. Click to align. */
import * as THREE from '../../vendor/three/three.module.js';

function labelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 40px "IBM Plex Sans", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, toneMapped: false }));
  s.scale.set(0.55, 0.55, 0.55);
  return s;
}

export class AxisGizmo {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
    this.size = 104;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(1, 1, 2); this.scene.add(d);
    this.axes = [];
    this.mode = null;
    this.setAxes([[1, 0, 0], [0, 1, 0], [0, 0, 1]], ['x', 'y', 'z']);
  }

  setAxes(vectors, labels) {
    const key = JSON.stringify([vectors.map((v) => v.map((x) => +x.toFixed(4))), labels]);
    if (key === this.mode) return;
    this.mode = key;
    this.group.clear();
    this.axes = [];
    const colors = ['#e5484d', '#30a46c', '#3e63dd'];
    vectors.forEach((v, i) => {
      const dir = new THREE.Vector3(...v).normalize();
      const mat = new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.4, toneMapped: false });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.8, 12), mat);
      shaft.position.copy(dir).multiplyScalar(0.4);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 16), mat);
      head.position.copy(dir).multiplyScalar(0.92);
      head.quaternion.copy(shaft.quaternion);
      const lab = labelSprite(labels[i], colors[i]);
      lab.position.copy(dir).multiplyScalar(1.3);
      shaft.userData.axis = head.userData.axis = lab.userData.axis = { dir: dir.clone(), label: labels[i] };
      this.group.add(shaft, head, lab);
      this.axes.push({ dir, label: labels[i], hit: [shaft, head, lab] });
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshStandardMaterial({ color: '#9aa1ab', toneMapped: false }));
    this.group.add(ball);
  }

  render(renderer, mainCamera, x, y) {
    this.camera.position.set(0, 0, 4).applyQuaternion(mainCamera.quaternion);
    this.camera.quaternion.copy(mainCamera.quaternion);
    this.camera.updateMatrixWorld();
    const prevAuto = renderer.autoClear;
    const vp = renderer.getViewport(new THREE.Vector4()), sc = renderer.getScissor(new THREE.Vector4());
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, this.size, this.size);
    renderer.setScissor(x, y, this.size, this.size);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(vp);
    renderer.setScissor(sc);
    renderer.autoClear = prevAuto;
  }

  /** ndc within the gizmo square -> axis hit or null */
  pick(nx, ny) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = ray.intersectObjects(this.group.children, false).filter((h) => h.object.userData.axis);
    return hits[0]?.object.userData.axis ?? null;
  }
}
