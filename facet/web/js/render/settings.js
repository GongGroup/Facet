/** Default scene settings (the `scene` object stored in projects). */
import { presetToSettings } from './lighting.js';
import { deepClone, deepMerge, getPath } from '../core/util.js';

export const DEFAULT_SCENE = {
  look: 'studio',
  lookBase: 'studio',            // the look the scene started from; `look` becomes null once settings are customised
  style: {
    rep: 'ballstick', radiusSource: 'atomic', atomScale: 0.42, bondRadius: 0.13, bondColor: 'split', bondUniformColor: '#9aa1ab',
    colorScheme: 'jmol', monoColor: '#c9ced6', colorOverrides: {}, property: null,
    material: 'standard', roughness: null, metalness: null, opacity: 1,
    bondMaterial: 'auto',          // 'auto' (opaque bonds under glass/x-ray atoms) | 'same' | a material preset id
    radiusOverrides: {},           // { [symbol]: base radius in Å } — scaled by atomScale like table radii
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
    dropShadow: { enabled: false, distance: 0.3, softness: 0.25, opacity: 0.35, angle: -55, color: '#1c1a17' },   // Å, Å, 0–1, degrees
    paper: { enabled: false, strength: 0.6 },
  },
  display: {
    background: { mode: 'gradient', color1: '#f7f8fa', color2: '#dde2e8' },
    cell: { show: true, color: '#3b4048', width: 1.6, which: 'unit', labels: true },
    axes: true, labels: 'none', labelSize: 12,
    supercell: [1, 1, 1], wrap: true, boundaryAtoms: true, completeBonds: false,
    bonds: { show: true, tolerance: 1.15, smart: true, pairOverrides: {}, maxLength: 4.5 },
    hiddenElements: [], projection: 'perspective', fov: 30, controls: 'orbit', turntable: false,
    orthoAxisViews: true,          // views along a/b/c/x/y/z use an orthographic camera until the next free rotation
    legend: 'auto',                // 'auto' (colour bar for per-atom schemes) | 'always' (also element chips) | 'none'
    scaleBar: false,               // length scale bar (1/2/5 Å steps) in the viewport and in image exports
  },
  camera: null,
};

export function makeScene(partial) {
  return deepMerge(deepClone(DEFAULT_SCENE), partial ?? {});
}

/**
 * The values at dotted scene paths (['display.layers', …]), e.g. those a colour scheme declares in `dependsOn`:
 * the viewer recomputes colours when they change. No list (or an empty one) gives null; a path that is not a
 * string, or leads nowhere, reads as null.
 */
export function scenePathValues(scene, paths) {
  if (!Array.isArray(paths) || !paths.length) return null;
  return paths.map((p) => (typeof p === 'string' ? getPath(scene, p) ?? null : null));
}
