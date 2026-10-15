/** Default scene settings (the `scene` object stored in projects). */
import { presetToSettings } from './lighting.js';
import { deepClone, deepMerge } from '../core/util.js';

export const DEFAULT_SCENE = {
  look: 'publication',
  style: {
    rep: 'ballstick', radiusSource: 'atomic', atomScale: 0.42, bondRadius: 0.13, bondColor: 'split', bondUniformColor: '#9aa1ab',
    colorScheme: 'jmol', monoColor: '#c9ced6', colorOverrides: {}, property: null,
    material: 'standard', roughness: null, metalness: null, opacity: 1,
    polyhedra: { centers: 'auto', opacity: 0.55, edges: true, edgeColor: '#22262c' },
    lineWidth: 2.5, quality: 'auto',
  },
  lighting: {
    ...presetToSettings('studio'), follow: true,
    shadows: { enabled: false, softness: 3, floor: false }, exposure: 1, toneMapping: 'neutral',
  },
  post: {
    ao: { enabled: true, intensity: 1, radius: 0.6 },
    outline: { enabled: false, thickness: 1.5, color: '#16181c', sensitivity: 1, strength: 1, creases: true },
    bloom: { enabled: false, strength: 0.6, radius: 0.4, threshold: 0.8 },
    dof: { enabled: false, aperture: 2, maxblur: 0.008 },
    vignette: { enabled: false, darkness: 1.1, offset: 1 },
    fog: { enabled: false, strength: 0.5 },
  },
  display: {
    background: { mode: 'gradient', color1: '#f7f8fa', color2: '#dde2e8' },
    cell: { show: true, color: '#3b4048', width: 1.6, which: 'unit', labels: true },
    axes: true, labels: 'none', labelSize: 12,
    supercell: [1, 1, 1], wrap: true, boundaryAtoms: true, completeBonds: false,
    bonds: { show: true, tolerance: 1.15, smart: true, pairOverrides: {}, maxLength: 4.5 },
    hiddenElements: [], projection: 'perspective', fov: 30, controls: 'orbit', turntable: false,
  },
  camera: null,
};

export function makeScene(partial) {
  return deepMerge(deepClone(DEFAULT_SCENE), partial ?? {});
}
