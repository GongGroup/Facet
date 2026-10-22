/** A few small molecules generated from ideal geometries. */
import { Structure } from '../core/structure.js';
import { c60 } from './cluster.js';

const DEG = Math.PI / 180;

function water() {
  const r = 0.9572, a = 104.52 * DEG / 2;
  return { symbols: ['O', 'H', 'H'], positions: [[0, 0, 0], [r * Math.sin(a), r * Math.cos(a), 0], [-r * Math.sin(a), r * Math.cos(a), 0]] };
}
function methane() {
  const t = 1.089 / Math.sqrt(3);
  return { symbols: ['C', 'H', 'H', 'H', 'H'], positions: [[0, 0, 0], [t, t, t], [-t, -t, t], [-t, t, -t], [t, -t, -t]] };
}
function ammonia() {
  const r = 1.012, s = 0.9376, h = 0.3808;
  const H = [0, 1, 2].map((k) => [s * Math.cos(2 * Math.PI * k / 3), s * Math.sin(2 * Math.PI * k / 3), -h]);
  return { symbols: ['N', 'H', 'H', 'H'], positions: [[0, 0, 0.0], ...H] };
}
function co2() { return { symbols: ['C', 'O', 'O'], positions: [[0, 0, 0], [1.16, 0, 0], [-1.16, 0, 0]] }; }
function benzene() {
  const symbols = [], positions = [];
  for (let k = 0; k < 6; k++) { const t = k * 60 * DEG; symbols.push('C'); positions.push([1.397 * Math.cos(t), 1.397 * Math.sin(t), 0]); }
  for (let k = 0; k < 6; k++) { const t = k * 60 * DEG; symbols.push('H'); positions.push([2.484 * Math.cos(t), 2.484 * Math.sin(t), 0]); }
  return { symbols, positions };
}
function ethylene() {
  return { symbols: ['C', 'C', 'H', 'H', 'H', 'H'], positions: [[0.667, 0, 0], [-0.667, 0, 0], [1.237, 0.927, 0], [1.237, -0.927, 0], [-1.237, 0.927, 0], [-1.237, -0.927, 0]] };
}
function sf6() {
  const r = 1.564;
  return { symbols: ['S', 'F', 'F', 'F', 'F', 'F', 'F'], positions: [[0, 0, 0], [r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]] };
}

export const MOLECULES = {
  water: { name: 'Water', build: water },
  methane: { name: 'Methane', build: methane },
  ammonia: { name: 'Ammonia', build: ammonia },
  co2: { name: 'Carbon dioxide', build: co2 },
  ethylene: { name: 'Ethylene', build: ethylene },
  benzene: { name: 'Benzene', build: benzene },
  sf6: { name: 'Sulfur hexafluoride', build: sf6 },
  c60: { name: 'Buckminsterfullerene', build: () => ({ symbols: Array(60).fill('C'), positions: c60() }) },
};

export function buildMolecule(id) {
  const m = MOLECULES[id];
  if (!m) throw new Error(`Unknown molecule "${id}"`);
  const { symbols, positions } = m.build();
  return new Structure({ name: m.name, symbols, positions, info: { source: `builder:molecule:${id}` } });
}
