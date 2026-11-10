"""The shared data module ``facet.core.webdata`` (M5 §4.2, ledger L-M2-06): ``facet/web/data/*.json``,
one copy read by Python through importlib.resources and by the web app through ``web/js/core/webdata.js``.

``tests/js/webdata.test.mjs`` runs the same checks on the JavaScript twin (``loadWebData``, ``webData``,
``setWebData``).  Both files hold the same JSON constant ``PARITY_CASES`` (between the BEGIN and END PARITY_CASES
lines): the data file names with the error text that both languages must give; ``test_parity_cases_are_one_constant``
checks that the two copies agree.  The last two tests read the data from an installed copy of the package and from a
zip archive of it, where the data has no file path, so that nothing depends on the checkout.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

from facet.core import webdata
from facet.core.webdata import load_web_data

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "facet"
DATA = PACKAGE / "web" / "data"
JS_TESTS = Path(__file__).resolve().parent / "js" / "webdata.test.mjs"

# BEGIN PARITY_CASES (JSON: the same constant as in tests/js/webdata.test.mjs)
PARITY_CASES = {
  "valid": ["oxidation_states.json"],
  "invalid": [
    {"name": "../oxidation_states.json", "error": "invalid data file name '../oxidation_states.json'"},
    {"name": "data/oxidation_states.json", "error": "invalid data file name 'data/oxidation_states.json'"},
    {"name": "/etc/passwd", "error": "invalid data file name '/etc/passwd'"},
    {"name": "x.json/../oxidation_states.json", "error": "invalid data file name 'x.json/../oxidation_states.json'"},
    {"name": "Oxidation_states.json", "error": "invalid data file name 'Oxidation_states.json'"},
    {"name": "oxidation-states.json", "error": "invalid data file name 'oxidation-states.json'"},
    {"name": "oxidation_states.JSON", "error": "invalid data file name 'oxidation_states.JSON'"},
    {"name": "oxidation_states", "error": "invalid data file name 'oxidation_states'"},
    {"name": "oxidation_states.json.json", "error": "invalid data file name 'oxidation_states.json.json'"},
    {"name": ".json", "error": "invalid data file name '.json'"},
    {"name": "", "error": "invalid data file name ''"},
    {"name": " oxidation_states.json", "error": "invalid data file name ' oxidation_states.json'"},
    {"name": "oxidation_states.json\n", "error": "invalid data file name 'oxidation_states.json\n'"}
  ],
  "missing": "no_such_table.json"
}
# END PARITY_CASES


def _parity_block(path: Path, comment: str) -> dict:
    text = path.read_text(encoding="utf-8")
    block = text.split(f"{comment} BEGIN PARITY_CASES", 1)[1].split(f"{comment} END PARITY_CASES", 1)[0]
    return json.loads(block.split("=", 1)[1].strip().rstrip(";"))


def test_parity_cases_are_one_constant():
    """The two copies of PARITY_CASES (here and in tests/js/webdata.test.mjs) are the same JSON constant."""
    here = _parity_block(Path(__file__), "#")
    assert here == PARITY_CASES
    assert _parity_block(JS_TESTS, "//") == here


@pytest.mark.parametrize("name", PARITY_CASES["valid"])
def test_load_web_data_reads_the_file(name):
    assert load_web_data(name) == json.loads((DATA / name).read_text(encoding="utf-8"))


def test_load_web_data_returns_deep_copies_of_one_read():
    webdata._load.cache_clear()
    first = load_web_data("oxidation_states.json")
    second = load_web_data("oxidation_states.json")
    assert first == second and first is not second
    assert first["cations"]["Fe"] is not second["cations"]["Fe"]
    first["cations"]["Fe"].append(99)
    first["anions"].clear()
    again = load_web_data("oxidation_states.json")
    assert again == second and 99 not in again["cations"]["Fe"] and again["anions"]
    assert webdata._load.cache_info().misses == 1, "the file is read and parsed once"


@pytest.mark.parametrize("case", PARITY_CASES["invalid"], ids=lambda c: repr(c["name"]))
def test_invalid_names(case):
    """Only plain file names of web/data: no directories, no other characters (the same text as the web app's)."""
    with pytest.raises(ValueError) as exc:
        load_web_data(case["name"])
    assert str(exc.value) == case["error"]


@pytest.mark.parametrize("name", [None, 5, b"oxidation_states.json", ["oxidation_states.json"]], ids=repr)
def test_names_must_be_strings(name):
    with pytest.raises(ValueError, match="^invalid data file name "):
        load_web_data(name)  # type: ignore[arg-type]


def test_a_missing_file():
    with pytest.raises(FileNotFoundError):
        load_web_data(PARITY_CASES["missing"])


def test_the_data_is_package_data():
    """pyproject.toml ships facet/web/** with the package (setuptools expands the glob from the package)."""
    tomllib = pytest.importorskip("tomllib")
    config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    globs = config["tool"]["setuptools"]["package-data"]["facet"]
    shipped = {p for g in globs for p in PACKAGE.glob(g) if p.is_file()}
    assert {DATA / name for name in PARITY_CASES["valid"]} <= shipped


def _run(code: str, *args: str, cwd: Path) -> dict:
    """Run *code* in a fresh isolated interpreter (no checkout on sys.path) and return the JSON it prints."""
    proc = subprocess.run([sys.executable, "-I", "-c", code, *args], capture_output=True, text=True,
                          encoding="utf-8", cwd=cwd, timeout=120)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def test_an_installed_package_reads_its_own_data(tmp_path: Path):
    """A copy of the package in a site directory (as pip installs it) finds the table next to itself, and the
    oxidation-state functions work from there."""
    site = tmp_path / "site-packages"
    shutil.copytree(PACKAGE, site / "facet", ignore=shutil.ignore_patterns("__pycache__"))
    got = _run(
        "import json, sys\n"
        "sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1])\n"
        "import facet\n"
        "from facet.core.webdata import load_web_data\n"
        "from facet.build.surface import estimate_oxidation_states, load_oxidation_states\n"
        "print(json.dumps({'file': facet.__file__, 'table': load_web_data('oxidation_states.json'),\n"
        "                  'loaded': load_oxidation_states(), 'SrTiO3': estimate_oxidation_states(['Sr', 'Ti', 'O', 'O', 'O'])}))\n",
        str(site), cwd=tmp_path)
    assert Path(got["file"]).is_relative_to(site)
    table = json.loads((DATA / "oxidation_states.json").read_text(encoding="utf-8"))
    assert got["table"] == table and got["loaded"] == table
    assert got["SrTiO3"] == {"Sr": 2.0, "Ti": 4.0, "O": -2.0}


def test_a_zipped_package_reads_its_data_through_importlib_resources(tmp_path: Path):
    """From a zip archive the data has no file path at all: load_web_data must go through importlib.resources."""
    archive = tmp_path / "site.zip"
    with zipfile.ZipFile(archive, "w") as z:
        for p in sorted(PACKAGE.rglob("*")):
            if p.is_file() and "__pycache__" not in p.parts:
                z.write(p, p.relative_to(ROOT).as_posix())
    got = _run(
        "import json, sys\n"
        "sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1])\n"
        "import facet\n"
        "from facet.core.webdata import load_web_data\n"
        "from facet.build.surface import load_oxidation_states\n"
        "print(json.dumps({'file': facet.__file__, 'table': load_web_data('oxidation_states.json'),\n"
        "                  'loaded': load_oxidation_states()}))\n",
        str(archive), cwd=tmp_path)
    assert Path(got["file"]).is_relative_to(archive)
    table = json.loads((DATA / "oxidation_states.json").read_text(encoding="utf-8"))
    assert got["table"] == table and got["loaded"] == table
