/** File open / save helpers that work in a normal browser tab and inside a sandboxed Claude artifact. */

export const isArtifact = () => typeof window.claude?.use === 'function';

let downloadsCap;
async function downloads() {
  if (downloadsCap !== undefined) return downloadsCap;
  try { downloadsCap = isArtifact() ? await window.claude.use('downloads') : null; } catch { downloadsCap = null; }
  return downloadsCap;
}

/**
 * Offer a file to the user. Resolves true when saved (or handed to the browser), false if declined.
 * @param {string} filename
 * @param {Blob|string|ArrayBuffer} data
 * @param {string} mime
 */
export async function saveFile(filename, data, mime = 'application/octet-stream') {
  const dl = await downloads();
  if (dl) {
    try { await dl.save({ filename, data }); return true; }
    catch (e) {
      if (e?.code === 'declined') return false;
      if (e?.code === 'rejected_extension') throw new Error(`This viewer cannot save .${filename.split('.').pop()} files. Try another format.`);
      throw new Error(e?.message || 'The file could not be saved here.');
    }
  }
  if (isArtifact()) throw new Error('Saving files is not available in this view. Open the app in a browser tab to download files.');
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/** Show the native file picker. Resolves File[] (empty if cancelled). */
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

export const readText = (file) => (file.text ? file.text() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); }));

export const slug = (s) => String(s || 'untitled').trim().replace(/[^\w一-鿿.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
