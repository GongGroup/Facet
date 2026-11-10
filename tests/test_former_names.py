"""Facet was called Crystallume, and before that AtomScope: what was written for either name keeps working."""

from __future__ import annotations

import importlib
import subprocess
import sys
import warnings

import pytest

from .conftest import ROOT


@pytest.mark.parametrize("old", ["crystallume", "atomscope"])
def test_former_package_names_import(old):
    import facet
    import facet.core.structure

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        package = importlib.import_module(old)
        structure = importlib.import_module(f"{old}.core.structure")
        io = importlib.import_module(f"{old}.io")
    assert package is facet and structure is facet.core.structure and io is facet.io
    assert facet.core.structure.__spec__.name == "facet.core.structure"


@pytest.mark.parametrize("old", ["crystallume", "atomscope"])
def test_former_package_names_warn_once_imported(old):
    code = f"import warnings; warnings.simplefilter('error'); import {old}"
    done = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert done.returncode != 0 and f"the '{old}' package is now called 'facet'" in done.stderr


@pytest.mark.parametrize("old", ["crystallume", "atomscope"])
def test_former_names_run_as_modules(old):
    done = subprocess.run([sys.executable, "-W", "ignore", "-m", old, "--help"], cwd=ROOT, capture_output=True,
                          text=True, encoding="utf-8")
    assert done.returncode == 0 and "serve" in done.stdout


def test_both_command_names_are_installed():
    import tomllib

    scripts = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]["scripts"]
    assert scripts == {"facet": "facet.cli:main", "crystallume": "facet.cli:main"}


@pytest.mark.parametrize("old", ["crystallume", "atomscope"])
def test_former_name_documents_still_load(old):
    from facet import Structure
    from facet.project import normalize_project

    s = Structure.from_dict({"schema": f"{old}.structure/1", "symbols": ["H"], "positions": [[0, 0, 0]]})
    assert len(s) == 1 and s.to_dict()["schema"] == "facet.structure/1"
    doc = normalize_project({"schema": f"{old}.project/1", "name": "old", "structures": []})
    assert doc["schema"] == "facet.project/1"


def test_environment_variables_newest_name_wins(tmp_path):
    from facet.config import Settings

    s = Settings.from_env({"CRYSTALLUME_PORT": "9123", "FACET_MODE": "local", "CRYSTALLUME_DATA_DIR": str(tmp_path)})
    assert s.port == 9123 and s.data_dir == tmp_path
    assert Settings.from_env({"ATOMSCOPE_PORT": "9001", "CRYSTALLUME_PORT": "9002"}).port == 9002
    assert Settings.from_env({"ATOMSCOPE_PORT": "9001", "CRYSTALLUME_PORT": "9002", "FACET_PORT": "9003"}).port == 9003
    assert Settings.from_env({"ATOMSCOPE_PORT": "9001"}).port == 9001


def test_default_data_folder_prefers_an_existing_one(tmp_path, monkeypatch):
    from facet import config

    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    assert config._default_data_dir() == tmp_path / ".facet"            # nothing there yet: the new name
    (tmp_path / ".atomscope").mkdir()
    assert config._default_data_dir() == tmp_path / ".atomscope"
    (tmp_path / ".crystallume").mkdir()
    assert config._default_data_dir() == tmp_path / ".crystallume"      # the newer of the two former names
    (tmp_path / ".facet").mkdir()
    assert config._default_data_dir() == tmp_path / ".facet"


def test_cloud_database_of_a_former_name_is_kept(tmp_path):
    from facet.config import Settings
    from facet.storage.sqlite import SQLiteStore

    def with_user(name, user):
        db = SQLiteStore(tmp_path / name, secret="x" * 32)
        db.create_user(user, "correct horse battery")
        db.close()

    s = Settings(mode="cloud", data_dir=tmp_path)
    assert s.db_path == tmp_path / "facet.db"
    with_user("atomscope.db", "alice")
    assert s.db_path == tmp_path / "atomscope.db"
    with_user("crystallume.db", "bob")
    assert s.db_path == tmp_path / "crystallume.db"          # the newer of the two former names
    SQLiteStore(tmp_path / "facet.db", secret="x" * 32).close()
    assert s.db_path == tmp_path / "crystallume.db"          # an empty facet.db from an earlier start does not hide it
    with_user("facet.db", "carol")
    assert s.db_path == tmp_path / "facet.db"                # a facet.db that holds data wins


def _fake_plugin(site, name, groups):
    (site / name).mkdir(parents=True)
    (site / name / "__init__.py").write_text(f"PLUGIN = {{'name': '{name}'}}\ndef register(ctx):\n    pass\n", encoding="utf-8")
    dist = site / f"{name}-0.1.dist-info"
    dist.mkdir()
    (dist / "METADATA").write_text(f"Metadata-Version: 2.1\nName: {name}\nVersion: 0.1\n", encoding="utf-8")
    (dist / "entry_points.txt").write_text("".join(f"[{g}]\n{name} = {name}\n\n" for g in groups), encoding="utf-8")


@pytest.mark.parametrize("groups", [["crystallume.plugins"], ["atomscope.plugins"],
                                    ["facet.plugins", "crystallume.plugins", "atomscope.plugins"]])
def test_plugins_registered_under_former_names_load_once(tmp_path, monkeypatch, groups):
    from facet.plugins import PluginManager

    name = "oldplug" + str(len(groups))
    _fake_plugin(tmp_path / "site", name, groups)
    monkeypatch.syspath_prepend(str(tmp_path / "site"))
    try:
        mgr = PluginManager([], use_entry_points=True).load_all()
        assert [r.status for r in mgr.records if r.name == name] == ["loaded"]
    finally:
        sys.modules.pop(name, None)


def test_local_token_message_names_the_variable_in_use(monkeypatch, capsys):
    from facet.config import Settings
    from facet.server import print_banner

    def banner():
        print_banner(Settings.from_env(mode="local"))
        out = capsys.readouterr()
        return out.out + out.err

    for name in ("FACET_TOKEN", "CRYSTALLUME_TOKEN", "ATOMSCOPE_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CRYSTALLUME_TOKEN", "t" * 32)
    assert Settings.from_env(mode="local").token == "t" * 32
    assert "the CRYSTALLUME_TOKEN value" in banner()
    monkeypatch.setenv("FACET_TOKEN", "u" * 32)
    assert Settings.from_env(mode="local").token == "u" * 32
    assert "the FACET_TOKEN value" in banner()
