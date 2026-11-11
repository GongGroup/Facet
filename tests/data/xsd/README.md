# Materials Studio XSD: test data

Used by `tests/test_xsd.py` (Python, and both languages through the bridge) and `tests/js/io_xsd.test.mjs`.
The design is `docs/design/xsd-export/README.md`.

## Writer: `cases.json` and `<id>.xsd`

`cases.json` lists the golden cases: the input structure (`facet.structure/1`, coordinates with every digit so
both languages start from the same numbers), the expected file and the warnings and notes of the export check.
Python and JavaScript must both write each file byte for byte.

`make_xsd_cases.py` writes these files with the Python writer (`--check` compares instead; a test does the same).
The files are therefore checked without the writer as well:

- four of them are the files of `docs/design/xsd-export/samples`, written by the prototype of the design (key
  `sample`);
- an XML parser reads every file: unique IDs, no dangling references, the counts, the fixed atoms;
- the coordinates and the cell are read back and compared with the structure (same cell lengths and angles, same
  fractional coordinates, same distances, c along z and b in the yz plane);
- the rounding is compared with JavaScript's `toFixed` on its own.

To add a case, add it to `cases()` in the script and run it.

## Reader: `read/`

Small documents written by hand, with what the reader must give for each in `read/expected.json` (also written by
hand). None of them is a file from Materials Studio.

| File | Modelled on | What it checks |
|---|---|---|
| `ms_periodic.xsd` | a document saved by Materials Studio 8.0 | attribute order, child elements of atoms, bonds, compressed ID lists, image atoms under `ImageMapping` (skipped), atoms fixed through a `CompleteRestriction`, coordinates outside 0–1 |
| `ms_molecule_loose.xsd` | a document saved by Materials Studio 17.1 | atoms directly under the root, an atom without a name, exponents in numbers |
| `ms_molecule_repeatunit.xsd` | a document of format version 4.4 | atoms nested in `Molecule/RepeatUnit`, no names at all |
| `assumed_symmetry_fcc.xsd`, `assumed_symmetry_screw.xsd` | nothing: the layout is an assumption | the symmetry expansion: operators of twelve numbers, centring, image atoms, the note that asks to check the result |
| `constraints_unread.xsd` | nothing: the slider element is invented | which atoms count as fixed, and the note for the others |
| `components_and_entities.xsd` | nothing | what `Components` may hold, an atom without `XYZ`, character references, entities of a DOCTYPE (never expanded), comments and CDATA |

Three real files written by Materials Studio (the test data of gchemol-readwrite) were read with both languages
while the reader was written, with identical results; they are not part of this repository.
