"""Command-line interface tests (run in-process through ``cli.main``)."""

from __future__ import annotations

import json

import atomscope as ats
from atomscope.cli import main
from atomscope.storage import SQLiteStore

from .conftest import EXAMPLE_PLUGINS


def test_build_crystal_and_info(tmp_path, capsys):
    out = tmp_path / "out.xyz"
    assert main(["build", "crystal", "fcc", "Cu", "--a", "3.61", "--repeat", "3", "3", "3", "-o", str(out)]) == 0
    s = ats.read(out)
    assert len(s) == 108 and s.cell is not None
    capsys.readouterr()
    assert main(["info", str(out), "--json", "--bonds"]) == 0
    info = json.loads(capsys.readouterr().out)
    assert info["formula"] == "Cu108" and info["averageCoordination"] == 12.0
    assert main(["info", str(out)]) == 0
    assert "Cu108" in capsys.readouterr().out


def test_build_cluster_and_molecule(tmp_path, capsys):
    out = tmp_path / "au55.xyz"
    assert main(["build", "cluster", "icosahedron", "Au", "--size", "3", "-o", str(out)]) == 0
    assert len(ats.read(out)) == 55
    capsys.readouterr()
    assert main(["build", "molecule", "caffeine"]) == 0
    assert capsys.readouterr().out.startswith("24\n")


def test_convert(tmp_path, data_dir):
    out = tmp_path / "POSCAR"
    assert main(["convert", str(data_dir / "NaCl.cif"), str(out)]) == 0
    assert ats.read(out).formula == "Na4Cl4"
    pdb = tmp_path / "nacl.pdb"
    assert main(["convert", str(out), str(pdb), "--to", "pdb"]) == 0
    assert "CRYST1" in pdb.read_text()


def test_errors_return_nonzero(tmp_path, capsys):
    assert main(["info", str(tmp_path / "missing.xyz")]) == 1
    assert main(["build", "crystal", "nonsense"]) == 1
    assert "error" in capsys.readouterr().err


def test_user_create_and_list(tmp_path, capsys):
    data = tmp_path / "srv"
    assert main(["user", "create", "carol", "--password", "carolpass", "--data", str(data)]) == 0
    assert main(["user", "list", "--data", str(data)]) == 0
    assert "carol" in capsys.readouterr().out
    store = SQLiteStore(data / "atomscope.db")
    assert store.authenticate("carol", "carolpass") is not None
    store.close()
    assert main(["user", "create", "carol", "--password", "another1", "--data", str(data)]) == 1


def test_plugins_and_formats(capsys):
    assert main(["plugins", "--plugins", str(EXAMPLE_PLUGINS)]) == 0
    out = capsys.readouterr().out
    assert "hello 1.0.0" in out and "/api/v1/ext/hello" in out
    assert main(["formats"]) == 0
    assert "poscar" in capsys.readouterr().out
