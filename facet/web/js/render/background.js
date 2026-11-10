/** Scene backgrounds: solid, linear gradient, radial gradient or transparent. */
import * as THREE from '../../vendor/three/three.module.js';

let cache = { key: null, tex: null };

export function makeBackground(bg) {
  const mode = bg?.mode ?? 'solid';
  if (mode === 'transparent') return { background: null, fogColor: new THREE.Color(bg.color1 ?? '#ffffff'), alpha: 0 };
  if (mode === 'solid') return { background: new THREE.Color(bg.color1), fogColor: new THREE.Color(bg.color1), alpha: 1 };
  const key = `${mode}|${bg.color1}|${bg.color2}`;
  if (cache.key !== key) {
    cache.tex?.dispose();
    const c = document.createElement('canvas');
    c.width = 16; c.height = 512;
    if (mode === 'radial') { c.width = 512; c.height = 512; }
    const g = c.getContext('2d');
    let grad;
    if (mode === 'radial') grad = g.createRadialGradient(256, 230, 10, 256, 256, 380);
    else grad = g.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, bg.color1);
    grad.addColorStop(1, bg.color2);
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    cache = { key, tex };
  }
  const fog = new THREE.Color(bg.color1).lerp(new THREE.Color(bg.color2), 0.5);
  return { background: cache.tex, fogColor: fog, alpha: 1 };
}
