// Exact integer lattice arithmetic (core/intmath.js, M1 §3.2) and the skeleton of core/cellops.js (cellOpResult and
// the two hooks of plan.md P-05). tests/test_intmath.py runs the same checks on the Python twins. Both files hold the
// same JSON constant PARITY_CASES (between the BEGIN and END PARITY_CASES lines): inputs with the exact results, or the
// error message, that both languages must give, so that each language asserts the same results; the Python test
// checks that the two copies agree and compares the two languages item by item on random inputs through the Node
// bridge. This file adds the overflow guard of the Number arithmetic (RangeError beyond the safe integers).
// Run: node --test tests/js/intmath.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  asIntMatrix, egcd, hermiteNormalForm, hermiteNormalForm2d, hnfMatrices2d, intAdjugate3, intDet3, isUnimodular,
  supercellLatticePoints,
} from '../../crystallume/web/js/core/intmath.js';
import { beginCellOp, cellOpResult, finishCellOp } from '../../crystallume/web/js/core/cellops.js';
import { CARTESIAN_VECTOR_PROPS, EDIT_KINDS, Structure, markEdited } from '../../crystallume/web/js/core/structure.js';
import { SURFACE_DEFAULTS } from '../../crystallume/web/js/core/defaults.js';
import { repoPath } from './helpers.mjs';

const OVERFLOW = 'integer overflow in lattice arithmetic';
/** The seven matrices of M1 §3.2 (see tests/test_intmath.py). */
const SEVEN = [
  [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
  [[2, 1, 0], [-1, 1, 0], [0, 0, 1]],
  [[1, 1, 0], [-1, 1, 0], [0, 0, 2]],
  [[-3, 1, 1], [-1, -1, 3], [1, 1, 1]],
  [[1, 0, 0], [0, 1, 0], [37, 0, 1]],
  [[3, 1, 0], [-1, 2, 0], [0, 0, 1]],
  [[5, 2, 1], [-1, 3, 2], [2, -1, 4]],
];

// BEGIN PARITY_CASES (JSON: the same constant as in tests/test_intmath.py)
const PARITY_CASES = {
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
    {"m": [[1, 0.5], [0, 1]], "what": "lattice matrix", "error": "the lattice matrix must contain whole numbers"},
    {"m": [2, 1.00000002, 2], "error": "the matrix must contain whole numbers"},
    {"m": [2, "2", 2], "error": "the matrix must contain whole numbers"},
    {"m": [1001, 2.5, 1], "what": "supercell matrix", "error": "the supercell matrix must contain whole numbers"},
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
    {"rows": [[2, 1, 0], [-1, 1, 0], [0, 0, 1], [3, 0, 0], [0, 6, 2]], "hnf": [[1, 2, 0], [0, 3, 0], [0, 0, 1]]},
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
      "points": [[0, 0, 0], [0, 2, 3], [1, 1, 4], [0, 1, 1], [1, 0, 2], [1, 2, 5], [0, 2, 2], [1, 1, 3], [2, 0, 4],
        [1, 0, 1], [1, 2, 4], [2, 1, 5], [1, 1, 2], [2, 0, 3], [0, 3, 2], [1, 2, 3], [2, 1, 4], [1, 1, 1],
        [2, 0, 2], [2, 2, 5], [1, 2, 2], [2, 1, 3], [3, 0, 4], [1, 3, 3], [2, 2, 4], [3, 1, 5], [2, 1, 2],
        [3, 0, 3], [1, 3, 2], [2, 2, 3], [3, 1, 4], [2, 1, 1], [2, 3, 4], [3, 2, 5], [2, 2, 2], [3, 1, 3],
        [4, 0, 4], [2, 3, 3], [3, 2, 4], [4, 1, 5], [3, 1, 2], [3, 3, 5], [2, 3, 2], [3, 2, 3], [4, 1, 4],
        [3, 1, 1], [3, 3, 4], [4, 2, 5], [3, 2, 2], [4, 1, 3], [4, 3, 6], [3, 3, 3], [4, 2, 4], [5, 1, 5],
        [4, 1, 2], [4, 3, 5], [3, 3, 2], [4, 2, 3], [5, 1, 4], [3, 4, 3], [4, 3, 4], [5, 2, 5], [4, 2, 2],
        [5, 1, 3], [5, 3, 6], [4, 3, 3], [5, 2, 4], [6, 1, 5], [4, 4, 4], [5, 3, 5], [4, 3, 2], [5, 2, 3],
        [6, 1, 4], [4, 4, 3], [5, 3, 4], [6, 2, 5], [5, 2, 2], [5, 4, 5], [6, 3, 6], [5, 3, 3], [6, 2, 4]]
    },
    {"P": [[2, 1], [-1, 1]], "points": [[0, 0, 0], [0, 1, 0], [1, 1, 0]]},
    {"P": [[0, 1, 0], [1, 0, 0], [0, 0, 2]], "points": [[0, 0, 0], [0, 0, -1]]},
    {"P": [[-2, -1, 0], [1, -1, 0], [0, 0, -1]], "points": [[0, 0, 0], [0, 1, 0], [1, 1, 0]]},
    {
      "P": [[3, -1, -1], [-1, -1, 3], [1, 1, 1]],
      "points": [[0, 0, 0], [0, 0, -1], [0, 0, -2], [0, 0, -3], [-1, 0, 0], [-1, 0, -1], [-1, 0, -2], [0, 1, -2],
        [-2, 0, 0], [-2, 0, -1], [-1, 1, -1], [-1, 1, -2], [-3, 0, 0], [-2, 1, 0], [-2, 1, -1], [-2, 1, -2]]
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
        [[1, 5], [0, 6]], [[2, 0], [0, 3]], [[2, 1], [0, 3]], [[2, 2], [0, 3]], [[3, 0], [0, 2]], [[3, 1], [0, 2]],
        [[6, 0], [0, 1]]]
    },
    {
      "n": 7,
      "matrices": [[[1, 0], [0, 7]], [[1, 1], [0, 7]], [[1, 2], [0, 7]], [[1, 3], [0, 7]], [[1, 4], [0, 7]],
        [[1, 5], [0, 7]], [[1, 6], [0, 7]], [[7, 0], [0, 1]]]
    },
    {
      "n": 12,
      "matrices": [[[1, 0], [0, 12]], [[1, 1], [0, 12]], [[1, 2], [0, 12]], [[1, 3], [0, 12]], [[1, 4], [0, 12]],
        [[1, 5], [0, 12]], [[1, 6], [0, 12]], [[1, 7], [0, 12]], [[1, 8], [0, 12]], [[1, 9], [0, 12]],
        [[1, 10], [0, 12]], [[1, 11], [0, 12]], [[2, 0], [0, 6]], [[2, 1], [0, 6]], [[2, 2], [0, 6]],
        [[2, 3], [0, 6]], [[2, 4], [0, 6]], [[2, 5], [0, 6]], [[3, 0], [0, 4]], [[3, 1], [0, 4]], [[3, 2], [0, 4]],
        [[3, 3], [0, 4]], [[4, 0], [0, 3]], [[4, 1], [0, 3]], [[4, 2], [0, 3]], [[6, 0], [0, 2]], [[6, 1], [0, 2]],
        [[12, 0], [0, 1]]]
    },
    {"n": 0, "error": "the sublattice index must be a positive integer (got 0)"},
    {"n": -6, "error": "the sublattice index must be a positive integer (got -6)"}
  ]
};
// END PARITY_CASES

// ----------------------------------------------------------------------------------------------------- helpers
/** A seeded generator of uniform numbers in [0, 1) (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const sigma = (n) => { let s = 0; for (let d = 1; d <= n; d++) if (n % d === 0) s += d; return s; };
const matmul = (a, b) => a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const neg = (m) => m.map((row) => row.map((v) => -v + 0));
const det2 = (m) => m[0][0] * m[1][1] - m[0][1] * m[1][0];
const lexLess = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function randomUnimodular(r, dim = 3, steps = 6) {
  const u = Array.from({ length: dim }, (_, i) => Array.from({ length: dim }, (__, j) => Number(i === j)));
  for (let s = 0; s < steps; s++) {
    const i = randInt(r, 0, dim - 1);
    let j = randInt(r, 0, dim - 2);
    if (j >= i) j += 1;
    if (r() < 0.2) [u[i], u[j]] = [u[j], u[i]];
    else { const f = randInt(r, -3, 3); u[i] = u[i].map((v, c) => v + f * u[j][c]); }
  }
  return u;
}

function randomMatrix(r, lo = -4, hi = 4, nonsingular = true) {
  for (;;) {
    const m = [0, 1, 2].map(() => [0, 1, 2].map(() => randInt(r, lo, hi)));
    if (!nonsingular || intDet3(m) !== 0) return m;
  }
}

function checkHermite(h, d) {
  for (let i = 0; i < d; i++) {
    assert.ok(h[i][i] > 0);
    for (let j = 0; j < i; j++) assert.equal(h[i][j], 0);
    for (let j = i + 1; j < d; j++) assert.ok(h[i][j] >= 0 && h[i][j] < h[j][j]);
  }
}

/** Whether integer `row` is an integer combination of the rows of the Hermite form `h` (back substitution). */
function inLattice(row, h) {
  let r = row.slice();
  for (let j = 0; j < h.length; j++) {
    if (r[j] % h[j][j] !== 0) return false;
    const q = r[j] / h[j][j];
    r = r.map((v, c) => v - q * h[j][c]);
  }
  return r.every((v) => v === 0);
}

/** The integer keys n · adj(p) of lattice points (det(p) times their new fractional coordinates). */
function keysOf(points, p) {
  const A = intAdjugate3(p);
  return points.map((n) => [0, 1, 2].map((c) => n[0] * A[0][c] + n[1] * A[1][c] + n[2] * A[2][c]));
}

/** A ValueError of the Python twin: a plain Error with exactly this message. */
const valueError = (message) => (e) => e.constructor === Error && e.message === message;
const typeError = (message) => (e) => e instanceof TypeError && e.message === message;
const overflow = (e) => e instanceof RangeError && e.message === OVERFLOW;

// -------------------------------------------------------------------------------------------------- parity cases
describe('parity cases (the same constant as the Python tests)', () => {
  const opts = (c) => ({ ...(c.what !== undefined ? { what: c.what } : {}), ...(c.plane !== undefined ? { plane: c.plane } : {}) });
  const RUN = {
    egcd: (c) => egcd(c.a, c.b),
    det3: (c) => [intDet3(c.m), intAdjugate3(c.m)],
    as_int_matrix: (c) => asIntMatrix(c.m, opts(c)),
    hermite_normal_form: (c) => hermiteNormalForm(c.rows),
    hermite_normal_form_2d: (c) => hermiteNormalForm2d(c.m),
    supercell_lattice_points: (c) => supercellLatticePoints(c.P),
    hnf_matrices_2d: (c) => hnfMatrices2d(c.n),
  };
  const EXPECT = {
    egcd: (c) => c.gxy, det3: (c) => [c.det, c.adjugate], as_int_matrix: (c) => c.matrix, hermite_normal_form: (c) => c.hnf,
    hermite_normal_form_2d: (c) => c.abc, supercell_lattice_points: (c) => c.points, hnf_matrices_2d: (c) => c.matrices,
  };
  for (const section of Object.keys(PARITY_CASES)) {
    test(section, () => {
      for (const c of PARITY_CASES[section]) {
        if ('error' in c) assert.throws(() => RUN[section](c), valueError(c.error), JSON.stringify(c));
        else assert.deepEqual(RUN[section](c), EXPECT[section](c), JSON.stringify(c));
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------------------- egcd
describe('egcd', () => {
  test("Bezout's identity, the gcd and the coefficient bounds", () => {
    const r = rng(5);
    const pairs = Array.from({ length: 5000 }, () => [randInt(r, -1e6, 1e6), randInt(r, -1e6, 1e6)]);
    for (let a = -12; a <= 12; a++) for (let b = -12; b <= 12; b++) pairs.push([a, b]);
    for (const [a, b] of pairs) {
      const [g, x, y] = egcd(a, b);
      assert.equal(a * x + b * y, g);
      assert.equal(g, gcd(a, b));
      if (g) assert.ok(Math.abs(x) <= Math.max(1, Math.floor(Math.abs(b) / g)) && Math.abs(y) <= Math.max(1, Math.floor(Math.abs(a) / g)));
    }
    assert.deepEqual(egcd(240, 46), [2, -9, 47]);
    assert.deepEqual(egcd(0, 0), [0, 1, 0]);
    assert.deepEqual(egcd(-4, 0), [4, -1, 0]);
  });

  test('integers only, as in Python (booleans, text and fractions of one are refused)', () => {
    assert.deepEqual(egcd(12.0, 18), [6, -1, 1]);
    for (const [bad, shown] of [[2.5, '2.5'], [true, 'true'], ['3', '"3"'], [null, 'null'], [NaN, 'NaN'], [Infinity, 'Infinity'], [undefined, 'undefined']]) {
      assert.throws(() => egcd(bad, 1), typeError(`egcd needs integers (got ${shown})`));
      assert.throws(() => intDet3([[bad, 0, 0], [0, 1, 0], [0, 0, 1]]), typeError(`intDet3 needs integers (got ${shown})`));
    }
  });
});

// -------------------------------------------------------------------------------------------- determinant, adjugate
describe('determinant and adjugate', () => {
  test('m · adj = adj · m = det · I on random matrices', () => {
    const r = rng(11);
    for (let t = 0; t < 500; t++) {
      const m = randomMatrix(r, -20, 20, false);
      const d = intDet3(m), A = intAdjugate3(m);
      const I3 = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? d : 0)));
      assert.deepEqual(matmul(m, A), I3);
      assert.deepEqual(matmul(A, m), I3);
    }
    assert.equal(intDet3(SEVEN[3]), 16);
    assert.deepEqual(intAdjugate3(SEVEN[1]), [[1, -1, 0], [1, 2, 0], [0, 0, 3]]);
  });

  test('isUnimodular', () => {
    for (const m of [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 1, 0], [1, 0, 0], [0, 0, 1]], SEVEN[4], [[1, 0, 0], [0, 1, 0], [0, 0, -1]]]) {
      assert.equal(isUnimodular(m), true);
    }
    for (const m of [SEVEN[1], SEVEN[0], [[1, 2, 3], [4, 5, 6], [7, 8, 9]]]) assert.equal(isUnimodular(m), false);
    const r = rng(3);
    for (let t = 0; t < 200; t++) assert.equal(isUnimodular(randomUnimodular(r)), true);
  });

  test('typed arrays are read; shapes are checked; the input is not changed', () => {
    const m = [Int32Array.of(-3, 1, 1), Float64Array.of(-1, -1, 3), [1, 1, 1]];
    assert.equal(intDet3(m), 16);
    assert.deepEqual(m[0], Int32Array.of(-3, 1, 1));
    for (const bad of [[[1, 0], [0, 1]], [[1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 1], [0, 0, 1]], 'abc', 5, null, [1, 2, 3]]) {
      for (const [fn, name] of [[intDet3, 'intDet3'], [intAdjugate3, 'intAdjugate3'], [isUnimodular, 'isUnimodular']]) {
        assert.throws(() => fn(bad), typeError(`${name} needs a 3×3 matrix of integers`));
      }
    }
    assert.throws(() => hermiteNormalForm([[1, 0, 0], [0, 1]]), typeError('hermiteNormalForm needs rows of 3 integers'));
    assert.throws(() => hermiteNormalForm2d([[1, 0, 0], [0, 1, 0]]), typeError('hermiteNormalForm2d needs rows of 2 integers'));
    assert.throws(() => hermiteNormalForm([[1, 0, 0], [0, 1, 0], [0, 0, 0.5]]), typeError('hermiteNormalForm needs integers (got 0.5)'));
  });
});

// ----------------------------------------------------------------------------------------------------- asIntMatrix
describe('asIntMatrix', () => {
  test('three repeats, a 2×2 matrix in any plane, a 3×3 matrix', () => {
    assert.deepEqual(asIntMatrix([2, 2, 1]), [[2, 0, 0], [0, 2, 0], [0, 0, 1]]);
    assert.deepEqual(asIntMatrix(Int32Array.of(3, 1, 2)), [[3, 0, 0], [0, 1, 0], [0, 0, 2]]);
    for (const [i, j] of [[0, 1], [1, 0], [0, 2], [2, 0], [1, 2], [2, 1]]) {
      const out = asIntMatrix([[2, 1], [-1, 1]], { plane: [i, j] });
      const k = 3 - i - j;
      assert.deepEqual(out[k], [0, 1, 2].map((c) => Number(c === k)));
      assert.deepEqual([out[0][k], out[1][k], out[2][k]], [0, 1, 2].map((rr) => Number(rr === k)));
      assert.deepEqual([out[i][i], out[i][j], out[j][i], out[j][j]], [2, 1, -1, 1]);
      assert.equal(intDet3(out), 3);
    }
    const src = [[1, 0, 0], [0, 1, 0], [37, 0, 1]];
    const out = asIntMatrix(src);
    assert.deepEqual(out, src);
    assert.ok(out !== src && out[2] !== src[2]);
    assert.deepEqual(asIntMatrix([[2.000000001, 1, 0], [-1, 0.9999999995, 0], [0, 0, 1]]), [[2, 1, 0], [-1, 1, 0], [0, 0, 1]]);
    assert.ok(Object.is(asIntMatrix([-1e-9, 1, 1])[0][0], 0));         // never −0
  });

  test('the messages of M1 §3.17 (E-SC0, E-SC0b) and the limit max_matrix_entry', () => {
    const limit = SURFACE_DEFAULTS.maxMatrixEntry ?? 1000;
    assert.equal(limit, 1000);
    assert.equal(asIntMatrix([-limit, limit, 1])[0][0], -limit);
    const what = 'supercell matrix';
    for (const bad of [[limit + 1, 1, 1], [[1, 0], [0, -limit - 1]], [[5000, 0, 0], [0, 1, 0], [0, 0, 1]]]) {
      assert.throws(() => asIntMatrix(bad, { what }), valueError(`${what} entries must be between -${limit} and ${limit}`));
    }
    for (const bad of [[2.5, 1, 1], [NaN, 1, 1], [Infinity, 1, 1], [1, 1, 2 + 2e-8], [[1, true], [0, 1]], [null, 1, 1]]) {
      assert.throws(() => asIntMatrix(bad, { what }), valueError(`the ${what} must contain whole numbers`));
    }
    for (const bad of [[1, 2], [[1, 2, 3]], [[1, 2], [3, 4], [5, 6]], [1, [2], 3], 7, null, '1 1 1', { a: 1 }]) {
      assert.throws(() => asIntMatrix(bad, { what }), valueError(`the ${what} must be 3×3, 2×2 (in-plane) or three repeats`));
    }
    assert.throws(() => asIntMatrix([1, 2]), valueError('the matrix must be 3×3, 2×2 (in-plane) or three repeats'));
    for (const plane of [[0, 0], [0, 3], [1], [true, 2], [0.5, 1], '01', null]) {
      assert.throws(() => asIntMatrix([[1, 0], [0, 1]], { plane }), valueError('the plane must be two different cell axes out of 0, 1 and 2'));
    }
    assert.deepEqual(asIntMatrix([1, 1, 1], { plane: [2.0, 0] })[0], [1, 0, 0]);
  });
});

// --------------------------------------------------------------------------------------------- Hermite normal form
describe('Hermite normal form', () => {
  test('the same for every basis and set of rows of the lattice', () => {
    const r = rng(17);
    for (let t = 0; t < 300; t++) {
      const p = randomMatrix(r);
      const h = hermiteNormalForm(p);
      checkHermite(h, 3);
      assert.equal(h[0][0] * h[1][1] * h[2][2], Math.abs(intDet3(p)));
      for (const row of p) assert.ok(inLattice(row, h));
      assert.deepEqual(hermiteNormalForm(matmul(randomUnimodular(r), p)), h);
      const coefficients = Array.from({ length: randInt(r, 1, 4) }, () => [0, 1, 2].map(() => randInt(r, -3, 3)));
      const rows = p.concat(matmul(coefficients, p));
      for (let i = rows.length - 1; i > 0; i--) { const j = randInt(r, 0, i); [rows[i], rows[j]] = [rows[j], rows[i]]; }
      assert.deepEqual(hermiteNormalForm(rows), h);
    }
    assert.deepEqual(hermiteNormalForm(SEVEN[1]), [[1, 2, 0], [0, 3, 0], [0, 0, 1]]);
  });

  test('negative inputs; rows of rank below 3; the input is not changed', () => {
    assert.deepEqual(hermiteNormalForm([[-2, 0, 0], [0, -3, 0], [0, 0, -1]]), [[2, 0, 0], [0, 3, 0], [0, 0, 1]]);
    assert.deepEqual(hermiteNormalForm(neg(SEVEN[2])), hermiteNormalForm(SEVEN[2]));
    const rows = [[-3, 1, 1], [-1, -1, 3], [1, 1, 1]];
    const before = JSON.stringify(rows);
    hermiteNormalForm(rows);
    assert.equal(JSON.stringify(rows), before);
    for (const bad of [[[1, 0, 0], [0, 1, 0], [1, 1, 0]], [[1, 0, 0], [0, 1, 0]], [], [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], [[1, 2, 3], [2, 4, 6], [3, 6, 9]]]) {
      assert.throws(() => hermiteNormalForm(bad), valueError('the rows do not span three dimensions'));
    }
  });

  test('hermiteNormalForm2d', () => {
    const r = rng(23);
    for (let t = 0; t < 300; t++) {
      let m;
      do m = [0, 1].map(() => [0, 1].map(() => randInt(r, -9, 9))); while (det2(m) === 0);
      const [a, b, c] = hermiteNormalForm2d(m);
      assert.ok(a > 0 && c > 0 && b >= 0 && b < c && a * c === Math.abs(det2(m)));
      const e = hermiteNormalForm([[...m[0], 0], [...m[1], 0], [0, 0, 1]]);
      assert.deepEqual([a, b, c], [e[0][0], e[0][1], e[1][1]]);
      assert.deepEqual(hermiteNormalForm2d(matmul(randomUnimodular(r, 2), m)), [a, b, c]);
    }
    assert.deepEqual(hermiteNormalForm2d([[2, 1], [-1, 1]]), [1, 2, 3]);
    assert.deepEqual(hermiteNormalForm2d([[2, 0], [0, 2], [1, 1]]), [1, 1, 2]);
    for (const bad of [[[1, 2], [2, 4]], [[0, 0], [0, 0]], [[1, 1]]]) {
      assert.throws(() => hermiteNormalForm2d(bad), valueError('the rows do not span two dimensions'));
    }
  });

  test('hnfMatrices2d: hnfMatrices2d(6) and σ(n) sublattices, ascending i then j', () => {
    assert.deepEqual(hnfMatrices2d(6), [
      [[1, 0], [0, 6]], [[1, 1], [0, 6]], [[1, 2], [0, 6]], [[1, 3], [0, 6]], [[1, 4], [0, 6]], [[1, 5], [0, 6]],
      [[2, 0], [0, 3]], [[2, 1], [0, 3]], [[2, 2], [0, 3]],
      [[3, 0], [0, 2]], [[3, 1], [0, 2]],
      [[6, 0], [0, 1]],
    ]);
    for (let n = 1; n <= 60; n++) {
      const ms = hnfMatrices2d(n);
      assert.equal(ms.length, sigma(n));
      const keys = ms.map(hermiteNormalForm2d);
      assert.deepEqual(keys, ms.map((m) => [m[0][0], m[0][1], m[1][1]]));
      for (let k = 1; k < keys.length; k++) assert.ok(lexLess(keys[k - 1], keys[k]) < 0);
    }
    for (const bad of [0, -6]) assert.throws(() => hnfMatrices2d(bad), valueError(`the sublattice index must be a positive integer (got ${bad})`));
    for (const [bad, shown] of [[2.5, '2.5'], [true, 'true'], ['6', '"6"'], [null, 'null']]) {
      assert.throws(() => hnfMatrices2d(bad), typeError(`the sublattice index must be a positive integer (got ${shown})`));
    }
  });
});

// -------------------------------------------------------------------------------------------------- lattice points
describe('supercellLatticePoints', () => {
  test('a diagonal matrix gives the image order of Structure.repeat (positions and source map)', () => {
    const cell = [[3, 0, 0], [1.2, 2.8, 0], [0.4, -0.3, 4.1]];
    const s = new Structure({ symbols: ['Pt', 'O', 'Pt'], positions: [[0.1, 0.2, 0.3], [1.5, 1.1, 2.0], [2.2, 0.4, 3.3]], cell });
    for (const reps of [[2, 2, 2], [3, 1, 2], [1, 1, 1]]) {
      const pts = supercellLatticePoints(reps);
      const order = [];
      for (let i = 0; i < reps[0]; i++) for (let j = 0; j < reps[1]; j++) for (let k = 0; k < reps[2]; k++) order.push([i, j, k]);
      assert.deepEqual(pts, order);
      assert.deepEqual(supercellLatticePoints([[reps[0], 0, 0], [0, reps[1], 0], [0, 0, reps[2]]]), order);
      const r = s.repeat(...reps);
      const n = s.length;
      assert.equal(r.length, n * pts.length);
      assert.deepEqual(Array.from(r.sourceMap), pts.flatMap(() => [0, 1, 2]));
      pts.forEach((p, q) => {
        for (let a = 0; a < n; a++) {
          for (let c = 0; c < 3; c++) {
            const want = s.positions[3 * a + c] + p[0] * cell[0][c] + p[1] * cell[1][c] + p[2] * cell[2][c];
            assert.ok(Math.abs(r.positions[3 * (q * n + a) + c] - want) <= 1e-12);
          }
        }
      });
    }
  });

  for (const p of SEVEN) {
    test(`|det P| points inside the new cell, one per coset, sorted: det ${intDet3(p)}`, () => {
      const pts = supercellLatticePoints(p);
      const det = intDet3(p);
      assert.equal(pts.length, Math.abs(det));
      assert.deepEqual(pts[0], [0, 0, 0]);
      const keys = keysOf(pts, p);
      for (const key of keys) for (const k of key) assert.ok(k >= 0 && k < det);
      for (let i = 1; i < keys.length; i++) assert.ok(lexLess(keys[i - 1], keys[i]) < 0);
      const h = hermiteNormalForm(p);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) assert.ok(!inLattice([0, 1, 2].map((c) => pts[i][c] - pts[j][c]), h));
      }
    });
  }

  test('a negative determinant gives the points of −P', () => {
    const r = rng(29);
    const mats = SEVEN.map(neg).concat(SEVEN.map((m) => [m[1], m[0], m[2]]));
    while (mats.length < 40) {
      const m = randomMatrix(r, -3, 3);
      if (intDet3(m) < 0) mats.push(m);
    }
    for (const q of mats) {
      const det = intDet3(q);
      assert.ok(det < 0);
      const pts = supercellLatticePoints(q);
      assert.deepEqual(pts, supercellLatticePoints(neg(q)));
      assert.equal(pts.length, -det);
      for (const key of keysOf(pts, neg(q))) for (const k of key) assert.ok(k >= 0 && k < -det);
    }
  });

  test('shapes and errors', () => {
    assert.deepEqual(supercellLatticePoints([[2, 1], [-1, 1]]), [[0, 0, 0], [0, 1, 0], [1, 1, 0]]);
    assert.equal(supercellLatticePoints([10, 10, 10]).length, 1000);
    for (const bad of [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], [2, 0, 1], [[1, 2], [2, 4]]]) {
      assert.throws(() => supercellLatticePoints(bad), valueError('the supercell matrix is singular (determinant 0)'));
    }
    assert.throws(() => supercellLatticePoints([2, 2, 1.5]), valueError('the supercell matrix must contain whole numbers'));
  });

  test('random matrices against a brute-force search of the bounding box', () => {
    const r = rng(31);
    for (let done = 0; done < 60;) {
      const p = randomMatrix(r, -3, 3);
      const det = intDet3(p);
      if (Math.abs(det) > 40) continue;
      const q = det > 0 ? p : neg(p);
      const corners = [];
      for (const c0 of [0, 1]) for (const c1 of [0, 1]) for (const c2 of [0, 1]) corners.push([0, 1, 2].map((k) => c0 * q[0][k] + c1 * q[1][k] + c2 * q[2][k]));
      const lo = [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k])));
      const hi = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k])));
      const inside = [];
      for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
        const [key] = keysOf([[i, j, k]], q);
        if (key.every((v) => v >= 0 && v < Math.abs(det))) inside.push([key, [i, j, k]]);
      }
      inside.sort((x, y) => lexLess(x[0], y[0]));
      assert.deepEqual(supercellLatticePoints(p), inside.map((e) => e[1].map((v) => v + 0)));
      done += 1;
    }
  });
});

// ------------------------------------------------------------------------------------------------- overflow guard
describe('overflow guard (Number.isSafeInteger)', () => {
  test('products and inputs beyond the safe integers throw RangeError', () => {
    const big = 2 ** 26;
    assert.throws(() => intDet3([[big, 0, 0], [0, big, 0], [0, 0, big]]), overflow);
    assert.throws(() => intAdjugate3([[2 ** 27, 0, 0], [0, 2 ** 27, 0], [0, 0, 1]]), overflow);
    assert.throws(() => isUnimodular([[big, 0, 0], [0, big, 0], [0, 0, big]]), overflow);
    assert.throws(() => intDet3([[2 ** 53, 0, 0], [0, 1, 0], [0, 0, 1]]), overflow);
    assert.throws(() => egcd(2 ** 53, 1), overflow);
    assert.throws(() => egcd(1, -(2 ** 60)), overflow);
    const t = 2 ** 40;
    assert.throws(() => hermiteNormalForm([[t + 1, t, 0], [t, t - 1, 0], [0, 0, 1]]), overflow);   // Python: the identity
    assert.throws(() => hermiteNormalForm2d([[t + 1, t], [t, t - 1]]), overflow);
    assert.throws(() => hnfMatrices2d(2 ** 53), overflow);
  });

  test('exact up to the limit: floor quotients and remainders without rounding', () => {
    const max = Number.MAX_SAFE_INTEGER;
    assert.deepEqual(egcd(max, max - 1), [1, 1, -1]);
    assert.deepEqual(egcd(max, 2), [1, 1, -(2 ** 52 - 1)]);
    assert.deepEqual(egcd(-max, 1e6), [1, -250111, -2252799612802524]);
    assert.equal(intDet3([[2 ** 26, 0, 0], [0, 2 ** 26, 0], [0, 0, 1]]), 2 ** 52);
    // the largest matrix entries cannot overflow the lattice points (|key| ≤ 6·10^9)
    assert.deepEqual(supercellLatticePoints([[1000, 999, 0], [999, 998, 0], [0, 0, 1]]), [[0, 0, 0]]);
    assert.equal(supercellLatticePoints([[1000, 0, 0], [0, 1, 0], [0, 0, -1]]).length, 1000);
  });
});

// ----------------------------------------------------------------------------------------------- cellops skeleton
function sample() {
  const s = new Structure({
    name: 'Pt fcc', symbols: ['Pt', 'O'], positions: [[0, 0, 0], [1, 1, 1]], cell: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
    props: { forces: [[0.1, 0, 0], [0, 0.2, 0]] },
    info: { spacegroup: 'Fm-3m', spacegroupNumber: 225, energy: -1.5, a: 3.92, prototype: 'fcc' },
  });
  for (const key of CARTESIAN_VECTOR_PROPS) s.setProp(key, [[1, 2, 3], [-0.5, 0.25, 4]]);
  return s;
}

describe('cellops skeleton', () => {
  test('cellOpResult: the fields of CellOpResult in camelCase, three required, defaults for the others', () => {
    const s = sample();
    const r = cellOpResult({ structure: s, changed: true, latticeChanged: false });
    assert.deepEqual(Object.keys(r), ['structure', 'src', 'indexMap', 'imageShift', 'matrix', 'label', 'notes', 'changed',
      'latticeChanged', 'rotation', 'moved']);
    assert.equal(r.structure, s);
    assert.deepEqual([r.src, r.indexMap, r.imageShift, r.matrix, r.label, r.rotation, r.moved, r.notes], [null, null, null, null, null, null, 0, []]);
    assert.notEqual(cellOpResult({ structure: s, changed: false, latticeChanged: false }).notes, r.notes);
    const full = { structure: s, src: Int32Array.of(0, 1), indexMap: null, imageShift: null, matrix: [[2, 0, 0], [0, 2, 0], [0, 0, 1]],
      label: '2×2×1', notes: ['a note'], changed: true, latticeChanged: true, rotation: null, moved: 3 };
    assert.deepEqual(cellOpResult(full), full);
    assert.throws(() => cellOpResult({ structure: s, changed: true }), typeError('cellOpResult needs latticeChanged'));
    assert.throws(() => cellOpResult({ changed: true, lattice_changed: true }), typeError("cellOpResult: unknown field 'lattice_changed'"));
    assert.throws(() => cellOpResult(null), TypeError);
  });

  test('beginCellOp returns the name and changes nothing', () => {
    const s = sample();
    const rev = s.rev, json = JSON.stringify(s.toJSON());
    assert.deepEqual(beginCellOp(s), { name: 'Pt fcc' });
    assert.equal(s.rev, rev);
    assert.equal(JSON.stringify(s.toJSON()), json);
  });

  test('finishCellOp marks the result exactly like markEdited, for every kind, with and without a rotation', () => {
    const R = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
    for (const kind of EDIT_KINDS) {
      for (const rotation of [null, R]) {
        const old = sample(), out = sample(), ref = sample();
        const before = beginCellOp(old);
        const ctx = { kind: 'basis', old, new: out, mark: kind, matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
        if (rotation) ctx.rotation = rotation;
        const r0 = out.rev, q0 = ref.rev;
        assert.equal(finishCellOp(out, ctx, before), undefined);
        markEdited(ref, kind, { rotation });
        assert.deepEqual(out.toJSON(), ref.toJSON(), `${kind} ${rotation ? 'with' : 'without'} a rotation`);
        assert.equal(out.rev - r0, ref.rev - q0);
        assert.equal(out.name, 'Pt fcc');
        assert.deepEqual(old.toJSON(), sample().toJSON());
      }
    }
    const turned = sample();
    finishCellOp(turned, { kind: 'rotation', old: sample(), new: turned, mark: 'rotate', rotation: R }, { name: 'Pt fcc' });
    assert.deepEqual(turned.props.velocities, [[-2, 1, 3], [-0.25, -0.5, 4]]);
  });

  test('finishCellOp without a mark changes nothing; a bad ctx throws before anything changes', () => {
    const s = sample(), old = sample();
    const before = beginCellOp(old);
    const json = JSON.stringify(s.toJSON()), rev = s.rev;
    finishCellOp(s, { kind: 'translate', old, new: s, mark: null, src: null }, before);
    assert.equal(JSON.stringify(s.toJSON()), json);
    assert.equal(s.rev, rev);
    const cases = [
      [TypeError, 'finishCellOp: ctx must be an object', null],
      [Error, "finishCellOp: ctx needs 'kind', 'old', 'new' and 'mark' (missing 'mark')", { kind: 'basis', old, new: s }],
      [Error, "finishCellOp: ctx needs 'kind', 'old', 'new' and 'mark' (missing 'old', 'new')", { kind: 'basis', mark: 'cell' }],
      [Error, "finishCellOp: unknown kind 'twist' (use supercell, basis, primitive, rotation, deform or translate)", { kind: 'twist', old, new: s, mark: 'cell' }],
      [Error, 'finishCellOp: ctx.new must be the structure being finished', { kind: 'basis', old, new: old, mark: 'cell' }],
      [RangeError, "markEdited: unknown kind 'cells' (use order, translate, rotate, positions, atoms, symbols, repeat, cell or pbc)", { kind: 'basis', old, new: s, mark: 'cells' }],
      [Error, 'rotation must be a 3x3 matrix of finite numbers', { kind: 'rotation', old, new: s, mark: 'rotate', rotation: [[1, 0], [0, 1]] }],
    ];
    for (const [cls, message, ctx] of cases) {
      assert.throws(() => finishCellOp(s, ctx, before), (e) => e.constructor === cls && e.message === message, message);
      assert.equal(JSON.stringify(s.toJSON()), json);
      assert.equal(s.rev, rev);
    }
  });

  test('cellops.js does not import core/structure.js (ledger L-M1-08)', () => {
    const text = readFileSync(repoPath('crystallume/web/js/core/cellops.js'), 'utf8');
    const specs = [...text.matchAll(/^\s*(?:import|export)\b[^'"\n]*?\bfrom\s+['"]([^'"\n]+)['"]/gm)].map((m) => m[1]);
    assert.ok(!specs.some((spec) => spec.includes('structure')), specs.join(', '));
    assert.ok(!text.includes('import('));
  });
});
