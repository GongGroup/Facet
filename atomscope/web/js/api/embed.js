/**
 * postMessage API for embedding AtomScope in an <iframe>:
 *   frame.contentWindow.postMessage({ type: 'atomscope:load', text, format, name }, '*')
 *   { type: 'atomscope:look', id } | { type: 'atomscope:set', path, value } | { type: 'atomscope:view', axis }
 *   { type: 'atomscope:screenshot', scale, id } -> replies { type: 'atomscope:screenshot', id, dataURL }
 * Only messages from the parent window are accepted.
 */
export function installEmbedAPI(api) {
  if (window.parent === window) return;
  addEventListener('message', async (e) => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || !String(m.type).startsWith('atomscope:')) return;
    const reply = (data) => e.source.postMessage({ type: m.type, id: m.id, ...data }, e.origin === 'null' ? '*' : e.origin);
    try {
      switch (m.type) {
        case 'atomscope:load': api.load(m.text ?? m.structure, { format: m.format, name: m.name, look: m.look }); reply({ ok: true }); break;
        case 'atomscope:look': api.applyLook(m.id); reply({ ok: true }); break;
        case 'atomscope:set': api.set(m.path, m.value); reply({ ok: true }); break;
        case 'atomscope:view': api.view(m.axis); reply({ ok: true }); break;
        case 'atomscope:screenshot': {
          const blob = await api.screenshot({ scale: m.scale ?? 2, transparent: !!m.transparent });
          const dataURL = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
          reply({ dataURL });
          break;
        }
        default: reply({ error: `unknown message ${m.type}` });
      }
    } catch (err) { reply({ error: err.message }); }
  });
  window.parent.postMessage({ type: 'atomscope:ready', version: api.version }, '*');
}
