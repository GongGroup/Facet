/** XYZ / extended XYZ (multi-frame) reader and writer. */
import { Structure } from '../core/structure.js';

/** Parse `key=value key="quoted value"` pairs from an extXYZ comment line. */
export function parseKeyValues(line) {
  const out = {};
  const re = /([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)'|\{([^}]*)\}|(\S+))/g;
  let m;
  while ((m = re.exec(line))) out[m[1]] = m[3] ?? m[4] ?? m[5] ?? m[6];
  return out;
}

function parseProperties(spec) {
  // species:S:1:pos:R:3:forces:R:3
  const parts = spec.split(':');
  const cols = [];
  let c = 0;
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const n = +parts[i + 2];
    cols.push({ name: parts[i], type: parts[i + 1], start: c, n });
    c += n;
  }
  return cols;
}

export function readXYZ(text, filename = '') {
  const lines = text.split(/\r?\n/);
  const frames = [];
  let l = 0;
  while (l < lines.length) {
    while (l < lines.length && !lines[l].trim()) l++;
    if (l >= lines.length) break;
    const n = parseInt(lines[l], 10);
    if (!Number.isFinite(n) || n < 0) throw new Error(`XYZ: expected an atom count on line ${l + 1}, found "${lines[l].trim().slice(0, 40)}"`);
    const comment = lines[l + 1] ?? '';
    const kv = parseKeyValues(comment);
    let cols = kv.Properties ? parseProperties(kv.Properties) : null;
    const spCol = cols?.find((c) => c.name === 'species' || c.name === 'element' || c.name === 'symbols');
    const posCol = cols?.find((c) => c.name === 'pos' || c.name === 'positions');
    const extra = cols?.filter((c) => c !== spCol && c !== posCol && c.n === 1 && (c.type === 'R' || c.type === 'I')) ?? [];
    const symbols = [], pos = new Float64Array(3 * n), props = Object.fromEntries(extra.map((c) => [c.name, []]));
    for (let i = 0; i < n; i++) {
      const raw = lines[l + 2 + i];
      if (raw == null) throw new Error(`XYZ: file ended early — expected ${n} atoms in frame ${frames.length + 1}`);
      const t = raw.trim().split(/\s+/);
      const sc = spCol ? spCol.start : 0, pc = posCol ? posCol.start : 1;
      symbols.push(t[sc]);
      pos[3 * i] = +t[pc]; pos[3 * i + 1] = +t[pc + 1]; pos[3 * i + 2] = +t[pc + 2];
      for (const c of extra) props[c.name].push(+t[c.start]);
    }
    let cell = null, pbc = null;
    if (kv.Lattice) {
      const v = kv.Lattice.trim().split(/[\s,]+/).map(Number);
      if (v.length === 9 && v.every(Number.isFinite)) cell = [v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)];
    }
    if (kv.pbc) pbc = kv.pbc.trim().split(/\s+/).map((x) => /^[tT1]/.test(x));
    const name = kv.Lattice || kv.Properties ? (kv.name ?? kv.config_type ?? null) : comment.trim() || null;
    frames.push({ symbols, pos, cell, pbc, props, name, comment });
    l += 2 + n;
  }
  if (!frames.length) throw new Error('XYZ: no frames found');
  const f0 = frames[0];
  const s = new Structure({
    name: f0.name || filename.replace(/\.[^.]+$/, '') || 'XYZ structure', symbols: f0.symbols, positions: f0.pos,
    cell: f0.cell, pbc: f0.pbc ?? (f0.cell ? [true, true, true] : [false, false, false]), props: f0.props,
    info: { source: 'xyz' },
  });
  const same = frames.every((f) => f.symbols.length === f0.symbols.length);
  if (same) s.frames = frames.slice(1).map((f) => ({ positions: f.pos, cell: f.cell }));
  else s.info.warning = 'Frames have different atom counts; only the first frame was loaded.';
  return s;
}

export function writeXYZ(s, { extended = true } = {}) {
  const out = [];
  const nf = s.nFrames;
  const cur = s.frame;
  for (let f = 0; f < nf; f++) {
    s.setFrame(f);
    out.push(String(s.length));
    if (extended && s.cell) {
      const lat = s.cell.flat().map((v) => v.toFixed(8)).join(' ');
      out.push(`Lattice="${lat}" Properties=species:S:1:pos:R:3 pbc="${s.pbc.map((b) => (b ? 'T' : 'F')).join(' ')}" name="${s.name.replace(/"/g, "'")}"`);
    } else out.push(s.name);
    for (let i = 0; i < s.length; i++) {
      const p = s.pos(i);
      out.push(`${s.symbols[i].padEnd(3)} ${p.map((v) => v.toFixed(8).padStart(15)).join(' ')}`);
    }
  }
  s.setFrame(cur);
  return out.join('\n') + '\n';
}
