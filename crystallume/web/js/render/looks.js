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

const light = (id, extra = {}) => ({ ...presetToSettings(id), ...extra });
const off = { ao: { enabled: false }, outline: { enabled: false }, bloom: { enabled: false }, dof: { enabled: false }, vignette: { enabled: false }, fog: { enabled: false } };
const post = (p) => ({ ...JSON.parse(JSON.stringify(off)), ...p });

[
  { id: 'studio', name: 'Studio', description: 'Glazed spheres in warm studio light, with soft floor shadows on a lit backdrop', backgroundDark: { mode: 'radial', color1: '#3a3632', color2: '#1c1a18' }, cellDark: '#b5aa9e',
    swatch: 'radial-gradient(circle at 50% 45%, #fdfcfa, #e2dcd3)', ball: 'radial-gradient(circle at 36% 30%, #fff 0, #fff 5%, #f7da86 15%, #d49d26 55%, #6b4808 100%)',
    scene: { style: { material: 'glossy', roughness: 0.42, colorScheme: 'modern' }, lighting: light('warm-studio', { shadows: { enabled: true, softness: 5, floor: true } }),
      post: post({ ao: { enabled: true, intensity: 1.1, radius: 0.8 } }),
      display: { background: { mode: 'radial', color1: '#fdfcfa', color2: '#e2dcd3' }, cell: { color: '#3d3a36' } } } },
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
  { id: 'crystal', name: 'Crystal', description: 'Light, clear coloured glass with bright reflections on a pale sky backdrop', backgroundDark: { mode: 'radial', color1: '#e9f0f6', color2: '#cbd7e3' },
    swatch: 'radial-gradient(circle at 50% 45%, #ffffff, #dfe9f2)', ball: 'radial-gradient(circle at 34% 28%, #fff 0 7%, transparent 13%), radial-gradient(circle at 60% 74%, rgba(255,255,255,.8) 0, transparent 36%), radial-gradient(circle closest-side, #a9c4f0 0, #7d9fe0 62%, #3f5f9e 100%)',
    scene: { style: { material: 'crystal', colorScheme: 'modern' }, lighting: light('soft-studio', { env: { enabled: true, intensity: 1.1, map: 'room' }, exposure: 1.15 }), post: post({}),
      display: { background: { mode: 'radial', color1: '#ffffff', color2: '#dfe9f2' }, cell: { color: '#3a4656' } } } },
  { id: 'midnight', name: 'Midnight', description: 'Modern colours with a cool rim light on deep navy — for dark slides',
    swatch: 'linear-gradient(#1d2a3c,#0c121b)', ball: 'radial-gradient(circle closest-side at 46% 46%, transparent 88%, rgba(168,198,255,.75) 100%), radial-gradient(circle at 38% 35%, #fff 0, #8fd8c6 16%, #2fa58c 58%, #0f4a42 100%)',
    scene: { style: { material: 'standard', colorScheme: 'modern' }, lighting: light('night'),
      post: post({ ao: { enabled: true, intensity: 1.1, radius: 0.7 } }),
      display: { background: { mode: 'gradient', color1: '#1d2a3c', color2: '#0c121b' }, cell: { color: '#8a9bb3' } } } },
  { id: 'glass', name: 'Glass', description: 'Refractive glass atoms in a dark studio with a little bloom',
    swatch: 'radial-gradient(circle at 50% 45%, #22303f, #07090d)', ball: 'radial-gradient(circle at 35% 30%, #fff 0, #c9f0ff 14%, rgba(80,170,220,.6) 55%, rgba(120,200,240,.85) 96%)',
    scene: { style: { material: 'glass', colorScheme: 'modern' }, lighting: light('dramatic', { env: { enabled: true, intensity: 0.9, map: 'studio' } }), post: post({ bloom: { enabled: true, strength: 0.35, radius: 0.5, threshold: 0.85 } }),
      display: { background: { mode: 'radial', color1: '#22303f', color2: '#07090d' }, cell: { color: '#8aa0b8' } } } },
].forEach((l) => looks.register(l));
