/**
 * Surface panel (fifth rail panel, Shift+5): the Cleave, Slab, Layers, Adsorbates and Interface sections,
 * which the surface modules register with registerPanelSection('surface', …) (ui/sections.js). The panel
 * shows the same sections for any structure (U1); each section says itself when it cannot be used.
 */
import { h, ic, btn } from '../dom.js';
import { registerLeftPanel } from '../shell.js';
import { keyLabel } from '../keys.js';
import { reservePanelSection, renderSections, sectionsSignature } from '../sections.js';
import { structureKey } from '../../core/analyses.js';

/** The sections the panel always has, in this order; Cleave and Slab start open. */
export const SURFACE_SECTIONS = Object.freeze([
  { id: 'cleave', title: 'Cleave', order: 10, defaultOpen: true },
  { id: 'slab', title: 'Slab', order: 20, defaultOpen: true },
  { id: 'layers', title: 'Layers', order: 30, defaultOpen: false },
  { id: 'adsorbates', title: 'Adsorbates', order: 40, defaultOpen: false },
  { id: 'interface', title: 'Interface', order: 50, defaultOpen: false },
].map((s) => Object.freeze(s)));
for (const s of SURFACE_SECTIONS) reservePanelSection('surface', s);

/** The panel is drawn again as a whole only for another structure, an edit or a change in its sections. */
export function surfaceSignature(app) {
  return JSON.stringify([app.project?.activeStructure ?? null, app.structure ? structureKey(app) : null, sectionsSignature('surface', app)]);
}

/** Without a structure the panel says what to load first and offers the three ways to get one. */
function emptyState(shell) {
  return h('div.panel-empty',
    ic('surface'),
    h('h3', 'Load a bulk crystal first.'),
    h('p.hint', 'Open a CIF or POSCAR file, pick a crystal in the Library, or build one. Then cleave a surface, set the vacuum, fix layers and place adsorbates here.'),
    h('div.acts',
      btn('Open file…', { icon: 'open', cls: 'primary small', tip: 'Open CIF, POSCAR, XYZ, PDB, Materials Studio XSD or Facet files', kbd: keyLabel('mod+o'), on: () => shell.runCommand('file.open') }),
      btn('Library', { icon: 'library', cls: 'small', tip: 'Sample crystals, 2D materials, clusters and molecules', on: () => shell.openLeft('library') }),
      btn('Build crystal', { icon: 'build', cls: 'small', tip: 'Build a crystal from a prototype', on: () => shell.openLeft('build') })));
}

registerLeftPanel({
  id: 'surface', title: 'Surface', short: 'Surface', icon: 'surface', tip: 'Cleave surfaces, set the vacuum, fix layers and place adsorbates',
  refreshOn: ['project', 'structure'],
  signature: surfaceSignature,
  render(app, el, shell) {
    if (!app.structure) { el.append(emptyState(shell)); return; }
    renderSections('surface', app, el, shell);
  },
});
