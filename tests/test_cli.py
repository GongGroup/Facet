"""Command-line interface tests (run in-process through ``cli.main``)."""

from __future__ import annotations

import json
import os

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


HELLO = "HELLO tiny chain\nCu 0 0 0\nCu 2.5 0 0\n"


def test_plugin_formats_on_the_command_line(tmp_path, capsys, monkeypatch):
    src = tmp_path / "t.hello"
    src.write_text(HELLO)
    out = tmp_path / "out.xyz"
    assert main(["convert", str(src), str(out), "--plugins", str(EXAMPLE_PLUGINS)]) == 0
    assert ats.read(out).formula == "Cu2"
    capsys.readouterr()
    assert main(["info", str(src), "--json", "--plugins", str(EXAMPLE_PLUGINS)]) == 0
    assert json.loads(capsys.readouterr().out)["natoms"] == 2
    assert main(["formats", "--plugins", str(EXAMPLE_PLUGINS)]) == 0
    assert "[plugin hello]" in capsys.readouterr().out
    # ATOMSCOPE_PLUGIN_DIRS is the fallback for --plugins
    monkeypatch.setenv("ATOMSCOPE_PLUGIN_DIRS", str(EXAMPLE_PLUGINS))
    back = tmp_path / "back.hello"
    assert main(["convert", str(out), str(back)]) == 0
    assert back.read_text().startswith("HELLO")


def test_build_custom_and_analyze(tmp_path, capsys):
    plugins = ["--plugins", str(EXAMPLE_PLUGINS)]
    out = tmp_path / "chain.xyz"
    assert main(["build", "custom", "hello-chain", "--param", "n=5", "--param", "element=Ag", "-o", str(out), *plugins]) == 0
    assert ats.read(out).formula == "Ag5"
    capsys.readouterr()
    assert main(["build", "custom", *plugins]) == 0
    assert "hello-chain" in capsys.readouterr().out
    assert main(["analyze", "hello-com", str(out), *plugins]) == 0
    res = json.loads(capsys.readouterr().out)
    assert abs(res["centerOfMass"][0] - 5.2) < 1e-6
    assert main(["analyze", "coordination", str(out)]) == 0
    assert json.loads(capsys.readouterr().out)["average"] > 0
    assert main(["analyze", "rdf", str(out), "--param", "rmax=5", "--param", "nbins=10"]) == 0
    assert len(json.loads(capsys.readouterr().out)["g"]) == 10
    assert main(["analyze", "missing", str(out), *plugins]) == 1
    assert "available" in capsys.readouterr().err
    assert main(["build", "custom", "hello-chain", "--param", "n", *plugins]) == 1


def test_plugins_option_before_positionals(tmp_path, capsys):
    # --plugins takes one DIR per flag, so it may come before the positional arguments
    src = tmp_path / "t.hello"
    src.write_text(HELLO)
    out = tmp_path / "out.xyz"
    assert main(["convert", "--plugins", str(EXAMPLE_PLUGINS), str(src), str(out)]) == 0
    assert ats.read(out).formula == "Cu2"
    capsys.readouterr()
    assert main(["analyze", "--plugins", str(EXAMPLE_PLUGINS), "hello-com", str(out)]) == 0
    assert "centerOfMass" in json.loads(capsys.readouterr().out)
    # repeated flags and os.pathsep-joined lists both add directories
    empty = tmp_path / "none"
    empty.mkdir()
    assert main(["info", "--plugins", str(empty), "--plugins", str(EXAMPLE_PLUGINS), str(src), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["natoms"] == 2
    assert main(["info", "--plugins", os.pathsep.join([str(empty), str(EXAMPLE_PLUGINS)]), str(src), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["natoms"] == 2


def test_plugins_new_scaffolds_a_loadable_plugin(tmp_path, capsys):
    assert main(["plugins", "new", "demo", "--dir", str(tmp_path)]) == 0
    assert (tmp_path / "demo" / "plugin.py").is_file() and (tmp_path / "demo" / "static" / "demo.js").is_file()
    assert "created plugin 'demo'" in capsys.readouterr().out
    assert main(["plugins", "--plugins", str(tmp_path), "--json"]) == 0
    (rec,) = json.loads(capsys.readouterr().out)
    assert rec["status"] == "loaded" and rec["analyses"] == ["demo-count"] and rec["frontend"] == ["plugins/demo/demo.js"]
    assert rec["presets"]["styles"] == ["demo-look"]
    # refuses to overwrite, rejects bad names
    assert main(["plugins", "new", "demo", "--dir", str(tmp_path)]) == 1
    assert main(["plugins", "new", "bad name", "--dir", str(tmp_path)]) == 1


def test_serve_passes_root_path(monkeypatch):
    seen = {}
    import atomscope.server as server

    monkeypatch.setattr(server, "serve", lambda **kw: seen.update(kw))
    assert main(["serve", "--root-path", "/atomscope", "--port", "9999"]) == 0
    assert seen["root_path"] == "/atomscope" and seen["settings"].port == 9999
