/**
 * Input controls of the surface tools and parameter forms (F0-A §5.6): a number with a unit, a 2- or 3-vector with a
 * Cartesian / fractional (/ surface) switch, Miller indices that show four indices (h k i l) on a hexagonal cell, and
 * an integer matrix with its determinant and presets. Values are checked by core/params.js, so a control shows the
 * same messages as the parameter schema, the CLI and the REST API.
 *
 * Every control returns
 *   { el, value, set(v, { silent }), validate() → message | null, setError(message | null), focus(), valid, inputs }
 * `value` is the current value when the input is valid and null otherwise; `valid` says whether it is; `inputs` are
 * the editable boxes. Options all controls take:
 *   label        what the control is for (the aria-label of the group, the start of every message)
 *   key          keeps focus on the same box when a panel is drawn again (default: the label)
 *   required     empty → `<Label>: enter a value.`; such a control starts empty and never shows placeholder digits
 *                (U4); remembering the user's last value during a session is the caller's business
 *   optional     empty is valid (value null); otherwise an empty control shows its type's message
 *   onChange(value)            on every valid change
 *   onCommit(value)            on Enter, or when focus leaves the control with a valid value not committed yet
 *   onValidity(valid, message) when the control turns valid or invalid (not while it is being built)
 * Errors show below the control (p.err-text.field-err, linked with aria-describedby; the boxes get aria-invalid) once
 * the user has typed or validate() was called; soft warnings show as p.hint.field-warn and never block.
 *
 * Number boxes are type="number" (phone keypads then have a minus key). A focused box ignores the mouse wheel and
 * scrolls the panel instead; a box holding only '-' (validity.badInput) counts as being typed, not as empty; pasted
 * text such as "0.5, 0.5, 0", "1/3 2/3 0", "1 0 -1 0", "(1 0 1̄ 0)" or "2 1 0; -1 1 0; 0 0 1" is spread over the boxes.
 */
import { h } from './dom.js';
import { showMenu } from './overlays.js';
import { coerceParam, parseIndices, validateParams } from '../core/params.js';
import {
  isHexagonalCell, hklToHkil, centeredCellHint, formatIndices, ariaIndices, inv3, surfaceNormal,
} from '../core/lattice.js';
import { cross, dot, norm } from '../core/util.js';

let lastId = 0;
const nextId = (prefix) => `${prefix}-${++lastId}`;
const MINUS = '\u2212';
/** The hkil / hkl choice of the Miller control when no app keeps it in prefs.millerIndices. */
let sessionNotation = null;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const keyOf = (v) => JSON.stringify(v ?? null);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
/** A number for a box: up to 12 significant digits (the exact value is kept until the box is edited). */
const boxText = (x) => (x == null || !Number.isFinite(x) ? '' : String(+x.toPrecision(12)));
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };

/** The error of `candidate` for the schema field `spec`, or its normalized value and soft warnings. */
function check(spec, candidate) {
  const { values, errors, warnings } = validateParams([{ ...spec, name: 'value' }], { value: candidate });
  return errors.length ? { value: null, error: errors[0], warnings: [] } : { value: values.value ?? null, error: null, warnings };
}

/** The message of an empty or unreadable entry of `spec`'s type ("<Label>: enter three numbers, like 0 0 1."). */
function typeMessage(spec) {
  try { coerceParam({ ...spec, required: false }, ''); } catch (err) { return err.message; }
  return `${spec.label}: enter a value.`;
}

/** Numbers pasted as text, or null when the text cannot be read. */
function readText(text, fractions) {
  try { return parseIndices(String(text), { fractions }); } catch { return null; }
}

/** The closest scrolling ancestor of `el` (the panel a wheel over a focused number box should scroll). */
function scrollParent(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = globalThis.getComputedStyle?.(p);
    if (s && /(auto|scroll|overlay)/.test(`${s.overflowY ?? ''} ${s.overflow ?? ''}`) && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement ?? null;
}

/** A wheel over a focused number box would change its value: scroll the panel instead. */
function blockWheel(e) {
  const box = e.currentTarget;
  if (document.activeElement !== box) return;
  e.preventDefault();
  const sp = scrollParent(box);
  if (!sp) return;
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (sp.clientHeight || 400) : 1;
  sp.scrollTop += (e.deltaY || 0) * unit;
  sp.scrollLeft += (e.deltaX || 0) * unit;
}

function numberBox({ label, value = '', step, min, max, dataKey, required = false, readonly = false }) {
  const box = h('input.field.num', {
    type: 'number', step: step ?? 'any', min, max, value, 'aria-label': label, 'data-key': dataKey ?? null,
    'aria-required': required ? 'true' : null, 'aria-readonly': readonly ? 'true' : null, readOnly: readonly || null,
    tabindex: readonly ? '-1' : null, autocomplete: 'off',
  });
  if (!readonly) box.addEventListener('wheel', blockWheel, { passive: false });
  return box;
}

/** The number in a box: null when empty, NaN when it is not a number. */
const readBox = (box) => {
  const t = String(box.value ?? '').trim();
  if (t === '') return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : NaN;
};

function setDescribedBy(el, ids) {
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
  else el.removeAttribute('aria-describedby');
}

/**
 * Mark `input` invalid with `message` (null or '' clears it), the way the controls and parameter forms do, for inputs
 * outside them too: aria-invalid on the input and the message in a p.err-text.field-err linked with aria-describedby.
 * `slot` is that p element, or an element to put it in; without a slot the p goes right after the input. Returns the
 * p (null when there was nothing to clear).
 */
export function setInvalid(input, message, slot = null) {
  let p = null;
  if (slot?.classList?.contains('field-err')) p = slot;
  else if (slot) p = slot.querySelector?.('.field-err') ?? null;
  else if (input?.nextElementSibling?.classList?.contains('field-err')) p = input.nextElementSibling;
  const others = () => (input?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((x) => x && x !== p?.id);
  if (!message) {
    input?.removeAttribute('aria-invalid');
    if (p) {
      p.hidden = true;
      p.textContent = '';
      if (input) setDescribedBy(input, others());
    }
    return p;
  }
  if (!p) {
    p = h('p.err-text.field-err');
    if (slot) slot.append(p);
    else input?.after?.(p);
  }
  if (!p.id) p.id = nextId('field-err');
  p.textContent = message;
  p.hidden = false;
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    setDescribedBy(input, [...others(), p.id]);
  }
  return p;
}

// --------------------------------------------------------------------------------------------- shared plumbing
/**
 * What every control shares: evaluate the boxes, show the message once the user has typed (or validate() asked),
 * report valid changes, commits and validity changes. `evaluate({ commit, focused })` returns { value, error,
 * warnings, pending } (pending: still being typed, no message yet); `paint(state | null)` updates readouts.
 */
class Field {
  constructor({ opts, group, boxes, err, warn, evaluate, paint }) {
    Object.assign(this, { opts, group, boxes, err, warn, evaluate, paintExtra: paint });
    this.touched = false;
    this.external = null;
    this.state = { value: null, error: null, warnings: [], pending: false };
    this.reported = keyOf(null);
    this.committed = this.reported;
    this.validity = false;
    group.addEventListener('focusout', (e) => {
      if (e.relatedTarget && group.contains(e.relatedTarget)) return;
      this.update({ commit: true, touch: this.touched });
      this.commit(false);
    });
  }

  get valid() { return !this.external && !this.state.error && !this.state.pending; }
  get value() { return this.valid ? this.state.value : null; }
  get message() { return this.external ?? this.state.error ?? null; }
  focused() { return !!document.activeElement && this.group.contains(document.activeElement); }

  /** The first evaluation: nothing is reported, nothing is shown unless the starting value is wrong. */
  start() {
    this.evaluateNow({ commit: false });
    this.paint();
    if (this.valid) this.reported = keyOf(this.state.value);
    this.committed = this.reported;
    this.validity = this.valid;
  }

  /** Bind a box: typing, Enter and paste (`onPaste(text, box)` returns false to leave the paste to the browser). */
  wire(box, onInput, onPaste) {
    box.addEventListener('input', () => { this.external = null; onInput?.(box); this.update(); });
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      this.update({ commit: true });
      this.commit(true);
    });
    if (onPaste) {
      box.addEventListener('paste', (e) => {
        const text = e.clipboardData?.getData('text/plain') || e.clipboardData?.getData('text') || '';
        if (onPaste(text, box) === false) return;
        e.preventDefault();
      });
    }
  }

  evaluateNow(ctx) {
    this.state = { value: null, error: null, warnings: [], pending: false, ...this.evaluate({ ...ctx, focused: this.focused() }) };
  }

  /** Evaluate the boxes again; show the message when touched; report a valid change unless `silent`. */
  update({ commit = false, touch = true, silent = false } = {}) {
    if (touch) this.touched = true;
    this.evaluateNow({ commit });
    this.paint();
    if (this.valid) {
      const k = keyOf(this.state.value);
      if (k !== this.reported) {
        this.reported = k;
        if (!silent) this.opts.onChange?.(this.state.value);
      }
    }
    this.notify();
  }

  /** onCommit with the valid value: always on Enter (`force`), on leaving the control only when it changed. */
  commit(force) {
    if (!this.valid) return;
    const k = keyOf(this.state.value);
    if (!force && k === this.committed) return;
    this.committed = k;
    this.opts.onCommit?.(this.state.value);
  }

  notify() {
    const v = this.valid;
    if (v === this.validity) return;
    this.validity = v;
    this.opts.onValidity?.(v, this.message);
  }

  /** A message for the control from outside it (a paste that does not fit, a server error); cleared by typing. */
  fail(message) {
    this.touched = true;
    this.external = message || null;
    this.paint();
    this.notify();
  }

  paint() {
    const msg = this.external ?? (this.touched ? this.state.error : null);
    const warnings = msg || this.state.error || this.state.pending ? [] : this.state.warnings ?? [];
    for (const b of this.boxes) {
      if (msg) b.setAttribute('aria-invalid', 'true'); else b.removeAttribute('aria-invalid');
      setDescribedBy(b, [msg ? this.err.id : null, warnings.length ? this.warn.id : null].filter(Boolean));
    }
    this.err.textContent = msg ?? '';
    this.err.hidden = !msg;
    this.warn.textContent = warnings.join(' ');
    this.warn.hidden = !warnings.length;
    this.paintExtra?.(this.valid ? this.state : null);
  }

  /** The object a control returns; `set(v)` puts a value into the boxes. */
  api(el, set) {
    const f = this;
    return {
      el,
      inputs: this.boxes,
      get value() { return f.value; },
      get valid() { return f.valid; },
      set(v, { silent = false } = {}) {
        f.external = null;
        f.touched = v != null;
        set(v);
        f.update({ touch: v != null, silent });
        if (f.valid) f.committed = f.reported;
      },
      validate() { f.update({ commit: true }); return f.message; },
      setError(message) { f.external = message || null; f.paint(); f.notify(); },
      focus() { f.boxes[0]?.focus?.(); },
    };
  }
}

/**
 * The app of a control: `opts.app`, else the page's facet.app. Its prefs keep the Miller control's hkil / hkl
 * choice and its structure is the current one (the 'surface' frame of a vector, the presets of a matrix).
 */
function appOf(opts) {
  const app = opts.app ?? globalThis.facet?.app ?? null;
  return app && typeof app === 'object' ? app : null;
}

/** The current structure of a control: `opts.structure` (an override), else the app's (see appOf), else null. */
const structureOf = (opts) => opts.structure ?? appOf(opts)?.structure ?? null;

/** The p elements under a control: its error line and its soft-warning line. */
function messageLines() {
  return [h('p.err-text.field-err', { id: nextId('field-err'), hidden: true }), h('p.hint.field-warn', { id: nextId('field-warn'), hidden: true })];
}

/** A control left empty: required → enter a value; optional → valid null; otherwise its type's message. */
function emptyState(spec, opts) {
  if (opts.required) return { error: `${spec.label}: enter a value.` };
  if (opts.optional) return { value: null };
  return { error: typeMessage(spec) };
}

/**
 * The state of several boxes: `values` are their numbers (null = empty, NaN = not a number), `bad` whether one holds
 * a half-typed number. Some boxes empty while focus is inside the control: still being typed.
 */
function boxesState(spec, opts, values, bad, { commit, focused }, candidate) {
  if (bad) return commit ? { error: typeMessage(spec) } : { pending: true };
  const empty = values.filter((x) => x === null).length;
  if (empty === values.length) return emptyState(spec, opts);
  if (empty) return !commit && focused ? { pending: true } : { error: typeMessage(spec) };
  if (values.some((x) => !isNum(x))) return { error: typeMessage(spec) };
  return check(spec, candidate());
}

// ------------------------------------------------------------------------------------------------------ numbers
/**
 * A number box with an optional unit after it: numberInput({ label, value, unit, min, max, step, integer, required,
 * optional, placeholder, onChange, onCommit, onValidity, key }). Messages: enter a number / enter a whole number /
 * use a value from <min> to <max> / enter a value (required). `placeholder` is never shown on a required box (U4).
 */
export function numberInput(opts = {}) {
  const label = opts.label || 'Value';
  const spec = { type: opts.integer ? 'int' : 'float', label, min: opts.min, max: opts.max, required: !!opts.required };
  const box = numberBox({
    label, value: opts.value == null ? '' : String(opts.value), step: opts.step ?? (opts.integer ? 1 : 'any'), min: opts.min, max: opts.max,
    dataKey: opts.key ?? label, required: opts.required,
  });
  if (opts.placeholder != null && !opts.required) box.setAttribute('placeholder', String(opts.placeholder));
  const [err, warn] = messageLines();
  const el = h('div.inp.num-field', h('div.num-in', box, opts.unit ? h('span.unit', { 'aria-hidden': 'true' }, opts.unit) : null), err, warn);
  const f = new Field({
    opts, group: el, boxes: [box], err, warn,
    evaluate: ({ commit }) => {
      if (box.validity?.badInput) return commit ? { error: typeMessage(spec) } : { pending: true };
      const x = readBox(box);
      if (x === null) return emptyState(spec, opts);
      return check(spec, x);
    },
  });
  f.wire(box, null, (text) => {
    const v = readText(text, false);
    if (v && v.length === 1 && isNum(v[0])) { box.value = String(v[0]); f.external = null; f.update(); }
    else if (!v || v.length) f.fail(typeMessage(spec));
    return true;
  });
  f.start();
  return f.api(el, (v) => { box.value = v == null ? '' : String(v); });
}

// ------------------------------------------------------------------------------------------------------ vectors
const FRAME_LABELS = { cartesian: ['x', 'y', 'z'], fractional: ['a', 'b', 'c'], surface: ['u', 'v', 'h'] };
const FRAME_NAMES = { cartesian: 'Å', fractional: 'frac', surface: 'u v h' };
const FRAME_TIPS = {
  cartesian: 'Cartesian x, y, z (Å)',
  fractional: 'Fractions of a, b, c',
  surface: 'Fractions u, v of the two in-plane cell vectors and the height h (Å) along the surface normal',
};

/** Cells equal entry by entry within 1e-9 Å. */
function sameCell(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) if (!(Math.abs(a[i][k] - b[i][k]) <= 1e-9)) return false;
  return true;
}

/**
 * The surface of the 'surface' frame when the caller gave none: surfaceNormal of the current structure when `cell` is
 * its cell, else the 'ab-plane' rule of surfaceNormal for the bare cell (axis c, the unit normal of a × b on the +c
 * side); null for a cell whose a and b are parallel.
 */
function surfaceOf(cell, opts) {
  const s = structureOf(opts);
  if (s && sameCell(s.cell, cell)) {
    try {
      const sn = surfaceNormal(s);
      if (sn?.normal) return sn;
    } catch { /* the ab-plane rule below */ }
  }
  const nv = cross(cell[0], cell[1]);
  const length = norm(nv);
  if (!(length > 0)) return null;
  const sign = dot(nv, cell[2]) < 0 ? -1 : 1;
  return { normal: nv.map((x) => (sign * x) / length + 0), axis: 2 };
}

/** Rows of the frame's basis in Cartesian coordinates (null when the frame needs a cell or a surface it does not have). */
function frameBasis(frame, cell, surface) {
  if (frame === 'cartesian') return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (!cell) return null;
  if (frame === 'fractional') return cell.map((r) => [r[0], r[1], r[2]]);
  if (frame === 'surface' && surface?.normal) {
    const k = surface.axis ?? 2, i = (k + 1) % 3, j = (k + 2) % 3;
    const nv = surface.normal, len = Math.hypot(nv[0], nv[1], nv[2]) || 1;
    return [cell[i], cell[j], [nv[0] / len, nv[1] / len, nv[2] / len]].map((r) => [r[0], r[1], r[2]]);
  }
  return null;
}

const times = (v, m) => [0, 1, 2].map((x) => v[0] * m[0][x] + v[1] * m[1][x] + v[2] * m[2][x]);

/** v given in the basis `from` (rows) written in the basis `to`: cart = v · from, v' = cart · inv(to). */
function convert(v, from, to) {
  if (from === to) return v.slice();
  return times(times(v, from), inv3(to)).map((x) => (Math.abs(x) < 1e-12 ? 0 : x + 0));
}

/**
 * Two or three number boxes for a vector: vec3Input({ label, value, size = 3, labels, frame = 'cartesian',
 * frames = [frame], cell, integer, nonzero, unit = 'Å', required, optional, onChange, onCommit, onValidity, key }).
 * The value is always in `frame`; with two or more frames and a cell a small switch (Å / frac / u v h) shows it in
 * another frame, converted with the cell. In the 'surface' frame (for displacements) u, v are fractions of the two
 * in-plane cell vectors and h is in Å along the surface normal: surfaceNormal of the current structure when `cell` is
 * its cell (the structure is `structure`, else the app's: `app`, else the page's facet.app), else the normal of
 * a × b; `surface` (a surfaceNormal result) overrides both. The boxes are labelled x y z (Å), a b c (fractional),
 * u v h (surface) or `labels`; size 2 defaults to u v.
 */
export function vec3Input(opts = {}) {
  const label = opts.label || 'Vector';
  const n = opts.size === 2 ? 2 : 3;
  const spec = { type: 'vector', label, size: n, integer: !!opts.integer, nonzero: !!opts.nonzero, required: !!opts.required };
  const cell = opts.cell ?? null;
  const wantsSurface = n === 3 && !!cell && (opts.frame === 'surface' || (opts.frames ?? []).includes('surface'));
  const surface = wantsSurface ? opts.surface ?? surfaceOf(cell, opts) : null;
  const basis = (fr) => frameBasis(fr, cell, surface);
  const frame = n === 3 ? opts.frame ?? 'cartesian' : null;
  const available = n === 3 && basis(frame) ? [...new Set([frame, ...(opts.frames ?? [])])].filter((fr) => basis(fr)) : [frame];
  let shown = frame;
  let disp = Array(n).fill(null);   // the numbers of the boxes in the shown frame (null = empty)
  let anchor = null;                // { disp, value }: the exact value behind converted boxes nobody edited since
  const base = opts.key ?? label;
  const unitText = n === 3 ? opts.unit ?? 'Å' : opts.unit ?? '';
  const names = (fr) => opts.labels ?? (n === 2 ? ['u', 'v'] : FRAME_LABELS[fr] ?? FRAME_LABELS.cartesian);
  const boxes = Array.from({ length: n }, (_, k) => numberBox({ label: names(shown)[k], dataKey: `${base}:${k}`, step: opts.integer ? 1 : 'any', required: opts.required }));
  const tags = boxes.map((b, k) => h('span.ax', { 'aria-hidden': 'true' }, names(shown)[k]));
  const unit = h('span.unit', { 'aria-hidden': 'true' });
  const [err, warn] = messageLines();
  const toggle = available.length >= 2 ? h('div.seg.frame-seg', { role: 'group', 'aria-label': `${label} frame` }) : null;
  const el = h('div.inp.v3', { role: 'group', 'aria-label': label },
    h('div.v3-row', h('div.triple', { dataset: { n: String(n) } }, boxes.map((b, k) => h('label', tags[k], b))), unit, toggle), err, warn);
  const toSchema = (v) => {
    if (n !== 3 || shown === frame) return v.slice();
    if (anchor && sameList(anchor.disp, v)) return anchor.value.slice();
    return convert(v, basis(shown), basis(frame));
  };
  const show = (v) => {   // put the schema-frame value v into the boxes of the shown frame
    disp = n === 3 && shown !== frame ? convert(v, basis(frame), basis(shown)) : v.slice();
    anchor = n === 3 && shown !== frame ? { disp: disp.slice(), value: v.slice() } : null;
  };
  const fill = () => { boxes.forEach((b, k) => { b.value = boxText(disp[k]); }); };
  const relabel = () => {
    const ns = names(shown);
    boxes.forEach((b, k) => { b.setAttribute('aria-label', ns[k]); tags[k].textContent = ns[k]; });
    unit.textContent = shown === 'cartesian' || n === 2 ? unitText : '';
    unit.hidden = !unit.textContent;
    for (const b of toggle?.children ?? []) b.setAttribute('aria-pressed', String(b.dataset.frame === shown));
  };
  const f = new Field({
    opts, group: el, boxes, err, warn,
    evaluate: (ctx) => boxesState(spec, opts, disp, boxes.some((b) => b.validity?.badInput), ctx, () => toSchema(disp)),
  });
  const setValue = (v) => {
    const arr = v == null ? [] : Array.from(v, (x) => (typeof x === 'number' ? x : NaN));
    if (arr.length === n && arr.every(isNum)) show(arr);
    else { disp = Array.from({ length: n }, (_, k) => (k < arr.length ? arr[k] : null)); anchor = null; }
    fill();
  };
  boxes.forEach((b, k) => f.wire(b, () => { disp[k] = readBox(b); }, (text, box) => {
    const v = readText(text, !opts.integer);
    if (v && v.length === n && v.every(isNum)) disp = v.slice();
    else if (v && v.length === 1 && isNum(v[0])) disp[boxes.indexOf(box)] = v[0];
    else { if (!v || v.length) f.fail(typeMessage(spec)); return true; }
    fill();
    f.external = null;
    f.update();
    return true;
  }));
  for (const fr of toggle ? available : []) {
    const tip = FRAME_TIPS[fr] ?? fr;
    const b = h('button', { type: 'button', 'aria-pressed': String(fr === shown), 'data-frame': fr, 'data-tip': tip, 'aria-label': tip }, FRAME_NAMES[fr] ?? fr);
    b.addEventListener('click', () => {
      if (fr === shown) return;
      if (!f.valid) { f.update({ commit: true }); return; }   // nothing to convert yet: say what is wrong
      const v = f.value;
      shown = fr;
      if (v) show(v);
      fill();
      relabel();
      f.update({ touch: f.touched });
    });
    toggle.append(b);
  }
  setValue(opts.value);
  relabel();
  f.start();
  return f.api(el, setValue);
}

// ------------------------------------------------------------------------------------------------------- Miller
const reduce = (v) => { const g = v.reduce((a, x) => gcd(a, x), 0) || 1; return v.map((x) => x / g + 0); };

/** Indices in the interface: "(1 0 1̅ 0)" for the eye and "1 0 minus 1 0" for screen readers. */
function indices(v) {
  return h('span.idx', h('span', { 'aria-hidden': 'true' }, formatIndices(v)), h('span.sr-only', `(${ariaIndices(v)})`));
}

/**
 * Boxes h k l for Miller indices of the current cell: millerInput({ label, value, cell, hexagonal = 'auto', max = 30,
 * warnAbove = 12, describe, required, optional, app, onChange, onCommit, onValidity, key }). The value is always
 * [h, k, l]. On a hexagonal cell (γ = 120° with c unique, isHexagonalCell) the control shows four boxes h k i l, i
 * computed (read-only), and a hkil / hkl switch kept in the app's prefs.millerIndices (`app`, else the page's
 * facet.app, else for the session); hexagonal true / false forces four / three boxes. Four indices can always be
 * pasted ("1 0 -1 0", "(1 0 1̄ 0)"). Below: "(h k l) of the current cell", the plane it equals when the indices have a
 * common factor, the conventional indices on an fcc or bcc primitive cell (centeredCellHint) and describe(value)
 * (e.g. "d = 2.265 Å"); on another hexagonal setting a note says what four indices need (the γ = 120° setting when
 * γ is 60°, c as the unique axis when another axis is unique).
 */
export function millerInput(opts = {}) {
  const label = opts.label || 'Miller indices';
  const spec = { type: 'miller', label, required: !!opts.required };
  if (opts.max !== undefined) spec.max = opts.max;
  if (opts.warnAbove !== undefined) spec.warnAbove = opts.warnAbove;
  const cell = opts.cell ?? null;
  let hex = null;
  try { hex = cell ? isHexagonalCell(cell) : null; } catch { hex = null; }
  const hex120 = !!hex && hex.axis === 2 && hex.gamma === 120;
  const canFour = opts.hexagonal === true || (opts.hexagonal !== false && hex120);
  // a hexagonal cell in another setting: what the four boxes would need (none when the caller chose the boxes)
  const fourNote = !hex || canFour || opts.hexagonal === false ? null
    : hex.axis === 2 ? 'Four-index (h k i l) notation needs the γ = 120° setting.'
      : `Four-index (h k i l) notation needs c as the unique axis${hex.gamma === 120 ? '' : ' and γ = 120°'}.`;
  const app = appOf(opts);
  let four = canFour && (app?.prefs?.millerIndices ?? sessionNotation ?? 'hkil') !== 'hkl';
  let primitive = null;
  try { primitive = cell ? centeredCellHint(cell) : null; } catch { primitive = null; }
  const base = opts.key ?? label;
  let disp = [null, null, null];
  const boxes = ['h', 'k', 'l'].map((x) => numberBox({ label: x, dataKey: `${base}:${x}`, step: 1, required: opts.required }));
  const iBox = numberBox({ label: 'i (computed)', dataKey: `${base}:i`, step: 1, readonly: true });
  iBox.dataset.tip = `i = ${MINUS}(h + k)`;
  const iCell = h('label.computed', h('span.ax', { 'aria-hidden': 'true' }, 'i'), iBox);
  const cells = boxes.map((b, k) => h('label', h('span.ax', { 'aria-hidden': 'true' }, 'hkl'[k]), b));
  const row = h('div.triple');
  const readout = h('div.readout', { 'aria-live': 'polite' });
  const [err, warn] = messageLines();
  const modeSeg = canFour ? h('div.seg.notation-seg', { role: 'group', 'aria-label': `${label} notation` }) : null;
  const el = h('div.inp.miller', { role: 'group', 'aria-label': label }, h('div.miller-row', row, modeSeg), err, warn, readout);
  const layout = () => {
    row.replaceChildren(...(four ? [cells[0], cells[1], iCell, cells[2]] : cells));
    row.dataset.n = four ? '4' : '3';
    for (const b of modeSeg?.children ?? []) b.setAttribute('aria-pressed', String((b.dataset.mode === 'hkil') === four));
  };
  const fillI = () => { iBox.value = Number.isSafeInteger(disp[0]) && Number.isSafeInteger(disp[1]) ? String(0 - (disp[0] + disp[1])) : ''; };
  const fill = () => { boxes.forEach((b, k) => { b.value = isNum(disp[k]) ? String(disp[k]) : ''; }); fillI(); };
  const paint = (state) => {
    const lines = [];
    const v = state?.value;
    if (v) {
      const first = h('p.hint', indices(four ? hklToHkil(v) : v), ' of the current cell');
      if (v.reduce((a, x) => gcd(a, x), 0) > 1) first.append(' = the ', indices(four ? hklToHkil(reduce(v)) : reduce(v)), ' plane');
      lines.push(first);
      if (primitive) {
        const q = primitive.toConventional;
        const conv = reduce([0, 1, 2].map((r) => q[r][0] * v[0] + q[r][1] * v[1] + q[r][2] * v[2]));
        lines.push(h('p.hint', 'This is a primitive cell: ', indices(v), ' here is the conventional ', indices(conv),
          ' plane. Use Cell › Conventional cell first, or enter indices for this cell.'));
      }
      let extra = null;
      try { extra = opts.describe?.(v) ?? null; } catch { extra = null; }
      if (extra) lines.push(h('p.hint', extra));
    }
    if (fourNote) lines.push(h('p.hint', fourNote));
    readout.replaceChildren(...lines);
    readout.hidden = !lines.length;
    fillI();
  };
  const f = new Field({
    opts, group: el, boxes, err, warn, paint,
    evaluate: (ctx) => boxesState(spec, opts, disp, boxes.some((b) => b.validity?.badInput), ctx, () => disp.slice()),
  });
  const setValue = (v) => {
    const arr = v == null ? [] : Array.from(v, (x) => (typeof x === 'number' ? x : NaN));
    const r = arr.length ? check(spec, arr) : { value: null };
    disp = r.value ? r.value.slice() : (arr.length === 4 ? [arr[0], arr[1], arr[3]] : arr.slice(0, 3));
    while (disp.length < 3) disp.push(null);
    fill();
  };
  boxes.forEach((b, k) => f.wire(b, () => { disp[k] = readBox(b); }, (text, box) => {
    const v = readText(text, false);
    if (v && v.length === 3 && v.every(isNum)) disp = v.slice();
    else if (v && v.length === 1 && isNum(v[0])) disp[boxes.indexOf(box)] = v[0];
    else if (v && v.length === 0) return true;
    else {
      const r = check(spec, v ?? String(text));   // four indices (converted when i fits), or the message
      if (r.error) { f.fail(r.error); return true; }
      disp = r.value.slice();
    }
    fill();
    f.external = null;
    f.update();
    return true;
  }));
  for (const m of canFour ? ['hkil', 'hkl'] : []) {
    const tip = m === 'hkil' ? 'Four indices (h k i l)' : 'Three indices (h k l)';
    const b = h('button', { type: 'button', 'data-mode': m, 'aria-pressed': String((m === 'hkil') === four), 'data-tip': tip }, m);
    b.addEventListener('click', () => {
      if ((m === 'hkil') === four) return;
      four = m === 'hkil';
      sessionNotation = m;
      try { app?.setPref?.('millerIndices', m); } catch { /* a convenience only */ }
      layout();
      f.paint();
    });
    modeSeg.append(b);
  }
  layout();
  setValue(opts.value);
  f.start();
  return f.api(el, setValue);
}

// ----------------------------------------------------------------------------------------------------- matrices
/** [det, |det|] of an integer matrix as text, exactly (BigInt). */
function detText(m) {
  const b = m.map((r) => r.map((x) => BigInt(x)));
  const d = b.length === 2 ? b[0][0] * b[1][1] - b[0][1] * b[1][0]
    : b[0][0] * (b[1][1] * b[2][2] - b[1][2] * b[2][1]) - b[0][1] * (b[1][0] * b[2][2] - b[1][2] * b[2][0]) + b[0][2] * (b[1][0] * b[2][1] - b[1][1] * b[2][0]);
  return [d.toString(), (d < 0n ? -d : d).toString()];
}

/**
 * A grid of whole-number boxes for a 2×2 or 3×3 matrix: imatrixInput({ label, size = 3, value, presets, positive =
 * true, max = 50, maxDet, warnDet = 400, warn, area, rowLabels, colLabels, required, optional, onChange, onCommit,
 * onValidity, key }). Rows are labelled a′ b′ c′ (2×2: U′ V′), columns a b c (U V); each box is "Row a′, column b"
 * for screen readers; Tab goes along the rows. Below it: "det 3 · 3× the atoms" (2×2: "… the area"), or area(value)
 * when given; warn(value) → text adds a soft warning; with positive: false a negative determinant is not an error
 * (the caller's warn explains the handedness). `presets` is a list or a function ({ structure, cell, value }) → list
 * of { label, value, hint, applicable, why, params } (and { header } or { separator: true } rows), called when the
 * menu opens: `structure` is the current structure then (`structure` overrides it, else the app's: `app`, else the
 * page's facet.app), `cell` is `cell` or that structure's cell, `value` the matrix in the boxes. A preset that
 * is not applicable is greyed with `why` as its tip; one with `params` ([{ name, label, value, min, max }], whole
 * numbers) asks for them below the grid and then calls value(params) (or resolve(params)) for its matrix.
 */
export function imatrixInput(opts = {}) {
  const label = opts.label || 'Matrix';
  const n = opts.size === 2 ? 2 : 3;
  const spec = { type: 'imatrix', label, size: n, required: !!opts.required };
  for (const k of ['max', 'maxDet', 'warnDet', 'positive']) if (opts[k] !== undefined) spec[k] = opts[k];
  const rowLabels = opts.rowLabels ?? (n === 2 ? ['U′', 'V′'] : ['a′', 'b′', 'c′']);
  const colLabels = opts.colLabels ?? (n === 2 ? ['U', 'V'] : ['a', 'b', 'c']);
  const base = opts.key ?? label;
  let disp = Array.from({ length: n }, () => Array(n).fill(null));
  const boxes = [];
  const grid = h('div.imatrix-grid', { dataset: { n: String(n) } }, h('span.corner', { 'aria-hidden': 'true' }),
    colLabels.map((c) => h('span.col', { 'aria-hidden': 'true' }, c)));
  for (let r = 0; r < n; r++) {
    grid.append(h('span.row', { 'aria-hidden': 'true' }, rowLabels[r]));
    for (let c = 0; c < n; c++) {
      const b = numberBox({ label: `Row ${rowLabels[r]}, column ${colLabels[c]}`, dataKey: `${base}:${r},${c}`, step: 1, required: opts.required });
      boxes.push(b);
      grid.append(b);
    }
  }
  const readout = h('p.hint.imatrix-readout', { 'aria-live': 'polite', hidden: true });
  const [err, warn] = messageLines();
  const params = h('div.imatrix-params', { hidden: true });
  const presetsBtn = opts.presets
    ? h('button.btn.small.ghost.imatrix-presets', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': `${label} presets` }, 'Presets…')
    : null;
  const el = h('div.inp.imatrix', { role: 'group', 'aria-label': label },
    h('div.imatrix-row', grid, presetsBtn ? h('div.imatrix-tools', presetsBtn) : null), readout, err, warn, params);
  const fill = () => { boxes.forEach((b, i) => { const x = disp[Math.floor(i / n)][i % n]; b.value = isNum(x) ? String(x) : ''; }); };
  const paint = (state) => {
    let text = '';
    if (state?.value) {
      const [det, size] = detText(state.value);
      text = `det ${det} · ${size}× the ${n === 2 ? 'area' : 'atoms'}`;
      if (typeof opts.area === 'function') {
        try { text = String(opts.area(state.value) ?? text); } catch { /* keep the determinant */ }
      }
    }
    readout.textContent = text;
    readout.hidden = !text;
  };
  const f = new Field({
    opts, group: el, boxes, err, warn, paint,
    evaluate: (ctx) => {
      const s = boxesState(spec, opts, disp.flat(), boxes.some((b) => b.validity?.badInput), ctx, () => disp.map((r) => r.slice()));
      if (s.value && typeof opts.warn === 'function') {
        let w = null;
        try { w = opts.warn(s.value); } catch { w = null; }
        if (w) s.warnings = [...(s.warnings ?? []), String(w)];
      }
      return s;
    },
  });
  /** Put a matrix (n rows, or n² numbers) into the boxes; false when it does not have that shape. */
  const setValue = (v) => {
    const items = v == null ? [] : Array.from(v);
    const rows = items.length === n * n && items.every((x) => typeof x === 'number') ? Array.from({ length: n }, (_, r) => items.slice(r * n, r * n + n)) : items;
    const ok = v == null || (rows.length === n && rows.every((r) => Array.isArray(r) && r.length === n));
    disp = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (__, c) => {
      const x = ok ? rows[r]?.[c] : undefined;
      return x === undefined || x === null ? null : typeof x === 'number' ? x : NaN;
    }));
    fill();
    return ok;
  };
  boxes.forEach((b, i) => f.wire(b, () => { disp[Math.floor(i / n)][i % n] = readBox(b); }, (text) => {
    const v = readText(text, false);
    const r = Math.floor(i / n), c = i % n;
    if (v && v.length === 1 && isNum(v[0])) disp[r][c] = v[0];
    else if (v && v.length === n && v.every(isNum)) disp[r] = v.slice();
    else if (v && v.length === 0) return true;
    else if (!v || !setValue(v)) { f.fail(typeMessage(spec)); return true; }
    fill();
    f.external = null;
    f.update();
    return true;
  }));

  const apply = (m) => {
    if (m == null) return;
    if (!setValue(m)) { f.fail(typeMessage(spec)); return; }
    f.external = null;
    f.update();
    f.commit(true);
  };
  const closeParams = () => { params.hidden = true; params.replaceChildren(); };
  const askParams = (p) => {
    const list = Array.from(p.params).map((q) => (typeof q === 'string' ? { name: q } : q));
    const pErr = h('p.err-text.field-err.preset-err', { id: nextId('field-err'), hidden: true, role: 'alert' });
    const ctls = list.map((q) => ({
      name: String(q.name),
      label: String(q.label ?? q.name),
      ctl: numberInput({ label: String(q.label ?? q.name), value: q.value ?? q.default ?? 1, integer: true, min: q.min ?? 1, max: q.max, key: `${base}:preset:${q.name}` }),
    }));
    const go = () => {
      const vals = {};
      for (const c of ctls) {
        if (c.ctl.validate()) { c.ctl.focus(); return; }
        vals[c.name] = c.ctl.value;
      }
      let m;
      try { m = typeof p.value === 'function' ? p.value(vals) : typeof p.resolve === 'function' ? p.resolve(vals) : p.value; }
      catch (e) { pErr.textContent = e?.message ?? String(e); pErr.hidden = false; return; }
      if (m == null) { pErr.textContent = 'No matrix for these numbers.'; pErr.hidden = false; return; }
      closeParams();
      apply(m);
      f.boxes[0]?.focus?.();
    };
    for (const c of ctls) {
      c.ctl.inputs[0].addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
        else if (e.key === 'Escape') { e.stopPropagation(); closeParams(); presetsBtn?.focus?.(); }
      });
    }
    const applyBtn = h('button.btn.small.primary', { type: 'button' }, 'Apply');
    applyBtn.addEventListener('click', go);
    const cancelBtn = h('button.btn.small', { type: 'button' }, 'Cancel');
    cancelBtn.addEventListener('click', () => { closeParams(); presetsBtn?.focus?.(); });
    params.replaceChildren(h('p.hint', p.label), h('div.imatrix-param-row', ctls.map((c) => h('label.imatrix-param', h('span', c.label), c.ctl.el))),
      pErr, h('div.row', applyBtn, cancelBtn));
    params.setAttribute('role', 'group');
    params.setAttribute('aria-label', `${p.label}: numbers`);
    params.hidden = false;
    ctls[0]?.ctl.focus();
  };
  const choose = (p) => {
    if (p.params && Array.from(p.params).length) { askParams(p); return; }
    closeParams();
    try { apply(typeof p.value === 'function' ? p.value({}) : p.value); } catch (e) { f.fail(e?.message ?? String(e)); }
  };
  presetsBtn?.addEventListener('click', () => {
    const structure = structureOf(opts);
    const ctx = { structure, cell: opts.cell ?? structure?.cell ?? null, value: f.value };
    let list;
    try { list = typeof opts.presets === 'function' ? opts.presets(ctx) : opts.presets; }
    catch (e) { f.fail(e?.message ?? String(e)); return; }
    const items = Array.from(list ?? []).filter((p) => p && (p.separator || p.header || p.label != null)).map((p) => {
      if (p.separator || p.header) return p;
      const off = p.applicable === false;
      return { label: String(p.label), hint: off ? null : p.hint ?? null, tip: off ? p.why ?? null : p.tip ?? null, disabled: off, run: () => choose(p) };
    });
    if (!items.length) items.push({ header: 'No presets for this cell.' });
    showMenu(presetsBtn, items, { label: `${label} presets` });
  });

  setValue(opts.value);
  f.start();
  return f.api(el, (v) => { setValue(v); });
}
