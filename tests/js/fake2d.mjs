// A recording stand-in for CanvasRenderingContext2D in node tests (overlay text, legends).
// Every drawing call is logged in `calls` as [name, ...args]; fill/stroke/arc also log the current styles.
// measureText: 0.6 × the font's px size per character.

export function fake2d() {
  const calls = [];
  const state = { font: '10px sans-serif', fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, globalAlpha: 1, textAlign: 'start', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter' };
  const stack = [];
  const g = {
    calls,
    get depth() { return stack.length; },
    save() { calls.push(['save']); stack.push({ ...state }); },
    restore() { calls.push(['restore']); Object.assign(state, stack.pop() ?? {}); },
    measureText(t) {
      const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? '10');
      return { width: String(t).length * px * 0.6 };
    },
    createLinearGradient() { return { addColorStop() {} }; },
    fillText(t, x, y) { calls.push(['fillText', String(t), x, y, state.fillStyle, state.font]); },
    strokeText(t, x, y) { calls.push(['strokeText', String(t), x, y]); },
    arc(x, y, r) { calls.push(['arc', x, y, r]); },
    fill() { calls.push(['fill', state.fillStyle, state.globalAlpha]); },
    stroke() { calls.push(['stroke', state.strokeStyle, state.lineWidth, state.globalAlpha]); },
  };
  for (const k of Object.keys(state)) Object.defineProperty(g, k, { get: () => state[k], set: (v) => { state[k] = v; }, enumerable: true });
  for (const m of ['beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo', 'setLineDash', 'clearRect', 'setTransform', 'fillRect', 'rect', 'clip', 'translate', 'scale']) {
    g[m] = (...a) => { calls.push([m, ...a]); };
  }
  /** The texts drawn with fillText, in order. */
  g.texts = () => calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  return g;
}

/** Run fn with console.error silenced; returns [result, the messages it would have printed]. */
export function quietErrors(fn) {
  const seen = [], orig = console.error;
  console.error = (...a) => { seen.push(a.map(String).join(' ')); };
  try { return [fn(), seen]; } finally { console.error = orig; }
}
