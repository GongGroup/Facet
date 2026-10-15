/**
 * Looks: one-click combinations of material, colours, lighting, effects and background.
 *   looks.register({ id, name, description, swatch, scene: <partial scene> })
 * Looks deliberately leave the representation alone unless they set `style.rep`.
 */
import { presetToSettings } from './lighting.js';

const registry = new Map();
export const looks = {
  register(l) { registry.set(l.id, l); return () => registry.delete(l.id); },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
};

const light = (id, extra = {}) => ({ ...presetToSettings(id), ...extra });
const off = { ao: { enabled: false }, outline: { enabled: false }, bloom: { enabled: false }, dof: { enabled: false }, vignette: { enabled: false }, fog: { enabled: false } };
const post = (p) => ({ ...JSON.parse(JSON.stringify(off)), ...p });

[
  { id: 'publication', name: 'Publication', description: 'Clean satin spheres, studio light and soft occlusion on a pale gradient',
    swatch: 'radial-gradient(circle at 38% 35%, #fff 0, #cfd7e2 20%, #6f7f93 75%), linear-gradient(#f7f8fa,#dde2e8)',
    scene: { style: { material: 'standard', colorScheme: 'jmol' }, lighting: light('studio', { shadows: { enabled: false } }), post: post({ ao: { enabled: true, intensity: 1, radius: 0.6 } }),
      display: { background: { mode: 'gradient', color1: '#f7f8fa', color2: '#dde2e8' }, cell: { color: '#3b4048' } } } },
  { id: 'vesta', name: 'VESTA', description: 'Phong highlights, headlight and VESTA colours on white',
    swatch: 'radial-gradient(circle at 34% 30%, #fff 0, #fff 6%, #fe0300 18%, #8a0000 80%)',
    scene: { style: { material: 'phong', colorScheme: 'vesta' }, lighting: light('headlight'), post: post({}),
      display: { background: { mode: 'solid', color1: '#ffffff', color2: '#ffffff' }, cell: { color: '#000000' } } } },
  { id: 'ink', name: 'Illustration', description: 'Cel shading with crisp ink outlines, like a textbook figure',
    swatch: 'radial-gradient(circle at 50% 50%, #9fd4b4 0 52%, #1b1b1b 54% 60%, #fbfbf9 62%)',
    scene: { style: { material: 'toon', colorScheme: 'pastel' }, lighting: light('flat'), post: post({ outline: { enabled: true, thickness: 1.6, color: '#16181c', sensitivity: 1, strength: 1 }, ao: { enabled: false } }),
      display: { background: { mode: 'solid', color1: '#fbfbf9', color2: '#fbfbf9' }, cell: { color: '#16181c' } } } },
  { id: 'qutemol', name: 'QuteMol', description: 'Matte surfaces, deep ambient occlusion and silhouette edges',
    swatch: 'radial-gradient(circle at 45% 40%, #e9ecef 0, #a9b2bb 50%, #3a4048 85%, #fff 88%)',
    scene: { style: { material: 'matte', colorScheme: 'muted' }, lighting: light('softbox'), post: post({ ao: { enabled: true, intensity: 1.8, radius: 1.2 }, outline: { enabled: true, thickness: 1.1, color: '#20242a', sensitivity: 0.9, strength: 0.85, creases: false } }),
      display: { background: { mode: 'solid', color1: '#ffffff', color2: '#ffffff' }, cell: { color: '#4a5059' } } } },
  { id: 'clay', name: 'Clay studio', description: 'Chalky clay, soft daylight and a contact-shadow floor',
    swatch: 'radial-gradient(circle at 40% 35%, #f6eee6 0, #d9c9ba 45%, #9b8a7b 85%), linear-gradient(#ece8e3,#d6d0c9)',
    scene: { style: { material: 'clay', colorScheme: 'pastel' }, lighting: light('softbox', { shadows: { enabled: true, softness: 4, floor: true } }), post: post({ ao: { enabled: true, intensity: 1.2, radius: 0.8 } }),
      display: { background: { mode: 'gradient', color1: '#efebe6', color2: '#d4cdc5' }, cell: { color: '#5b524a' } } } },
  { id: 'glass', name: 'Glass', description: 'Refractive glass atoms in a dark studio with a little bloom',
    swatch: 'radial-gradient(circle at 35% 30%, #fff 0, #c9f0ff 14%, rgba(80,170,220,.6) 55%, #0c1a2a 100%)',
    scene: { style: { material: 'glass', colorScheme: 'jmol' }, lighting: light('dramatic', { env: { enabled: true, intensity: 0.9 } }), post: post({ bloom: { enabled: true, strength: 0.35, radius: 0.5, threshold: 0.85 } }),
      display: { background: { mode: 'radial', color1: '#22303f', color2: '#07090d' }, cell: { color: '#8aa0b8' } } } },
  { id: 'metallic', name: 'Metallic', description: 'Polished metal under three-point light with reflections',
    swatch: 'radial-gradient(circle at 35% 30%, #fff 0, #ffe7a3 10%, #c08d2c 40%, #3a2508 85%, #15181d 90%)',
    scene: { style: { material: 'metallic', colorScheme: 'jmol' }, lighting: light('three-point', { env: { enabled: true, intensity: 1.3 } }), post: post({ ao: { enabled: true, intensity: 0.9, radius: 0.5 } }),
      display: { background: { mode: 'radial', color1: '#3a4048', color2: '#121418' }, cell: { color: '#aab3be' } } } },
  { id: 'dark', name: 'Dark studio', description: 'Satin finish with a strong rim light on charcoal',
    swatch: 'radial-gradient(circle at 38% 35%, #fff 0, #9fb3cc 18%, #2c3542 75%), linear-gradient(#252a31,#0f1114)',
    scene: { style: { material: 'standard', colorScheme: 'jmol' }, lighting: light('three-point'), post: post({ ao: { enabled: true, intensity: 1, radius: 0.6 } }),
      display: { background: { mode: 'gradient', color1: '#252a31', color2: '#0f1114' }, cell: { color: '#9aa4b1' } } } },
  { id: 'neon', name: 'Neon', description: 'Self-lit atoms with bloom and coloured side lights',
    swatch: 'radial-gradient(circle at 50% 50%, #fff 0, #ffd38a 12%, #ff4fd8 40%, #3fe9ff 60%, #05060a 75%)',
    scene: { style: { material: 'glow', colorScheme: 'jmol' }, lighting: light('neon'), post: post({ bloom: { enabled: true, strength: 0.85, radius: 0.5, threshold: 0.4 } }),
      display: { background: { mode: 'solid', color1: '#05060a', color2: '#05060a' }, cell: { color: '#5f6dff' } } } },
  { id: 'xray', name: 'X-ray', description: 'See-through Fresnel shells with additive glow',
    swatch: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0 40%, #7fe0ff 62%, #0a1422 78%)',
    scene: { style: { material: 'xray', colorScheme: 'jmol' }, lighting: light('flat'), post: post({ bloom: { enabled: true, strength: 0.6, radius: 0.4, threshold: 0.3 } }),
      display: { background: { mode: 'radial', color1: '#0f1d2e', color2: '#03060b' }, cell: { color: '#4c86c6' } } } },
  { id: 'pearl', name: 'Pearl', description: 'Iridescent finish in soft daylight',
    swatch: 'radial-gradient(circle at 35% 30%, #fff 0, #f6ebff 15%, #c8dcf6 45%, #9fb2c4 80%)',
    scene: { style: { material: 'pearl', colorScheme: 'pastel' }, lighting: light('softbox'), post: post({ ao: { enabled: true, intensity: 0.9, radius: 0.6 } }),
      display: { background: { mode: 'gradient', color1: '#f6f4fa', color2: '#dcdbe6' }, cell: { color: '#6a6878' } } } },
  { id: 'sunset', name: 'Golden hour', description: 'Glossy atoms in warm low sunlight',
    swatch: 'radial-gradient(circle at 35% 30%, #fff 0, #ffd2a0 14%, #d1652e 60%, #4a2a40 100%)',
    scene: { style: { material: 'glossy', colorScheme: 'jmol' }, lighting: light('sunset'), post: post({ ao: { enabled: true, intensity: 0.8, radius: 0.6 }, vignette: { enabled: true, darkness: 1.05, offset: 1 } }),
      display: { background: { mode: 'gradient', color1: '#f3c9a5', color2: '#5b4a6e' }, cell: { color: '#3a2a35' } } } },
  { id: 'blueprint', name: 'Blueprint', description: 'Flat blue shapes with white ink on drafting blue',
    swatch: 'linear-gradient(135deg, #1e4f8f 0 40%, #e8f1ff 40% 43%, #2f6db3 43% 70%, #e8f1ff 70% 73%, #1e4f8f 73%)',
    scene: { style: { material: 'flat', colorScheme: 'mono', monoColor: '#2f6db3' }, lighting: light('flat'), post: post({ outline: { enabled: true, thickness: 1.4, color: '#e8f1ff', sensitivity: 1.2, strength: 1 } }),
      display: { background: { mode: 'solid', color1: '#1e4f8f', color2: '#1e4f8f' }, cell: { color: '#e8f1ff' } } } },
  { id: 'polyhedra-studio', name: 'Polyhedra', description: 'Coordination polyhedra in publication lighting', hidden: true,
    swatch: 'linear-gradient(#f7f8fa,#dde2e8)',
    scene: { style: { rep: 'polyhedra', radiusSource: 'atomic', atomScale: 0.3, bondRadius: 0.09, material: 'standard', colorScheme: 'vesta', polyhedra: { opacity: 0.72 } }, lighting: light('studio'), post: post({ ao: { enabled: true, intensity: 0.9, radius: 0.6 } }),
      display: { background: { mode: 'gradient', color1: '#f7f8fa', color2: '#dde2e8' }, cell: { color: '#3b4048' } } } },
].forEach((l) => looks.register(l));
