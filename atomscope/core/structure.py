"""The :class:`Structure` container — AtomScope's in-memory atomistic model.

A :class:`Structure` holds a set of atoms (symbols + Cartesian positions in Å),
an optional periodic cell, per-atom properties, free-form metadata and an
optional trajectory (extra frames).  It serialises to/from the shared JSON
contract ``atomscope.structure/1`` documented in ``docs/SCHEMA.md``::

    {"schema": "atomscope.structure/1", "name": ..., "symbols": [...],
     "positions": [[x, y, z], ...], "cell": [[...], [...], [...]] | null,
     "pbc": [bool, bool, bool], "frames": [{"positions": ..., "cell": ...}],
     "props": {name: [per-atom values]}, "info": {...}}

Frame 0 is the top-level ``positions``/``cell``; ``frames`` holds frames 1..n-1.

Mutating helpers (``wrap``, ``center``, ``translate``, ``append``, ``extend``,
``delete``) work in place and return ``self`` for chaining; ``copy``,
``repeat``, ``select`` and ``get_frame`` return new objects.
"""

from __future__ import annotations

import copy as _copy
from collections import Counter
from typing import Any, Iterable, Iterator, Sequence

import numpy as np

from . import elements as _el
from .lattice import cart_to_frac, cell_to_cellpar, cellpar_to_cell, frac_to_cart

__all__ = ["Structure", "SCHEMA_ID", "jsonable"]

#: Schema identifier for serialised structures.
SCHEMA_ID = "atomscope.structure/1"

_AMU_PER_A3_TO_G_PER_CM3 = 1.66053906660


def jsonable(obj: Any) -> Any:
    """Recursively convert numpy scalars/arrays (and tuples) into JSON-friendly types."""
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return jsonable(obj.tolist())
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    return obj


def _round(arr: np.ndarray, decimals: int = 6) -> list:
    """Round an array and return nested lists (``-0.0`` normalised to ``0.0``)."""
    return (np.round(np.asarray(arr, dtype=float), decimals) + 0.0).tolist()


def _as_cell(cell: Any) -> np.ndarray | None:
    """Coerce various cell specifications into a 3x3 float array (or ``None``).

    Accepts ``None``, a 3x3 matrix, three lengths (orthorhombic) or six cell
    parameters ``(a, b, c, alpha, beta, gamma)``.
    """
    if cell is None:
        return None
    arr = np.asarray(cell, dtype=float)
    if arr.size == 0:
        return None
    if arr.shape == (3, 3):
        return arr.copy()
    if arr.shape == (3,):
        return np.diag(arr)
    if arr.shape == (6,):
        return cellpar_to_cell(*arr)
    raise ValueError(f"cell must be a 3x3 matrix, 3 lengths or 6 cell parameters (got shape {arr.shape})")


def _as_pbc(pbc: Any, has_cell: bool) -> list[bool]:
    if pbc is None:
        return [has_cell] * 3
    if isinstance(pbc, (bool, np.bool_, int)):
        return [bool(pbc)] * 3
    vals = [bool(v) for v in pbc]
    if len(vals) != 3:
        raise ValueError("pbc must be a bool or a sequence of three bools")
    return vals


#: Vacuum (Å) added around the atoms when a missing non-periodic cell axis is filled in.
_FILL_VACUUM = 10.0


def _fix_degenerate_cell(cell: np.ndarray | None, pbc: list[bool],
                         positions: np.ndarray) -> tuple[np.ndarray | None, list[bool], str | None]:
    """Repair a singular cell (zero volume) so geometry code does not fail.

    A zero-length axis that is not periodic (e.g. ``c = 0`` in a 2D slab with
    ``pbc = T,T,F``) is replaced by the unit normal of the other two axes times
    (extent of the atoms along it + 10 Å).  A cell that is still singular is
    dropped (``pbc`` all false).  Returns ``(cell, pbc, warning_or_None)``.
    """
    if cell is None:
        return cell, pbc, None
    lengths = np.linalg.norm(cell, axis=1)
    scale = max(float(lengths.max()), 1.0)
    det = float(np.linalg.det(cell))
    if np.all(np.isfinite(cell)) and lengths.min() > 1e-8 * scale and abs(det) > 1e-9 * float(np.prod(lengths)):
        return cell, pbc, None
    if not np.any(lengths > 1e-8 * scale) or not np.all(np.isfinite(cell)):
        warn = "the unit cell was empty and has been removed" if any(pbc) else None
        return None, [False, False, False], warn
    new = cell.copy()
    zero = [k for k in range(3) if lengths[k] <= 1e-8 * scale]
    fixed = bool(zero) and not any(pbc[k] for k in zero)
    if fixed:
        if len(zero) == 2:  # one lattice vector left: build two perpendicular axes
            keep = next(k for k in range(3) if k not in zero)
            u = new[keep] / lengths[keep]
            p1 = np.eye(3)[(keep + 1) % 3]  # prefer the Cartesian axis the missing vector is named after
            p1 = p1 - (p1 @ u) * u
            if np.linalg.norm(p1) < 1e-6:
                p1 = np.eye(3)[(keep + 2) % 3] - u[(keep + 2) % 3] * u
            p1 /= np.linalg.norm(p1)
            new[(keep + 1) % 3] = p1
            new[(keep + 2) % 3] = np.cross(u, p1)
        for k in zero:
            n = np.cross(new[(k + 1) % 3], new[(k + 2) % 3])  # cyclic order keeps the cell right-handed
            nn = np.linalg.norm(n)
            if nn < 1e-12:
                fixed = False
                break
            n /= nn
            extent = float(np.ptp(positions @ n)) if len(positions) else 0.0
            new[k] = n * (extent + _FILL_VACUUM)
        if fixed and len(zero) == 2:
            for k in zero:  # rescale the helper axes built above to the atoms' extent
                d = new[k] / np.linalg.norm(new[k])
                new[k] = d * ((float(np.ptp(positions @ d)) if len(positions) else 0.0) + _FILL_VACUUM)
    if fixed and abs(float(np.linalg.det(new))) > 1e-9 * float(np.prod(np.linalg.norm(new, axis=1))):
        axes = " and ".join("abc"[k] for k in zero)
        verb = "vectors " + axes + " were" if len(zero) > 1 else "vector " + axes + " was"
        return new, pbc, f"the zero-length cell {verb} replaced by a vacuum gap around the atoms"
    return None, [False, False, False], "the unit cell has zero volume and was removed (structure treated as non-periodic)"


def _as_positions(positions: Any, n: int | None = None) -> np.ndarray:
    if positions is None:
        arr = np.zeros((0, 3))
    else:
        arr = np.asarray(positions, dtype=float)
        if arr.size == 0:
            arr = np.zeros((0, 3))
    if arr.ndim != 2 or arr.shape[1] != 3:
        raise ValueError(f"positions must be an N x 3 array (got shape {arr.shape})")
    if n is not None and arr.shape[0] != n:
        raise ValueError(f"positions must have {n} rows to match symbols (got {arr.shape[0]})")
    if not np.all(np.isfinite(arr)):
        raise ValueError("positions contain NaN or infinite values")
    return arr.copy()


class Structure:
    """A set of atoms with optional periodic cell, properties and trajectory frames.

    Parameters
    ----------
    symbols:
        Element symbols, one per atom (``"X"`` is allowed for dummies).
    positions:
        Cartesian coordinates in Å, shape ``(N, 3)``.
    cell:
        ``None`` (molecule/cluster), a 3x3 matrix whose rows are lattice
        vectors, three box lengths, or six cell parameters.
    pbc:
        Periodicity flags; defaults to all-True if a cell is given, else all-False.
    frames:
        Extra trajectory frames (1..n-1), each ``{"positions": (N,3), "cell": optional}``.
    props:
        Per-atom arrays keyed by name (e.g. ``{"charges": [...]}``).
    info:
        Free-form JSON-serialisable metadata.
    name:
        Human-readable name.
    """

    __slots__ = ("symbols", "positions", "cell", "pbc", "frames", "props", "info", "name")

    def __init__(
        self,
        symbols: Sequence[str] | None = None,
        positions: Any = None,
        cell: Any = None,
        pbc: Any = None,
        frames: Iterable[dict[str, Any]] | None = None,
        props: dict[str, Any] | None = None,
        info: dict[str, Any] | None = None,
        name: str = "",
    ) -> None:
        self.symbols: list[str] = [str(s).strip() for s in (symbols or [])]
        self.positions: np.ndarray = _as_positions(positions, len(self.symbols))
        self.cell: np.ndarray | None = _as_cell(cell)
        self.pbc: list[bool] = _as_pbc(pbc, self.cell is not None)
        self.cell, self.pbc, cell_warning = _fix_degenerate_cell(self.cell, self.pbc, self.positions)
        self.frames: list[dict[str, Any]] = []
        for fr in frames or []:
            self.frames.append(self._make_frame(fr))
        self.props: dict[str, Any] = {}
        for key, val in (props or {}).items():
            self.set_prop(key, val)
        self.info: dict[str, Any] = dict(info or {})
        self.name: str = str(name or "")
        if cell_warning:
            warnings = self.info.get("warnings")
            warnings = list(warnings) if isinstance(warnings, list) else []
            if cell_warning not in warnings:
                warnings.append(cell_warning)
            self.info["warnings"] = warnings

    # ------------------------------------------------------------------ basics
    def _make_frame(self, frame: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(frame, dict) or "positions" not in frame:
            raise ValueError("each frame must be an object with a 'positions' array")
        pos = _as_positions(frame["positions"], len(self.symbols))
        out: dict[str, Any] = {"positions": pos}
        if frame.get("cell") is not None:
            out["cell"] = _as_cell(frame["cell"])
        return out

    def set_prop(self, key: str, values: Any) -> None:
        """Set a per-atom property (length must equal the number of atoms)."""
        vals = values.tolist() if isinstance(values, np.ndarray) else list(values)
        if len(vals) != len(self.symbols):
            raise ValueError(f"property '{key}' has {len(vals)} values but there are {len(self.symbols)} atoms")
        self.props[str(key)] = vals

    def __len__(self) -> int:
        return len(self.symbols)

    def __repr__(self) -> str:
        pbc = "".join("T" if p else "F" for p in self.pbc)
        extra = f", frames={self.n_frames}" if self.frames else ""
        nm = f"name={self.name!r}, " if self.name else ""
        return f"Structure({nm}formula={self.formula!r}, natoms={len(self)}, pbc={pbc}{extra})"

    def copy(self) -> "Structure":
        """Return a deep copy."""
        new = Structure.__new__(Structure)
        new.symbols = list(self.symbols)
        new.positions = self.positions.copy()
        new.cell = None if self.cell is None else self.cell.copy()
        new.pbc = list(self.pbc)
        new.frames = [
            {k: (v.copy() if isinstance(v, np.ndarray) else v) for k, v in fr.items()} for fr in self.frames
        ]
        new.props = _copy.deepcopy(self.props)
        new.info = _copy.deepcopy(self.info)
        new.name = self.name
        return new

    # ------------------------------------------------------------- serialise
    def to_dict(self, decimals: int = 6) -> dict[str, Any]:
        """Serialise to the ``atomscope.structure/1`` JSON shape (floats rounded)."""
        frames = []
        for fr in self.frames:
            d: dict[str, Any] = {"positions": _round(fr["positions"], decimals)}
            if fr.get("cell") is not None:
                d["cell"] = _round(fr["cell"], decimals)
            frames.append(d)
        props: dict[str, Any] = {}
        for key, vals in self.props.items():
            arr = None
            try:
                arr = np.asarray(vals)
            except Exception:  # ragged / mixed
                arr = None
            if arr is not None and arr.dtype.kind == "f":
                props[key] = _round(arr, decimals)
            else:
                props[key] = jsonable(vals)
        return {
            "schema": SCHEMA_ID,
            "name": self.name,
            "symbols": list(self.symbols),
            "positions": _round(self.positions, decimals),
            "cell": None if self.cell is None else _round(self.cell, decimals),
            "pbc": [bool(p) for p in self.pbc],
            "frames": frames,
            "props": props,
            "info": jsonable(self.info),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Structure":
        """Create a structure from the ``atomscope.structure/1`` JSON shape.

        Missing optional keys are tolerated; malformed input raises ``ValueError``.
        """
        if isinstance(data, Structure):
            return data.copy()
        if not isinstance(data, dict):
            raise ValueError("structure must be a JSON object")
        schema = data.get("schema")
        if schema is not None and not str(schema).startswith("atomscope.structure/"):
            raise ValueError(f"unsupported structure schema {schema!r}")
        symbols = data.get("symbols")
        if symbols is None or not isinstance(symbols, (list, tuple)):
            raise ValueError("structure.symbols must be a list of element symbols")
        try:
            return cls(
                symbols=symbols,
                positions=data.get("positions") or [],
                cell=data.get("cell"),
                pbc=data.get("pbc"),
                frames=data.get("frames") or [],
                props=data.get("props") or {},
                info=data.get("info") or {},
                name=data.get("name") or "",
            )
        except (TypeError, ValueError) as exc:
            raise ValueError(f"invalid structure: {exc}") from exc

    @classmethod
    def from_frames(cls, frames: Sequence["Structure"], name: str | None = None) -> "Structure":
        """Combine single-frame structures (same atom count) into one trajectory."""
        if not frames:
            raise ValueError("no frames given")
        first = frames[0].copy()
        first.frames = []
        n = len(first)
        for fr in frames[1:]:
            if len(fr) != n:
                raise ValueError("all frames must have the same number of atoms")
            entry: dict[str, Any] = {"positions": fr.positions.copy()}
            if fr.cell is not None and (first.cell is None or not np.allclose(fr.cell, first.cell)):
                entry["cell"] = fr.cell.copy()
            first.frames.append(entry)
        if name is not None:
            first.name = name
        return first

    # ---------------------------------------------------------------- frames
    @property
    def n_frames(self) -> int:
        """Number of frames (1 + extra trajectory frames)."""
        return 1 + len(self.frames)

    def get_frame(self, index: int) -> "Structure":
        """Return frame *index* (negative indices allowed) as a single-frame structure."""
        n = self.n_frames
        if index < 0:
            index += n
        if not 0 <= index < n:
            raise IndexError(f"frame index {index} out of range (structure has {n} frames)")
        new = self.copy()
        new.frames = []
        if index > 0:
            fr = self.frames[index - 1]
            new.positions = fr["positions"].copy()
            if fr.get("cell") is not None:
                new.cell = fr["cell"].copy()
        return new

    def iter_frames(self) -> Iterator["Structure"]:
        """Iterate over all frames as single-frame structures."""
        for k in range(self.n_frames):
            yield self.get_frame(k)

    def _all_position_sets(self) -> list[tuple[np.ndarray, np.ndarray | None, dict[str, Any] | None]]:
        """(positions, cell, frame-dict-or-None) for every frame; used by in-place ops."""
        out: list[tuple[np.ndarray, np.ndarray | None, dict[str, Any] | None]] = [(self.positions, self.cell, None)]
        for fr in self.frames:
            out.append((fr["positions"], fr.get("cell", self.cell), fr))
        return out

    # ------------------------------------------------------------ chemistry
    @property
    def numbers(self) -> np.ndarray:
        """Atomic numbers (0 for unknown species)."""
        return np.array([_el.atomic_number(s) for s in self.symbols], dtype=int)

    @property
    def masses(self) -> np.ndarray:
        """Atomic masses in amu."""
        return np.array([_el.atomic_mass(s) for s in self.symbols], dtype=float)

    @property
    def composition(self) -> dict[str, int]:
        """Element counts, ordered as in :attr:`formula`."""
        counts = Counter(self.symbols)
        return {s: counts[s] for s in self._formula_order(counts)}

    @staticmethod
    def _formula_order(counts: dict[str, int], mode: str = "auto") -> list[str]:
        syms = list(counts)
        if mode == "alphabetical":
            return sorted(syms)
        if mode == "hill" or (mode == "auto" and "C" in counts):
            if "C" in counts:
                head = ["C"] + (["H"] if "H" in counts else [])
                return head + sorted(s for s in syms if s not in head)
            return sorted(syms)

        def key(s: str) -> tuple[float, str]:
            en = _el.electronegativity(s)
            return (en if en is not None else 5.0, s)

        return sorted(syms, key=key)

    def get_formula(self, mode: str = "auto", reduce: bool = False) -> str:
        """Chemical formula.

        ``mode``:
          * ``"auto"`` (default) — Hill order (C, H, then alphabetical) for
            carbon-containing systems, otherwise elements ordered by increasing
            Pauling electronegativity (cations first): ``C60``, ``C8H10N4O2``,
            ``SrTiO3``, ``NaCl``, ``Cu108``.
          * ``"hill"`` — strict Hill system (alphabetical when carbon is absent).
          * ``"electronegativity"`` / ``"alphabetical"`` — as named.

        With ``reduce=True`` counts are divided by their greatest common divisor.
        """
        counts = Counter(self.symbols)
        if not counts:
            return ""
        order = self._formula_order(counts, mode)
        nums = [counts[s] for s in order]
        if reduce:
            g = int(np.gcd.reduce(nums))
            nums = [n // g for n in nums]
        return "".join(f"{s}{n if n != 1 else ''}" for s, n in zip(order, nums))

    @property
    def formula(self) -> str:
        """Chemical formula (see :meth:`get_formula`, ``mode="auto"``)."""
        return self.get_formula()

    # ------------------------------------------------------------- geometry
    def _require_cell(self, what: str) -> np.ndarray:
        if self.cell is None:
            raise ValueError(f"{what} requires a unit cell")
        return self.cell

    @property
    def frac_positions(self) -> np.ndarray:
        """Fractional (scaled) coordinates; requires a cell."""
        return cart_to_frac(self.positions, self._require_cell("fractional coordinates"))

    def set_frac_positions(self, frac: Any) -> "Structure":
        """Set positions from fractional coordinates (requires a cell)."""
        self.positions = frac_to_cart(_as_positions(frac, len(self)), self._require_cell("fractional coordinates"))
        return self

    @property
    def volume(self) -> float | None:
        """Cell volume in Å^3, or ``None`` without a cell."""
        return None if self.cell is None else float(abs(np.linalg.det(self.cell)))

    @property
    def density(self) -> float | None:
        """Mass density in g/cm^3, or ``None`` without a (non-degenerate) cell."""
        vol = self.volume
        if not vol:
            return None
        return float(self.masses.sum() * _AMU_PER_A3_TO_G_PER_CM3 / vol)

    @property
    def cellpar(self) -> tuple[float, float, float, float, float, float] | None:
        """``(a, b, c, alpha, beta, gamma)`` or ``None`` without a cell."""
        return None if self.cell is None else cell_to_cellpar(self.cell)

    @property
    def bounding_box(self) -> tuple[np.ndarray, np.ndarray]:
        """``(min_xyz, max_xyz)`` of the atomic positions (zeros when empty)."""
        if len(self) == 0:
            return np.zeros(3), np.zeros(3)
        return self.positions.min(axis=0), self.positions.max(axis=0)

    def _vector(self, i: int, j: int, mic: bool) -> np.ndarray:
        from ..analysis.geometry import minimum_image_vectors

        d = self.positions[j] - self.positions[i]
        if mic and self.cell is not None and any(self.pbc):
            d = minimum_image_vectors(d[None, :], self.cell, self.pbc)[0]
        return d

    def get_distance(self, i: int, j: int, mic: bool = False, vector: bool = False) -> float | np.ndarray:
        """Distance between atoms *i* and *j* (minimum-image if ``mic``)."""
        d = self._vector(i, j, mic)
        return d if vector else float(np.linalg.norm(d))

    def get_angle(self, i: int, j: int, k: int, mic: bool = False) -> float:
        """Angle i-j-k in degrees (vertex at *j*)."""
        from ..analysis.geometry import angle_between

        return angle_between(self._vector(j, i, mic), self._vector(j, k, mic))

    def get_dihedral(self, i: int, j: int, k: int, l: int, mic: bool = False) -> float:
        """Dihedral angle i-j-k-l in degrees, in the range [0, 360)."""
        from ..analysis.geometry import dihedral_from_vectors

        return dihedral_from_vectors(self._vector(i, j, mic), self._vector(j, k, mic), self._vector(k, l, mic))

    # ----------------------------------------------------------- transforms
    def translate(self, vector: Sequence[float]) -> "Structure":
        """Shift all atoms (all frames) by *vector* (Å). In place."""
        v = np.asarray(vector, dtype=float).reshape(3)
        self.positions += v
        for fr in self.frames:
            fr["positions"] += v
        return self

    def wrap(self) -> "Structure":
        """Wrap atoms into the cell along periodic directions (all frames). In place."""
        if self.cell is None or not any(self.pbc):
            return self
        mask = np.array(self.pbc, dtype=bool)
        for pos, cell, fr in self._all_position_sets():
            if cell is None or len(pos) == 0:
                continue
            frac = cart_to_frac(pos, cell)
            frac[:, mask] -= np.floor(frac[:, mask] + 1e-12)
            frac[:, mask] = np.where(frac[:, mask] >= 1.0 - 1e-12, 0.0, frac[:, mask])
            new = frac_to_cart(frac, cell)
            if fr is None:
                self.positions = new
            else:
                fr["positions"] = new
        return self

    def center(self, vacuum: float | None = None, axis: Sequence[int] = (0, 1, 2)) -> "Structure":
        """Center the atoms; optionally (re)size the cell to leave *vacuum* Å on each side.

        * With a cell: atoms are moved so the bounding box is centered in the cell
          along the given axes.  If *vacuum* is given, each selected cell vector is
          rescaled so its perpendicular height = extent + 2*vacuum.
        * Without a cell and *vacuum* given: an orthorhombic box enclosing the atoms
          plus *vacuum* on every side is created (pbc unchanged).
        * Without a cell and no vacuum: the bounding-box center is moved to the origin.
        """
        axes = [int(a) for a in axis]
        if len(self) == 0:
            return self
        if self.cell is None:
            lo, hi = self.bounding_box
            if vacuum is None:
                self.translate(-(lo + hi) / 2.0)
                return self
            extent = hi - lo
            lengths = np.where(extent + 2 * vacuum > 0, extent + 2 * vacuum, 1.0)
            self.cell = np.diag(lengths)
            self.translate(-lo + vacuum)
            return self
        cell = self.cell.copy()
        if vacuum is not None:
            rec = np.linalg.inv(cell).T
            for ax in axes:
                normal = rec[ax] / np.linalg.norm(rec[ax])
                proj = self.positions @ normal
                height = 1.0 / np.linalg.norm(rec[ax])
                target = float(proj.max() - proj.min()) + 2.0 * vacuum
                if target > 0:
                    cell[ax] *= target / height
            self.cell = cell
        frac = cart_to_frac(self.positions, cell)
        shift = np.zeros(3)
        for ax in axes:
            lo, hi = frac[:, ax].min(), frac[:, ax].max()
            shift[ax] = 0.5 - (lo + hi) / 2.0
        self.translate(shift @ cell)
        return self

    def repeat(self, nx: int | Sequence[int] = 1, ny: int = 1, nz: int = 1) -> "Structure":
        """Return a supercell repeated ``nx x ny x nz`` times (requires a cell).

        ``repeat((2, 2, 2))`` and ``repeat(2, 2, 2)`` are equivalent.
        """
        if not isinstance(nx, (int, np.integer)):
            nx, ny, nz = (int(v) for v in nx)  # type: ignore[union-attr]
        reps = np.array([int(nx), int(ny), int(nz)])
        if np.any(reps < 1):
            raise ValueError("repeat counts must be >= 1")
        cell = self._require_cell("repeat")
        grid = np.array([[i, j, k] for i in range(reps[0]) for j in range(reps[1]) for k in range(reps[2])], dtype=float)
        n_img = len(grid)

        def tile(pos: np.ndarray, c: np.ndarray) -> np.ndarray:
            offsets = grid @ c
            return (pos[None, :, :] + offsets[:, None, :]).reshape(-1, 3)

        new = self.copy()
        new.symbols = self.symbols * n_img
        new.positions = tile(self.positions, cell)
        new.cell = cell * reps[:, None]
        new.frames = []
        for fr in self.frames:
            fc = fr.get("cell", cell)
            entry: dict[str, Any] = {"positions": tile(fr["positions"], fc)}
            if "cell" in fr:
                entry["cell"] = fc * reps[:, None]
            new.frames.append(entry)
        new.props = {k: list(v) * n_img for k, v in self.props.items()}
        if self.name:
            new.name = f"{self.name} {reps[0]}x{reps[1]}x{reps[2]}"
        new.info["supercell"] = [int(r) for r in reps]
        return new

    # -------------------------------------------------------------- editing
    def append(self, symbol: str, position: Sequence[float], **props: Any) -> "Structure":
        """Append one atom (same position in every frame). In place.

        Existing per-atom properties are extended with the given keyword values
        (``None`` when not provided).
        """
        pos = np.asarray(position, dtype=float).reshape(1, 3)
        self.symbols.append(str(symbol))
        self.positions = np.vstack([self.positions, pos])
        for fr in self.frames:
            fr["positions"] = np.vstack([fr["positions"], pos])
        for key in list(self.props):
            self.props[key].append(props.get(key))
        for key, val in props.items():
            if key not in self.props:
                self.props[key] = [None] * (len(self) - 1) + [val]
        return self

    def extend(self, other: "Structure") -> "Structure":
        """Append all atoms of *other*. In place.

        Frames are concatenated when both structures have the same frame count,
        otherwise the extra frames of ``self`` are dropped.
        """
        n_self, n_other = len(self), len(other)
        self.symbols = self.symbols + list(other.symbols)
        self.positions = np.vstack([self.positions, other.positions])
        if self.frames and len(self.frames) == len(other.frames):
            for fr, ofr in zip(self.frames, other.frames):
                fr["positions"] = np.vstack([fr["positions"], ofr["positions"]])
        elif self.frames:
            self.frames = []
            self.info.setdefault("warnings", []).append("frames dropped by extend(): frame counts differ")
        keys = list(dict.fromkeys(list(self.props) + list(other.props)))
        merged: dict[str, Any] = {}
        for key in keys:
            a = self.props.get(key, [None] * n_self)
            b = other.props.get(key, [None] * n_other)
            merged[key] = list(a) + list(b)
        self.props = merged
        return self

    def delete(self, indices: int | Iterable[int]) -> "Structure":
        """Delete atoms by index (negative indices allowed). In place."""
        if isinstance(indices, (int, np.integer)):
            indices = [int(indices)]
        n = len(self)
        drop = {int(i) % n if n else 0 for i in indices}
        keep = np.array([i for i in range(n) if i not in drop], dtype=int)
        self._take(keep)
        return self

    def _take(self, keep: np.ndarray) -> None:
        self.symbols = [self.symbols[i] for i in keep]
        self.positions = self.positions[keep].reshape(-1, 3)
        for fr in self.frames:
            fr["positions"] = fr["positions"][keep].reshape(-1, 3)
        self.props = {k: [v[i] for i in keep] for k, v in self.props.items()}

    def select(
        self,
        elements: str | Iterable[str] | None = None,
        indices: Iterable[int] | None = None,
        mask: Sequence[bool] | None = None,
    ) -> "Structure":
        """Return a new structure with the selected atoms (criteria are AND-ed).

        ``elements`` may be a symbol or a list of symbols; ``indices`` a list of
        atom indices; ``mask`` a boolean list of length N.
        """
        sel = np.ones(len(self), dtype=bool)
        if elements is not None:
            wanted = {elements} if isinstance(elements, str) else set(elements)
            sel &= np.array([s in wanted for s in self.symbols], dtype=bool)
        if indices is not None:
            idx_mask = np.zeros(len(self), dtype=bool)
            idx = np.asarray(list(indices), dtype=int)
            if idx.size:
                idx_mask[idx] = True
            sel &= idx_mask
        if mask is not None:
            sel &= np.asarray(mask, dtype=bool)
        new = self.copy()
        new._take(np.nonzero(sel)[0])
        return new
