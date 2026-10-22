// Hello plugin — frontend part.
//
// Crystallume's web UI dynamic-imports every URL listed under
// `plugins[].frontend` in GET /api/v1/info and calls the default export:
//
//   export default function activate(api) { ... }
//
// `api` is window.crystallume: registerLook, registerStyle, registerMaterial, registerColorScheme,
// registerLightingPreset, registerAnalysis, registerCommand, registerPanel, toast, … — see docs/PLUGINS.md.
// This example uses:
//   api.registerLightingPreset({ id, name, ... })
//   api.registerColorScheme({ id, name, colorFor(symbol, index, ctx) })
//   api.registerCommand({ id, title, run })
//   api.toast(message)

const RAINBOW = ["#e6194b", "#f58231", "#ffe119", "#3cb44b", "#42d4f4", "#4363d8", "#911eb4", "#f032e6"];

/** Stable small hash of an element symbol so each element keeps its colour. */
function hashSymbol(symbol) {
  let h = 0;
  for (const ch of String(symbol)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export default function activate(api) {
  api.registerColorScheme({
    id: "hello-rainbow",
    name: "Rainbow by element (hello plugin)",
    // ctx may carry extra information (e.g. the structure); unused here.
    colorFor(symbol, index, ctx) {
      return RAINBOW[hashSymbol(symbol) % RAINBOW.length];
    },
  });

  api.registerCommand({
    id: "hello.greet",
    title: "Say hello (hello plugin)",
    run() {
      api.toast("Hello from plugin");
    },
  });
}
