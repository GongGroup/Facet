/**
 * Sample library shown in the "Library" panel. Each sample builds a structure and may suggest a look
 * (a partial scene) that shows it at its best. Plugins can add samples with `samples.register()`.
 */
import { buildCrystal } from './crystal.js';
import { buildCluster } from './cluster.js';
import { buildMolecule } from './molecules.js';
import { readCIF } from '../io/cif.js';

const registry = new Map();
export const samples = {
  register(s) { registry.set(s.id, s); return () => registry.delete(s.id); },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
};

const ANATASE_CIF = `data_anatase
_chemical_name_mineral 'Anatase'
_cell_length_a 3.7845
_cell_length_b 3.7845
_cell_length_c 9.5143
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'I 41/a m d'
loop_
_symmetry_equiv_pos_as_xyz
'x,y,z' '-x,-y,z' '-y+1/2,x,z+3/4' 'y+1/2,-x,z+3/4' '-x+1/2,y,-z+3/4' 'x+1/2,-y,-z+3/4' 'y,x,-z' '-y,-x,-z'
'-x+1/2,-y,-z+3/4' 'x+1/2,y,-z+3/4' 'y,-x,-z' '-y,x,-z' 'x,-y,z' '-x,y,z' '-y+1/2,-x,z+3/4' 'y+1/2,x,z+3/4'
'x+1/2,y+1/2,z+1/2' '-x+1/2,-y+1/2,z+1/2' '-y,x+1/2,z+1/4' 'y,-x+1/2,z+1/4' '-x,y+1/2,-z+1/4' 'x,-y+1/2,-z+1/4' 'y+1/2,x+1/2,-z+1/2' '-y+1/2,-x+1/2,-z+1/2'
'-x,-y+1/2,-z+1/4' 'x,y+1/2,-z+1/4' 'y+1/2,-x+1/2,-z+1/2' '-y+1/2,x+1/2,-z+1/2' 'x+1/2,-y+1/2,z+1/2' '-x+1/2,y+1/2,z+1/2' '-y,-x+1/2,z+1/4' 'y,x+1/2,z+1/4'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Ti1 Ti 0 0 0
O1 O 0 0 0.2081
`;

function thermalTrajectory(structure, { frames = 48, amplitude = 0.16, seed = 7 } = {}) {
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const n = structure.length;
  const dirs = Array.from({ length: n }, () => { const v = [rand() - 0.5, rand() - 0.5, rand() - 0.5]; const l = Math.hypot(...v) || 1; return v.map((x) => x / l); });
  const phase = Array.from({ length: n }, () => rand() * Math.PI * 2);
  const base = structure.positions.slice();
  for (let f = 1; f < frames; f++) {
    const pos = new Float64Array(base.length);
    const t = (f / frames) * Math.PI * 2;
    const breathe = 1 + 0.035 * Math.sin(t);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
      pos[3 * i + k] = base[3 * i + k] * breathe + dirs[i][k] * amplitude * Math.sin(2 * t + phase[i]);
    }
    structure.frames.push({ positions: pos });
  }
  structure.info.note = 'Synthetic trajectory (breathing + random vibration) generated for demonstration.';
  return structure;
}

const crystal = (id, prm) => () => buildCrystal(id, prm);

[
  { id: 'perovskite', rep: 'polyhedra', name: 'SrTiO₃ perovskite', category: 'Crystals', tags: ['oxide', 'polyhedra'], build: crystal('perovskite', { repeat: [2, 2, 2] }), look: 'poster', scene: { display: { bonds: { disabledPairs: ['O-Sr'] } }, style: { polyhedra: { centers: ['Ti'], opacity: 0.72 } } } },
  { id: 'rocksalt', rep: 'ballstick', name: 'NaCl rock salt', category: 'Crystals', tags: ['ionic'], build: crystal('rocksalt', { repeat: [2, 2, 2] }), look: 'poster' },
  { id: 'silicon', rep: 'ballstick', name: 'Silicon (diamond)', category: 'Crystals', tags: ['semiconductor'], build: crystal('diamond', { repeat: [2, 2, 2] }), look: 'lineart' },
  { id: 'rutile', rep: 'polyhedra', name: 'TiO₂ rutile', category: 'Crystals', tags: ['oxide', 'polyhedra'], build: crystal('rutile', { repeat: [2, 2, 3] }), look: 'morandi', scene: { style: { polyhedra: { centers: ['Ti'], opacity: 0.72 } } } },
  { id: 'anatase', rep: 'ballstick', name: 'TiO₂ anatase (from CIF)', category: 'Crystals', tags: ['oxide', 'cif'], build: () => { const s = readCIF(ANATASE_CIF, 'anatase.cif'); s.name = 'TiO₂ anatase'; return s.repeat(2, 2, 1); }, look: 'midnight' },
  { id: 'wurtzite', rep: 'ballstick', name: 'ZnO wurtzite', category: 'Crystals', tags: ['semiconductor'], build: crystal('wurtzite', { repeat: [3, 3, 2] }), look: 'poster' },
  { id: 'fluorite', rep: 'polyhedra', name: 'CaF₂ fluorite', category: 'Crystals', tags: ['ionic', 'polyhedra'], build: crystal('fluorite', { repeat: [2, 2, 2] }), look: 'ink', scene: { style: { polyhedra: { centers: ['Ca'], opacity: 0.72 } } } },
  { id: 'copper', rep: 'spheres', name: 'Cu fcc 4×4×4', category: 'Crystals', tags: ['metal'], build: crystal('fcc', { elements: ['Cu'], a: 3.615, repeat: [4, 4, 4] }), look: 'midnight' },
  { id: 'graphene', rep: 'ballstick', name: 'Graphene sheet', category: '2D materials', tags: ['2D', 'carbon'], build: crystal('graphene', { repeat: [7, 7, 1] }), look: 'ink' },
  { id: 'mos2', rep: 'ballstick', name: 'MoS₂ monolayer', category: '2D materials', tags: ['2D', 'TMD'], build: crystal('mos2', { repeat: [5, 5, 1] }), look: 'poster' },
  { id: 'hbn', rep: 'ballstick', name: 'h-BN monolayer', category: '2D materials', tags: ['2D'], build: crystal('hbn', { repeat: [6, 6, 1] }), look: 'lineart' },
  { id: 'au55', rep: 'spheres', name: 'Au₅₅ Mackay icosahedron', category: 'Clusters', tags: ['nanoparticle', 'gold'], build: () => buildCluster('icosahedron', { element: 'Au', size: 3 }), look: 'poster' },
  { id: 'pt309', rep: 'spheres', name: 'Pt₃₀₉ cuboctahedron', category: 'Clusters', tags: ['nanoparticle'], build: () => buildCluster('cuboctahedron', { element: 'Pt', size: 5 }), look: 'morandi' },
  { id: 'ag-deca', rep: 'spheres', name: 'Ag₁₀₅ Ino decahedron', category: 'Clusters', tags: ['nanoparticle', 'twinned'], build: () => buildCluster('decahedron', { element: 'Ag', size: 4 }), look: 'glass' },
  { id: 'c60', rep: 'ballstick', name: 'C₆₀ fullerene', category: 'Molecules', tags: ['carbon'], build: () => buildMolecule('c60'), look: 'crystal' },
  { id: 'benzene', rep: 'ballstick', name: 'Benzene', category: 'Molecules', tags: ['aromatic'], build: () => buildMolecule('benzene'), look: 'ink' },
  { id: 'sf6', rep: 'ballstick', name: 'SF₆', category: 'Molecules', tags: ['octahedral'], build: () => buildMolecule('sf6'), look: 'crystal' },
  { id: 'pt55-md', rep: 'spheres', name: 'Pt₅₅ vibration (trajectory)', category: 'Trajectories', tags: ['animation'], build: () => { const s = thermalTrajectory(buildCluster('icosahedron', { element: 'Pt', size: 3 })); s.name = 'Pt₅₅ vibration (synthetic)'; return s; }, look: 'poster' },
].forEach((s) => samples.register(s));
