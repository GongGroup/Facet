/**
 * Parameter forms and result views shared by plugin builders (Build panel) and analyses (Structure panel).
 * A parameter is { name, type: 'int'|'float'|'string'|'element'|'bool'|'select'|'vector'|'miller'|'imatrix',
 * default, label?, description?, required?, unit?, min?, max?, step?, options?, … } — the schema plugins use for
 * builders and analyses, checked by core/params.js (the fields of each type are listed there).
 */
import { h, select, toggle } from './dom.js';
import { lineChart } from './chart.js';
import { normalizeSymbol, ELEMENTS } from '../core/elements.js';
import { paramOptions } from '../core/analyses.js';
import { defaultParams } from '../core/params.js';
import { surfaceNormal } from '../core/lattice.js';
import { numberInput, vec3Input, millerInput, imatrixInput, setInvalid } from './inputs.js';
import { disabledPairsFor } from '../render/display.js';

/** Element symbol input with completion; calls onChange(symbol) with a valid symbol only. */
export function elementInput(value, onChange, label) {
  const listId = 'elements-datalist';
  if (!document.getElementById(listId)) document.body.append(h('datalist', { id: listId }, ...[...ELEMENTS.keys()].filter((s) => s !== 'X').map((s) => h('option', { value: s }))));
  const inp = h('input.field', { value, list: listId, 'aria-label': label, style: { width: '64px', textAlign: 'center', fontWeight: 600 }, maxlength: 3, spellcheck: false });
  inp.addEventListener('change', () => { const s = normalizeSymbol(inp.value); inp.value = s === 'X' ? '' : s; if (s !== 'X') onChange(s); });
  return inp;
}

const labelOf = (p) => p.label ?? p.name;

/** The surface normal a vector field's 'surface' frame needs (null without a structure or a usable one). */
function surfaceOf(p, structure) {
  if (!structure || !Array.isArray(p.frames) || !p.frames.includes('surface')) return null;
  try { return surfaceNormal(structure); } catch { return null; }
}

/**
 * Build a form for `params`. Returns { el, values, validate(), valid, onValidity(cb) }: `values` holds the value of
 * every field and is updated on each valid change (then onChange(values, name) runs); validate() marks the invalid
 * fields and returns the first message, or null; `valid` says whether every field is valid now (a required field
 * left empty is not), and onValidity(cb) calls cb(valid) whenever that changes (it returns a function that stops
 * it), so a panel can keep its main button disabled until the form can run (U4). int and float fields show `unit`
 * after the box and start empty when `required`; vector, miller and imatrix fields use the controls of ui/inputs.js,
 * with the structure's cell for the Å / frac switch and the four-index display.
 */
export function paramForm(params = [], { values = {}, structure = null, onChange = () => {} } = {}) {
  const vals = { ...defaultParams(params, structure), ...values };
  const checked = [];   // { valid, validate() } of the fields that can be invalid
  const listeners = new Set();
  const formValid = () => checked.every((c) => c.valid);
  let lastValid = true;
  const notify = () => {
    const v = formValid();
    if (v === lastValid) return;
    lastValid = v;
    for (const cb of [...listeners]) cb(v);
  };
  const set = (name, v) => { vals[name] = v; onChange(vals, name); };
  const row = (p, control, wide = false) => {
    const l = h('label', labelOf(p));
    if (p.description) l.dataset.tip = p.description;
    return h(`div.pf-field${wide ? '.pf-wide' : ''}`, l, control);
  };
  const control = (ctl) => { checked.push(ctl); return ctl.el; };
  const fields = (params ?? []).filter((p) => p?.name).map((p) => {
    const label = labelOf(p);
    const common = { label, required: !!p.required, optional: p.default === null && !p.required, onChange: (v) => set(p.name, v), onValidity: notify };
    if (p.type === 'bool') return h('div.pf-field.pf-wide', toggle({ label, sub: p.description, checked: !!vals[p.name], onChange: (v) => set(p.name, v) }));
    if (p.type === 'element') return row(p, elementInput(vals[p.name] ?? 'C', (v) => set(p.name, v), label));
    if (p.type === 'select') {
      const raw = paramOptions(p, structure);
      const opts = raw.map((o) => ({ value: String(o.value), label: o.label }));
      const typed = new Map(raw.map((o) => [String(o.value), o.value]));
      // a value kept from another structure (e.g. a pair of elements it no longer has) falls back to the
      // default, so the form shows the value Run will use
      if (raw.length && !typed.has(String(vals[p.name]))) {
        const d = defaultParams([p], structure)[p.name];
        vals[p.name] = typed.has(String(d)) ? typed.get(String(d)) : raw[0].value;
      }
      return row(p, select({ options: opts, value: String(vals[p.name] ?? ''), label, onChange: (v) => set(p.name, typed.get(v) ?? v) }));
    }
    if (p.type === 'int' || p.type === 'float') {
      const v = vals[p.name];
      return row(p, control(numberInput({
        ...common, value: Number.isFinite(v) ? v : null, unit: p.unit, min: p.min, max: p.max, step: p.step, integer: p.type === 'int',
        placeholder: p.placeholder,
      })));
    }
    if (p.type === 'vector') {
      return row(p, control(vec3Input({
        ...common, value: vals[p.name], size: p.size, labels: p.labels, integer: p.integer, nonzero: p.nonzero, frame: p.frame, frames: p.frames,
        unit: p.unit, cell: structure?.cell ?? null, surface: surfaceOf(p, structure),
      })), true);
    }
    if (p.type === 'miller') {
      return row(p, control(millerInput({ ...common, value: vals[p.name], cell: structure?.cell ?? null, hexagonal: p.hexagonal, max: p.max, warnAbove: p.warnAbove })), true);
    }
    if (p.type === 'imatrix') {
      return row(p, control(imatrixInput({
        ...common, value: vals[p.name], size: p.size, presets: p.presets ?? null, positive: p.positive, max: p.max, maxDet: p.maxDet, warnDet: p.warnDet,
        rowLabels: p.rowLabels, colLabels: p.colLabels, structure,
      })), true);
    }
    // text: 'string' and types the form does not know
    const inp = h('input.field', { type: 'text', value: vals[p.name] ?? '', 'aria-label': label, placeholder: p.required ? null : p.placeholder ?? null, spellcheck: false, 'aria-required': p.required ? 'true' : null });
    const slot = h('div.pf-msg');
    const message = () => (p.required && inp.value === '' ? `${label}: enter a value.` : null);
    inp.addEventListener('input', () => { set(p.name, inp.value); setInvalid(inp, message(), slot); notify(); });
    checked.push({ get valid() { return !message(); }, validate() { const m = message(); setInvalid(inp, m, slot); return m; } });
    return row(p, h('div.inp', inp, slot));
  });
  lastValid = formValid();
  const el = h('div.pf', fields);
  return {
    el, values: vals,
    /** Mark every invalid field; the first message (in form order), or null. */
    validate() {
      let first = null;
      for (const c of checked) { const m = c.validate(); if (m && first === null) first = m; }
      return first;
    },
    get valid() { return formValid(); },
    onValidity(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}

// ------------------------------------------------------------------ results
const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(+(+v).toPrecision(6)));
const isNumArray = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'number');
const isScalar = (v) => v == null || ['number', 'string', 'boolean'].includes(typeof v);
/** 'centerOfMass' / 'total_mass' → 'Center of mass' / 'Total mass'. */
export const prettyKey = (k) => { const s = String(k).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
const fmtValue = (v) => (typeof v === 'number' ? fmtNum(v) : isNumArray(v) ? v.map(fmtNum).join(', ') : v == null ? '—' : String(v));

/** <dl class="kv"> from [[key, value], ...]. */
export function kvTable(rows) {
  return h('dl.kv', rows.flatMap(([k, v]) => [h('dt', k), h('dd', v instanceof Node ? v : fmtValue(v))]));
}

/**
 * Default view of an analysis result: scalars and short vectors as a key/value table, long numeric
 * arrays as a line chart (two equally long arrays: the first is x), anything else as JSON.
 */
export function renderResult(result, el) {
  if (result == null) { el.append(h('p.hint', 'The analysis returned no result.')); return; }
  if (isScalar(result)) { el.append(kvTable([['Result', result]])); return; }
  if (isNumArray(result) && result.length > 6) { el.append(lineChart({ x: result.map((_, i) => i), y: result, xLabel: 'index', yLabel: 'value', fmtX: fmtNum, fmtY: fmtNum })); return; }
  if (!Array.isArray(result) && typeof result === 'object') {
    const entries = Object.entries(result);
    const series = entries.filter(([, v]) => isNumArray(v) && v.length > 6);
    const rows = entries.filter(([, v]) => isScalar(v) || (isNumArray(v) && v.length <= 6));
    const rest = entries.filter(([k]) => !series.some(([s]) => s === k) && !rows.some(([r]) => r === k));
    if (rows.length) el.append(kvTable(rows.map(([k, v]) => [prettyKey(k), v])));
    if (series.length >= 2 && series[0][1].length === series[1][1].length) {
      el.append(lineChart({ x: series[0][1], y: series[1][1], xLabel: series[0][0], yLabel: series[1][0], fmtX: fmtNum, fmtY: fmtNum }));
      series.splice(0, 2);
    }
    for (const [k, v] of series) el.append(h('div.sub-h', prettyKey(k)), lineChart({ x: v.map((_, i) => i), y: v, xLabel: 'index', yLabel: k, fmtX: fmtNum, fmtY: fmtNum }));
    for (const [k, v] of rest) {
      const flat = v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => isScalar(x) || (isNumArray(x) && x.length <= 6));
      el.append(h('div.sub-h', prettyKey(k)), flat ? kvTable(Object.entries(v).map(([a, b]) => [a, b])) : jsonBlock(v));
    }
    return;
  }
  el.append(jsonBlock(result));
}

function jsonBlock(v) {
  let text;
  try { text = JSON.stringify(v, null, 2); } catch { text = String(v); }
  if (text.length > 20000) text = `${text.slice(0, 20000)}\n…`;
  return h('pre.pf-json', text);
}

/** Helpers handed to analysis render() functions as ctx.ui. */
export const resultUI = { h, lineChart, kvTable, renderResult };

/** The ctx passed to analyses: { app, scene, bondOptions (the scene's bond rules), ui }. */
export function analysisContext(app, s = app.structure) {
  const bonds = app.scene?.display?.bonds ?? {};
  let disabledPairs = [];
  try { disabledPairs = s ? disabledPairsFor(s.elements(), bonds) : []; } catch { /* older display module */ }
  return { app, scene: app.scene, bondOptions: { tolerance: bonds.tolerance ?? 1.15, disabledPairs }, ui: resultUI };
}
