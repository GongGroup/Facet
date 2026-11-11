/**
 * Materials Studio XSD (3D atomistic documents, `.xsd`): reader and writer. The file is XML: a structure with a cell
 * is a SymmetrySystem (3D periodic, space group P1, fractional coordinates), a structure without one a Molecule
 * (Cartesian coordinates in Å). The design is docs/design/xsd-export/README.md; the Python twin is
 * facet/io/xsd.py: the writer gives the same file byte for byte, the reader the same structure and notes, so the
 * arithmetic here and there is written out in the same order.
 *
 * writeXSD(s) writes the current frame:
 * - the cell in Materials Studio's orientation (c along z, b in the yz plane): the structure is turned as a whole
 *   and the fractional coordinates do not change. A cell that already has that orientation (every component within
 *   1e-8 Å) is written as it is, and so is a left-handed cell (cellOrientation tells which);
 * - fractional coordinates with 12 decimals, cell vectors and Cartesian coordinates with 10 (toFixed), never
 *   `-0.000`; coordinates are not wrapped into the cell;
 * - atom names are props.labels where an atom has one, else the element with a running number per element (Pt1, Pt2,
 *   O1); the atom order is kept;
 * - an atom with any direction fixed in props.selective_dynamics is written as fixed
 *   (RestrictedProperties="FractionalXYZ", "XYZ" in a molecule): the format fixes whole atoms;
 * - bonds, occupancies, velocities, charges and symmetry are not written; the file is plain ASCII.
 *
 * readXSD(text, filename) reads files written by Facet, by ASE and by Materials Studio itself:
 * - a document with a lattice (AVector, BVector, CVector on its SpaceGroup) is periodic and its atoms have fractional
 *   coordinates; any other document is a molecule with Cartesian coordinates. Atoms are the Atom3d elements wherever
 *   they are nested (Molecule, RepeatUnit, directly under the root); image atoms (ImageOf) are copies and are
 *   skipped; an atom without XYZ is at the origin;
 * - names (Name) become props.labels; fixed atoms (RestrictedProperties with XYZ or FractionalXYZ) become F F F rows
 *   of props.selective_dynamics. An atom restricted by anything but a CompleteRestriction object, or with other
 *   restricted properties only, is left free and a note says so;
 * - Components gives the element; anything more than one element symbol (a mixture, an isotope) is reduced to its
 *   first element, with a note;
 * - a space group with more than the identity operator: the listed atoms are the asymmetric unit, and they are
 *   expanded with the operators of the file (Operators, twelve numbers each: the rows of the rotation with the
 *   translation in the fourth place), the centring translations and the image atoms of the file, wrapped into the
 *   cell and merged within 1e-3 (fractional). No file of this kind written by Materials Studio was available when
 *   this was written, so the result carries a note asking to check it.
 *
 * The XML is read by a small scanner of its own (tags and attributes), the same in both languages: entities other
 * than the five predefined ones and numeric character references are never expanded, and a DOCTYPE is skipped.
 */
import { Structure, fixDegenerateCell, addWarning } from '../core/structure.js';
import { det3 } from '../core/util.js';
import { MOVE_FLAGS_KEY, moveFlags } from '../core/constraints.js';
import { ELEMENTS } from '../core/elements.js';

/** The label of the format in messages. */
const LABEL = 'Materials Studio XSD';
/** Decimals of fractional coordinates, and of cell vectors and Cartesian coordinates (Å). */
const FRAC_DECIMALS = 12;
const CART_DECIMALS = 10;
/** A cell whose vectors differ from Materials Studio's orientation by less than this (Å) is written as it is. */
const ORIENTATION_TOL = 1e-8;
/** Fractional tolerance for merging symmetry-equivalent atoms (the CIF reader's). */
const SYMPREC = 1e-3;

/** The 40 property definitions every document starts with (DefinedOn, Name, Type), as Materials Studio and ASE write them. */
const PROPERTIES = `
ClassicalEnergyHolder AngleEnergy Double
ClassicalEnergyHolder BendBendEnergy Double
ClassicalEnergyHolder BendTorsionBendEnergy Double
ClassicalEnergyHolder BondEnergy Double
Atom EFGAsymmetry Double
Atom EFGQuadrupolarCoupling Double
ClassicalEnergyHolder ElectrostaticEnergy Double
GrowthFace FaceMillerIndex MillerIndex
GrowthFace FacetTransparency Float
Bondable Force CoDirection
ClassicalEnergyHolder HydrogenBondEnergy Double
Bondable ImportOrder UnsignedInteger
ClassicalEnergyHolder InversionEnergy Double
Atom IsBackboneAtom Boolean
Atom IsChiralCenter Boolean
Atom IsOutOfPlane Boolean
BestFitLineMonitor LineExtentPadding Double
Linkage LinkageGroupName String
PropertyList ListIdentifier String
Atom NMRShielding Double
ClassicalEnergyHolder NonBondEnergy Double
Bondable NormalMode Direction
Bondable NormalModeFrequency Double
Bondable OrbitalCutoffRadius Double
BestFitPlaneMonitor PlaneExtentPadding Double
ClassicalEnergyHolder PotentialEnergy Double
ScalarFieldBase QuantizationValue Double
ClassicalEnergyHolder RestraintEnergy Double
ClassicalEnergyHolder SeparatedStretchStretchEnergy Double
Trajectory SimulationStep Integer
ClassicalEnergyHolder StretchBendStretchEnergy Double
ClassicalEnergyHolder StretchStretchEnergy Double
ClassicalEnergyHolder StretchTorsionStretchEnergy Double
ClassicalEnergyHolder TorsionBendBendEnergy Double
ClassicalEnergyHolder TorsionEnergy Double
ClassicalEnergyHolder TorsionStretchEnergy Double
ClassicalEnergyHolder ValenceCrossTermEnergy Double
ClassicalEnergyHolder ValenceDiagonalEnergy Double
ClassicalEnergyHolder VanDerWaalsEnergy Double
SymmetrySystem _Stress Matrix
`.split('\n').slice(1, -1);

const IDENTITY = '1,0,0,0,0,1,0,0,0,0,1,0';
const trim = (text) => text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
const isElement = (symbol) => symbol !== 'X' && ELEMENTS.has(symbol);

// ------------------------------------------------------------------------------- cell arithmetic (Python's order)
const rows = (cell) => cell.map((r) => [Number(r[0]), Number(r[1]), Number(r[2])]);
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

/** The inverse of `m` with determinant `d` (the adjugate formula of inv3 in core/util.js). */
function inverse(m, d) {
  const [[a, b, c], [d1, e, f], [g, h, i]] = m;
  return [
    [(e * i - f * h) / d, (c * h - b * i) / d, (b * f - c * e) / d],
    [(f * g - d1 * i) / d, (a * i - c * g) / d, (c * d1 - a * f) / d],
    [(d1 * h - e * g) / d, (b * g - a * h) / d, (a * e - b * d1) / d],
  ];
}

function volume(m) {
  const d = det3(m);
  if (!(Math.abs(d) >= 1e-12)) throw new Error(`${LABEL}: the unit cell has no volume`);   // also a determinant that is not a number
  return d;
}

/** [kind, vectors to write] of the cell rows `m`: see cellOrientation. */
function oriented(m) {
  if (volume(m) < 0) return ['left-handed', m];
  const [a, b, c] = m;
  const lc = Math.sqrt(dot(c, c));
  const bz = dot(b, c) / lc;
  const by = Math.sqrt(Math.max(0, dot(b, b) - bz * bz));
  const az = dot(a, c) / lc;
  const ay = (dot(a, b) - az * bz) / by;
  const ax = Math.sqrt(Math.max(0, dot(a, a) - ay * ay - az * az));
  const std = [[ax, ay, az], [0, by, bz], [0, 0, lc]];
  const same = std.every((r, i) => r.every((v, j) => Math.abs(v - m[i][j]) < ORIENTATION_TOL));
  return same ? ['same', m] : ['rotated', std];
}

/**
 * How the writer writes `cell` (3 rows): 'same', 'rotated' or 'left-handed'. Materials Studio's orientation is c
 * along z and b in the yz plane. 'same': the cell has it already (every component within 1e-8 Å) and is written as
 * it is. 'rotated': the cell is turned into it; the structure turns as a whole and the fractional coordinates stay.
 * 'left-handed' (negative volume): no rotation gives that orientation, so the cell is written as it is. A cell
 * without volume throws.
 */
export function cellOrientation(cell) {
  return oriented(rows(cell))[0];
}

/** The symbols of `symbols` that are not chemical elements (X included), each once, in order. */
export function nonElements(symbols) {
  const out = [];
  for (const s of symbols) if (!isElement(s) && !out.includes(s)) out.push(s);
  return out;
}

// ------------------------------------------------------------------------------------------------------ writer
/** `x` with `d` decimals (toFixed), without the sign of a zero; null for a value that cannot be written that way. */
function fixed(x, d) {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return null;
  const t = x.toFixed(d);
  return /^-[0.]*$/.test(t) ? t.slice(1) : t;
}

function triple(v, d, what) {
  const parts = v.map((x) => fixed(x, d));
  if (parts.includes(null)) throw new Error(`${LABEL}: ${what} has a value that is not a finite number or is too large`);
  return parts.join(',');
}

/** `text` as an XML attribute value in plain ASCII. */
function xml(text) {
  if (/^[ !#-%'-;=?-~]*$/.test(text)) return text;
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (c === 9 || c === 10 || c === 13) out += `&#${c};`;
    else if (c < 32 || (c >= 0xD800 && c <= 0xDFFF) || c === 0xFFFE || c === 0xFFFF) out += '&#65533;';   // not allowed in XML: the replacement character
    else if (c < 127) out += ch;
    else out += `&#${c};`;
  }
  return out;
}

/** The name of every atom: its label, else the element with a running number per element. */
function atomNames(s) {
  const col = s.props?.labels;
  const labels = Array.isArray(col) && col.length === s.length ? col : null;
  const counts = new Map();
  return s.symbols.map((sym, i) => {
    counts.set(sym, (counts.get(sym) ?? 0) + 1);
    const lab = labels ? labels[i] : null;
    return (typeof lab === 'string' ? trim(lab) : '') || `${sym}${counts.get(sym)}`;
  });
}

/**
 * The current frame of `s` as a Materials Studio XSD document (see the top of this file for what is written). Throws
 * for a cell without volume and for coordinates that are not finite numbers.
 */
export function writeXSD(s) {
  const n = s.length;
  const names = atomNames(s);
  const flags = Object.prototype.hasOwnProperty.call(s.props ?? {}, MOVE_FLAGS_KEY) ? moveFlags(s) : null;
  const isFixed = (i) => flags !== null && !flags[i].every(Boolean);
  const pos = s.positions;
  const out = ['<?xml version="1.0" encoding="latin1"?>', '<!DOCTYPE XSD []>', '<XSD Version="6.0" WrittenBy="Facet">',
    '\t<AtomisticTreeRoot ID="1" NumProperties="40" NumChildren="1">'];
  for (const row of PROPERTIES) {
    const [definedOn, name, kind] = row.split(' ');
    out.push(`\t\t<Property DefinedOn="${definedOn}" Name="${name}" Type="${kind}"/>`);
  }

  if (!s.cell) {
    out.push(`\t\t<Molecule ID="2" NumChildren="${n}" Name="${xml(trim(String(s.name ?? '')) || 'Untitled')}">`);
    for (let i = 0; i < n; i++) {
      const p = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
      out.push(`\t\t\t<Atom3d ID="${i + 3}" Name="${xml(names[i])}" UserID="${i + 1}" DisplayStyle="Ball and Stick" XYZ="${triple(p, CART_DECIMALS, `atom ${i + 1}`)}" Components="${xml(s.symbols[i])}"${isFixed(i) ? ' RestrictedProperties="XYZ"' : ''}/>`);
    }
    out.push('\t\t</Molecule>', '\t</AtomisticTreeRoot>', '</XSD>');
    return out.join('\n') + '\n';
  }

  const m = rows(s.cell);
  const vectors = oriented(m)[1];
  const inv = inverse(m, det3(m));
  const atoms = Array.from({ length: n }, (_, k) => k + 4).join(',');
  const sg = n + 4, mapping = n + 7;
  out.push(`\t\t<SymmetrySystem ID="2" Mapping="3" Children="${n ? `${atoms},` : ''}${sg}" Normalized="1" Name="SymmSys" UserID="${n + 1}" XYZ="0,0,0" OverspecificationTolerance="0.05" PeriodicDisplayType="Original">`);
  out.push(`\t\t\t<MappingSet ID="${n + 5}" SymmetryDefinition="${sg}" ActiveSystem="2" NumFamilies="1" OwnsTotalConstraintMapping="1" TotalConstraintMapping="3">`);
  out.push(`\t\t\t\t<MappingFamily ID="${n + 6}" NumImageMappings="0">`);
  out.push(`\t\t\t\t\t<IdentityMapping ID="${mapping}" Element="${IDENTITY}" Constraint="${IDENTITY}" MappedObjects="${atoms}" DefectObjects="${sg},${n + 8}" NumImages="${n}" NumDefects="2">`);
  for (let i = 0; i < n; i++) {
    const p0 = pos[3 * i], p1 = pos[3 * i + 1], p2 = pos[3 * i + 2];
    const frac = [0, 1, 2].map((k) => p0 * inv[0][k] + p1 * inv[1][k] + p2 * inv[2][k]);
    out.push(`\t\t\t\t\t\t<Atom3d ID="${i + 4}" Mapping="${mapping}" Parent="2" Name="${xml(names[i])}" UserID="${i + 1}" DisplayStyle="Ball and Stick" XYZ="${triple(frac, FRAC_DECIMALS, `atom ${i + 1}`)}" Components="${xml(s.symbols[i])}"${isFixed(i) ? ' RestrictedProperties="FractionalXYZ"' : ''}/>`);
  }
  const [a, b, c] = vectors.map((v) => triple(v, CART_DECIMALS, 'the unit cell'));
  out.push(`\t\t\t\t\t\t<SpaceGroup ID="${sg}" Parent="2" Children="${n + 8}" DisplayStyle="Solid" XYZ="0,0,0" Color="0,0,0,0" AVector="${a}" BVector="${b}" CVector="${c}" OrientationBase="C along Z, B in YZ plane" Centering="3D Primitive-Centered" Lattice="3D Triclinic" GroupName="GroupName" Operators="${IDENTITY}" DisplayRange="0,1,0,1,0,1" LineThickness="2" CylinderRadius="0.2" LabelAxes="1" ActiveSystem="2" ITNumber="1" LongName="P 1" Qualifier="Origin-1" SchoenfliesName="C1-1" System="Triclinic" Class="1" Name="P1"/>`);
  out.push(`\t\t\t\t\t\t<ReciprocalLattice3D ID="${n + 8}" Parent="${sg}"/>`,
    '\t\t\t\t\t</IdentityMapping>',
    '\t\t\t\t\t<MappingRepairs NumRepairs="0"/>',
    '\t\t\t\t</MappingFamily>',
    `\t\t\t\t<InfiniteMapping ID="3" Element="${IDENTITY}" MappedObjects="2"/>`,
    '\t\t\t</MappingSet>',
    '\t\t</SymmetrySystem>',
    '\t</AtomisticTreeRoot>',
    '</XSD>');
  return out.join('\n') + '\n';
}

// ------------------------------------------------------------------------------------------------- XML scanner
const NAME_RE = /[^ \t\r\n<>/="']+/y;
const ATTR_RE = /[ \t\r\n]+([^ \t\r\n<>/="']+)[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)')/y;
const TAG_END_RE = /[ \t\r\n]*(\/?)>/y;
const SUBSET_END_RE = /\][ \t\r\n]*>/g;
const ENTITY_RE = /&(#[xX][0-9A-Fa-f]{1,8}|#[0-9]{1,10}|amp|lt|gt|quot|apos);/g;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const TRUNCATED = 'XSD: the file ends in the middle of a tag';

/** `re` (sticky or global) matched at or from `pos`; null when it does not match. */
function matchAt(re, text, pos) {
  re.lastIndex = pos;
  return re.exec(text);
}

/**
 * An attribute value with its character references and the five predefined entities replaced; any other entity
 * reference stays as it is written (entities declared in a DOCTYPE are never expanded).
 */
function decode(value) {
  if (!value.includes('&')) return value;
  return value.replace(ENTITY_RE, (_, ref) => {
    if (ref[0] !== '#') return NAMED[ref];
    const c = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return c === 0 || c > 0x10FFFF || (c >= 0xD800 && c <= 0xDFFF) ? '�' : String.fromCodePoint(c);
  });
}

/**
 * The elements of `text` as a tree under a nameless root: {tag, attrs, children, parent} (attributes only; text
 * content is not kept). Tolerant: comments, processing instructions, CDATA and declarations are skipped, an end tag
 * closes the nearest open element of its name (one without such an element is ignored), elements still open at the
 * end are closed, a repeated attribute keeps its first value. Throws when the text ends inside a tag.
 */
function parseXML(text) {
  const root = { tag: '', attrs: Object.create(null), children: [], parent: null };
  let node = root;
  const isOpen = new Map();   // how many open elements have each name: an end tag for none costs nothing
  let pos = 0;
  for (;;) {
    const lt = text.indexOf('<', pos);
    if (lt < 0) break;
    let skip = null;
    if (text.startsWith('<!--', lt)) skip = ['-->', 4];
    else if (text.startsWith('<![CDATA[', lt)) skip = [']]>', 9];
    else if (text.startsWith('<?', lt)) skip = ['?>', 2];
    if (skip) {
      const end = text.indexOf(skip[0], lt + skip[1]);
      if (end < 0) throw new Error(TRUNCATED);
      pos = end + skip[0].length;
      continue;
    }
    if (text.startsWith('<!', lt)) {   // a declaration; a DOCTYPE may hold an internal subset in [ ... ]
      let end = text.indexOf('>', lt + 2);
      const bracket = text.indexOf('[', lt + 2);
      if (bracket >= 0 && bracket < end) {
        const m = matchAt(SUBSET_END_RE, text, bracket + 1);
        end = m ? m.index + m[0].length - 1 : -1;
      }
      if (end < 0) throw new Error(TRUNCATED);
      pos = end + 1;
      continue;
    }
    if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt + 2);
      if (end < 0) throw new Error(TRUNCATED);
      const name = trim(text.slice(lt + 2, end));
      if ((isOpen.get(name) ?? 0) > 0) {
        while (node.tag !== name) { isOpen.set(node.tag, isOpen.get(node.tag) - 1); node = node.parent; }
        isOpen.set(name, isOpen.get(name) - 1);
        node = node.parent;
      }
      pos = end + 1;
      continue;
    }
    const m = matchAt(NAME_RE, text, lt + 1);
    if (!m) { pos = lt + 1; continue; }   // a stray "<"
    const child = { tag: m[0], attrs: Object.create(null), children: [], parent: node };   // no prototype: any attribute name is a plain key
    node.children.push(child);
    let p2 = lt + 1 + m[0].length;
    for (;;) {
      const a = matchAt(ATTR_RE, text, p2);
      if (!a) break;
      if (!Object.prototype.hasOwnProperty.call(child.attrs, a[1])) child.attrs[a[1]] = decode(a[2] !== undefined ? a[2] : a[3]);
      p2 += a[0].length;
    }
    const close = matchAt(TAG_END_RE, text, p2);
    let empty;
    if (close) {
      empty = close[1] === '/';
      pos = p2 + close[0].length;
    } else {   // something the scanner does not read inside the tag: go on after its ">"
      const end = text.indexOf('>', p2);
      if (end < 0) throw new Error(TRUNCATED);
      empty = text[end - 1] === '/';
      pos = end + 1;
    }
    if (!empty) { node = child; isOpen.set(child.tag, (isOpen.get(child.tag) ?? 0) + 1); }
  }
  return root;
}

/** The elements below `top` in document order. */
function walk(top) {
  const out = [];
  const stack = top.children.slice().reverse();
  while (stack.length) {
    const node = stack.pop();
    out.push(node);
    for (let k = node.children.length - 1; k >= 0; k--) stack.push(node.children[k]);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------ reader
const NUM_RE = /^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
const SPLIT_RE = /[,;: \t\r\n]+/;
const NOT_XSD = 'XSD: this is not a Materials Studio document (no <XSD> element); XML Schema files have the same extension';
const POSITION_PROPS = ['XYZ', 'FractionalXYZ'];
const CENTRINGS = {
  F: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]],
  I: [[0.5, 0.5, 0.5]],
  A: [[0, 0.5, 0.5]],
  B: [[0.5, 0, 0.5]],
  C: [[0.5, 0.5, 0]],
  R: [[2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 2 / 3]],
};
const BASE_RE = /(?:^|[^a-z])([abc])[- ]?cent/;
const RHOMBO_RE = /rhombohedral|(?:^|[^a-z])r[- ]?cent/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The numbers of a list such as "1,0,0.5" (commas, semicolons, colons or blanks between them), or null. */
function numbers(text) {
  if (text == null) return null;
  const out = [];
  for (const tok of text.split(SPLIT_RE)) {
    if (tok === '') continue;
    if (!NUM_RE.test(tok)) return null;
    const value = Number(tok);
    if (!Number.isFinite(value)) return null;   // 1e999
    out.push(value);
  }
  return out;
}

const shown = (text) => (text.length <= 40 ? text : `${text.slice(0, 40)}…`);

function vector(node, key) {
  const v = numbers(node.attrs[key]);
  if (v === null || v.length !== 3) throw new Error(`XSD: ${key}="${shown(node.attrs[key] ?? '')}" of the lattice is not three numbers`);
  return v;
}

/**
 * [symbol, kind] of a Components value: kind '' (one element), 'reduced' (more than one element symbol was given:
 * an isotope, a mixture, a charge) or 'unknown' (no element: X).
 */
function elementOf(text) {
  const t = trim(text);
  if (isElement(t) || t === 'X') return [t, ''];   // X: the dummy atom, as Facet writes it
  for (const tok of t.match(/[A-Z][a-z]?/g) ?? []) {
    if (tok === 'D' || tok === 'T') return ['H', 'reduced'];   // deuterium, tritium
    if (isElement(tok)) return [tok, 'reduced'];
  }
  return ['X', 'unknown'];
}

function wrap01(v) {
  const g = v - Math.floor(v);
  return g >= 1 - 1e-8 || Math.abs(g) < 1e-8 ? 0 : g;
}

/** The operator `op` (twelve numbers: three rows of rotation and translation) applied to `f`, wrapped. */
const apply = (op, f) => [0, 1, 2].map((r) => wrap01(op[4 * r] * f[0] + op[4 * r + 1] * f[1] + op[4 * r + 2] * f[2] + op[4 * r + 3]));
const isIdentity = (op) => op.every((v, k) => Math.abs(v - (k === 0 || k === 5 || k === 10 ? 1 : 0)) < 1e-9);
const identityOp = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** [translations, known] of a Centering value such as "3D Face-Centered". */
function centringOf(text) {
  const t = (text ?? '').toLowerCase();
  if (t === '' || t.includes('primitive')) return [[], true];
  if (t.includes('face')) return [CENTRINGS.F, true];
  if (t.includes('body')) return [CENTRINGS.I, true];
  if (RHOMBO_RE.test(t)) return [CENTRINGS.R, true];
  const m = BASE_RE.exec(t);
  if (m) return [CENTRINGS[m[1].toUpperCase()], true];
  return [[], false];
}

/**
 * Every atom under every operator, then the image atoms, wrapped into the cell; an atom within SYMPREC of an earlier
 * one of the same element is left out. Returns the positions and the listed atom each comes from.
 */
function expand(frac, symbols, ops, images) {
  const nc = Math.floor(1 / SYMPREC);
  const lim = SYMPREC + 1e-7;
  const buckets = new Map();
  const outF = [], outSrc = [];
  const cellOf = (v) => ((Math.floor(v * nc) % nc) + nc) % nc;
  const add = (g, src) => {
    const kx = cellOf(g[0]), ky = cellOf(g[1]), kz = cellOf(g[2]);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = buckets.get(((kx + dx + nc) % nc) + nc * (((ky + dy + nc) % nc) + nc * ((kz + dz + nc) % nc)));
      if (!arr) continue;
      for (const idx of arr) {
        if (symbols[outSrc[idx]] !== symbols[src]) continue;
        const o = outF[idx];
        if ([0, 1, 2].every((k) => Math.abs((o[k] - g[k]) - Math.floor(o[k] - g[k] + 0.5)) < lim)) return;
      }
    }
    const key = kx + nc * (ky + nc * kz);
    let arr = buckets.get(key);
    if (!arr) buckets.set(key, (arr = []));
    arr.push(outF.length);
    outF.push(g);
    outSrc.push(src);
  };
  frac.forEach((f, i) => { for (const op of ops) add(apply(op, f), i); });
  for (const [src, op] of images) add(apply(op, frac[src]), src);
  return [outF, outSrc];
}

const plural = (n) => (n === 1 ? `${n} atom` : `${n} atoms`);

/**
 * Parse a Materials Studio XSD document (see the top of this file for what is read). The structure takes its name
 * from the document, else from `filename`. Throws for text that is not such a document, a document without atoms, a
 * 2D periodic document and coordinates or lattice vectors that are not numbers.
 */
export function readXSD(text, filename = '') {
  const root = parseXML(text);
  const nodes = walk(root);
  if (!nodes.some((nd) => nd.tag === 'XSD')) throw new Error(NOT_XSD);
  const lattice = nodes.find((nd) => has(nd.attrs, 'AVector') && has(nd.attrs, 'BVector')) ?? null;
  if (lattice && !has(lattice.attrs, 'CVector')) {
    throw new Error(`XSD: this is a 2D periodic document (${lattice.tag}); only 3D periodic documents and molecules can be read`);
  }
  let system = null;
  if (lattice) {
    system = lattice.parent;
    while (system && system.tag !== 'SymmetrySystem') system = system.parent;
    if (!system) system = root;
  }
  const scope = system ? walk(system) : nodes;
  const inScope = system && system !== root ? new Set(scope) : null;
  const isAtom = (nd) => nd.tag === 'Atom3d' && !has(nd.attrs, 'ImageOf');
  const atoms = scope.filter(isAtom);
  const outside = inScope ? nodes.filter((nd) => isAtom(nd) && !inScope.has(nd)).length : 0;
  if (!atoms.length) throw new Error('XSD: the document has no atoms (Atom3d)');
  // the objects atoms are restricted by, by ID
  const tags = new Map();
  for (const nd of nodes) if (nd.tag !== 'Atom3d' && nd.tag !== 'Bond' && nd.tag !== 'Property' && has(nd.attrs, 'ID')) tags.set(nd.attrs.ID, nd.tag);

  const coords = [], symbols = [], labels = [], fixedAtoms = [];
  const reduced = [], unknown = [], unread = [];
  let nReduced = 0, nUnknown = 0, nUnread = 0;
  const list = (text0) => (text0 ?? '').split(',').map(trim).filter(Boolean);
  atoms.forEach((nd, k) => {
    const at = nd.attrs;
    let xyz = [0, 0, 0];
    if (has(at, 'XYZ')) {
      xyz = numbers(at.XYZ);
      if (xyz === null || xyz.length !== 3) throw new Error(`XSD: atom ${k + 1}: XYZ="${shown(at.XYZ)}" is not three numbers`);
    }
    coords.push(xyz);
    const comp = has(at, 'Components') ? at.Components : '';
    const [sym, kind] = elementOf(comp);
    if (kind === 'reduced') { nReduced++; if (!reduced.includes(comp)) reduced.push(comp); }
    else if (kind === 'unknown') { nUnknown++; if (!unknown.includes(comp)) unknown.push(comp); }
    symbols.push(sym);
    labels.push(trim(has(at, 'Name') ? at.Name : '') || null);
    // fixed atoms: sure only for a whole-atom restriction (no object named, or CompleteRestriction objects)
    const props = list(at.RestrictedProperties);
    let isFixed = false;
    if (props.length) {
      const other = list(at.RestrictedBy).filter((r) => tags.has(r)).map((r) => tags.get(r)).filter((t) => t !== 'CompleteRestriction');
      let why = '';
      if (!props.some((p) => POSITION_PROPS.includes(p))) why = `RestrictedProperties="${props.join(',')}"`;
      else if (other.length) why = `restricted by ${other[0]}`;
      else isFixed = true;
      if (why) { nUnread++; if (!unread.includes(why)) unread.push(why); }
    }
    fixedAtoms.push(isFixed);
  });

  const info = {};
  const notes = [];
  let name = '';
  let src = atoms.map((_, i) => i);
  let cell = null, positions = coords;
  if (!lattice) {
    const molecule = nodes.find((nd) => nd.tag === 'Molecule');
    if (molecule) name = trim(molecule.attrs.Name ?? '');
  } else {
    cell = [vector(lattice, 'AVector'), vector(lattice, 'BVector'), vector(lattice, 'CVector')];
    if (system && system !== root) {
      name = trim(system.attrs.Name ?? '');
      if (name === 'SymmSys') name = '';   // the placeholder Facet and ASE write
    }
    let frac = coords;
    // symmetry: more than the identity operator means the listed atoms are the asymmetric unit
    const opsText = has(lattice.attrs, 'Operators') ? lattice.attrs.Operators : null;
    const nums = numbers(opsText);
    let ops = null;
    if (opsText === null || trim(opsText) === '') ops = [identityOp()];
    else if (nums !== null && nums.length && nums.length % 12 === 0) ops = Array.from({ length: nums.length / 12 }, (_, k) => nums.slice(12 * k, 12 * k + 12));
    const [centring, known] = centringOf(has(lattice.attrs, 'Centering') ? lattice.attrs.Centering : null);
    const group = trim(lattice.attrs.LongName ?? '') || trim(lattice.attrs.Name ?? '');
    if (ops === null) notes.push('the symmetry operators of the file (Operators) could not be read; the atoms are used as listed');
    else if (ops.length > 1 || !isIdentity(ops[0]) || centring.length || !known) {
      if (!ops.some(isIdentity)) ops = [identityOp(), ...ops];
      const nOps = ops.length;
      const centred = [];
      for (const t of centring) for (const op of ops) centred.push([op[0], op[1], op[2], op[3] + t[0], op[4], op[5], op[6], op[7] + t[1], op[8], op[9], op[10], op[11] + t[2]]);
      ops = [...ops, ...centred];
      const index = new Map();
      atoms.forEach((nd, k) => { if (has(nd.attrs, 'ID')) index.set(nd.attrs.ID, k); });
      const images = [];
      for (const nd of scope) {
        if (nd.tag !== 'Atom3d' || !has(nd.attrs, 'ImageOf') || !index.has(nd.attrs.ImageOf) || !nd.parent) continue;
        const element = numbers(has(nd.parent.attrs, 'Element') ? nd.parent.attrs.Element : null);
        if (element !== null && element.length === 12) images.push([index.get(nd.attrs.ImageOf), element]);
      }
      [frac, src] = expand(frac, symbols, ops, images);
      if (group) info.spacegroup = group;
      notes.push(`symmetry expanded: ${plural(atoms.length)} listed, ${plural(frac.length)} after applying the file's ${nOps} symmetry operator${nOps === 1 ? '' : 's'}${group ? ` (${group})` : ''}; check the result${known ? '' : `: the centring "${shown(lattice.attrs.Centering ?? '')}" is not known and was not applied`}`);
    }
    positions = frac.map((f) => [0, 1, 2].map((k) => f[0] * cell[0][k] + f[1] * cell[1][k] + f[2] * cell[2][k]));
  }
  if (outside) notes.push(`${plural(outside)} outside the periodic system ${outside === 1 ? 'was' : 'were'} not read`);
  if (nReduced) notes.push(`${plural(nReduced)} ${nReduced === 1 ? 'has' : 'have'} a Components value that is not a single element symbol (e.g. "${shown(reduced[0])}"); the first element in it was read (D and T as H)`);
  if (nUnknown) notes.push(`${plural(nUnknown)} ${nUnknown === 1 ? 'has' : 'have'} no element Facet knows (e.g. Components="${shown(unknown[0])}") and ${nUnknown === 1 ? 'is' : 'are'} read as X`);
  if (nUnread) notes.push(`${plural(nUnread)} ${nUnread === 1 ? 'has' : 'have'} constraints Facet does not read (${unread.map(shown).join(', ')}) and ${nUnread === 1 ? 'is' : 'are'} left free`);

  const props = {};
  if (labels.some((lab) => lab !== null)) props.labels = src.map((i) => labels[i] ?? symbols[i]);
  if (fixedAtoms.some(Boolean)) props[MOVE_FLAGS_KEY] = src.map((i) => [!fixedAtoms[i], !fixedAtoms[i], !fixedAtoms[i]]);
  const fix = cell ? fixDegenerateCell(cell, [true, true, true], positions.flat()) : { cell: null, pbc: [false, false, false], warning: null };
  const stem = String(filename ?? '').split(/[\\/]/).pop().replace(/\.gz$/i, '').replace(/\.[^.]*$/, '');
  const s = new Structure({ name: name || stem || 'XSD structure', symbols: src.map((i) => symbols[i]), positions, cell: fix.cell, pbc: fix.pbc, props, info });
  addWarning(s.info, fix.warning);
  for (const note of notes) addWarning(s.info, note);
  return s;
}
