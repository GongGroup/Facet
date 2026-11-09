/**
 * The Measure tool (M), F0-A §3.13.1: clicks pick the atoms of a distance (2), angle (3) or dihedral (4); the picking
 * itself stays in app._onAtomClick (app.measureType, app.measurePicks), so the tool has no handler. It does not select
 * atoms (the selection card hides), and its toolbar button opens the Measure menu. The key M is bound by the command
 * tool.measure. setTool('measure', { measureType: 'angle' }) (or the older setTool('measure', 'angle')) picks the kind.
 */
import { tools } from './index.js';
import { h } from '../../ui/dom.js';

/** Atoms a measurement of each kind needs. */
export const MEASURE_ATOMS = Object.freeze({ distance: 2, angle: 3, dihedral: 4 });
const title = (type) => type[0].toUpperCase() + type.slice(1);
/** 'Distance', 2 atoms and the picks so far, for app.measureType. */
const state = (app) => {
  const type = MEASURE_ATOMS[app.measureType] ? app.measureType : 'distance';
  return { name: title(type), need: MEASURE_ATOMS[type], have: app.measurePicks?.length ?? 0 };
};

export const measureTool = {
  id: 'measure', title: 'Measure', tip: 'Measure distance, angle or dihedral', icon: 'ruler', key: 'm', order: 20,
  toolbar: true, selects: false,
  activate(app) { if (!MEASURE_ATOMS[app.measureType]) app.measureType = 'distance'; },
  hint(app, { touch } = {}) {
    const { name, need, have } = state(app);
    return [`<b>${name}</b> — ${touch ? 'tap' : 'click'} ${need} atoms (${have}/${need})`, '<b>Esc</b> to finish'];
  },
  hud(app, { touch } = {}) {
    const { name, need, have } = state(app);
    const f = document.createDocumentFragment();
    f.append(h('span', `${name}: ${touch ? 'tap' : 'click'} ${need} atoms (${have}/${need})`), h('button', { type: 'button', on: { click: () => app.setTool('select') } }, 'Done'));
    return f;
  },
};

tools.register(measureTool);
