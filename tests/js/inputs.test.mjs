// The input controls of ui/inputs.js and their use in ui/paramform.js (F0-A T8, F0-A §5.6, ledger L-F0-48): numberInput
// (unit, required boxes that start empty with no placeholder digits, U4), vec3Input (frames, size 2, paste), millerInput
// (four indices on a hexagonal cell, the readout, paste "1 0 0 0"), imatrixInput (det readout, area, warn, positive:
// false, presets as a list or a function of ctx, presets with numbers), setInvalid, wheel blocking on a focused box,
// validity.badInput counted as typing, aria-labels on every box (the e2e locators, lead decision L-06), and paramForm's
// new types, valid and onValidity. The controls run on the small DOM stand-in below (events with capture and bubble,
// focus, a selector subset); the real page is checked in the browser.
// Run: node --test tests/js/inputs.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ------------------------------------------------------------------------------------------- a minimal DOM
class FakeNode {
  constructor() { this.parentNode = null; }
  get parentElement() { return this.parentNode instanceof FakeElement && this.parentNode !== doc ? this.parentNode : null; }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === doc) return true; return false; }
  remove() { this.parentNode?.removeChild(this); }
}
class FakeText extends FakeNode {
  constructor(t) { super(); this.data = String(t); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function splitSelector(sel) {
  const parts = [];
  let cur = '', depth = 0, quote = null;
  for (const ch of sel.trim()) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}
function compound(s) {
  const tests = [];
  let i = 0;
  const tag = /^[a-zA-Z][\w-]*|^\*/.exec(s);
  if (tag) { const t = tag[0].toLowerCase(); if (t !== '*') tests.push((el) => el.localName === t); i = tag[0].length; }
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if ((m = /^\.([\w-]+)/.exec(rest))) { const c = m[1]; tests.push((el) => el.classList.contains(c)); }
    else if ((m = /^#([\w-]+)/.exec(rest))) { const id = m[1]; tests.push((el) => el.id === id); }
    else if ((m = /^\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/.exec(rest))) {
      const name = m[1].toLowerCase(), val = m[2] ?? m[3] ?? m[4];
      tests.push(val === undefined ? (el) => el.hasAttribute(name) : (el) => el.getAttribute(name) === val);
    } else if (rest.startsWith(':not(')) {
      let depth = 0, j = 4;
      for (; j < rest.length; j++) { if (rest[j] === '(') depth++; else if (rest[j] === ')' && --depth === 0) break; }
      const inner = compound(rest.slice(5, j));
      tests.push((el) => !inner(el));
      m = [rest.slice(0, j + 1)];
    } else throw new Error(`fake DOM: unsupported selector "${s}"`);
    i += m[0].length;
  }
  return (el) => tests.every((t) => t(el));
}
function matcher(sel) {
  const parts = splitSelector(sel).map(compound);
  return (el) => {
    if (!parts[parts.length - 1](el)) return false;
    let k = parts.length - 2;
    for (let p = el.parentElement; p && k >= 0; p = p.parentElement) if (parts[k](p)) k--;
    return k < 0;
  };
}

class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.localName = tag.toLowerCase();
    this.tagName = tag.toUpperCase();
    this.childNodes = [];
    this.attrs = new Map();
    this.listeners = [];
    this.style = {};
    this.scrollTop = 0; this.scrollLeft = 0; this.scrollHeight = 0; this.clientHeight = 0;
    this.validity = { badInput: false };
    this._value = null;
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? this.getAttribute(`data-${kebab(k)}`) ?? undefined : undefined),
      set: (_, k, v) => { this.setAttribute(`data-${kebab(String(k))}`, v); return true; },
      has: (_, k) => this.hasAttribute(`data-${kebab(String(k))}`),
      ownKeys: () => [...this.attrs.keys()].filter((a) => a.startsWith('data-')).map((a) => camel(a.slice(5))),
      getOwnPropertyDescriptor: (_, k) => (this.hasAttribute(`data-${kebab(String(k))}`) ? { enumerable: true, configurable: true, value: this.getAttribute(`data-${kebab(String(k))}`) } : undefined),
    });
    this.classList = {
      add: (...cs) => { const s = this._classes(); cs.forEach((c) => s.add(c)); this._setClasses(s); },
      remove: (...cs) => { const s = this._classes(); cs.forEach((c) => s.delete(c)); this._setClasses(s); },
      toggle: (c, on) => { const s = this._classes(); const want = on ?? !s.has(c); if (want) s.add(c); else s.delete(c); this._setClasses(s); return want; },
      contains: (c) => this._classes().has(c),
    };
  }
  _classes() { return new Set((this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)); }
  _setClasses(s) { this.setAttribute('class', [...s].join(' ')); }
  get className() { return this.getAttribute('class') ?? ''; }
  set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') ?? ''; }
  set id(v) { this.setAttribute('id', v); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get value() { return this._value ?? this.getAttribute('value') ?? ''; }
  set value(v) { this._value = String(v); }
  get placeholder() { return this.getAttribute('placeholder') ?? ''; }
  set placeholder(v) { this.setAttribute('placeholder', v); }
  get readOnly() { return this.hasAttribute('readonly'); }
  set readOnly(v) { if (v) this.setAttribute('readonly', ''); else this.removeAttribute('readonly'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get checked() { return this.hasAttribute('checked'); }
  set checked(v) { if (v) this.setAttribute('checked', ''); else this.removeAttribute('checked'); }
  get children() { return this.childNodes.filter((n) => n instanceof FakeElement); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get nextElementSibling() { const sib = this.parentNode?.children ?? []; return sib[sib.indexOf(this) + 1] ?? null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(...(v === '' || v == null ? [] : [String(v)])); }
  setAttribute(k, v) { this.attrs.set(String(k).toLowerCase(), String(v)); }
  getAttribute(k) { return this.attrs.get(String(k).toLowerCase()) ?? null; }
  hasAttribute(k) { return this.attrs.has(String(k).toLowerCase()); }
  removeAttribute(k) { this.attrs.delete(String(k).toLowerCase()); }
  toggleAttribute(k, on) { const want = on ?? !this.hasAttribute(k); if (want) this.setAttribute(k, ''); else this.removeAttribute(k); return want; }
  _adopt(n) { const node = n instanceof FakeNode ? n : new FakeText(n); node.parentNode?.removeChild(node); node.parentNode = this; return node; }
  append(...ns) { for (const n of ns) this.childNodes.push(this._adopt(n)); }
  prepend(...ns) { this.childNodes.unshift(...ns.map((n) => this._adopt(n))); }
  replaceChildren(...ns) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this.append(...ns); }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  after(...ns) { const p = this.parentNode; if (!p) return; const nodes = ns.map((n) => p._adopt(n)); p.childNodes.splice(p.childNodes.indexOf(this) + 1, 0, ...nodes); }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  *descendants() { for (const c of this.children) { yield c; yield* c.descendants(); } }
  querySelectorAll(sel) { const m = matcher(sel); return [...this.descendants()].filter(m); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  matches(sel) { return matcher(sel)(this); }
  closest(sel) { const m = matcher(sel); for (let x = this; x instanceof FakeElement; x = x.parentNode) if (m(x)) return x; return null; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getClientRects() { return [{}]; }
  addEventListener(type, fn, opts) { this.listeners.push({ type, fn, capture: opts === true || !!opts?.capture, passive: !!opts?.passive }); }
  removeEventListener(type, fn, opts) { const cap = opts === true || !!opts?.capture; this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === cap)); }
  dispatchEvent(ev) {
    ev.target = this;
    const path = [];
    for (let x = this; x; x = x.parentNode) path.unshift(x);
    const fire = (node, phase) => {
      for (const l of [...node.listeners]) {
        if (l.type !== ev.type || ev._stop) continue;
        if (phase === 'capture' && !l.capture) continue;
        if (phase === 'bubble' && l.capture) continue;
        ev.currentTarget = node;
        if (l.passive) { const pd = ev.preventDefault; ev.preventDefault = () => {}; l.fn.call(node, ev); ev.preventDefault = pd; } else l.fn.call(node, ev);
      }
    };
    for (const node of path.slice(0, -1)) fire(node, 'capture');
    fire(this, 'target');
    if (ev.bubbles) for (const node of path.slice(0, -1).reverse()) fire(node, 'bubble');
    return !ev.defaultPrevented;
  }
  focus() {
    const prev = doc.activeElement;
    if (prev === this) return;
    doc.activeElement = this;
    if (prev && prev !== doc.body) prev.dispatchEvent(event('focusout', { relatedTarget: this }));
    this.dispatchEvent(event('focusin', { relatedTarget: prev }));
  }
  blur() {
    if (doc.activeElement !== this) return;
    doc.activeElement = doc.body;
    this.dispatchEvent(event('focusout', { relatedTarget: null }));
  }
  click() { this.dispatchEvent(event('click')); }
}
function event(type, init = {}) {
  return { type, bubbles: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; }, ...init };
}
const doc = new FakeElement('#document');
doc.body = new FakeElement('body');
doc.append(doc.body);
Object.assign(doc, {
  activeElement: doc.body, fullscreenElement: null, documentElement: doc.body, scrollingElement: doc.body,
  createElement: (tag) => new FakeElement(tag), createTextNode: (t) => new FakeText(t),
});
globalThis.document = doc;
globalThis.Node = FakeNode;
globalThis.Element = FakeElement;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
globalThis.getComputedStyle = (el) => el.style;
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(fn, ms, ...a); t?.unref?.(); return t; };   // menus' timers must not keep node alive

const { numberInput, vec3Input, millerInput, imatrixInput, setInvalid } = await import('../../crystallume/web/js/ui/inputs.js');
const { paramForm } = await import('../../crystallume/web/js/ui/paramform.js');
const { closeMenu } = await import('../../crystallume/web/js/ui/overlays.js');
const { cellFromParams } = await import('../../crystallume/web/js/core/util.js');

// ------------------------------------------------------------------------------------------- helpers
const MINUS = '\u2212';
const BAR = '\u0305';
/** A panel that scrolls, holding `el`, attached to the page. */
function mount(el) {
  const panel = new FakeElement('div');
  Object.assign(panel.style, { overflowY: 'auto' });
  panel.scrollHeight = 2000; panel.clientHeight = 400;
  panel.append(el);
  doc.body.append(panel);
  return panel;
}
/** Type `text` into a box (an input event), optionally leaving the browser's badInput flag set. */
function type(box, text, { badInput = false } = {}) {
  box.focus();
  box.value = text;
  box.validity.badInput = badInput;
  box.dispatchEvent(event('input'));
}
const enter = (box) => box.dispatchEvent(event('keydown', { key: 'Enter' }));
const paste = (box, text) => !box.dispatchEvent(event('paste', { clipboardData: { getData: () => text } }));
const errorLine = (ctl) => { const p = ctl.el.querySelector('p.field-err'); return p.hidden ? null : p.textContent; };
const warnLine = (ctl) => { const p = ctl.el.querySelector('p.field-warn'); return p.hidden ? null : p.textContent; };
const byLabel = (root, label) => root.querySelector(`[aria-label="${label}"]`);
const recorder = () => { const calls = []; const fn = (...a) => { calls.push(a); }; fn.calls = calls; return fn; };
const hex = cellFromParams(3.25, 3.25, 5.207, 90, 90, 120);
const cubic = [[3.92, 0, 0], [0, 3.92, 0], [0, 0, 3.92]];

beforeEach(() => { doc.body.replaceChildren(); doc.activeElement = doc.body; closeMenu(); });

// ------------------------------------------------------------------------------------------- numberInput
describe('numberInput', () => {
  test('required: starts empty without placeholder digits, invalid until a value is typed (U4)', () => {
    const onChange = recorder(), onValidity = recorder();
    const ctl = numberInput({ label: 'Vacuum', unit: 'Å', min: 0, required: true, placeholder: '15', onChange, onValidity });
    const [box] = ctl.inputs;
    assert.equal(box.getAttribute('type'), 'number');
    assert.equal(box.getAttribute('aria-label'), 'Vacuum');
    assert.equal(box.getAttribute('aria-required'), 'true');
    assert.equal(box.value, '');
    assert.equal(box.getAttribute('placeholder'), null, 'no placeholder digits on a required box');
    assert.equal(ctl.el.querySelector('.unit').textContent, 'Å');
    assert.equal(ctl.valid, false);
    assert.equal(ctl.value, null);
    assert.equal(errorLine(ctl), null, 'no message before the user typed');
    assert.equal(onValidity.calls.length, 0, 'nothing reported while it is built');
    type(box, '0');
    assert.deepEqual([ctl.valid, ctl.value, errorLine(ctl)], [true, 0, null]);
    assert.deepEqual(onChange.calls, [[0]]);
    assert.deepEqual(onValidity.calls, [[true, null]]);
    type(box, '');
    assert.equal(errorLine(ctl), 'Vacuum: enter a value.');
    assert.equal(box.getAttribute('aria-invalid'), 'true');
    assert.equal(box.getAttribute('aria-describedby'), ctl.el.querySelector('p.field-err').id);
    assert.deepEqual(onValidity.calls.at(-1), [false, 'Vacuum: enter a value.']);
    assert.deepEqual(onChange.calls, [[0]], 'onChange only for valid values');
  });
  test('a placeholder on an optional box; messages of int ranges', () => {
    const ctl = numberInput({ label: 'Layers', value: 4, min: 1, max: 30, integer: true, placeholder: '4' });
    const [box] = ctl.inputs;
    assert.equal(box.getAttribute('placeholder'), '4');
    assert.equal(box.value, '4');
    assert.equal(ctl.value, 4);
    type(box, '31');
    assert.equal(errorLine(ctl), 'Layers: use a value from 1 to 30.');
    type(box, '2.5');
    assert.equal(errorLine(ctl), 'Layers: enter a whole number.');
    type(box, '');
    assert.equal(errorLine(ctl), 'Layers: enter a number.', 'not required and not optional: an empty box is not a number');
    assert.equal(ctl.validate(), 'Layers: enter a number.');
  });
  test('badInput (only "-" typed) is typing, not an empty box; leaving the box says so', () => {
    const ctl = numberInput({ label: 'Height', required: true });
    const [box] = ctl.inputs;
    mount(ctl.el);
    type(box, '', { badInput: true });
    assert.equal(errorLine(ctl), null, 'no "enter a value." while the minus sign is being typed');
    assert.equal(box.getAttribute('aria-invalid'), null);
    assert.equal(ctl.valid, false, 'but nothing to use yet');
    box.blur();
    assert.equal(errorLine(ctl), 'Height: enter a number.');
    type(box, '-2', { badInput: false });
    assert.deepEqual([ctl.value, errorLine(ctl)], [-2, null]);
  });
  test('the wheel over a focused box scrolls the panel instead of changing the value', () => {
    const ctl = numberInput({ label: 'Vacuum', value: 10 });
    const [box] = ctl.inputs;
    const panel = mount(ctl.el);
    const unfocused = box.dispatchEvent(event('wheel', { deltaY: 40, deltaX: 0, deltaMode: 0 }));
    assert.equal(unfocused, true, 'an unfocused box leaves the wheel alone (the page scrolls normally)');
    box.focus();
    const wheel = event('wheel', { deltaY: 40, deltaX: 0, deltaMode: 0 });
    box.dispatchEvent(wheel);
    assert.equal(wheel.defaultPrevented, true);
    assert.equal(panel.scrollTop, 40);
    box.dispatchEvent(event('wheel', { deltaY: 2, deltaX: 0, deltaMode: 1 }));
    assert.equal(panel.scrollTop, 72, 'lines are 16 px');
    assert.equal(box.value, '10');
    assert.ok(box.listeners.some((l) => l.type === 'wheel' && !l.passive), 'the listener can prevent the default');
  });
  test('onCommit on Enter and on leaving the box once per change; set; setError; paste', () => {
    const onCommit = recorder(), onChange = recorder();
    const ctl = numberInput({ label: 'x', value: 1, onCommit, onChange });
    const [box] = ctl.inputs;
    mount(ctl.el);
    box.focus();
    box.blur();
    assert.deepEqual(onCommit.calls, [], 'nothing changed');
    type(box, '2');
    enter(box);
    box.blur();
    assert.deepEqual(onCommit.calls, [[2]], 'Enter commits; leaving with the same value does not again');
    type(box, '3');
    box.blur();
    assert.deepEqual(onCommit.calls, [[2], [3]]);
    ctl.set(5, { silent: true });
    assert.deepEqual([box.value, ctl.value, onChange.calls.at(-1)], ['5', 5, [3]]);
    ctl.set(6);
    assert.deepEqual(onChange.calls.at(-1), [6]);
    ctl.setError('x: the server said no.');
    assert.deepEqual([ctl.valid, errorLine(ctl)], [false, 'x: the server said no.']);
    type(box, '7');
    assert.deepEqual([ctl.valid, errorLine(ctl), ctl.value], [true, null, 7], 'typing clears an outside message');
    assert.equal(paste(box, `${MINUS}4`), true);
    assert.equal(ctl.value, -4, 'U+2212 pasted');
    assert.equal(paste(box, '1, 2'), true);
    assert.equal(errorLine(ctl), 'x: enter a number.');
  });
});

// ------------------------------------------------------------------------------------------- vec3Input
describe('vec3Input', () => {
  test('three labelled boxes in a group; a vector or nothing', () => {
    const onChange = recorder();
    const ctl = vec3Input({ label: 'Shift', value: [0, 0, 1], onChange });
    assert.equal(ctl.el.getAttribute('role'), 'group');
    assert.equal(ctl.el.getAttribute('aria-label'), 'Shift');
    assert.deepEqual(ctl.inputs.map((b) => b.getAttribute('aria-label')), ['x', 'y', 'z']);
    assert.equal(ctl.el.querySelector('.unit').textContent, 'Å');
    assert.deepEqual(ctl.value, [0, 0, 1]);
    type(ctl.inputs[0], '0.5');
    assert.deepEqual(onChange.calls, [[[0.5, 0, 1]]]);
    type(ctl.inputs[1], '');
    assert.equal(errorLine(ctl), null, 'a box emptied while typing in the control: no message yet');
    assert.equal(ctl.valid, false);
    ctl.inputs[1].blur();
    assert.equal(errorLine(ctl), 'Shift: enter three numbers, like 0 0 1.');
  });
  test('paste spreads "0.5, 0.5, 0" and "1/3 2/3 0" over the boxes', () => {
    const ctl = vec3Input({ label: 'Shift', value: [0, 0, 0] });
    assert.equal(paste(ctl.inputs[2], '0.5, 0.5, 0'), true);
    assert.deepEqual(ctl.value, [0.5, 0.5, 0]);
    assert.deepEqual(ctl.inputs.map((b) => b.value), ['0.5', '0.5', '0']);
    paste(ctl.inputs[0], '1/3 2/3 0');
    assert.ok(Math.abs(ctl.value[0] - 1 / 3) < 1e-15 && Math.abs(ctl.value[1] - 2 / 3) < 1e-15);
    paste(ctl.inputs[1], '7');
    assert.equal(ctl.value[1], 7, 'one number goes into the box it was pasted into');
    paste(ctl.inputs[1], '1 2');
    assert.equal(errorLine(ctl), 'Shift: enter three numbers, like 0 0 1.');
  });
  test('Å / frac: the value stays in the schema frame, the boxes show the other one', () => {
    const cell = [[4, 0, 0], [0, 5, 0], [0, 0, 10]];
    const onChange = recorder();
    const ctl = vec3Input({ label: 'Origin', value: [1, 2.5, 5], frame: 'cartesian', frames: ['cartesian', 'fractional'], cell, onChange });
    const seg = ctl.el.querySelector('.frame-seg');
    assert.ok(seg, 'two frames and a cell: a switch');
    const frac = seg.querySelector('[data-frame="fractional"]');
    frac.click();
    assert.deepEqual(ctl.inputs.map((b) => b.value), ['0.25', '0.5', '0.5']);
    assert.deepEqual(ctl.inputs.map((b) => b.getAttribute('aria-label')), ['a', 'b', 'c']);
    assert.equal(ctl.el.querySelector('.unit').hidden, true);
    assert.deepEqual(ctl.value, [1, 2.5, 5], 'unchanged by the switch');
    assert.deepEqual(onChange.calls, []);
    type(ctl.inputs[2], '0.25');
    assert.deepEqual(ctl.value, [1, 2.5, 2.5]);
    assert.equal(vec3Input({ label: 'v', frames: ['cartesian', 'fractional'] }).el.querySelector('.frame-seg'), null, 'no cell: no switch');
  });
  test('the surface frame: u, v along the in-plane cell vectors and h along the normal', () => {
    const cell = [[2, 0, 0], [0, 2, 0], [1, 0, 20]];   // c tilted, the normal is z
    const ctl = vec3Input({ label: 'Move', value: [0, 0, 1.5], frames: ['cartesian', 'fractional', 'surface'], cell, surface: { normal: [0, 0, 1], axis: 2 } });
    ctl.el.querySelector('[data-frame="surface"]').click();
    assert.deepEqual(ctl.inputs.map((b) => b.getAttribute('aria-label')), ['u', 'v', 'h']);
    assert.deepEqual(ctl.inputs.map((b) => b.value), ['0', '0', '1.5']);
    type(ctl.inputs[0], '0.5');
    assert.deepEqual(ctl.value, [1, 0, 1.5]);
    assert.equal(vec3Input({ label: 'v', frames: ['cartesian', 'surface'], cell }).el.querySelector('[data-frame="surface"]'), null, 'no normal: no surface frame');
  });
  test('size 2 (labels u v), integer, nonzero, optional', () => {
    const uv = vec3Input({ label: 'Offset', size: 2, value: [0, 0] });
    assert.deepEqual(uv.inputs.map((b) => b.getAttribute('aria-label')), ['u', 'v']);
    assert.equal(uv.el.querySelector('.unit').hidden, true);
    paste(uv.inputs[0], '0.5 0.25');
    assert.deepEqual(uv.value, [0.5, 0.25]);
    const dir = vec3Input({ label: 'Direction', integer: true, nonzero: true, value: [1, 1, 0] });
    type(dir.inputs[0], '0'); type(dir.inputs[1], '0');
    assert.equal(errorLine(dir), 'Direction: the vector cannot be zero.');
    type(dir.inputs[1], '1.5');
    assert.equal(errorLine(dir), 'Direction: enter three whole numbers, like 1 1 0.');
    const opt = vec3Input({ label: 'v', optional: true });
    assert.deepEqual([opt.valid, opt.value], [true, null]);
    const req = vec3Input({ label: 'v', required: true });
    assert.equal(req.validate(), 'v: enter a value.');
  });
});

// ------------------------------------------------------------------------------------------- millerInput
describe('millerInput', () => {
  test('three boxes h k l on a cubic cell, the readout of the current cell and common factors', () => {
    const ctl = millerInput({ label: 'Miller indices', value: [2, 2, 2], cell: cubic, describe: (v) => `d = ${(3.92 / Math.hypot(...v)).toFixed(3)} Å` });
    assert.deepEqual(ctl.inputs.map((b) => b.getAttribute('aria-label')), ['h', 'k', 'l']);
    assert.equal(ctl.el.querySelector('[aria-label="i (computed)"]'), null);
    const lines = ctl.el.querySelectorAll('.readout p').map((p) => p.textContent);
    assert.equal(lines[0], '(2 2 2)(2 2 2) of the current cell = the (1 1 1)(1 1 1) plane');
    assert.equal(ctl.el.querySelector('.readout .sr-only').textContent, '(2 2 2)');
    assert.equal(lines[1], 'd = 1.132 Å');
    assert.deepEqual(ctl.value, [2, 2, 2], 'common factors are kept');
    assert.equal(ctl.el.querySelector('.notation-seg'), null);
  });
  test('four boxes h k i l on a hexagonal cell, i computed and read-only', () => {
    const app = { prefs: {}, setPref(k, v) { this.prefs[k] = v; } };
    const onChange = recorder();
    const ctl = millerInput({ label: 'Miller indices', value: [1, 0, 0], cell: hex, app, onChange });
    const iBox = byLabel(ctl.el, 'i (computed)');
    assert.ok(iBox);
    assert.equal(iBox.getAttribute('aria-readonly'), 'true');
    assert.equal(iBox.readOnly, true);
    assert.equal(iBox.dataset.tip, `i = ${MINUS}(h + k)`);
    assert.equal(iBox.value, '-1');
    assert.equal(ctl.el.querySelector('.triple').dataset.n, '4');
    assert.equal(ctl.el.querySelector('.readout .sr-only').textContent, '(1 0 minus 1 0)');
    type(byLabel(ctl.el, 'k'), '1');
    assert.equal(iBox.value, '-2');
    assert.deepEqual(onChange.calls, [[[1, 1, 0]]]);
    const hkl = ctl.el.querySelector('[data-mode="hkl"]');
    hkl.click();
    assert.deepEqual(app.prefs, { millerIndices: 'hkl' }, 'the choice is kept in prefs.millerIndices');
    assert.equal(ctl.el.querySelector('.triple').dataset.n, '3');
    const again = millerInput({ label: 'Miller indices', value: [1, 0, 0], cell: hex, app });
    assert.equal(again.el.querySelector('.triple').dataset.n, '3', 'the next control follows the preference');
    ctl.el.querySelector('[data-mode="hkil"]').click();
    assert.equal(app.prefs.millerIndices, 'hkil');
  });
  test('paste "1 0 0 0": the message names i, the value does not change', () => {
    const onChange = recorder();
    const ctl = millerInput({ label: 'hkl', value: [1, 1, 1], cell: cubic, onChange });
    assert.equal(paste(ctl.inputs[0], '1 0 0 0'), true);
    assert.equal(errorLine(ctl), `hkl: in (h k i l), i must be ${MINUS}(h + k) = -1.`);
    assert.equal(ctl.inputs[0].getAttribute('aria-invalid'), 'true');
    assert.equal(ctl.valid, false);
    assert.deepEqual(onChange.calls, []);
    assert.deepEqual(ctl.inputs.map((b) => b.value), ['1', '1', '1']);
    paste(ctl.inputs[1], `(1 0 1\u0304 0)`);
    assert.deepEqual([ctl.value, errorLine(ctl)], [[1, 0, 0], null], 'four indices are converted');
    assert.deepEqual(onChange.calls, [[[1, 0, 0]]]);
    paste(ctl.inputs[0], `(1${BAR}2${BAR} 3 9)`);
    assert.deepEqual(ctl.value, [-12, 3, 9], 'what formatIndices writes reads back');
    paste(ctl.inputs[0], '0 0 0');
    assert.equal(errorLine(ctl), 'hkl: (0 0 0) is not a plane.');
  });
  test('the primitive-cell hint, the γ = 60° note and the soft warning above warnAbove', () => {
    const fcc = [[0, 1.96, 1.96], [1.96, 0, 1.96], [1.96, 1.96, 0]];
    const p = millerInput({ label: 'hkl', value: [1, 0, 0], cell: fcc });
    assert.equal(p.el.querySelectorAll('.readout p')[1].textContent,
      `This is a primitive cell: (1 0 0)(1 0 0) here is the conventional (1${BAR} 1 1)(minus 1 1 1) plane. Use Cell › Conventional cell first, or enter indices for this cell.`);
    const sixty = millerInput({ label: 'hkl', value: [0, 0, 1], cell: cellFromParams(3.25, 3.25, 5.2, 90, 90, 60) });
    assert.equal(sixty.inputs.length, 3);
    assert.ok(sixty.el.querySelectorAll('.readout p').some((x) => x.textContent === 'Four-index (h k i l) notation needs the γ = 120° setting.'));
    const high = millerInput({ label: 'hkl', value: [1, 1, 1] });
    type(high.inputs[0], '13');
    assert.equal(warnLine(high), 'High-index plane; the surface cell may be large.');
    assert.equal(high.valid, true, 'a soft warning does not block');
    type(high.inputs[0], '31');
    assert.equal(errorLine(high), `hkl: use indices from ${MINUS}30 to 30.`);
    assert.equal(warnLine(high), null);
    const own = millerInput({ label: 'hkl', value: [1, 1, 1], max: 12 });
    type(own.inputs[0], '13');
    assert.equal(errorLine(own), `hkl: use indices from ${MINUS}12 to 12.`);
  });
});

// ------------------------------------------------------------------------------------------- imatrixInput
describe('imatrixInput', () => {
  test('a labelled grid and the determinant readout (atoms, or the area for 2×2)', () => {
    const ctl = imatrixInput({ label: 'Supercell', value: [[2, 1, 0], [-1, 1, 0], [0, 0, 1]] });
    assert.equal(ctl.inputs.length, 9);
    assert.equal(ctl.inputs[1].getAttribute('aria-label'), 'Row a′, column b');
    assert.equal(ctl.el.querySelector('.imatrix-readout').textContent, 'det 3 · 3× the atoms');
    const two = imatrixInput({ label: 'Surface cell', size: 2, value: [[3, 0], [0, 3]] });
    assert.equal(two.inputs[2].getAttribute('aria-label'), 'Row V′, column U');
    assert.equal(two.el.querySelector('.imatrix-readout').textContent, 'det 9 · 9× the area');
    type(two.inputs[0], '0');
    type(two.inputs[3], '0');
    assert.equal(errorLine(two), 'Surface cell: the matrix is singular (determinant 0).');
    assert.equal(two.el.querySelector('.imatrix-readout').hidden, true);
  });
  test('area replaces the readout; warn adds a soft warning; positive: false lets det < 0 through', () => {
    const seen = [];
    const ctl = imatrixInput({
      label: 'Matrix', value: [[1, 0, 0], [0, 1, 0], [0, 0, -1]], positive: false,
      area: (m) => `area of ${m[0][0]}`, warn: (m) => { seen.push(m); return m[2][2] < 0 ? 'This matrix turns the slab upside down (c reverses); the top and bottom surfaces swap.' : null; },
    });
    assert.equal(ctl.valid, true);
    assert.equal(errorLine(ctl), null, 'no negative-determinant message with positive: false');
    assert.equal(ctl.el.querySelector('.imatrix-readout').textContent, 'area of 1');
    ctl.validate();
    assert.equal(warnLine(ctl), 'This matrix turns the slab upside down (c reverses); the top and bottom surfaces swap.');
    assert.deepEqual(seen.at(-1), [[1, 0, 0], [0, 1, 0], [0, 0, -1]]);
    const strict = imatrixInput({ label: 'Matrix', value: [[1, 0, 0], [0, 1, 0], [0, 0, -1]] });
    assert.equal(strict.validate(), 'Matrix: the determinant is -1; a negative determinant mirrors the cell. Swap two rows or negate one.');
    const big = imatrixInput({ label: 'Matrix', size: 2, value: [[1, 0], [0, 1]] });
    paste(big.inputs[0], '21 0; 0 20');
    assert.equal(warnLine(big), 'This makes 420× the atoms.');
    assert.equal(big.el.querySelector('.imatrix-readout').textContent, 'det 420 · 420× the area');
  });
  test('paste "2 1 0; -1 1 0; 0 0 1", nine numbers, or one row', () => {
    const ctl = imatrixInput({ label: 'P' });
    paste(ctl.inputs[4], '2 1 0; -1 1 0; 0 0 1');
    assert.deepEqual(ctl.value, [[2, 1, 0], [-1, 1, 0], [0, 0, 1]]);
    paste(ctl.inputs[0], '1 0 0 0 1 0 0 0 2');
    assert.deepEqual(ctl.value, [[1, 0, 0], [0, 1, 0], [0, 0, 2]]);
    paste(ctl.inputs[3], '1 1 0');
    assert.deepEqual(ctl.value, [[1, 0, 0], [1, 1, 0], [0, 0, 2]], 'one row into the row it was pasted into');
    paste(ctl.inputs[0], '1 2');
    assert.equal(errorLine(ctl), "P: enter a 3×3 matrix of whole numbers, rows separated by ';'.");
  });
  test('presets as a function of ctx { structure, cell, value }: greyed with why, applied with one click', () => {
    const structure = { cell: hex, name: 'ZnO' };
    const calls = [];
    const onChange = recorder(), onCommit = recorder();
    const ctl = imatrixInput({
      label: 'Surface cell', size: 2, value: [[1, 0], [0, 1]], structure, onChange, onCommit,
      presets: (ctx) => {
        calls.push(ctx);
        return [
          { header: 'Presets relative to: this cell' },
          { label: 'p(2×2)', value: [[2, 0], [0, 2]], hint: 'det 4 · 4× the atoms', applicable: true },
          { label: 'c(2×2)', value: null, applicable: false, why: 'c(2×2) does not fit this surface mesh (hexagonal)' },
          { separator: true },
          { label: '(√3×√3)R30°', value: [[1, 1], [-1, 2]], hint: 'det 3 · 3× the atoms' },
        ];
      },
    });
    const btn = byLabel(ctl.el, 'Surface cell presets');
    assert.equal(btn.getAttribute('aria-haspopup'), 'menu');
    btn.click();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].structure, structure);
    assert.equal(calls[0].cell, hex);
    assert.deepEqual(calls[0].value, [[1, 0], [0, 1]]);
    const menu = doc.body.querySelector('.menu');
    assert.ok(menu, 'the presets menu');
    assert.equal(menu.getAttribute('aria-label'), 'Surface cell presets');
    assert.equal(menu.querySelector('.mh').textContent, 'Presets relative to: this cell');
    const items = menu.querySelectorAll('.mi');
    assert.deepEqual(items.map((b) => b.querySelector('span').textContent), ['p(2×2)', 'c(2×2)', '(√3×√3)R30°']);
    assert.equal(items[1].getAttribute('aria-disabled'), 'true');
    assert.equal(items[1].getAttribute('data-tip'), 'c(2×2) does not fit this surface mesh (hexagonal)');
    assert.equal(items[0].querySelector('small').textContent, 'det 4 · 4× the atoms');
    items[1].click();
    assert.deepEqual(ctl.value, [[1, 0], [0, 1]], 'a greyed preset does nothing');
    items[2].click();
    assert.deepEqual(ctl.value, [[1, 1], [-1, 2]]);
    assert.deepEqual(onChange.calls, [[[[1, 1], [-1, 2]]]]);
    assert.deepEqual(onCommit.calls, [[[[1, 1], [-1, 2]]]], 'choosing a preset commits it');
    btn.click();
    assert.deepEqual(calls[1].value, [[1, 1], [-1, 2]], 'ctx.value is the current matrix');
  });
  test('a preset with params asks for its whole numbers, then calls value(params)', () => {
    const got = [];
    const ctl = imatrixInput({
      label: 'Surface cell', size: 2, value: [[1, 0], [0, 1]],
      presets: [{ label: 'Rectangular (n × m√3)…', params: [{ name: 'n', label: 'n', value: 2 }, { name: 'm', label: 'm', value: 1, max: 9 }],
        value: (p) => { got.push(p); return p.m > 5 ? null : [[p.n, 0], [p.m, 2 * p.m]]; } }],
    });
    byLabel(ctl.el, 'Surface cell presets').click();
    doc.body.querySelector('.menu .mi').click();
    const box = ctl.el.querySelector('.imatrix-params');
    assert.equal(box.hidden, false);
    assert.equal(box.getAttribute('aria-label'), 'Rectangular (n × m√3)…: numbers');
    const n = byLabel(box, 'n'), m = byLabel(box, 'm');
    assert.deepEqual([n.value, m.value], ['2', '1']);
    type(m, '7');
    box.querySelector('.btn.primary').click();
    assert.equal(box.querySelector('p.preset-err').textContent, 'No matrix for these numbers.');
    type(m, '2');
    enter(m);
    assert.deepEqual(got.at(-1), { n: 2, m: 2 });
    assert.deepEqual(ctl.value, [[2, 0], [2, 4]]);
    assert.equal(box.hidden, true);
  });
});

// ------------------------------------------------------------------------------------------- setInvalid
test('setInvalid marks any input and puts the message after it, or into a slot', () => {
  const wrap = new FakeElement('div');
  const inp = new FakeElement('input');
  wrap.append(inp);
  const p = setInvalid(inp, 'Element: enter an element symbol, like Cu.');
  assert.equal(inp.getAttribute('aria-invalid'), 'true');
  assert.ok(p.classList.contains('err-text') && p.classList.contains('field-err'));
  assert.equal(inp.nextElementSibling, p);
  assert.equal(inp.getAttribute('aria-describedby'), p.id);
  assert.equal(setInvalid(inp, 'Element: again.'), p, 'the same line is reused');
  assert.equal(p.textContent, 'Element: again.');
  setInvalid(inp, null);
  assert.equal(inp.getAttribute('aria-invalid'), null);
  assert.equal(inp.getAttribute('aria-describedby'), null);
  assert.equal(p.hidden, true);
  const slot = new FakeElement('div');
  const q = setInvalid(inp, 'x: no.', slot);
  assert.equal(q.parentNode, slot);
  assert.equal(setInvalid(new FakeElement('input'), null), null);
});

// ------------------------------------------------------------------------------------------- paramForm
describe('paramForm', () => {
  const schema = [
    { name: 'hkl', type: 'miller', label: 'Miller indices' },
    { name: 'P', type: 'imatrix', size: 2, label: 'Surface cell' },
    { name: 'shift', type: 'vector', label: 'Shift', frames: ['cartesian', 'fractional'] },
    { name: 'vacuum', type: 'float', label: 'Vacuum', unit: 'Å', min: 0, required: true },
    { name: 'layers', type: 'int', label: 'Layers', min: 1, default: 4 },
    { name: 'name', type: 'string', label: 'Name', required: true, default: 'slab' },
    { name: 'periodic', type: 'bool', label: 'Periodic' },
  ];
  test('the new types, units and required fields; valid and onValidity keep a button in step (U4)', () => {
    const changes = [];
    const form = paramForm(schema, { structure: { cell: cubic }, onChange: (v, name) => changes.push([name, structuredClone(v[name])]) });
    assert.deepEqual(form.values, { hkl: [1, 1, 1], P: [[1, 0], [0, 1]], shift: [0, 0, 0], vacuum: null, layers: 4, name: 'slab', periodic: false });
    const vac = byLabel(form.el, 'Vacuum');
    assert.equal(vac.value, '');
    assert.equal(vac.closest('.num-in').querySelector('.unit').textContent, 'Å');
    assert.ok(byLabel(form.el, 'Miller indices') && byLabel(form.el, 'Surface cell') && byLabel(form.el, 'Shift'));
    assert.ok(form.el.querySelector('.frame-seg'), 'the structure has a cell: Å / frac');
    assert.ok(byLabel(form.el, 'Miller indices').closest('.pf-field').classList.contains('pf-wide'));
    assert.equal(form.valid, false);
    const seen = [];
    const off = form.onValidity((v) => seen.push(v));
    type(vac, '12');
    assert.equal(form.valid, true);
    assert.deepEqual(seen, [true]);
    assert.deepEqual(changes.at(-1), ['vacuum', 12]);
    assert.equal(form.values.vacuum, 12);
    paste(byLabel(form.el, 'h'), '1 0 -1 0');
    assert.deepEqual(form.values.hkl, [1, 0, 0]);
    type(byLabel(form.el, 'Name'), '');
    assert.deepEqual(seen, [true, false]);
    assert.equal(form.validate(), 'Name: enter a value.');
    assert.equal(byLabel(form.el, 'Name').getAttribute('aria-invalid'), 'true');
    off();
    type(byLabel(form.el, 'Name'), 'Pt(111)');
    assert.deepEqual(seen, [true, false], 'unsubscribed');
    assert.equal(form.valid, true);
    assert.equal(form.validate(), null);
  });
  test('validate() marks every invalid field and returns the first message', () => {
    const form = paramForm(schema, {});
    type(byLabel(form.el, 'Layers'), '0');
    assert.equal(form.validate(), 'Vacuum: enter a value.');
    assert.equal(byLabel(form.el, 'Layers').getAttribute('aria-invalid'), 'true');
    assert.equal(byLabel(form.el, 'Vacuum').getAttribute('aria-invalid'), 'true');
  });
  test('old schemas work as before: kept values, numbers, a null default is an empty box that is fine', () => {
    const old = [{ name: 'n', type: 'int', label: 'Atoms', min: 1, max: 10000, default: 8 }, { name: 'spacing', type: 'float', default: 2.6, min: 0.5 },
      { name: 'cap', type: 'float', label: 'Cap', default: null }];
    const form = paramForm(old, { values: { n: 5 } });
    assert.equal(byLabel(form.el, 'Atoms').value, '5');
    assert.equal(form.valid, true, 'an empty box with a null default is valid');
    type(byLabel(form.el, 'Atoms'), '0');
    assert.equal(form.validate(), 'Atoms: use a value from 1 to 10000.');
    assert.equal(form.values.n, 5, 'values keep the last valid value');
    type(byLabel(form.el, 'Atoms'), '9');
    assert.deepEqual(form.values, { n: 9, spacing: 2.6, cap: null });
  });
});
