/** XYZ / extended XYZ (multi-frame) reader and writer. */
import { Structure, fixDegenerateCell, addWarning } from '../core/structure.js';
import { normalizeSymbol } from '../core/elements.js';
import { num } from './index.js';

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
    const cols = kv.Properties ? parseProperties(kv.Properties) : null;
    const spCol = cols?.find((c) => /^(species|element|symbols)$/i.test(c.name));
    const zCol = spCol ? null : cols?.find((c) => c.name === 'Z' || c.name === 'numbers');
    const posCol = cols?.find((c) => /^(pos|positions)$/i.test(c.name));
    if (cols && !posCol) throw new Error(`XYZ: line ${l + 2}: Properties must include pos:R:3`);
    if (cols && !spCol && !zCol) throw new Error(`XYZ: line ${l + 2}: Properties must include species:S:1 (or Z:I:1)`);
    const extra = cols?.filter((c) => c !== spCol && c !== zCol && c !== posCol && c.n === 1 && (c.type === 'R' || c.type === 'I')) ?? [];
    const sc = spCol ? spCol.start : zCol ? zCol.start : 0, pc = posCol ? posCol.start : 1;
    const need = cols ? Math.max(sc + 1, pc + 3, ...extra.map((c) => c.start + 1)) : 4;
    const symbols = [], pos = new Float64Array(3 * n), props = Object.fromEntries(extra.map((c) => [c.name, []]));
    for (let i = 0; i < n; i++) {
      const ln = l + 3 + i;              // 1-based line number of this atom
      const raw = lines[l + 2 + i];
      // a missing or blank line (or the next frame's atom count) means the frame stopped short
      if (raw == null || !raw.trim() || /^\s*\d+\s*$/.test(raw)) {
        throw new Error(`XYZ: file ended early at line ${ln} (frame ${frames.length + 1} declares ${n} atoms, found ${i})`);
      }
      const t = raw.trim().split(/\s+/);
      if (t.length < need) throw new Error(`XYZ: line ${ln}: expected ${cols ? `${need} columns` : 'an element and three coordinates'}, found "${raw.trim().slice(0, 48)}"`);
      symbols.push(zCol ? normalizeSymbol(String(num(t[sc], 'XYZ', ln) | 0)) : t[sc]);
      pos[3 * i] = num(t[pc], 'XYZ', ln); pos[3 * i + 1] = num(t[pc + 1], 'XYZ', ln); pos[3 * i + 2] = num(t[pc + 2], 'XYZ', ln);
      for (const c of extra) props[c.name].push(num(t[c.start], 'XYZ', ln));
    }
    let cell = null, pbc = null;
    if (kv.Lattice != null) {
      const v = kv.Lattice.trim().split(/[\s,]+/).filter(Boolean);
      if (v.length !== 9) throw new Error(`XYZ: line ${l + 2}: Lattice needs 9 numbers, found ${v.length}`);
      const m = v.map((x) => num(x, 'XYZ', l + 2));
      cell = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
    }
    if (kv.pbc) {
      const t = kv.pbc.trim().split(/[\s,]+/).filter(Boolean).map((x) => /^(t|true|1)$/i.test(x));
      pbc = t.length === 3 ? t : [t[0] ?? false, t[0] ?? false, t[0] ?? false];
    }
    const name = kv.Lattice || kv.Properties ? (kv.name ?? kv.config_type ?? null) : comment.trim() || null;
    frames.push({ symbols, pos, cell, pbc, props, name, comment });
    l += 2 + n;
  }
  if (!frames.length) throw new Error('XYZ: no frames found');
  const f0 = frames[0];
  const info = { source: 'xyz' };
  const fix = fixDegenerateCell(f0.cell, f0.pbc ?? (f0.cell ? [true, true, true] : [false, false, false]), f0.pos);
  addWarning(info, fix.warning);
  const s = new Structure({
    name: f0.name || filename.replace(/\.[^.]+$/, '') || 'XYZ structure', symbols: f0.symbols, positions: f0.pos,
    cell: fix.cell, pbc: fix.pbc, props: f0.props, info,
  });
  const same = frames.every((f) => f.symbols.length === f0.symbols.length);
  if (same) {
    s.frames = frames.slice(1).map((f) => {
      const c = f.cell && fix.cell ? fixDegenerateCell(f.cell, fix.pbc, f.pos).cell : null;
      return { positions: f.pos, cell: c };
    });
  } else addWarning(s.info, 'Frames have different atom counts; only the first frame was loaded.');
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
