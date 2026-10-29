/**
 * Keyboard shortcut specs shared by the shortcut router, the command palette, tooltips and the
 * shortcuts dialog.
 *
 * A spec is a key name as in KeyboardEvent.key ('r', 'Escape', ' ', 'ArrowLeft', '?', '['), optionally
 * prefixed by modifiers joined with '+': 'mod+o' (Ctrl, or ⌘ on a Mac), 'shift+f', 'shift+1', 'alt+x'.
 * A command's `key` may also be an array of specs (any of them triggers it).
 */
export const isMac = /mac|iphone|ipad/i.test(globalThis.navigator?.platform ?? globalThis.navigator?.userAgent ?? '');
export const MOD = isMac ? '⌘' : 'Ctrl';
export const ALT = isMac ? '⌥' : 'Alt';

const NAMES = {
  escape: 'Esc', ' ': 'Space', space: 'Space', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
  delete: 'Del', backspace: '⌫', enter: 'Enter', tab: 'Tab', pageup: 'PgUp', pagedown: 'PgDn', home: 'Home', end: 'End',
};
const MODS = { mod: MOD, ctrl: 'Ctrl', cmd: '⌘', meta: '⌘', alt: ALT, shift: isMac ? '⇧' : 'Shift' };

/** Split 'mod+shift+z' into {mods:Set, key}; '+' and 'shift++' keep '+' as the key. */
export function parseKey(spec) {
  const s = String(spec ?? '');
  if (s === '+' || s.length === 1) return { mods: new Set(), key: s };
  const parts = s.split('+');
  let key = parts.pop();
  if (key === '' && parts.length) { parts.pop(); key = '+'; }
  return { mods: new Set(parts.map((m) => m.toLowerCase())), key };
}

/** Display label of a key spec: 'Escape' → 'Esc', 'ArrowLeft' → '←', ' ' → 'Space', 'mod+o' → 'Ctrl O'. */
export function keyLabel(spec) {
  if (spec == null || spec === '') return '';
  if (Array.isArray(spec)) return spec.map(keyLabel).join(' / ');
  const { mods, key } = parseKey(spec);
  const k = NAMES[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
  const order = ['mod', 'ctrl', 'cmd', 'meta', 'alt', 'shift'];
  return [...order.filter((m) => mods.has(m)).map((m) => MODS[m]), k].join(' ');
}

/** True when the keyboard event matches a key spec (or any spec of an array). */
export function matchKey(spec, e) {
  if (Array.isArray(spec)) return spec.some((s) => matchKey(s, e));
  if (!spec || !e?.key) return false;
  const { mods, key } = parseKey(spec);
  const ctrl = e.ctrlKey || e.metaKey;
  const wantMod = mods.has('mod') || mods.has('ctrl') || mods.has('cmd') || mods.has('meta');
  if (ctrl !== wantMod || e.altKey !== mods.has('alt')) return false;
  const k = key.toLowerCase(), ek = e.key.toLowerCase();
  if (/^[0-9]$/.test(key)) {
    // Shift+digit types a symbol ('!' on US keyboards): match the physical key instead
    const digit = e.code === `Digit${key}` || e.code === `Numpad${key}` || e.key === key;
    return digit && e.shiftKey === mods.has('shift');
  }
  if (/^[a-z]$/.test(k)) return ek === k && e.shiftKey === mods.has('shift');
  if (key.length === 1) return e.key === key && (!mods.has('shift') || e.shiftKey);   // '?', '[', '+' may need Shift
  return ek === k && e.shiftKey === mods.has('shift');
}

/** True when the spec includes a Ctrl/⌘ modifier. */
export const hasMod = (spec) => (Array.isArray(spec) ? spec.some(hasMod) : ['mod', 'ctrl', 'cmd', 'meta'].some((m) => parseKey(spec).mods.has(m)));
