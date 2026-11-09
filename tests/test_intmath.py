"""Exact integer lattice arithmetic (``crystallume.core.intmath``, M1 §3.2) and the skeleton of
``crystallume.core.cellops`` (``CellOpResult`` and the two hooks of plan.md P-05).

``tests/js/intmath.test.mjs`` runs the same checks on the JavaScript twins ``web/js/core/intmath.js`` and
``web/js/core/cellops.js``.  Both files hold the same JSON constant ``PARITY_CASES`` (between the BEGIN and END
PARITY_CASES lines): inputs with the exact results, or the error message, that both languages must give, so that each
language asserts the same results.  ``test_parity_cases_are_one_constant`` checks that the two copies agree, and
``test_js_matches_python`` runs the twin through the Node bridge on the cases and on random inputs and compares the
two languages item by item.  The expected values were checked independently when the cases were written (lattice
points by brute force over the bounding box of the new cell, Hermite forms by the lattice they span, egcd by
Bezout's identity) and agree with the M1 prototype on the seven matrices of M1 §3.2.
"""

from __future__ import annotations

import dataclasses
import inspect
import itertools
import json
import math
import random
import re
from fractions import Fraction
from pathlib import Path

import numpy as np
import pytest

from crystallume.core import cellops, intmath
from crystallume.core.cellops import CellOpResult, begin_cell_op, finish_cell_op
from crystallume.core.defaults import SURFACE_DEFAULTS
from crystallume.core.intmath import (
    as_int_matrix,
    egcd,
    hermite_normal_form,
    hermite_normal_form_2d,
    hnf_matrices_2d,
    int_adjugate3,
    int_det3,
    is_unimodular,
    supercell_lattice_points,
)
from crystallume.core.structure import CARTESIAN_VECTOR_PROPS, EDIT_KINDS, Structure, mark_edited

ROOT = Path(__file__).resolve().parents[1]
JS_TESTS = Path(__file__).resolve().parent / "js" / "intmath.test.mjs"
SOURCES = {
    "intmath.py": ROOT / "crystallume" / "core" / "intmath.py",
    "intmath.js": ROOT / "crystallume" / "web" / "js" / "core" / "intmath.js",
    "cellops.py": ROOT / "crystallume" / "core" / "cellops.py",
    "cellops.js": ROOT / "crystallume" / "web" / "js" / "core" / "cellops.js",
}
#: The seven matrices of M1 §3.2 (the v1 prototype's set): a diagonal, √3, c(2×2)-like, the det-16 Materials
#: Studio BN core-hole cell, a shear whose bounding box holds 38 cells, det 7 and a general det-81 matrix.
SEVEN = [
    [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
    [[2, 1, 0], [-1, 1, 0], [0, 0, 1]],
    [[1, 1, 0], [-1, 1, 0], [0, 0, 2]],
    [[-3, 1, 1], [-1, -1, 3], [1, 1, 1]],
    [[1, 0, 0], [0, 1, 0], [37, 0, 1]],
    [[3, 1, 0], [-1, 2, 0], [0, 0, 1]],
    [[5, 2, 1], [-1, 3, 2], [2, -1, 4]],
]

# BEGIN PARITY_CASES (JSON: the same constant as in tests/js/intmath.test.mjs)
PARITY_CASES = {
    "egcd": [
        {"a": 240, "b": 46, "gxy": [2, -9, 47]},
        {"a": 46, "b": 240, "gxy": [2, 47, -9]},
        {"a": -240, "b": 46, "gxy": [2, 9, 47]},
        {"a": 240, "b": -46, "gxy": [2, -9, -47]},
        {"a": -240, "b": -46, "gxy": [2, 9, -47]},
        {"a": 0, "b": 0, "gxy": [0, 1, 0]},
        {"a": 0, "b": 5, "gxy": [5, 0, 1]},
        {"a": 5, "b": 0, "gxy": [5, 1, 0]},
        {"a": 0, "b": -5, "gxy": [5, 0, -1]},
        {"a": -5, "b": 0, "gxy": [5, -1, 0]},
        {"a": 1, "b": 1, "gxy": [1, 0, 1]},
        {"a": -1, "b": 1, "gxy": [1, 0, 1]},
        {"a": 7, "b": 1, "gxy": [1, 0, 1]},
        {"a": 1, "b": 7, "gxy": [1, 1, 0]},
        {"a": 12, "b": 18, "gxy": [6, -1, 1]},
        {"a": 18, "b": 12, "gxy": [6, 1, -1]},
        {"a": -4, "b": 6, "gxy": [2, 1, 1]},
        {"a": 17, "b": 5, "gxy": [1, -2, 7]},
        {"a": 3, "b": 7, "gxy": [1, -2, 1]},
        {"a": 6, "b": 6, "gxy": [6, 0, 1]},
        {"a": -6, "b": -6, "gxy": [6, 0, -1]},
        {"a": 1000, "b": 1, "gxy": [1, 0, 1]},
        {"a": 2147483647, "b": 1000000007, "gxy": [1, 216959798, -465917615]},
        {"a": 123456789, "b": 987654321, "gxy": [9, -8, 1]},
        {"a": 9007199254740991, "b": 2, "gxy": [1, 1, -4503599627370495]},
        {"a": -9007199254740991, "b": 1000000, "gxy": [1, -250111, -2252799612802524]}
    ],
    "det3": [
        {"m": [[2, 0, 0], [0, 2, 0], [0, 0, 2]], "det": 8, "adjugate": [[4, 0, 0], [0, 4, 0], [0, 0, 4]]},
        {"m": [[2, 1, 0], [-1, 1, 0], [0, 0, 1]], "det": 3, "adjugate": [[1, -1, 0], [1, 2, 0], [0, 0, 3]]},
        {"m": [[1, 1, 0], [-1, 1, 0], [0, 0, 2]], "det": 4, "adjugate": [[2, -2, 0], [2, 2, 0], [0, 0, 2]]},
        {"m": [[-3, 1, 1], [-1, -1, 3], [1, 1, 1]], "det": 16, "adjugate": [[-4, 0, 4], [4, -4, 8], [0, 4, 4]]},
        {"m": [[1, 0, 0], [0, 1, 0], [37, 0, 1]], "det": 1, "adjugate": [[1, 0, 0], [0, 1, 0], [-37, 0, 1]]},
        {"m": [[3, 1, 0], [-1, 2, 0], [0, 0, 1]], "det": 7, "adjugate": [[2, -1, 0], [1, 3, 0], [0, 0, 7]]},
        {"m": [[5, 2, 1], [-1, 3, 2], [2, -1, 4]], "det": 81, "adjugate": [[14, -9, 1], [8, 18, -11], [-5, 9, 17]]},
        {"m": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "det": 1, "adjugate": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]},
        {"m": [[1, 2, 3], [4, 5, 6], [7, 8, 9]], "det": 0, "adjugate": [[-3, 6, -3], [6, -12, 6], [-3, 6, -3]]},
        {"m": [[0, 1, 0], [1, 0, 0], [0, 0, 1]], "det": -1, "adjugate": [[0, -1, 0], [-1, 0, 0], [0, 0, -1]]},
        {"m": [[-1, 0, 0], [0, -1, 0], [0, 0, -1]], "det": -1, "adjugate": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]},
        {
            "m": [[1000, 999, -1000], [-998, 1000, 997], [1000, -1000, 1000]],
            "det": 3992005000,
            "adjugate": [[1997000, 1000, 1996003], [1995000, 2000000, 1000], [-2000, 1999000, 1997002]]
        }
    ],
    "as_int_matrix": [
        {"m": [2, 2, 1], "matrix": [[2, 0, 0], [0, 2, 0], [0, 0, 1]]},
        {"m": [3, 1, 2], "what": "supercell matrix", "matrix": [[3, 0, 0], [0, 1, 0], [0, 0, 2]]},
        {"m": [-1, 1, 1], "matrix": [[-1, 0, 0], [0, 1, 0], [0, 0, 1]]},
        {"m": [[2, 1], [-1, 1]], "matrix": [[2, 1, 0], [-1, 1, 0], [0, 0, 1]]},
        {"m": [[2, 1], [-1, 1]], "plane": [1, 2], "matrix": [[1, 0, 0], [0, 2, 1], [0, -1, 1]]},
        {"m": [[2, 1], [-1, 1]], "plane": [0, 2], "matrix": [[2, 0, 1], [0, 1, 0], [-1, 0, 1]]},
        {"m": [[2, 1], [-1, 1]], "plane": [2, 0], "matrix": [[1, 0, -1], [0, 1, 0], [1, 0, 2]]},
        {"m": [[2, 1], [-1, 1]], "plane": [1, 0], "matrix": [[1, -1, 0], [1, 2, 0], [0, 0, 1]]},
        {"m": [[1, 0, 0], [0, 1, 0], [37, 0, 1]], "matrix": [[1, 0, 0], [0, 1, 0], [37, 0, 1]]},
        {
            "m": [[2.000000001, 0.9999999999, 0], [-1, 1, 0], [0, 0, 1.0]],
            "what": "supercell matrix",
            "matrix": [[2, 1, 0], [-1, 1, 0], [0, 0, 1]]
        },
        {"m": [[1, 2, 3], [4, 5, 6], [7, 8, 1e-09]], "matrix": [[1, 2, 3], [4, 5, 6], [7, 8, 0]]},
        {"m": [-1e-09, 1, 1], "matrix": [[0, 0, 0], [0, 1, 0], [0, 0, 1]]},
        {"m": [-1000, 1000, 1], "matrix": [[-1000, 0, 0], [0, 1000, 0], [0, 0, 1]]},
        {
            "m": [1001, 1, 1],
            "what": "supercell matrix",
            "error": "supercell matrix entries must be between -1000 and 1000"
        },
        {"m": [[1, 0, 0], [0, 1, 0], [0, 0, -1001]], "error": "matrix entries must be between -1000 and 1000"},
        {"m": [2.5, 1, 1], "what": "supercell matrix", "error": "the supercell matrix must contain whole numbers"},
        {
            "m": [[1, 0.5], [0, 1]],
            "what": "lattice matrix",
            "error": "the lattice matrix must contain whole numbers"
        },
        {"m": [2, 1.00000002, 2], "error": "the matrix must contain whole numbers"},
        {"m": [2, "2", 2], "error": "the matrix must contain whole numbers"},
        {
            "m": [1001, 2.5, 1],
            "what": "supercell matrix",
            "error": "the supercell matrix must contain whole numbers"
        },
        {
            "m": [1, 2],
            "what": "supercell matrix",
            "error": "the supercell matrix must be 3×3, 2×2 (in-plane) or three repeats"
        },
        {"m": [[1, 2, 3]], "error": "the matrix must be 3×3, 2×2 (in-plane) or three repeats"},
        {"m": [[1, 2], [3, 4], [5, 6]], "error": "the matrix must be 3×3, 2×2 (in-plane) or three repeats"},
        {"m": [[1, 2, 3], [4, 5, 6]], "error": "the matrix must be 3×3, 2×2 (in-plane) or three repeats"},
        {"m": [[1, 2, 3], [4, 5], [6, 7, 8]], "error": "the matrix must be 3×3, 2×2 (in-plane) or three repeats"},
        {"m": [1, [2], 3], "error": "the matrix must be 3×3, 2×2 (in-plane) or three repeats"},
        {"m": [1, 2, 3, 4], "error": "the matrix must be 3×3, 2×2 (in-plane) or three repeats"},
        {"m": 5, "error": "the matrix must be 3×3, 2×2 (in-plane) or three repeats"},
        {
            "m": "2 2 1",
            "what": "supercell matrix",
            "error": "the supercell matrix must be 3×3, 2×2 (in-plane) or three repeats"
        },
        {"m": [], "error": "the matrix must be 3×3, 2×2 (in-plane) or three repeats"},
        {
            "m": [[1, 2], [3, 4]],
            "plane": [0, 0],
            "error": "the plane must be two different cell axes out of 0, 1 and 2"
        },
        {"m": [1, 1, 1], "plane": [0, 3], "error": "the plane must be two different cell axes out of 0, 1 and 2"},
        {"m": [1, 1, 1], "plane": [1], "error": "the plane must be two different cell axes out of 0, 1 and 2"}
    ],
    "hermite_normal_form": [
        {"rows": [[2, 0, 0], [0, 2, 0], [0, 0, 2]], "hnf": [[2, 0, 0], [0, 2, 0], [0, 0, 2]]},
        {"rows": [[2, 1, 0], [-1, 1, 0], [0, 0, 1]], "hnf": [[1, 2, 0], [0, 3, 0], [0, 0, 1]]},
        {"rows": [[1, 1, 0], [-1, 1, 0], [0, 0, 2]], "hnf": [[1, 1, 0], [0, 2, 0], [0, 0, 2]]},
        {"rows": [[-3, 1, 1], [-1, -1, 3], [1, 1, 1]], "hnf": [[1, 1, 1], [0, 4, 0], [0, 0, 4]]},
        {"rows": [[1, 0, 0], [0, 1, 0], [37, 0, 1]], "hnf": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]},
        {"rows": [[3, 1, 0], [-1, 2, 0], [0, 0, 1]], "hnf": [[1, 5, 0], [0, 7, 0], [0, 0, 1]]},
        {"rows": [[5, 2, 1], [-1, 3, 2], [2, -1, 4]], "hnf": [[1, 0, 19], [0, 1, 34], [0, 0, 81]]},
        {"rows": [[-2, 0, 0], [0, -3, 0], [0, 0, -1]], "hnf": [[2, 0, 0], [0, 3, 0], [0, 0, 1]]},
        {
            "rows": [[2, 1, 0], [-1, 1, 0], [0, 0, 1], [3, 0, 0], [0, 6, 2]],
            "hnf": [[1, 2, 0], [0, 3, 0], [0, 0, 1]]
        },
        {
            "rows": [[2, 0, 0], [0, 2, 0], [0, 0, 2], [1, 1, 0], [1, 0, 1], [0, 1, 1]],
            "hnf": [[1, 0, 1], [0, 1, 1], [0, 0, 2]]
        },
        {"rows": [[0, 0, 1], [0, 1, 0], [1, 0, 0]], "hnf": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]},
        {"rows": [[0, 2, 0], [3, 0, 0], [0, 0, 5]], "hnf": [[3, 0, 0], [0, 2, 0], [0, 0, 5]]},
        {"rows": [[4, -6, 10], [-6, 9, 15], [10, 15, -25], [7, 0, 1]], "hnf": [[1, 0, 3], [0, 3, 1], [0, 0, 10]]},
        {"rows": [[1, 0, 0], [0, 1, 0], [1, 1, 0]], "error": "the rows do not span three dimensions"},
        {"rows": [[1, 0, 0], [0, 1, 0]], "error": "the rows do not span three dimensions"},
        {"rows": [], "error": "the rows do not span three dimensions"},
        {"rows": [[0, 0, 0], [0, 0, 0], [0, 0, 0]], "error": "the rows do not span three dimensions"},
        {"rows": [[1, 2, 3], [2, 4, 6], [0, 0, 0], [3, 6, 9]], "error": "the rows do not span three dimensions"}
    ],
    "hermite_normal_form_2d": [
        {"m": [[2, 1], [-1, 1]], "abc": [1, 2, 3]},
        {"m": [[1, 0], [0, 1]], "abc": [1, 0, 1]},
        {"m": [[3, 0], [0, 3]], "abc": [3, 0, 3]},
        {"m": [[2, 0], [1, 2]], "abc": [1, 2, 4]},
        {"m": [[-2, -1], [1, -1]], "abc": [1, 2, 3]},
        {"m": [[0, 1], [1, 0]], "abc": [1, 0, 1]},
        {"m": [[4, 6], [2, 4]], "abc": [2, 0, 2]},
        {"m": [[2, 0], [0, 2], [1, 1]], "abc": [1, 1, 2]},
        {"m": [[6, 3], [-3, 3]], "abc": [3, 6, 9]},
        {"m": [[0, -5], [7, 2]], "abc": [7, 2, 5]},
        {"m": [[1, 2], [2, 4]], "error": "the rows do not span two dimensions"},
        {"m": [[0, 0], [0, 0]], "error": "the rows do not span two dimensions"},
        {"m": [[1, 1]], "error": "the rows do not span two dimensions"}
    ],
    "supercell_lattice_points": [
        {
            "P": [2, 2, 2],
            "points": [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]]
        },
        {"P": [3, 1, 2], "points": [[0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1], [2, 0, 0], [2, 0, 1]]},
        {"P": [1, 1, 1], "points": [[0, 0, 0]]},
        {
            "P": [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
            "points": [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1], [1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]]
        },
        {"P": [[2, 1, 0], [-1, 1, 0], [0, 0, 1]], "points": [[0, 0, 0], [0, 1, 0], [1, 1, 0]]},
        {"P": [[1, 1, 0], [-1, 1, 0], [0, 0, 2]], "points": [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1]]},
        {
            "P": [[-3, 1, 1], [-1, -1, 3], [1, 1, 1]],
            "points": [[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3], [0, 1, 1], [-1, 0, 1], [-1, 0, 2], [-1, 0, 3],
                [-1, 1, 1], [-1, 1, 2], [-2, 0, 2], [-2, 0, 3], [-2, 1, 1], [-2, 1, 2], [-2, 1, 3], [-3, 0, 3]]
        },
        {"P": [[1, 0, 0], [0, 1, 0], [37, 0, 1]], "points": [[0, 0, 0]]},
        {
            "P": [[3, 1, 0], [-1, 2, 0], [0, 0, 1]],
            "points": [[0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 1, 0], [1, 2, 0], [2, 1, 0], [2, 2, 0]]
        },
        {
            "P": [[5, 2, 1], [-1, 3, 2], [2, -1, 4]],
            "points": [[0, 0, 0], [0, 2, 3], [1, 1, 4], [0, 1, 1], [1, 0, 2], [1, 2, 5], [0, 2, 2], [1, 1, 3],
                [2, 0, 4], [1, 0, 1], [1, 2, 4], [2, 1, 5], [1, 1, 2], [2, 0, 3], [0, 3, 2], [1, 2, 3], [2, 1, 4],
                [1, 1, 1], [2, 0, 2], [2, 2, 5], [1, 2, 2], [2, 1, 3], [3, 0, 4], [1, 3, 3], [2, 2, 4], [3, 1, 5],
                [2, 1, 2], [3, 0, 3], [1, 3, 2], [2, 2, 3], [3, 1, 4], [2, 1, 1], [2, 3, 4], [3, 2, 5], [2, 2, 2],
                [3, 1, 3], [4, 0, 4], [2, 3, 3], [3, 2, 4], [4, 1, 5], [3, 1, 2], [3, 3, 5], [2, 3, 2], [3, 2, 3],
                [4, 1, 4], [3, 1, 1], [3, 3, 4], [4, 2, 5], [3, 2, 2], [4, 1, 3], [4, 3, 6], [3, 3, 3], [4, 2, 4],
                [5, 1, 5], [4, 1, 2], [4, 3, 5], [3, 3, 2], [4, 2, 3], [5, 1, 4], [3, 4, 3], [4, 3, 4], [5, 2, 5],
                [4, 2, 2], [5, 1, 3], [5, 3, 6], [4, 3, 3], [5, 2, 4], [6, 1, 5], [4, 4, 4], [5, 3, 5], [4, 3, 2],
                [5, 2, 3], [6, 1, 4], [4, 4, 3], [5, 3, 4], [6, 2, 5], [5, 2, 2], [5, 4, 5], [6, 3, 6], [5, 3, 3],
                [6, 2, 4]]
        },
        {"P": [[2, 1], [-1, 1]], "points": [[0, 0, 0], [0, 1, 0], [1, 1, 0]]},
        {"P": [[0, 1, 0], [1, 0, 0], [0, 0, 2]], "points": [[0, 0, 0], [0, 0, -1]]},
        {"P": [[-2, -1, 0], [1, -1, 0], [0, 0, -1]], "points": [[0, 0, 0], [0, 1, 0], [1, 1, 0]]},
        {
            "P": [[3, -1, -1], [-1, -1, 3], [1, 1, 1]],
            "points": [[0, 0, 0], [0, 0, -1], [0, 0, -2], [0, 0, -3], [-1, 0, 0], [-1, 0, -1], [-1, 0, -2],
                [0, 1, -2], [-2, 0, 0], [-2, 0, -1], [-1, 1, -1], [-1, 1, -2], [-3, 0, 0], [-2, 1, 0], [-2, 1, -1],
                [-2, 1, -2]]
        },
        {"P": [[1, 2, 3], [4, 5, 6], [7, 8, 9]], "error": "the supercell matrix is singular (determinant 0)"},
        {"P": [2, 0, 1], "error": "the supercell matrix is singular (determinant 0)"},
        {"P": [[2, 0.5, 0], [0, 1, 0], [0, 0, 1]], "error": "the supercell matrix must contain whole numbers"},
        {"P": [2, 2], "error": "the supercell matrix must be 3×3, 2×2 (in-plane) or three repeats"}
    ],
    "hnf_matrices_2d": [
        {"n": 1, "matrices": [[[1, 0], [0, 1]]]},
        {"n": 2, "matrices": [[[1, 0], [0, 2]], [[1, 1], [0, 2]], [[2, 0], [0, 1]]]},
        {"n": 3, "matrices": [[[1, 0], [0, 3]], [[1, 1], [0, 3]], [[1, 2], [0, 3]], [[3, 0], [0, 1]]]},
        {
            "n": 4,
            "matrices": [[[1, 0], [0, 4]], [[1, 1], [0, 4]], [[1, 2], [0, 4]], [[1, 3], [0, 4]], [[2, 0], [0, 2]],
                [[2, 1], [0, 2]], [[4, 0], [0, 1]]]
        },
        {
            "n": 6,
            "matrices": [[[1, 0], [0, 6]], [[1, 1], [0, 6]], [[1, 2], [0, 6]], [[1, 3], [0, 6]], [[1, 4], [0, 6]],
                [[1, 5], [0, 6]], [[2, 0], [0, 3]], [[2, 1], [0, 3]], [[2, 2], [0, 3]], [[3, 0], [0, 2]],
                [[3, 1], [0, 2]], [[6, 0], [0, 1]]]
        },
        {
            "n": 7,
            "matrices": [[[1, 0], [0, 7]], [[1, 1], [0, 7]], [[1, 2], [0, 7]], [[1, 3], [0, 7]], [[1, 4], [0, 7]],
                [[1, 5], [0, 7]], [[1, 6], [0, 7]], [[7, 0], [0, 1]]]
        },
        {
            "n": 12,
            "matrices": [[[1, 0], [0, 12]], [[1, 1], [0, 12]], [[1, 2], [0, 12]], [[1, 3], [0, 12]],
                [[1, 4], [0, 12]], [[1, 5], [0, 12]], [[1, 6], [0, 12]], [[1, 7], [0, 12]], [[1, 8], [0, 12]],
                [[1, 9], [0, 12]], [[1, 10], [0, 12]], [[1, 11], [0, 12]], [[2, 0], [0, 6]], [[2, 1], [0, 6]],
                [[2, 2], [0, 6]], [[2, 3], [0, 6]], [[2, 4], [0, 6]], [[2, 5], [0, 6]], [[3, 0], [0, 4]],
                [[3, 1], [0, 4]], [[3, 2], [0, 4]], [[3, 3], [0, 4]], [[4, 0], [0, 3]], [[4, 1], [0, 3]],
                [[4, 2], [0, 3]], [[6, 0], [0, 2]], [[6, 1], [0, 2]], [[12, 0], [0, 1]]]
        },
        {"n": 0, "error": "the sublattice index must be a positive integer (got 0)"},
        {"n": -6, "error": "the sublattice index must be a positive integer (got -6)"}
    ]
}
# END PARITY_CASES


# ----------------------------------------------------------------------------------------------- helpers
def sigma(n: int) -> int:
    return sum(d for d in range(1, n + 1) if n % d == 0)


def leibniz_det(m) -> int:
    total = 0
    for perm in itertools.permutations(range(3)):
        inversions = sum(1 for i in range(3) for j in range(i + 1, 3) if perm[i] > perm[j])
        total += (-1) ** inversions * m[0][perm[0]] * m[1][perm[1]] * m[2][perm[2]]
    return total


def matmul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(len(b))) for j in range(len(b[0]))] for i in range(len(a))]


def random_unimodular(rng: random.Random, dim: int = 3, steps: int = 6):
    """A random integer matrix of determinant ±1: a product of elementary row operations and swaps."""
    u = [[int(i == j) for j in range(dim)] for i in range(dim)]
    for _ in range(steps):
        i, j = rng.sample(range(dim), 2)
        if rng.random() < 0.2:
            u[i], u[j] = u[j], u[i]
        else:
            f = rng.randint(-3, 3)
            u[i] = [u[i][c] + f * u[j][c] for c in range(dim)]
    return u


def random_matrix(rng: random.Random, lo: int = -4, hi: int = 4, *, nonsingular: bool = True):
    while True:
        m = [[rng.randint(lo, hi) for _ in range(3)] for _ in range(3)]
        if not nonsingular or int_det3(m) != 0:
            return m


def check_hermite(h, d: int) -> None:
    for i in range(d):
        assert h[i][i] > 0
        assert all(h[i][j] == 0 for j in range(i))
        assert all(0 <= h[i][j] < h[j][j] for j in range(i + 1, d))


def in_lattice(row, h) -> bool:
    """Whether the integer *row* is an integer combination of the rows of the Hermite form *h* (back substitution)."""
    r = list(row)
    for j in range(len(h)):
        if r[j] % h[j][j]:
            return False
        q = r[j] // h[j][j]
        r = [r[c] - q * h[j][c] for c in range(len(h))]
    return all(v == 0 for v in r)


def keys_of(points, p):
    """The integer keys n @ adj(p) of lattice points (det(p) times their new fractional coordinates)."""
    adj = int_adjugate3(p)
    return [tuple(sum(n[r] * adj[r][c] for r in range(3)) for c in range(3)) for n in points]


def py_attempt(fn):
    """The result of fn() as the bridge returns it from JS: {"ok": value} or {"error": message} for a ValueError."""
    try:
        return {"ok": json.loads(json.dumps(fn()))}
    except ValueError as exc:
        return {"error": str(exc)}


def js_kwargs(case: dict) -> dict:
    return {k: (tuple(case[k]) if k == "plane" else case[k]) for k in ("what", "plane") if k in case}


# ------------------------------------------------------------------------------------------- parity cases
def _run_case(section: str, case: dict):
    if section == "egcd":
        return list(egcd(case["a"], case["b"]))
    if section == "det3":
        return [int_det3(case["m"]), int_adjugate3(case["m"])]
    if section == "as_int_matrix":
        return as_int_matrix(case["m"], **js_kwargs(case))
    if section == "hermite_normal_form":
        return hermite_normal_form(case["rows"])
    if section == "hermite_normal_form_2d":
        return list(hermite_normal_form_2d(case["m"]))
    if section == "supercell_lattice_points":
        return [list(p) for p in supercell_lattice_points(case["P"])]
    if section == "hnf_matrices_2d":
        return hnf_matrices_2d(case["n"])
    raise AssertionError(section)


_EXPECTED = {"egcd": lambda c: c["gxy"], "det3": lambda c: [c["det"], c["adjugate"]], "as_int_matrix": lambda c: c["matrix"],
             "hermite_normal_form": lambda c: c["hnf"], "hermite_normal_form_2d": lambda c: c["abc"],
             "supercell_lattice_points": lambda c: c["points"], "hnf_matrices_2d": lambda c: c["matrices"]}


@pytest.mark.parametrize("section", list(PARITY_CASES))
def test_parity_cases(section):
    """The exact results (or messages) that the JavaScript twin gives as well."""
    for case in PARITY_CASES[section]:
        if "error" in case:
            with pytest.raises(ValueError) as exc:
                _run_case(section, case)
            assert str(exc.value) == case["error"], case
        else:
            assert _run_case(section, case) == _EXPECTED[section](case), case


def test_parity_cases_cover_the_brief():
    """The seven matrices, the diagonal repeats, negative determinants and hnf_matrices_2d(6) are in the constant."""
    points = [c["P"] for c in PARITY_CASES["supercell_lattice_points"] if "points" in c]
    assert all(m in points for m in SEVEN)
    assert [2, 2, 2] in points and [3, 1, 2] in points and [1, 1, 1] in points
    assert sum(1 for p in points if int_det3(as_int_matrix(p)) < 0) >= 3
    assert all(m in [c["rows"] for c in PARITY_CASES["hermite_normal_form"]] for m in SEVEN)
    assert len(next(c for c in PARITY_CASES["hnf_matrices_2d"] if c["n"] == 6)["matrices"]) == 12
    assert any("error" in c for c in PARITY_CASES["hermite_normal_form"])


def _parity_block(path: Path, comment: str) -> dict:
    text = path.read_text(encoding="utf-8")
    block = text.split(f"{comment} BEGIN PARITY_CASES", 1)[1].split(f"{comment} END PARITY_CASES", 1)[0]
    return json.loads(block[block.index("{"):block.rindex("}") + 1])


def test_parity_cases_are_one_constant():
    """The two copies of PARITY_CASES (here and in tests/js/intmath.test.mjs) are the same JSON constant."""
    here = _parity_block(Path(__file__), "#")
    assert here == PARITY_CASES
    assert _parity_block(JS_TESTS, "//") == here


def _random_inputs(seed: int = 20261109) -> dict:
    rng = random.Random(seed)
    big = 2**52
    pairs = [[rng.randint(-10**6, 10**6), rng.randint(-10**6, 10**6)] for _ in range(300)]
    pairs += [[rng.randint(-big, big), rng.randint(-big, big)] for _ in range(50)] + [[0, rng.randint(-9, 9)] for _ in range(5)]
    mats = [random_matrix(rng, -9, 9, nonsingular=False) for _ in range(300)]
    rows = [[[rng.randint(-6, 6) for _ in range(3)] for _ in range(rng.randint(3, 6))] for _ in range(300)]
    rows += [[r[0], r[1], [r[0][c] + 2 * r[1][c] for c in range(3)]] for r in rows[:20]]           # rank 2
    rows2 = [[[rng.randint(-9, 9) for _ in range(2)] for _ in range(rng.randint(2, 4))] for _ in range(300)]
    points = []
    while len(points) < 120:
        m = random_matrix(rng, -4, 4, nonsingular=False)
        if abs(int_det3(m)) <= 60:
            points.append(m)
    shapes = [[2, 2, 1], [[2, 1], [-1, 1]], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]]
    asint = []
    for _ in range(200):
        m = json.loads(json.dumps(rng.choice(shapes)))
        flat = m if not isinstance(m[0], list) else None
        for row in ([m] if flat is not None else m):
            for i in range(len(row)):
                row[i] = rng.choice([rng.randint(-1200, 1200), rng.randint(-5, 5) + rng.choice([0, 1e-9, -3e-9, 0.5, 2e-7])])
        opts = {"what": rng.choice(["matrix", "supercell matrix"])}
        if rng.random() < 0.5:
            opts["plane"] = rng.choice([[0, 1], [1, 2], [2, 0], [0, 2], [1, 0], [2, 1]])
        asint.append([m, opts])
    return {"egcd": pairs, "mats": mats, "rows": rows, "rows2": rows2, "points": points, "ns": list(range(-2, 61)),
            "asint": asint}


def test_js_matches_python(js):
    """The JavaScript twin gives the same results and messages, item by item, on the parity cases and random inputs."""
    payload = _random_inputs()
    payload["egcd"] += [[c["a"], c["b"]] for c in PARITY_CASES["egcd"]]
    payload["mats"] += [c["m"] for c in PARITY_CASES["det3"]]
    payload["rows"] += [c["rows"] for c in PARITY_CASES["hermite_normal_form"]]
    payload["rows2"] += [c["m"] for c in PARITY_CASES["hermite_normal_form_2d"]]
    payload["points"] += [c["P"] for c in PARITY_CASES["supercell_lattice_points"]]
    payload["asint"] += [[c["m"], {k: c[k] for k in ("what", "plane") if k in c}] for c in PARITY_CASES["as_int_matrix"]]
    got = js("""
      const I = await web('core/intmath.js');
      const attempt = (f) => { try { return { ok: f() }; } catch (e) { return { error: e.message }; } };
      return {
        egcd: input.egcd.map(([a, b]) => attempt(() => I.egcd(a, b))),
        mats: input.mats.map((m) => attempt(() => [I.intDet3(m), I.intAdjugate3(m), I.isUnimodular(m)])),
        rows: input.rows.map((r) => attempt(() => I.hermiteNormalForm(r))),
        rows2: input.rows2.map((r) => attempt(() => I.hermiteNormalForm2d(r))),
        points: input.points.map((P) => attempt(() => I.supercellLatticePoints(P))),
        ns: input.ns.map((n) => attempt(() => I.hnfMatrices2d(n))),
        asint: input.asint.map(([m, opts]) => attempt(() => I.asIntMatrix(m, opts))),
      };
    """, payload, timeout=120)
    want = {
        "egcd": [py_attempt(lambda a=a, b=b: egcd(a, b)) for a, b in payload["egcd"]],
        "mats": [py_attempt(lambda m=m: [int_det3(m), int_adjugate3(m), is_unimodular(m)]) for m in payload["mats"]],
        "rows": [py_attempt(lambda r=r: hermite_normal_form(r)) for r in payload["rows"]],
        "rows2": [py_attempt(lambda r=r: hermite_normal_form_2d(r)) for r in payload["rows2"]],
        "points": [py_attempt(lambda p=p: supercell_lattice_points(p)) for p in payload["points"]],
        "ns": [py_attempt(lambda n=n: hnf_matrices_2d(n)) for n in payload["ns"]],
        "asint": [py_attempt(lambda m=m, o=o: as_int_matrix(m, **js_kwargs(o))) for m, o in payload["asint"]],
    }
    for key in want:
        assert len(got[key]) == len(want[key])
        bad = [(i, g, w) for i, (g, w) in enumerate(zip(got[key], want[key])) if g != w]
        assert not bad, f"{key}: {len(bad)} differ, first {bad[0]}"
    # the random inputs reach the interesting branches
    assert any("error" in r for r in want["rows"]) and any("error" in r for r in want["points"])
    assert any("error" in r for r in want["asint"]) and sum("ok" in r for r in want["asint"]) > 20


# ------------------------------------------------------------------------------------------------- egcd
def test_egcd_bezout_gcd_and_bounds():
    rng = random.Random(5)
    pairs = [(rng.randint(-10**6, 10**6), rng.randint(-10**6, 10**6)) for _ in range(5000)]
    pairs += [(a, b) for a in range(-12, 13) for b in range(-12, 13)]
    pairs += [(10**40 + 7, 10**39 + 3), (-(2**200), 3**100)]          # Python ints do not overflow
    for a, b in pairs:
        g, x, y = egcd(a, b)
        assert a * x + b * y == g == math.gcd(a, b) >= 0
        if g:
            assert abs(x) <= max(1, abs(b) // g) and abs(y) <= max(1, abs(a) // g)
    assert egcd(240, 46) == (2, -9, 47) and egcd(0, 0) == (0, 1, 0) and egcd(-4, 0) == (4, -1, 0)
    assert all(type(v) is int for v in egcd(np.int64(12), np.int32(18)))


def test_integer_arguments():
    """Integers may be ints, numpy integers or integral floats; booleans, fractions of one and text are refused."""
    assert egcd(12.0, np.int64(18)) == egcd(12, 18) == (6, -1, 1)
    assert int_det3(np.array(SEVEN[3])) == int_det3(np.array(SEVEN[3], dtype=float)) == int_det3(tuple(map(tuple, SEVEN[3]))) == 16
    for bad, shown in ((2.5, "2.5"), (True, "true"), ("3", '"3"'), (None, "null"), (math.nan, "NaN"), (math.inf, "Infinity")):
        with pytest.raises(TypeError, match=re.escape(f"egcd needs integers (got {shown})")):
            egcd(bad, 1)
        with pytest.raises(TypeError, match=re.escape(f"int_det3 needs integers (got {shown})")):
            int_det3([[bad, 0, 0], [0, 1, 0], [0, 0, 1]])
    for bad in ([[1, 0], [0, 1]], [[1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 1], [0, 0, 1]], "abc", 5, None, [1, 2, 3]):
        for fn in (int_det3, int_adjugate3, is_unimodular):
            with pytest.raises(TypeError, match=re.escape(f"{fn.__name__} needs a 3×3 matrix of integers")):
                fn(bad)
    with pytest.raises(TypeError, match=re.escape("hermite_normal_form needs rows of 3 integers")):
        hermite_normal_form([[1, 0, 0], [0, 1]])
    with pytest.raises(TypeError, match=re.escape("hermite_normal_form_2d needs rows of 2 integers")):
        hermite_normal_form_2d([[1, 0, 0], [0, 1, 0]])
    with pytest.raises(TypeError, match=re.escape("hermite_normal_form needs integers (got 0.5)")):
        hermite_normal_form([[1, 0, 0], [0, 1, 0], [0, 0, 0.5]])


# ---------------------------------------------------------------------------------- determinant, adjugate
def test_det_adjugate_random_and_exact():
    rng = random.Random(11)
    mats = [random_matrix(rng, -20, 20, nonsingular=False) for _ in range(500)]
    mats += [[[rng.randint(-10**15, 10**15) for _ in range(3)] for _ in range(3)] for _ in range(20)]  # exact in Python
    for m in mats:
        d, adj = int_det3(m), int_adjugate3(m)
        assert d == leibniz_det(m)
        ident = [[d * int(i == j) for j in range(3)] for i in range(3)]
        assert matmul(m, adj) == ident and matmul(adj, m) == ident
    assert int_det3(SEVEN[3]) == 16 and int_adjugate3(SEVEN[1]) == [[1, -1, 0], [1, 2, 0], [0, 0, 3]]


def test_is_unimodular():
    for m in ([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 1, 0], [1, 0, 0], [0, 0, 1]], SEVEN[4], [[1, 0, 0], [0, 1, 0], [0, 0, -1]],
              [[2, 1, 0], [1, 1, 0], [0, 0, 1]]):
        assert is_unimodular(m) is True
    for m in (SEVEN[1], SEVEN[0], [[1, 2, 3], [4, 5, 6], [7, 8, 9]]):
        assert is_unimodular(m) is False
    rng = random.Random(3)
    assert all(is_unimodular(random_unimodular(rng)) for _ in range(200))


# ------------------------------------------------------------------------------------------- as_int_matrix
def test_as_int_matrix_forms_and_planes():
    assert as_int_matrix([2, 2, 1]) == [[2, 0, 0], [0, 2, 0], [0, 0, 1]]
    assert as_int_matrix(np.array([3, 1, 2])) == [[3, 0, 0], [0, 1, 0], [0, 0, 2]]
    two = [[2, 1], [-1, 1]]
    for plane in itertools.permutations(range(3), 2):
        i, j = plane
        out = as_int_matrix(two, plane=plane)
        k = 3 - i - j
        assert out[k] == [int(c == k) for c in range(3)] and all(out[r][k] == int(r == k) for r in range(3))
        assert (out[i][i], out[i][j], out[j][i], out[j][j]) == (2, 1, -1, 1)
        assert int_det3(out) == 3
    m = np.array([[2.000000001, 1, 0], [-1, 0.9999999995, 0], [0, 0, 1]])
    out = as_int_matrix(m)
    assert out == [[2, 1, 0], [-1, 1, 0], [0, 0, 1]] and all(type(v) is int for row in out for v in row)
    src = [[1, 0, 0], [0, 1, 0], [37, 0, 1]]
    out = as_int_matrix(src)
    assert out == src and out is not src and out[2] is not src[2]
    assert as_int_matrix([[1, 0, 0], [0, 1, 0], [0, 0, -1e-9]]) == [[1, 0, 0], [0, 1, 0], [0, 0, 0]]


def test_as_int_matrix_messages_and_limit():
    limit = SURFACE_DEFAULTS.get("max_matrix_entry", 1000)
    assert limit == 1000                                                      # M1 §3.1
    assert as_int_matrix([-limit, limit, 1])[0][0] == -limit
    what = "supercell matrix"
    for bad in ([limit + 1, 1, 1], [[1, 0], [0, -limit - 1]], np.full((3, 3), 5000)):
        with pytest.raises(ValueError, match=f"^{what} entries must be between -{limit} and {limit}$"):
            as_int_matrix(bad, what=what)
    for bad in ([2.5, 1, 1], [math.nan, 1, 1], [math.inf, 1, 1], [1, 1, 2 + 2e-8], [[1, True], [0, 1]], [None, 1, 1]):
        with pytest.raises(ValueError, match=f"^the {what} must contain whole numbers$"):
            as_int_matrix(bad, what=what)
    for bad in ([1, 2], [[1, 2, 3]], np.eye(4), [[1, 2], [3, 4], [5, 6]], [1, [2], 3], 7, None, "1 1 1", {"a": 1}):
        with pytest.raises(ValueError, match=re.escape(f"the {what} must be 3×3, 2×2 (in-plane) or three repeats")):
            as_int_matrix(bad, what=what)
    with pytest.raises(ValueError, match=re.escape("the matrix must be 3×3")):
        as_int_matrix([1, 2])                                                 # what defaults to "matrix"
    for plane in ((0, 0), (0, 3), (1,), (True, 2), (0.5, 1), "01", None):
        with pytest.raises(ValueError, match="^the plane must be two different cell axes out of 0, 1 and 2$"):
            as_int_matrix([[1, 0], [0, 1]], plane=plane)
    assert as_int_matrix([1, 1, 1], plane=(2.0, np.int64(0)))[0] == [1, 0, 0]


# ----------------------------------------------------------------------------------- Hermite normal form
def test_hermite_normal_form_is_unique_for_the_lattice():
    rng = random.Random(17)
    for _ in range(300):
        p = random_matrix(rng)
        h = hermite_normal_form(p)
        check_hermite(h, 3)
        assert math.prod(h[i][i] for i in range(3)) == abs(int_det3(p))
        assert all(in_lattice(row, h) for row in p)                          # the rows of P lie in the lattice of H
        v = [[Fraction(x, int_det3(p)) for x in row] for row in matmul(h, int_adjugate3(p))]
        assert all(x.denominator == 1 for row in v for x in row)            # H = V @ P with V integral ...
        assert abs(leibniz_det([[int(x) for x in row] for row in v])) == 1  # ... and unimodular
        u = random_unimodular(rng)
        assert hermite_normal_form(matmul(u, p)) == h                        # another basis of the same lattice
        coefficients = [[rng.randint(-3, 3) for _ in range(3)] for _ in range(rng.randint(1, 4))]
        rows = p + matmul(coefficients, p)                                   # integer combinations of the rows
        rng.shuffle(rows)
        assert hermite_normal_form(rows) == h                                # extra rows in any order
    assert hermite_normal_form(SEVEN[1]) == [[1, 2, 0], [0, 3, 0], [0, 0, 1]]


def test_hermite_normal_form_negative_inputs_and_rank():
    assert hermite_normal_form([[-2, 0, 0], [0, -3, 0], [0, 0, -1]]) == [[2, 0, 0], [0, 3, 0], [0, 0, 1]]
    assert hermite_normal_form([[-1, -1, 0], [1, -1, 0], [0, 0, -2]]) == hermite_normal_form(SEVEN[2])
    rows = [[-3, 1, 1], [-1, -1, 3], [1, 1, 1]]
    before = json.dumps(rows)
    hermite_normal_form(rows)
    assert json.dumps(rows) == before                                        # the input is not changed
    for bad in ([[1, 0, 0], [0, 1, 0], [1, 1, 0]], [[1, 0, 0], [0, 1, 0]], [], [[0, 0, 0]] * 4, [[1, 2, 3], [2, 4, 6], [3, 6, 9]]):
        with pytest.raises(ValueError, match="^the rows do not span three dimensions$"):
            hermite_normal_form(bad)


def test_hermite_normal_form_2d():
    rng = random.Random(23)
    for _ in range(300):
        while True:
            m = [[rng.randint(-9, 9) for _ in range(2)] for _ in range(2)]
            det = m[0][0] * m[1][1] - m[0][1] * m[1][0]
            if det:
                break
        a, b, c = hermite_normal_form_2d(m)
        assert a > 0 and c > 0 and 0 <= b < c and a * c == abs(det)
        embedded = hermite_normal_form([m[0] + [0], m[1] + [0], [0, 0, 1]])
        assert (a, b, c) == (embedded[0][0], embedded[0][1], embedded[1][1])
        u = random_unimodular(rng, 2)
        assert hermite_normal_form_2d(matmul(u, m)) == (a, b, c)
    assert hermite_normal_form_2d([[2, 1], [-1, 1]]) == (1, 2, 3)
    assert hermite_normal_form_2d(np.array([[2, 0], [0, 2], [1, 1]])) == (1, 1, 2)       # c(2×2): extra rows
    for bad in ([[1, 2], [2, 4]], [[0, 0], [0, 0]], [[1, 1]]):
        with pytest.raises(ValueError, match="^the rows do not span two dimensions$"):
            hermite_normal_form_2d(bad)


def test_hnf_matrices_2d():
    assert hnf_matrices_2d(6) == [
        [[1, 0], [0, 6]], [[1, 1], [0, 6]], [[1, 2], [0, 6]], [[1, 3], [0, 6]], [[1, 4], [0, 6]], [[1, 5], [0, 6]],
        [[2, 0], [0, 3]], [[2, 1], [0, 3]], [[2, 2], [0, 3]],
        [[3, 0], [0, 2]], [[3, 1], [0, 2]],
        [[6, 0], [0, 1]],
    ]
    for n in range(1, 61):
        ms = hnf_matrices_2d(n)
        assert len(ms) == sigma(n)
        keys = [hermite_normal_form_2d(m) for m in ms]
        assert keys == [(m[0][0], m[0][1], m[1][1]) for m in ms]               # each already in normal form
        assert keys == sorted(keys) and len(set(keys)) == len(keys)          # ascending i, then j; all different
    for n in (1, 2, 3, 4, 5, 6, 8, 9):                                         # every sublattice of index n is there
        found = set()
        for m in itertools.product(range(-n, n + 1), repeat=4):
            if abs(m[0] * m[3] - m[1] * m[2]) == n:
                found.add(hermite_normal_form_2d([[m[0], m[1]], [m[2], m[3]]]))
        assert found == {tuple(k) for k in map(hermite_normal_form_2d, hnf_matrices_2d(n))}
    assert hnf_matrices_2d(6.0) == hnf_matrices_2d(np.int64(6))
    for bad in (0, -6):
        with pytest.raises(ValueError, match=re.escape(f"the sublattice index must be a positive integer (got {bad})")):
            hnf_matrices_2d(bad)
    for bad, shown in ((2.5, "2.5"), (True, "true"), ("6", '"6"'), (None, "null")):
        with pytest.raises(TypeError, match=re.escape(f"the sublattice index must be a positive integer (got {shown})")):
            hnf_matrices_2d(bad)


# ------------------------------------------------------------------------------------------ lattice points
def test_lattice_points_of_a_diagonal_matrix_follow_repeat():
    """Diagonal matrices give the image order of F0-D's Structure.repeat (brief C1, U2): positions and source map."""
    cell = np.array([[3.0, 0.0, 0.0], [1.2, 2.8, 0.0], [0.4, -0.3, 4.1]])
    s = Structure(symbols=["Pt", "O", "Pt"], positions=[[0.1, 0.2, 0.3], [1.5, 1.1, 2.0], [2.2, 0.4, 3.3]], cell=cell)
    for reps in ([2, 2, 2], [3, 1, 2], [1, 1, 1]):
        pts = supercell_lattice_points(reps)
        assert pts == supercell_lattice_points(np.diag(reps)) == list(itertools.product(*map(range, reps)))
        r = s.repeat(*reps)
        n = len(s)
        assert len(r) == n * len(pts)
        assert r.source_map.tolist() == [a for _ in pts for a in range(n)]
        expected = np.array([s.positions[a] + np.array(p, dtype=float) @ cell for p in pts for a in range(n)])
        assert np.allclose(r.positions, expected, rtol=0, atol=1e-12)
        images = [tuple(int(v) for v in np.rint(np.linalg.solve(cell.T, r.positions[q * n] - s.positions[0])))
                  for q in range(len(pts))]
        assert images == pts


@pytest.mark.parametrize("p", SEVEN, ids=[f"det{abs(int_det3(m))}" for m in SEVEN])
def test_lattice_points_count_inside_and_distinct(p):
    """|det P| points, all inside the new cell, one per coset, (0, 0, 0) first, sorted by new coordinates."""
    pts = supercell_lattice_points(p)
    det = int_det3(p)
    assert len(pts) == abs(det) and pts[0] == (0, 0, 0)
    keys = keys_of(pts, p)
    assert all(0 <= k < det for key in keys for k in key)                    # 0 <= n @ inv(P) < 1, exactly
    assert keys == sorted(keys) and len(set(keys)) == len(keys)              # distinct new coordinates
    h = hermite_normal_form(p)
    for a, b in itertools.combinations(pts, 2):                              # no two in the same coset
        assert not in_lattice([a[c] - b[c] for c in range(3)], h)
    assert all(type(v) is int for n in pts for v in n)


def test_lattice_points_with_a_negative_determinant_are_those_of_minus_p():
    rng = random.Random(29)
    mats = [[[-v for v in row] for row in m] for m in SEVEN] + [[m[1], m[0], m[2]] for m in SEVEN]
    while len(mats) < 40:
        m = random_matrix(rng, -3, 3)
        if int_det3(m) < 0:
            mats.append(m)
    for q in mats:
        det = int_det3(q)
        assert det < 0
        neg = [[-v for v in row] for row in q]
        pts = supercell_lattice_points(q)
        assert pts == supercell_lattice_points(neg) and len(pts) == -det
        assert all(0 <= k < -det for key in keys_of(pts, neg) for k in key)  # inside the cell of -P


def test_lattice_points_shapes_and_errors():
    assert supercell_lattice_points([[2, 1], [-1, 1]]) == supercell_lattice_points(SEVEN[1]) == [(0, 0, 0), (0, 1, 0), (1, 1, 0)]
    assert len(supercell_lattice_points([10, 10, 10])) == 1000
    for bad in ([[1, 2, 3], [4, 5, 6], [7, 8, 9]], [2, 0, 1], [[1, 2], [2, 4]]):
        with pytest.raises(ValueError, match=re.escape("the supercell matrix is singular (determinant 0)")):
            supercell_lattice_points(bad)
    with pytest.raises(ValueError, match="^the supercell matrix must contain whole numbers$"):
        supercell_lattice_points([2, 2, 1.5])
    with pytest.raises(ValueError, match=re.escape("the supercell matrix must be 3×3, 2×2 (in-plane) or three repeats")):
        supercell_lattice_points([2, 2])


def test_lattice_points_random_against_brute_force():
    rng = random.Random(31)
    done = 0
    while done < 60:
        p = random_matrix(rng, -3, 3)
        det = int_det3(p)
        if abs(det) > 40:
            continue
        q = p if det > 0 else [[-v for v in row] for row in p]
        adj = int_adjugate3(q)
        corners = [[sum(c[r] * q[r][k] for r in range(3)) for k in range(3)] for c in itertools.product((0, 1), repeat=3)]
        box = [range(min(c[k] for c in corners), max(c[k] for c in corners) + 1) for k in range(3)]
        inside = sorted((tuple(sum(n[r] * adj[r][c] for r in range(3)) for c in range(3)), n)
                        for n in itertools.product(*box)
                        if all(0 <= sum(n[r] * adj[r][c] for r in range(3)) < abs(det) for c in range(3)))
        assert supercell_lattice_points(p) == [n for _, n in inside]
        done += 1


# ------------------------------------------------------------------------------------------ cellops skeleton
def _sample() -> Structure:
    """Two atoms with everything that mark_edited drops or turns: space group, results, builder keys, vectors."""
    s = Structure(symbols=["Pt", "O"], positions=[[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]], cell=np.eye(3) * 4.0, name="Pt fcc",
                  props={"forces": [[0.1, 0.0, 0.0], [0.0, 0.2, 0.0]]},
                  info={"spacegroup": "Fm-3m", "spacegroupNumber": 225, "energy": -1.5, "a": 3.92, "prototype": "fcc"})
    for key in CARTESIAN_VECTOR_PROPS:
        s.props[key] = [[1.0, 2.0, 3.0], [-0.5, 0.25, 4.0]]
    return s


def test_cellops_module_and_result_fields():
    assert "CellOpResult" in cellops.__all__
    names = [f.name for f in dataclasses.fields(CellOpResult)]
    assert names == ["structure", "src", "index_map", "image_shift", "matrix", "label", "notes", "changed",
                     "lattice_changed", "rotation", "moved"]                 # ledger L-M1-08
    required = [f.name for f in dataclasses.fields(CellOpResult)
                if f.default is dataclasses.MISSING and f.default_factory is dataclasses.MISSING]
    assert required == ["structure", "changed", "lattice_changed"]
    s = _sample()
    r = CellOpResult(structure=s, changed=True, lattice_changed=False)
    assert (r.src, r.index_map, r.image_shift, r.matrix, r.label, r.rotation, r.moved, r.notes) == (
        None, None, None, None, None, None, 0, [])
    assert CellOpResult(structure=s, changed=False, lattice_changed=False).notes is not r.notes
    with pytest.raises(TypeError):
        CellOpResult(s, True, False)                                         # keyword arguments only
    with pytest.raises(TypeError):
        CellOpResult(structure=s, changed=True)
    with pytest.raises(TypeError):
        CellOpResult(structure=s, changed=True, lattice_changed=True, latticeChanged=True)

    @dataclasses.dataclass(kw_only=True)
    class Extended(CellOpResult):                                            # what PrimitiveResult (M1-T4) does
        orbit_of: list

    assert Extended(structure=s, changed=True, lattice_changed=True, orbit_of=[0, 0]).orbit_of == [0, 0]


def test_hook_signatures():
    assert list(inspect.signature(begin_cell_op).parameters) == ["structure"]
    assert list(inspect.signature(finish_cell_op).parameters) == ["structure", "ctx", "before"]
    s = _sample()
    before = s.to_dict()
    assert begin_cell_op(s) == {"name": "Pt fcc"}
    assert s.to_dict() == before


@pytest.mark.parametrize("kind", EDIT_KINDS)
def test_finish_cell_op_marks_like_mark_edited(kind):
    """The stub applies mark_edited(structure, ctx["mark"], rotation=ctx["rotation"]) and nothing else."""
    rot = [[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]]
    for rotation in (None, rot):
        old, out, ref = _sample(), _sample(), _sample()
        before = begin_cell_op(old)
        ctx = {"kind": "basis", "old": old, "new": out, "mark": kind, "matrix": [[1, 0, 0], [0, 1, 0], [0, 0, 1]]}
        if rotation is not None:
            ctx["rotation"] = rotation
        assert finish_cell_op(out, ctx, before) is None
        mark_edited(ref, kind, rotation=rotation)
        assert out.to_dict() == ref.to_dict()
        assert old.to_dict() == _sample().to_dict() and out.name == "Pt fcc"
    turned = _sample()
    finish_cell_op(turned, {"kind": "rotation", "old": old, "new": turned, "mark": "rotate", "rotation": rot}, before)
    assert turned.props["velocities"] == [[-2.0, 1.0, 3.0], [-0.25, -0.5, 4.0]]   # v' = v @ R.T


def test_finish_cell_op_without_mark_and_bad_context():
    s, old = _sample(), _sample()
    before = begin_cell_op(old)
    snapshot = s.to_dict()
    finish_cell_op(s, {"kind": "translate", "old": old, "new": s, "mark": None, "src": None}, before)
    assert s.to_dict() == snapshot
    bad = [
        (TypeError, "finish_cell_op: ctx must be a dict", None),
        (ValueError, "finish_cell_op: ctx needs 'kind', 'old', 'new' and 'mark' (missing 'mark')",
         {"kind": "basis", "old": old, "new": s}),
        (ValueError, "(missing 'old', 'new')", {"kind": "basis", "mark": "cell"}),
        (ValueError, "finish_cell_op: unknown kind 'twist' (use supercell, basis, primitive, rotation, deform or translate)",
         {"kind": "twist", "old": old, "new": s, "mark": "cell"}),
        (ValueError, "finish_cell_op: ctx['new'] must be the structure being finished",
         {"kind": "basis", "old": old, "new": old, "mark": "cell"}),
        (ValueError, "mark_edited: unknown kind 'cells'", {"kind": "basis", "old": old, "new": s, "mark": "cells"}),
        (ValueError, "rotation must be a 3x3 matrix of finite numbers",
         {"kind": "rotation", "old": old, "new": s, "mark": "rotate", "rotation": [[1, 0], [0, 1]]}),
    ]
    for exc, text, ctx in bad:
        with pytest.raises(exc, match=re.escape(text)):
            finish_cell_op(s, ctx, before)
        assert s.to_dict() == snapshot                                       # nothing changed


# ------------------------------------------------------------------------------------------ segments, imports
def _segments(text: str, comment: str) -> list[tuple[str, int, int]]:
    opens = [(m.group(1), m.start()) for m in re.finditer(rf"^{re.escape(comment)} --- surface-modeling (\S+) ---$", text, re.M)]
    ends = {m.group(1): m.start() for m in re.finditer(rf"^{re.escape(comment)} --- end (\S+) ---$", text, re.M)}
    assert len(ends) == len(opens) == len(re.findall(rf"^{re.escape(comment)} --- end ", text, re.M))
    return [(name, start, ends[name]) for name, start in opens]


def test_segments_for_the_later_tasks():
    """plan.md §2.2: cellops has the segments M1-T3a, M1-T3b, M1-T10 (in this order, each once, apart by a line);
    intmath ends with the empty segment M2 (for M2-T1)."""
    for name, comment in (("cellops.py", "#"), ("cellops.js", "//")):
        text = SOURCES[name].read_text(encoding="utf-8")
        segs = _segments(text, comment)
        assert [s[0] for s in segs] == ["M1-T3a", "M1-T3b", "M1-T10"], name
        assert all(start < end for _, start, end in segs)
        for (_, _, end), (_, start, _) in zip(segs, segs[1:]):
            between = text[end:start].split("\n")
            assert len(between) >= 3, name                                   # at least one line between two segments
        hooks = text[segs[2][1]:segs[2][2]]
        for hook in (("def begin_cell_op", "def finish_cell_op") if name.endswith(".py") else
                     ("export function beginCellOp", "export function finishCellOp")):
            assert hook in hooks and hook not in text[:segs[2][1]] + text[segs[2][2]:]
    for name, comment in (("intmath.py", "#"), ("intmath.js", "//")):
        text = SOURCES[name].read_text(encoding="utf-8")
        assert text.rstrip().endswith(f"{comment} --- surface-modeling M2 ---\n{comment} --- end M2 ---"), name
        assert [s[0] for s in _segments(text, comment)] == ["M2"]


def test_web_modules_import_only_what_they_may():
    """cellops.js does not import core/structure.js (ledger L-M1-08; structure.js imports it for the thin methods);
    intmath.js imports only defaults.js."""
    def imports(name):
        text = SOURCES[name].read_text(encoding="utf-8")
        return re.findall(r"""^\s*(?:import|export)\b[^'"\n]*?\bfrom\s+['"]([^'"\n]+)['"]""", text, re.M)

    assert not any("structure" in spec for spec in imports("cellops.js"))
    assert "import(" not in SOURCES["cellops.js"].read_text(encoding="utf-8")
    assert imports("intmath.js") == ["./defaults.js"]
    names =["egcd", "int_det3", "int_adjugate3", "is_unimodular", "as_int_matrix", "hermite_normal_form",
             "hermite_normal_form_2d", "supercell_lattice_points", "hnf_matrices_2d"]
    assert intmath.__all__[:len(names)] == names                            # M2-T1 appends its names in segment M2
    assert all(callable(getattr(intmath, n)) for n in intmath.__all__)
