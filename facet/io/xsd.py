"""Materials Studio XSD (3D atomistic documents, ``.xsd``): reader and writer.

The file is XML.  A structure with a cell is a ``SymmetrySystem`` (3D periodic, space group P1, fractional
coordinates); a structure without one is a ``Molecule`` (Cartesian coordinates in Å).  The design, with the file
skeleton and the reasons for each choice, is ``docs/design/xsd-export/README.md``.  The web app has the same reader
and writer in ``facet/web/js/io/xsd.js``: the writer gives the same file byte for byte, the reader the same
structure and the same notes, so the arithmetic below is written out with Python floats in the order the JavaScript
uses (no numpy in the number paths).

**Writer** (:func:`write_xsd`, frame 0):

* the cell is written in Materials Studio's orientation (c along z, b in the yz plane): the structure is turned as a
  whole and the fractional coordinates do not change.  A cell that already has that orientation (every component
  within 1e-8 Å) is written as it is, and so is a left-handed cell (:func:`cell_orientation` tells which);
* fractional coordinates with 12 decimals, cell vectors and Cartesian coordinates with 10, in fixed notation, rounded
  half away from zero on the exact binary value (JavaScript's ``toFixed``), never ``-0.000``; coordinates are not
  wrapped into the cell;
* atom names are ``props["labels"]`` where an atom has one, else the element with a running number per element
  (``Pt1``, ``Pt2``, ``O1``); the atom order is kept;
* an atom with any direction fixed in ``props["selective_dynamics"]`` is written as fixed
  (``RestrictedProperties="FractionalXYZ"``, ``"XYZ"`` in a molecule): the format fixes whole atoms;
* bonds, occupancies, velocities, charges and symmetry are not written; the file is plain ASCII (other characters in
  names become ``&#N;``).

**Reader** (:func:`read_xsd`): files written by Facet, by ASE and by Materials Studio itself.

* a document with a lattice (``AVector``, ``BVector``, ``CVector`` on its ``SpaceGroup``) is periodic and its atoms
  have fractional coordinates; any other document is a molecule with Cartesian coordinates.  Atoms are the ``Atom3d``
  elements wherever they are nested (``Molecule``, ``RepeatUnit``, directly under the root); image atoms
  (``ImageOf``) are copies and are skipped; an atom without ``XYZ`` is at the origin;
* names (``Name``) become ``props["labels"]``; fixed atoms (``RestrictedProperties`` with ``XYZ`` or
  ``FractionalXYZ``) become ``F F F`` rows of ``props["selective_dynamics"]``.  An atom restricted by anything but a
  ``CompleteRestriction`` object, or with other restricted properties only, is left free and a note says so;
* ``Components`` gives the element; anything more than one element symbol (a mixture, an isotope) is reduced to its
  first element, with a note;
* a space group with more than the identity operator: the listed atoms are the asymmetric unit, and they are
  expanded with the operators of the file (``Operators``, twelve numbers each: the rows of the rotation with the
  translation in the fourth place), the centring translations and the image atoms of the file, wrapped into the cell
  and merged within 1e-3 (fractional).  No file of this kind written by Materials Studio was available when this
  was written, so the result carries a note asking to check it.

The XML is read by a small scanner of its own (tags and attributes), the same in both languages: entities other than
the five predefined ones and numeric character references are never expanded, and a DOCTYPE is skipped.
"""

from __future__ import annotations

import math
import re
from decimal import ROUND_HALF_UP, Context, Decimal
from typing import Any

import numpy as np

from ..core.constraints import MOVE_FLAGS_KEY, move_flags
from ..core.elements import is_element
from ..core.structure import Structure, add_warning

__all__ = ["read_xsd", "write_xsd", "cell_orientation", "non_elements"]

#: The label of the format in messages.
LABEL = "Materials Studio XSD"
#: Decimals of fractional coordinates, and of cell vectors and Cartesian coordinates (Å).
FRAC_DECIMALS = 12
CART_DECIMALS = 10
#: A cell whose vectors differ from Materials Studio's orientation by less than this (Å) is written as it is.
ORIENTATION_TOL = 1e-8
#: Fractional tolerance for merging symmetry-equivalent atoms (the CIF reader's).
SYMPREC = 1e-3

# The 40 property definitions every document starts with (DefinedOn, Name, Type), as Materials Studio and ASE write
# them.
_PROPERTIES = """
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
""".split("\n")[1:-1]

_IDENTITY = "1,0,0,0,0,1,0,0,0,0,1,0"
_WS = " \t\r\n"
_TRIM_RE = re.compile(r"^[ \t\r\n]+|[ \t\r\n]+$")


# ------------------------------------------------------------------------------------ cell arithmetic (JS order)
def _rows(cell: Any) -> list[list[float]]:
    return [[float(v) for v in row] for row in np.asarray(cell, dtype=float).reshape(3, 3).tolist()]


def _det3(m: list[list[float]]) -> float:
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
            - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def _inv3(m: list[list[float]], d: float) -> list[list[float]]:
    """The inverse of *m* with determinant *d* (the adjugate formula of ``inv3`` in ``web/js/core/util.js``)."""
    (a, b, c), (d1, e, f), (g, h, i) = m
    return [[(e * i - f * h) / d, (c * h - b * i) / d, (b * f - c * e) / d],
            [(f * g - d1 * i) / d, (a * i - c * g) / d, (c * d1 - a * f) / d],
            [(d1 * h - e * g) / d, (b * g - a * h) / d, (a * e - b * d1) / d]]


def _dot(u: list[float], v: list[float]) -> float:
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]


def _volume(m: list[list[float]]) -> float:
    d = _det3(m)
    if not abs(d) >= 1e-12:   # also a determinant that is not a number
        raise ValueError(f"{LABEL}: the unit cell has no volume")
    return d


def _oriented(m: list[list[float]]) -> tuple[str, list[list[float]]]:
    """``(kind, vectors to write)`` of the cell rows *m*: see :func:`cell_orientation`."""
    if _volume(m) < 0:
        return "left-handed", m
    a, b, c = m
    lc = math.sqrt(_dot(c, c))
    bz = _dot(b, c) / lc
    by = math.sqrt(max(0.0, _dot(b, b) - bz * bz))
    az = _dot(a, c) / lc
    ay = (_dot(a, b) - az * bz) / by
    ax = math.sqrt(max(0.0, _dot(a, a) - ay * ay - az * az))
    std = [[ax, ay, az], [0.0, by, bz], [0.0, 0.0, lc]]
    same = all(abs(std[i][j] - m[i][j]) < ORIENTATION_TOL for i in range(3) for j in range(3))
    return ("same", m) if same else ("rotated", std)


def cell_orientation(cell: Any) -> str:
    """How the writer writes *cell* (3x3, rows are the vectors): ``"same"``, ``"rotated"`` or ``"left-handed"``.

    Materials Studio's orientation is c along z and b in the yz plane.  ``"same"``: the cell has it already (every
    component within 1e-8 Å) and is written as it is.  ``"rotated"``: the cell is turned into it; the structure
    turns as a whole and the fractional coordinates stay.  ``"left-handed"`` (negative volume): no rotation gives
    that orientation, so the cell is written as it is.  A cell without volume raises ``ValueError``.
    """
    return _oriented(_rows(cell))[0]


def non_elements(symbols: Any) -> list[str]:
    """The symbols of *symbols* that are not chemical elements (``X`` included), each once, in order."""
    out: list[str] = []
    for s in symbols:
        if (s == "X" or not is_element(s)) and s not in out:
            out.append(s)
    return out


# ------------------------------------------------------------------------------------------------------ writer
_CTX = Context(prec=80, rounding=ROUND_HALF_UP)
_QUANTA = {d: Decimal(1).scaleb(-d) for d in (FRAC_DECIMALS, CART_DECIMALS)}
_PLAIN_RE = re.compile(r"[ !#-%'-;=?-~]*")


def _fixed(x: float, decimals: int) -> str | None:
    """*x* with *decimals* decimals as JavaScript's ``toFixed`` writes it, without the sign of a zero; ``None``
    for a value it cannot write that way (not finite, or 1e21 and above)."""
    if not math.isfinite(x) or abs(x) >= 1e21:
        return None
    text = format(Decimal(x).quantize(_QUANTA[decimals], context=_CTX), "f")
    if text[0] == "-" and not text.strip("-0."):
        return text[1:]
    return text


def _triple(v: list[float], decimals: int, what: str) -> str:
    parts = [_fixed(x, decimals) for x in v]
    if None in parts:
        raise ValueError(f"{LABEL}: {what} has a value that is not a finite number or is too large")
    return ",".join(parts)  # type: ignore[arg-type]


def _xml(text: str) -> str:
    """*text* as an XML attribute value in plain ASCII."""
    if _PLAIN_RE.fullmatch(text):
        return text
    out: list[str] = []
    for ch in text:
        c = ord(ch)
        if ch == "&":
            out.append("&amp;")
        elif ch == "<":
            out.append("&lt;")
        elif ch == ">":
            out.append("&gt;")
        elif ch == '"':
            out.append("&quot;")
        elif c in (9, 10, 13):
            out.append(f"&#{c};")
        elif c < 32 or 0xD800 <= c <= 0xDFFF or c in (0xFFFE, 0xFFFF):
            out.append("&#65533;")   # not allowed in XML: the replacement character
        elif c < 127:
            out.append(ch)
        else:
            out.append(f"&#{c};")
    return "".join(out)


def _trim(text: str) -> str:
    return _TRIM_RE.sub("", text)


def _names(s: Structure) -> list[str]:
    """The name of every atom: its label, else the element with a running number per element."""
    col = s.props.get("labels")
    labels = list(col) if isinstance(col, (list, tuple, np.ndarray)) and len(col) == len(s) else None
    counts: dict[str, int] = {}
    names: list[str] = []
    for i, sym in enumerate(s.symbols):
        counts[sym] = counts.get(sym, 0) + 1
        lab = labels[i] if labels is not None else None
        text = _trim(lab) if isinstance(lab, str) else ""
        names.append(text or f"{sym}{counts[sym]}")
    return names


def write_xsd(structure: Structure) -> str:
    """Frame 0 of *structure* as a Materials Studio XSD document (see the module docstring for what is written).

    Raises ``ValueError`` for a cell without volume and for coordinates that are not finite numbers.
    """
    s = structure.get_frame(0) if structure.frames else structure
    n = len(s)
    names = _names(s)
    flags = move_flags(s) if MOVE_FLAGS_KEY in s.props else None
    pos = np.asarray(s.positions, dtype=float).reshape(-1, 3).tolist()
    out = ['<?xml version="1.0" encoding="latin1"?>', "<!DOCTYPE XSD []>", '<XSD Version="6.0" WrittenBy="Facet">',
           '\t<AtomisticTreeRoot ID="1" NumProperties="40" NumChildren="1">']
    for row in _PROPERTIES:
        defined_on, name, kind = row.split(" ")
        out.append(f'\t\t<Property DefinedOn="{defined_on}" Name="{name}" Type="{kind}"/>')

    if s.cell is None:
        out.append(f'\t\t<Molecule ID="2" NumChildren="{n}" Name="{_xml(_trim(s.name) or "Untitled")}">')
        for i in range(n):
            fixed = ' RestrictedProperties="XYZ"' if flags is not None and not all(flags[i]) else ""
            out.append(f'\t\t\t<Atom3d ID="{i + 3}" Name="{_xml(names[i])}" UserID="{i + 1}" '
                       f'DisplayStyle="Ball and Stick" XYZ="{_triple(pos[i], CART_DECIMALS, f"atom {i + 1}")}" '
                       f'Components="{_xml(s.symbols[i])}"{fixed}/>')
        out += ["\t\t</Molecule>", "\t</AtomisticTreeRoot>", "</XSD>"]
        return "\n".join(out) + "\n"

    m = _rows(s.cell)
    _, vectors = _oriented(m)
    inv = _inv3(m, _det3(m))
    atoms = ",".join(str(k) for k in range(4, n + 4))
    sg, mapping = n + 4, n + 7
    out.append(f'\t\t<SymmetrySystem ID="2" Mapping="3" Children="{atoms + "," if n else ""}{sg}" Normalized="1" '
               f'Name="SymmSys" UserID="{n + 1}" XYZ="0,0,0" OverspecificationTolerance="0.05" '
               f'PeriodicDisplayType="Original">')
    out.append(f'\t\t\t<MappingSet ID="{n + 5}" SymmetryDefinition="{sg}" ActiveSystem="2" NumFamilies="1" '
               f'OwnsTotalConstraintMapping="1" TotalConstraintMapping="3">')
    out.append(f'\t\t\t\t<MappingFamily ID="{n + 6}" NumImageMappings="0">')
    out.append(f'\t\t\t\t\t<IdentityMapping ID="{mapping}" Element="{_IDENTITY}" Constraint="{_IDENTITY}" '
               f'MappedObjects="{atoms}" DefectObjects="{sg},{n + 8}" NumImages="{n}" NumDefects="2">')
    for i in range(n):
        p = pos[i]
        frac = [p[0] * inv[0][k] + p[1] * inv[1][k] + p[2] * inv[2][k] for k in range(3)]
        fixed = ' RestrictedProperties="FractionalXYZ"' if flags is not None and not all(flags[i]) else ""
        out.append(f'\t\t\t\t\t\t<Atom3d ID="{i + 4}" Mapping="{mapping}" Parent="2" Name="{_xml(names[i])}" '
                   f'UserID="{i + 1}" DisplayStyle="Ball and Stick" '
                   f'XYZ="{_triple(frac, FRAC_DECIMALS, f"atom {i + 1}")}" Components="{_xml(s.symbols[i])}"{fixed}/>')
    a, b, c = (_triple(v, CART_DECIMALS, "the unit cell") for v in vectors)
    out.append(f'\t\t\t\t\t\t<SpaceGroup ID="{sg}" Parent="2" Children="{n + 8}" DisplayStyle="Solid" XYZ="0,0,0" '
               f'Color="0,0,0,0" AVector="{a}" BVector="{b}" CVector="{c}" '
               f'OrientationBase="C along Z, B in YZ plane" Centering="3D Primitive-Centered" Lattice="3D Triclinic" '
               f'GroupName="GroupName" Operators="{_IDENTITY}" DisplayRange="0,1,0,1,0,1" LineThickness="2" '
               f'CylinderRadius="0.2" LabelAxes="1" ActiveSystem="2" ITNumber="1" LongName="P 1" '
               f'Qualifier="Origin-1" SchoenfliesName="C1-1" System="Triclinic" Class="1" Name="P1"/>')
    out += [f'\t\t\t\t\t\t<ReciprocalLattice3D ID="{n + 8}" Parent="{sg}"/>',
            "\t\t\t\t\t</IdentityMapping>",
            '\t\t\t\t\t<MappingRepairs NumRepairs="0"/>',
            "\t\t\t\t</MappingFamily>",
            f'\t\t\t\t<InfiniteMapping ID="3" Element="{_IDENTITY}" MappedObjects="2"/>',
            "\t\t\t</MappingSet>",
            "\t\t</SymmetrySystem>",
            "\t</AtomisticTreeRoot>",
            "</XSD>"]
    return "\n".join(out) + "\n"


# ------------------------------------------------------------------------------------------------- XML scanner
class _Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag: str, parent: "_Node | None") -> None:
        self.tag = tag
        self.attrs: dict[str, str] = {}
        self.children: list[_Node] = []
        self.parent = parent


_NAME_RE = re.compile(r"[^ \t\r\n<>/=\"']+")
_ATTR_RE = re.compile(r"[ \t\r\n]+([^ \t\r\n<>/=\"']+)[ \t\r\n]*=[ \t\r\n]*(?:\"([^\"]*)\"|'([^']*)')")
_TAG_END_RE = re.compile(r"[ \t\r\n]*(/?)>")
_SUBSET_END_RE = re.compile(r"\][ \t\r\n]*>")
_ENTITY_RE = re.compile(r"&(#[xX][0-9A-Fa-f]{1,8}|#[0-9]{1,10}|amp|lt|gt|quot|apos);")
_NAMED = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'"}
_TRUNCATED = "XSD: the file ends in the middle of a tag"


def _entity(m: re.Match[str]) -> str:
    ref = m.group(1)
    if ref[0] != "#":
        return _NAMED[ref]
    c = int(ref[2:], 16) if ref[1] in "xX" else int(ref[1:])
    if c == 0 or c > 0x10FFFF or 0xD800 <= c <= 0xDFFF:
        return "�"
    return chr(c)


def _decode(value: str) -> str:
    """An attribute value with its character references and the five predefined entities replaced; any other
    entity reference stays as it is written (entities declared in a DOCTYPE are never expanded)."""
    return _ENTITY_RE.sub(_entity, value) if "&" in value else value


def _parse_xml(text: str) -> _Node:
    """The elements of *text* as a tree under a nameless root (attributes only; text content is not kept).

    Tolerant: comments, processing instructions, CDATA and declarations are skipped, an end tag closes the nearest
    open element of its name (one without such an element is ignored), elements still open at the end are closed, a
    repeated attribute keeps its first value.  ``ValueError`` when the text ends inside a tag.
    """
    root = _Node("", None)
    node = root
    is_open: dict[str, int] = {}   # how many open elements have each name: an end tag for none costs nothing
    pos = 0
    while True:
        lt = text.find("<", pos)
        if lt < 0:
            break
        skip = None
        if text.startswith("<!--", lt):
            skip = ("-->", 4)
        elif text.startswith("<![CDATA[", lt):
            skip = ("]]>", 9)
        elif text.startswith("<?", lt):
            skip = ("?>", 2)
        if skip is not None:
            end = text.find(skip[0], lt + skip[1])
            if end < 0:
                raise ValueError(_TRUNCATED)
            pos = end + len(skip[0])
            continue
        if text.startswith("<!", lt):   # a declaration; a DOCTYPE may hold an internal subset in [ ... ]
            end = text.find(">", lt + 2)
            bracket = text.find("[", lt + 2)
            if 0 <= bracket < end:
                m = _SUBSET_END_RE.search(text, bracket + 1)
                end = m.end() - 1 if m else -1
            if end < 0:
                raise ValueError(_TRUNCATED)
            pos = end + 1
            continue
        if text.startswith("</", lt):
            end = text.find(">", lt + 2)
            if end < 0:
                raise ValueError(_TRUNCATED)
            name = _trim(text[lt + 2:end])
            if is_open.get(name, 0) > 0:
                while node.tag != name:
                    is_open[node.tag] -= 1
                    node = node.parent  # type: ignore[assignment]
                is_open[name] -= 1
                node = node.parent  # type: ignore[assignment]
            pos = end + 1
            continue
        m = _NAME_RE.match(text, lt + 1)
        if not m:   # a stray "<"
            pos = lt + 1
            continue
        child = _Node(m.group(), node)
        node.children.append(child)
        p2 = m.end()
        while True:
            a = _ATTR_RE.match(text, p2)
            if not a:
                break
            if a.group(1) not in child.attrs:
                child.attrs[a.group(1)] = _decode(a.group(2) if a.group(2) is not None else a.group(3))
            p2 = a.end()
        close = _TAG_END_RE.match(text, p2)
        if close:
            empty = close.group(1) == "/"
            pos = close.end()
        else:   # something the scanner does not read inside the tag: go on after its ">"
            end = text.find(">", p2)
            if end < 0:
                raise ValueError(_TRUNCATED)
            empty = text[end - 1] == "/"
            pos = end + 1
        if not empty:
            node = child
            is_open[child.tag] = is_open.get(child.tag, 0) + 1
    return root


def _walk(top: _Node) -> list[_Node]:
    """The elements below *top* in document order."""
    out: list[_Node] = []
    stack = list(reversed(top.children))
    while stack:
        node = stack.pop()
        out.append(node)
        if node.children:
            stack.extend(reversed(node.children))
    return out


# ------------------------------------------------------------------------------------------------------ reader
_NUM_RE = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
_SPLIT_RE = re.compile(r"[,;: \t\r\n]+")
_SYMBOL_RE = re.compile(r"[A-Z][a-z]?")
_NOT_XSD = ("XSD: this is not a Materials Studio document (no <XSD> element); XML Schema files have the same "
            "extension")
_POSITION_PROPS = ("XYZ", "FractionalXYZ")
_CENTRINGS = {
    "F": [[0.0, 0.5, 0.5], [0.5, 0.0, 0.5], [0.5, 0.5, 0.0]],
    "I": [[0.5, 0.5, 0.5]],
    "A": [[0.0, 0.5, 0.5]],
    "B": [[0.5, 0.0, 0.5]],
    "C": [[0.5, 0.5, 0.0]],
    "R": [[2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 2 / 3]],
}
_BASE_RE = re.compile(r"(?:^|[^a-z])([abc])[- ]?cent")
_RHOMBO_RE = re.compile(r"rhombohedral|(?:^|[^a-z])r[- ]?cent")


def _numbers(text: str | None) -> list[float] | None:
    """The numbers of a list such as ``"1,0,0.5"`` (commas, semicolons, colons or blanks between them), or None."""
    if text is None:
        return None
    out: list[float] = []
    for tok in _SPLIT_RE.split(text):
        if tok == "":
            continue
        if not _NUM_RE.fullmatch(tok):
            return None
        value = float(tok)
        if not math.isfinite(value):   # 1e999
            return None
        out.append(value)
    return out


def _shown(text: str) -> str:
    return text if len(text) <= 40 else text[:40] + "…"


def _vector(node: _Node, key: str) -> list[float]:
    v = _numbers(node.attrs.get(key))
    if v is None or len(v) != 3:
        raise ValueError(f'XSD: {key}="{_shown(node.attrs.get(key, ""))}" of the lattice is not three numbers')
    return v


def _element(text: str) -> tuple[str, str]:
    """``(symbol, kind)`` of a ``Components`` value: kind ``""`` (one element), ``"reduced"`` (more than one
    element symbol was given: an isotope, a mixture, a charge) or ``"unknown"`` (no element: ``X``)."""
    t = _trim(text)
    if is_element(t) or t == "X":   # X: the dummy atom, as Facet writes it
        return t, ""
    for tok in _SYMBOL_RE.findall(t):
        if tok in ("D", "T"):   # deuterium, tritium
            return "H", "reduced"
        if is_element(tok):
            return tok, "reduced"
    return "X", "unknown"


def _wrap01(v: float) -> float:
    g = v - math.floor(v)
    return 0.0 if g >= 1.0 - 1e-8 or abs(g) < 1e-8 else g


def _apply(op: list[float], f: list[float]) -> list[float]:
    """The operator *op* (twelve numbers: three rows of rotation and translation) applied to *f*, wrapped."""
    return [_wrap01(op[4 * r] * f[0] + op[4 * r + 1] * f[1] + op[4 * r + 2] * f[2] + op[4 * r + 3]) for r in range(3)]


def _is_identity(op: list[float]) -> bool:
    return all(abs(v - (1.0 if k in (0, 5, 10) else 0.0)) < 1e-9 for k, v in enumerate(op))


def _centring(text: str | None) -> tuple[list[list[float]], bool]:
    """``(translations, known)`` of a ``Centering`` value such as ``3D Face-Centered``."""
    t = (text or "").lower()
    if t == "" or "primitive" in t:
        return [], True
    if "face" in t:
        return _CENTRINGS["F"], True
    if "body" in t:
        return _CENTRINGS["I"], True
    if _RHOMBO_RE.search(t):
        return _CENTRINGS["R"], True
    m = _BASE_RE.search(t)
    if m:
        return _CENTRINGS[m.group(1).upper()], True
    return [], False


def _expand(frac: list[list[float]], symbols: list[str], ops: list[list[float]],
            images: list[tuple[int, list[float]]]) -> tuple[list[list[float]], list[int]]:
    """Every atom under every operator, then the image atoms, wrapped into the cell; an atom within ``SYMPREC`` of
    an earlier one of the same element is left out.  Returns the positions and the listed atom each comes from."""
    ncell = int(math.floor(1.0 / SYMPREC))
    lim = SYMPREC + 1e-7
    buckets: dict[tuple[int, int, int], list[int]] = {}
    out_f: list[list[float]] = []
    out_src: list[int] = []

    def add(g: list[float], src: int) -> None:
        key = (int(math.floor(g[0] * ncell)) % ncell, int(math.floor(g[1] * ncell)) % ncell,
               int(math.floor(g[2] * ncell)) % ncell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for idx in buckets.get(((key[0] + dx) % ncell, (key[1] + dy) % ncell, (key[2] + dz) % ncell), ()):
                        if symbols[out_src[idx]] != symbols[src]:
                            continue
                        o = out_f[idx]
                        if all(abs((o[k] - g[k]) - math.floor(o[k] - g[k] + 0.5)) < lim for k in range(3)):
                            return
        buckets.setdefault(key, []).append(len(out_f))
        out_f.append(g)
        out_src.append(src)

    for i, f in enumerate(frac):
        for op in ops:
            add(_apply(op, f), i)
    for src, op in images:
        add(_apply(op, frac[src]), src)
    return out_f, out_src


def _plural(n: int) -> str:
    return f"{n} atom" if n == 1 else f"{n} atoms"


def read_xsd(text: str) -> Structure:
    """Parse a Materials Studio XSD document (see the module docstring for what is read).

    Raises ``ValueError`` for text that is not such a document, a document without atoms, a 2D periodic document and
    coordinates or lattice vectors that are not numbers.
    """
    root = _parse_xml(text)
    nodes = _walk(root)
    if not any(nd.tag == "XSD" for nd in nodes):
        raise ValueError(_NOT_XSD)
    lattice = next((nd for nd in nodes if "AVector" in nd.attrs and "BVector" in nd.attrs), None)
    if lattice is not None and "CVector" not in lattice.attrs:
        raise ValueError(f"XSD: this is a 2D periodic document ({lattice.tag}); only 3D periodic documents and "
                         f"molecules can be read")
    system: _Node | None = None
    if lattice is not None:
        system = lattice.parent
        while system is not None and system.tag != "SymmetrySystem":
            system = system.parent
        if system is None:
            system = root
    scope = _walk(system) if system is not None else nodes
    in_scope = {id(nd) for nd in scope} if system is not None and system is not root else None
    atoms = [nd for nd in scope if nd.tag == "Atom3d" and "ImageOf" not in nd.attrs]
    outside = 0
    if in_scope is not None:
        outside = sum(1 for nd in nodes if nd.tag == "Atom3d" and "ImageOf" not in nd.attrs and id(nd) not in in_scope)
    if not atoms:
        raise ValueError("XSD: the document has no atoms (Atom3d)")
    # the objects atoms are restricted by, by ID
    tags = {nd.attrs["ID"]: nd.tag for nd in nodes if nd.tag not in ("Atom3d", "Bond", "Property") and "ID" in nd.attrs}

    coords: list[list[float]] = []
    symbols: list[str] = []
    labels: list[str | None] = []
    fixed: list[bool] = []
    reduced: list[str] = []
    unknown: list[str] = []
    unread: list[str] = []
    n_reduced = n_unknown = n_unread = 0
    for k, nd in enumerate(atoms):
        at = nd.attrs
        if "XYZ" in at:
            xyz = _numbers(at["XYZ"])
            if xyz is None or len(xyz) != 3:
                raise ValueError(f'XSD: atom {k + 1}: XYZ="{_shown(at["XYZ"])}" is not three numbers')
        else:
            xyz = [0.0, 0.0, 0.0]
        coords.append(xyz)
        comp = at.get("Components", "")
        sym, kind = _element(comp)
        if kind == "reduced":
            n_reduced += 1
            if comp not in reduced:
                reduced.append(comp)
        elif kind == "unknown":
            n_unknown += 1
            if comp not in unknown:
                unknown.append(comp)
        symbols.append(sym)
        name = _trim(at.get("Name", ""))
        labels.append(name or None)
        # fixed atoms: sure only for a whole-atom restriction (no object named, or CompleteRestriction objects)
        props = [t for t in (_trim(p) for p in at.get("RestrictedProperties", "").split(",")) if t]
        is_fixed = False
        if props:
            by = [tags[r] for r in (_trim(p) for p in at.get("RestrictedBy", "").split(",")) if r in tags]
            other = [t for t in by if t != "CompleteRestriction"]
            if not any(p in _POSITION_PROPS for p in props):
                why = 'RestrictedProperties="' + ",".join(props) + '"'
            elif other:
                why = "restricted by " + other[0]
            else:
                why = ""
                is_fixed = True
            if why:
                n_unread += 1
                if why not in unread:
                    unread.append(why)
        fixed.append(is_fixed)

    info: dict[str, Any] = {}
    notes: list[str] = []
    name = ""
    src = list(range(len(atoms)))
    if lattice is None:
        cell = None
        positions = coords
        molecule = next((nd for nd in nodes if nd.tag == "Molecule"), None)
        if molecule is not None:
            name = _trim(molecule.attrs.get("Name", ""))
    else:
        cell = [_vector(lattice, "AVector"), _vector(lattice, "BVector"), _vector(lattice, "CVector")]
        if system is not None and system is not root:
            name = _trim(system.attrs.get("Name", ""))
            if name == "SymmSys":   # the placeholder Facet and ASE write
                name = ""
        frac = coords
        # symmetry: more than the identity operator means the listed atoms are the asymmetric unit
        ops_text = lattice.attrs.get("Operators")
        numbers = _numbers(ops_text)
        ops: list[list[float]] | None = None
        if ops_text is None or _trim(ops_text) == "":
            ops = [[1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]]
        elif numbers is not None and numbers and len(numbers) % 12 == 0:
            ops = [numbers[k:k + 12] for k in range(0, len(numbers), 12)]
        centring, known = _centring(lattice.attrs.get("Centering"))
        group = _trim(lattice.attrs.get("LongName", "")) or _trim(lattice.attrs.get("Name", ""))
        if ops is None:
            notes.append("the symmetry operators of the file (Operators) could not be read; the atoms are used as "
                         "listed")
        elif len(ops) > 1 or not _is_identity(ops[0]) or centring or not known:
            if not any(_is_identity(op) for op in ops):
                ops = [[1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]] + ops
            n_ops = len(ops)
            ops = ops + [op[:3] + [op[3] + t[0]] + op[4:7] + [op[7] + t[1]] + op[8:11] + [op[11] + t[2]]
                         for t in centring for op in ops]
            index = {nd.attrs["ID"]: k for k, nd in enumerate(atoms) if "ID" in nd.attrs}
            images: list[tuple[int, list[float]]] = []
            for nd in scope:
                if nd.tag != "Atom3d" or nd.attrs.get("ImageOf") not in index or nd.parent is None:
                    continue
                element = _numbers(nd.parent.attrs.get("Element"))
                if element is not None and len(element) == 12:
                    images.append((index[nd.attrs["ImageOf"]], element))
            frac, src = _expand(frac, symbols, ops, images)
            if group:
                info["spacegroup"] = group
            notes.append(f"symmetry expanded: {_plural(len(atoms))} listed, {_plural(len(frac))} after applying the "
                         f"file's {n_ops} symmetry operator{'' if n_ops == 1 else 's'}"
                         + (f" ({group})" if group else "") + "; check the result"
                         + ("" if known else f': the centring "{_shown(lattice.attrs.get("Centering", ""))}" is not '
                                             f"known and was not applied"))
        positions = [[f[0] * cell[0][k] + f[1] * cell[1][k] + f[2] * cell[2][k] for k in range(3)] for f in frac]
    if outside:
        notes.append(f"{_plural(outside)} outside the periodic system {'was' if outside == 1 else 'were'} not read")
    if n_reduced:
        notes.append(f'{_plural(n_reduced)} {"has" if n_reduced == 1 else "have"} a Components value that is not a '
                     f'single element symbol (e.g. "{_shown(reduced[0])}"); the first element in it was read (D and T '
                     f'as H)')
    if n_unknown:
        notes.append(f'{_plural(n_unknown)} {"has" if n_unknown == 1 else "have"} no element Facet knows '
                     f'(e.g. Components="{_shown(unknown[0])}") and {"is" if n_unknown == 1 else "are"} read as X')
    if n_unread:
        notes.append(f'{_plural(n_unread)} {"has" if n_unread == 1 else "have"} constraints Facet does not read '
                     f'({", ".join(_shown(w) for w in unread)}) and {"is" if n_unread == 1 else "are"} left free')

    props: dict[str, Any] = {}
    if any(lab is not None for lab in labels):
        props["labels"] = [labels[i] if labels[i] is not None else symbols[i] for i in src]
    if any(fixed):
        props[MOVE_FLAGS_KEY] = [[not fixed[i]] * 3 for i in src]
    s = Structure([symbols[i] for i in src], positions, cell=cell, pbc=cell is not None, props=props, info=info,
                  name=name)
    for note in notes:
        add_warning(s.info, note)
    return s
