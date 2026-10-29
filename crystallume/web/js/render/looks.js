/**
 * Looks: one-click combinations of material, colours, lighting, effects and background.
 *   looks.register({ id, name, description, swatch, ball?, scene: <partial scene>, backgroundDark?, hidden? })
 * `swatch` is the card's CSS background; with `ball` (the CSS background of a sphere drawn in the middle of the
 * card, clipped to a circle so it is never cropped) `swatch` is the backdrop behind that sphere.
 * Looks deliberately leave the representation alone unless they set `style.rep`.
 * `backgroundDark` (optional) is the background to use instead of a light one when the interface is
 * dark (e.g. samples opened in dark mode), with `cellDark` as the matching unit-cell line colour;
 * `hidden` looks are not offered in the grid by default.
 */
import { presetToSettings } from './lighting.js';

const registry = new Map();
export const looks = {
  register(l) { registry.set(l.id, l); return () => registry.delete(l.id); },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
};

/** An octahedron (four shaded facets, cut to a diamond by corner masks) on the pale publication backdrop. */
const POLY_BG = '#eceff3';
const POLY_SWATCH = [
  [`to bottom right`, 'calc(50% - 10px) calc(50% - 10px)'], [`to bottom left`, 'calc(50% + 10px) calc(50% - 10px)'],
  [`to top right`, 'calc(50% - 10px) calc(50% + 10px)'], [`to top left`, 'calc(50% + 10px) calc(50% + 10px)'],
].map(([dir, at]) => `linear-gradient(${dir}, ${POLY_BG} 50%, transparent 50%) ${at} / 20px 20px no-repeat`)
  .concat('conic-gradient(#7ea6d8 0 90deg, #3f6aa6 0 180deg, #5a86c0 0 270deg, #b4cff0 0) center / 40px 40px no-repeat', POLY_BG).join(', ');

const light = (id, extra = {}) => ({ ...presetToSettings(id), ...extra });
const off = { ao: { enabled: false }, outline: { enabled: false }, bloom: { enabled: false }, dof: { enabled: false }, vignette: { enabled: false }, fog: { enabled: false } };
const post = (p) => ({ ...JSON.parse(JSON.stringify(off)), ...p });

[
  { id: 'paper', name: 'Paper', description: 'Modern colours, soft studio light and fine silhouettes on pure white — ready for a journal page', backgroundDark: { mode: 'gradient', color1: '#252a31', color2: '#0f1114' }, cellDark: '#9aa4b1',
    swatch: '#ffffff', ball: 'radial-gradient(circle at 38% 34%, #fff 0, #f2a19c 22%, #e5534b 62%, #b43a33 100%)',
    scene: { style: { material: 'standard', roughness: 0.5, colorScheme: 'modern' }, lighting: light('paper'),
      post: post({ ao: { enabled: true, intensity: 1.1, radius: 0.7 }, outline: { enabled: true, thickness: 1, color: '#2a2e35', sensitivity: 1, strength: 0.6, creases: false } }),
      display: { background: { mode: 'solid', color1: '#ffffff', color2: '#ffffff' }, cell: { color: '#2a2e35' } } } },
  { id: 'ink', name: 'Illustration', description: 'Cel shading with crisp ink outlines, like a textbook figure', backgroundDark: { mode: 'solid', color1: '#e9e9e4', color2: '#e9e9e4' },
    swatch: '#fbfbf9', ball: 'radial-gradient(circle closest-side, #9fd4b4 0 83%, #1b1b1b 86%)',
    scene: { style: { material: 'toon', colorScheme: 'pastel' }, lighting: light('flat'), post: post({ outline: { enabled: true, thickness: 1.6, color: '#16181c', sensitivity: 1, strength: 1 }, ao: { enabled: false } }),
      display: { background: { mode: 'solid', color1: '#fbfbf9', color2: '#fbfbf9' }, cell: { color: '#16181c' } } } },
  { id: 'poster', name: 'Poster', description: 'Bold two-tone colours with a glint and a heavy outline on cream', backgroundDark: { mode: 'solid', color1: '#ece3d3', color2: '#ece3d3' },
    swatch: '#f7f0e3', ball: 'radial-gradient(circle at 34% 30%, #fff 0 9%, transparent 10%), radial-gradient(circle closest-side, transparent 82%, #1d2433 85%), linear-gradient(135deg, #f0705a 0 58%, #b84a3c 58%)',
    scene: { style: { material: 'poster', colorScheme: 'vivid' }, lighting: light('poster', { toneMapping: 'none' }),
      post: post({ outline: { enabled: true, thickness: 1.6, color: '#1d2433', sensitivity: 1, strength: 1 } }),
      display: { background: { mode: 'solid', color1: '#f7f0e3', color2: '#f7f0e3' }, cell: { color: '#1d2433' } } } },
  { id: 'lineart', name: 'Line art', description: 'Black ink lines over light greys — for black-and-white print', backgroundDark: { mode: 'solid', color1: '#e9e9e9', color2: '#e9e9e9' },
    swatch: '#ffffff', ball: 'radial-gradient(circle closest-side, #f4f4f4 0 84%, #111 87%)',
    scene: { style: { material: 'flat', colorScheme: 'greyscale' }, lighting: light('flat', { toneMapping: 'none' }),
      post: post({ outline: { enabled: true, thickness: 1.4, color: '#111111', sensitivity: 1, strength: 1 } }),
      display: { background: { mode: 'solid', color1: '#ffffff', color2: '#ffffff' }, cell: { color: '#111111' } } } },
  { id: 'morandi', name: 'Morandi', description: 'Dusty Morandi tones in warm window light, with soft shadows like a still life', backgroundDark: { mode: 'solid', color1: '#3a3531', color2: '#3a3531' }, cellDark: '#b9ada0',
    swatch: '#ece6de', ball: 'radial-gradient(circle at 40% 35%, #f3ece6 0, #c9a9a2 45%, #8f7570 95%)',
    scene: { style: { material: 'matte', roughness: 0.85, colorScheme: 'morandi' }, lighting: light('window', { shadows: { enabled: true, softness: 5, floor: true } }),
      post: post({ ao: { enabled: true, intensity: 1.2, radius: 0.8 } }),
      display: { background: { mode: 'solid', color1: '#ece6de', color2: '#ece6de' }, cell: { color: '#6d655d' } } } },
  { id: 'crystal', name: 'Crystal', description: 'Clear coloured glass with studio reflections on a pale backdrop — glass that prints', backgroundDark: { mode: 'gradient', color1: '#e6eaf0', color2: '#cfd6df' },
    swatch: 'linear-gradient(#fbfcfd,#e3e8ee)', ball: 'radial-gradient(circle at 34% 28%, #fff 0 7%, transparent 13%), radial-gradient(circle at 60% 74%, rgba(255,255,255,.7) 0, transparent 34%), radial-gradient(circle closest-side, #5a86e0 0, #3d68c4 62%, #1b3570 100%)',
    scene: { style: { material: 'crystal', colorScheme: 'modern' }, lighting: light('paper', { env: { enabled: true, intensity: 1.3, map: 'studio' } }), post: post({}),
      display: { background: { mode: 'gradient', color1: '#fbfcfd', color2: '#e3e8ee' }, cell: { color: '#2a2e35' } } } },
  { id: 'midnight', name: 'Midnight', description: 'Modern colours with a cool rim light on deep navy — for dark slides',
    swatch: 'linear-gradient(#1d2a3c,#0c121b)', ball: 'radial-gradient(circle closest-side at 46% 46%, transparent 88%, rgba(168,198,255,.75) 100%), radial-gradient(circle at 38% 35%, #fff 0, #8fd8c6 16%, #2fa58c 58%, #0f4a42 100%)',
    scene: { style: { material: 'standard', colorScheme: 'modern' }, lighting: light('night'),
      post: post({ ao: { enabled: true, intensity: 1.1, radius: 0.7 } }),
      display: { background: { mode: 'gradient', color1: '#1d2a3c', color2: '#0c121b' }, cell: { color: '#8a9bb3' } } } },
  { id: 'publication', name: 'Publication', description: 'Clean satin spheres, studio light and soft occlusion on a pale gradient', backgroundDark: { mode: 'gradient', color1: '#252a31', color2: '#0f1114' }, cellDark: '#9aa4b1',
    swatch: 'linear-gradient(#f7f8fa,#dde2e8)', ball: 'radial-gradient(circle at 38% 35%, #fff 0, #cfd7e2 20%, #6f7f93 75%, #4f5d6e 100%)',
    scene: { style: { material: 'standard', colorScheme: 'jmol' }, lighting: light('studio', { shadows: { enabled: false } }), post: post({ ao: { enabled: true, intensity: 1.3, radius: 0.9 } }),
      display: { background: { mode: 'gradient', color1: '#f7f8fa', color2: '#dde2e8' }, cell: { color: '#3b4048' } } } },
  { id: 'vesta', name: 'VESTA', description: 'Phong highlights, headlight and VESTA colours on white', backgroundDark: { mode: 'solid', color1: '#1b1e23', color2: '#1b1e23' }, cellDark: '#c9ced6',
    swatch: '#ffffff', ball: 'radial-gradient(circle at 34% 30%, #fff 0, #fff 7%, #fe0300 24%, #8a0000 92%)',
    scene: { style: { material: 'phong', colorScheme: 'vesta' }, lighting: light('headlight'), post: post({}),
      display: { background: { mode: 'solid', color1: '#ffffff', color2: '#ffffff' }, cell: { color: '#000000' } } } },
  { id: 'qutemol', name: 'QuteMol', description: 'Matte surfaces, deep ambient occlusion and silhouette edges', backgroundDark: { mode: 'solid', color1: '#1c1f24', color2: '#1c1f24' }, cellDark: '#9aa4b1',
    swatch: '#ffffff', ball: 'radial-gradient(circle closest-side, transparent 88%, #20242a 91%), radial-gradient(circle at 45% 40%, #e9ecef 0, #a9b2bb 45%, #4a525c 85%)',
    scene: { style: { material: 'matte', colorScheme: 'muted' }, lighting: light('softbox'), post: post({ ao: { enabled: true, intensity: 1.8, radius: 1.2 }, outline: { enabled: true, thickness: 1.1, color: '#20242a', sensitivity: 0.9, strength: 0.85, creases: false } }),
      display: { background: { mode: 'solid', color1: '#ffffff', color2: '#ffffff' }, cell: { color: '#4a5059' } } } },
  { id: 'clay', name: 'Clay studio', description: 'Chalky clay, soft daylight and a contact-shadow floor', backgroundDark: { mode: 'gradient', color1: '#2f2b28', color2: '#161412' }, cellDark: '#b5aa9e',
    swatch: 'linear-gradient(#ece8e3,#d6d0c9)', ball: 'radial-gradient(circle at 40% 35%, #f6eee6 0, #d9c9ba 45%, #9b8a7b 90%)',
    scene: { style: { material: 'clay', colorScheme: 'pastel' }, lighting: light('softbox', { shadows: { enabled: true, softness: 4, floor: true } }), post: post({ ao: { enabled: true, intensity: 1.3, radius: 0.9 } }),
      display: { background: { mode: 'gradient', color1: '#efebe6', color2: '#d4cdc5' }, cell: { color: '#5b524a' } } } },
  { id: 'glass', name: 'Glass', description: 'Refractive glass atoms in a dark studio with a little bloom',
    swatch: 'radial-gradient(circle at 50% 45%, #22303f, #07090d)', ball: 'radial-gradient(circle at 35% 30%, #fff 0, #c9f0ff 14%, rgba(80,170,220,.6) 55%, rgba(120,200,240,.85) 96%)',
    scene: { style: { material: 'glass', colorScheme: 'jmol' }, lighting: light('dramatic', { env: { enabled: true, intensity: 0.9, map: 'studio' } }), post: post({ bloom: { enabled: true, strength: 0.35, radius: 0.5, threshold: 0.85 } }),
      display: { background: { mode: 'radial', color1: '#22303f', color2: '#07090d' }, cell: { color: '#8aa0b8' } } } },
  { id: 'metallic', name: 'Metallic', description: 'Polished metal under three-point light with reflections',
    swatch: 'radial-gradient(circle at 50% 45%, #3a4048, #121418)', ball: 'radial-gradient(circle at 35% 30%, #fff 0, #ffe7a3 10%, #c08d2c 42%, #3a2508 92%)',
    scene: { style: { material: 'metallic', colorScheme: 'jmol' }, lighting: light('three-point', { env: { enabled: true, intensity: 1.3, map: 'studio' } }), post: post({ ao: { enabled: true, intensity: 1.1, radius: 0.7 } }),
      display: { background: { mode: 'radial', color1: '#3a4048', color2: '#121418' }, cell: { color: '#aab3be' } } } },
  { id: 'dark', name: 'Dark studio', description: 'Satin finish with a strong rim light on charcoal',
    swatch: 'linear-gradient(#252a31,#0f1114)', ball: 'radial-gradient(circle closest-side at 46% 46%, transparent 89%, rgba(214,228,255,.65) 100%), radial-gradient(circle at 38% 35%, #fff 0, #9fb3cc 18%, #2c3542 78%)',
    scene: { style: { material: 'standard', colorScheme: 'jmol' }, lighting: light('three-point'), post: post({ ao: { enabled: true, intensity: 1.3, radius: 0.9 } }),
      display: { background: { mode: 'gradient', color1: '#252a31', color2: '#0f1114' }, cell: { color: '#9aa4b1' } } } },
  { id: 'neon', name: 'Neon', description: 'Self-lit atoms with bloom and coloured side lights',
    swatch: 'radial-gradient(circle 21px at 50% 50%, #fff 0, #ffd38a 15%, #ff4fd8 50%, #3fe9ff 76%, #05060a 100%)',
    scene: { style: { material: 'glow', colorScheme: 'jmol' }, lighting: light('neon'), post: post({ bloom: { enabled: true, strength: 0.55, radius: 0.35, threshold: 0.7 } }),
      display: { background: { mode: 'solid', color1: '#05060a', color2: '#05060a' }, cell: { color: '#5f6dff' } } } },
  { id: 'xray', name: 'X-ray', description: 'See-through Fresnel shells with additive glow',
    swatch: 'radial-gradient(circle 19px at 50% 50%, #102a40 0, #16395a 48%, #7fe0ff 86%, #0a1422 100%)',
    scene: { style: { material: 'xray', colorScheme: 'jmol' }, lighting: light('flat'), post: post({ bloom: { enabled: true, strength: 0.6, radius: 0.4, threshold: 0.3 } }),
      display: { background: { mode: 'radial', color1: '#0f1d2e', color2: '#03060b' }, cell: { color: '#4c86c6' } } } },
  { id: 'pearl', name: 'Pearl', description: 'Iridescent finish in soft daylight', backgroundDark: { mode: 'gradient', color1: '#2b2a33', color2: '#121117' }, cellDark: '#aeacbd',
    swatch: 'linear-gradient(#f6f4fa,#dcdbe6)', ball: 'radial-gradient(circle at 35% 30%, #fff 0, #f6ebff 15%, #c8dcf6 48%, #9fb2c4 92%)',
    scene: { style: { material: 'pearl', colorScheme: 'pastel' }, lighting: light('softbox'), post: post({ ao: { enabled: true, intensity: 1.2, radius: 0.8 } }),
      display: { background: { mode: 'gradient', color1: '#f6f4fa', color2: '#dcdbe6' }, cell: { color: '#6a6878' } } } },
  { id: 'sunset', name: 'Golden hour', description: 'Glossy atoms in warm low sunlight', backgroundDark: { mode: 'gradient', color1: '#4a3a4f', color2: '#1c1519' }, cellDark: '#d9b08c',
    swatch: 'linear-gradient(#f3c9a5,#5b4a6e)', ball: 'radial-gradient(circle at 35% 30%, #fff 0, #ffd2a0 14%, #d1652e 58%, #4a2a40 100%)',
    scene: { style: { material: 'glossy', colorScheme: 'jmol' }, lighting: light('sunset'), post: post({ ao: { enabled: true, intensity: 0.8, radius: 0.6 }, vignette: { enabled: true, darkness: 1.05, offset: 1 } }),
      display: { background: { mode: 'gradient', color1: '#f3c9a5', color2: '#5b4a6e' }, cell: { color: '#3a2a35' } } } },
  { id: 'blueprint', name: 'Blueprint', description: 'Flat blue shapes with white ink on drafting blue',
    swatch: 'linear-gradient(135deg, #1e4f8f 0 40%, #e8f1ff 40% 43%, #2f6db3 43% 70%, #e8f1ff 70% 73%, #1e4f8f 73%)',
    scene: { style: { material: 'flat', colorScheme: 'mono', monoColor: '#2f6db3' }, lighting: light('flat'), post: post({ outline: { enabled: true, thickness: 1.4, color: '#e8f1ff', sensitivity: 1.2, strength: 1 } }),
      display: { background: { mode: 'solid', color1: '#1e4f8f', color2: '#1e4f8f' }, cell: { color: '#e8f1ff' } } } },
  { id: 'polyhedra-studio', name: 'Polyhedra', description: 'Coordination polyhedra in publication lighting', hidden: true, backgroundDark: { mode: 'gradient', color1: '#252a31', color2: '#0f1114' }, cellDark: '#9aa4b1',
    swatch: POLY_SWATCH,
    scene: { style: { rep: 'polyhedra', radiusSource: 'atomic', atomScale: 0.3, bondRadius: 0.09, material: 'standard', colorScheme: 'vesta', polyhedra: { opacity: 0.72 } }, lighting: light('studio'), post: post({ ao: { enabled: true, intensity: 1.2, radius: 0.8 } }),
      display: { background: { mode: 'gradient', color1: '#f7f8fa', color2: '#dde2e8' }, cell: { color: '#3b4048' } } } },
].forEach((l) => looks.register(l));
