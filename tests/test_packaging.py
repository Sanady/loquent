import os
import shutil
import subprocess
import tarfile
import tomllib
import zipfile
from pathlib import Path

import pytest

PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"
HAS_NPM = shutil.which("npm") is not None


def deps() -> dict[str, str]:
    data = tomllib.loads(PYPROJECT.read_text())
    out = {}
    for spec in data["project"]["dependencies"]:
        name = spec.split(">")[0].split("<")[0].split("=")[0].split("[")[0].strip()
        out[name] = spec[len(name) :].strip()
    return out


def test_ag_ui_protocol_is_bounded_to_major_1():
    assert deps()["ag-ui-protocol"] == ">=1.0,<2"


def test_core_dependencies_have_floors():
    d = deps()
    assert d["starlette"] == ">=1.10"
    assert d["uvicorn"] == ">=0.54"
    assert d["httpx"] == ">=0.28"
    assert d["pydantic-settings"] == ">=2.16"


def test_frontend_package_json_is_pretty_printed():
    import json

    path = PYPROJECT.parent / "frontend" / "package.json"
    text = path.read_text()
    assert text == json.dumps(json.loads(text), indent=2, ensure_ascii=False) + "\n"


ROOT = PYPROJECT.parent


def _build(kind: str, out: Path) -> Path:
    env = dict(os.environ)
    if not HAS_NPM:
        env["LOQUENT_SKIP_UI_BUILD"] = "1"
    subprocess.run(
        ["uv", "build", f"--{kind}", "--out-dir", str(out)],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    return next(out.glob("*.whl" if kind == "wheel" else "*.tar.gz"))


@pytest.fixture(scope="module")
def dists(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("dist")
    _build("wheel", out)
    _build("sdist", out)
    return out


def _metadata(dists: Path) -> str:
    wheel = next(dists.glob("*.whl"))
    with zipfile.ZipFile(wheel) as zf:
        name = next(n for n in zf.namelist() if n.endswith(".dist-info/METADATA"))
        return zf.read(name).decode()


@pytest.mark.slow
def test_wheel_metadata_and_license(dists: Path) -> None:
    meta = _metadata(dists)
    assert "License-Expression: Apache-2.0" in meta
    assert "License-File: LICENSE" in meta
    for classifier in (
        "Development Status :: 3 - Alpha",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Programming Language :: Python :: 3.13",
        "Programming Language :: Python :: 3.14",
        "Framework :: FastAPI",
        "Framework :: AsyncIO",
        "License :: OSI Approved :: Apache Software License",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
        "Topic :: Software Development :: User Interfaces",
    ):
        assert f"Classifier: {classifier}" in meta
    assert "Keywords:" in meta and "chainlit alternative" in meta
    for label, url in (
        ("Homepage", "https://github.com/Sanady/loquent"),
        ("Source", "https://github.com/Sanady/loquent"),
        ("Issues", "https://github.com/Sanady/loquent/issues"),
        ("Changelog", "https://github.com/Sanady/loquent/blob/main/CHANGELOG.md"),
    ):
        assert f"Project-URL: {label}, {url}" in meta


@pytest.mark.slow
def test_wheel_ships_static_ui(dists: Path) -> None:
    if not HAS_NPM:
        if os.environ.get("LOQUENT_REQUIRE_NPM", "").lower() in ("1", "true"):
            pytest.fail("LOQUENT_REQUIRE_NPM is set but npm is not on PATH")
        pytest.skip("npm not on PATH: wheel built without the UI")
    wheel = next(dists.glob("*.whl"))
    with zipfile.ZipFile(wheel) as zf:
        assert "loquent/server/static/index.html" in zf.namelist()


@pytest.mark.slow
def test_sdist_contains_license_and_changelog(dists: Path) -> None:
    sdist = next(dists.glob("*.tar.gz"))
    with tarfile.open(sdist) as tf:
        names = tf.getnames()
    assert any(n.endswith("/LICENSE") for n in names)
    assert any(n.endswith("/CHANGELOG.md") for n in names)
    assert not any("node_modules" in n for n in names)


@pytest.mark.slow
def test_twine_check_strict(dists: Path) -> None:
    files = [str(p) for p in (*dists.glob("*.whl"), *dists.glob("*.tar.gz"))]
    result = subprocess.run(
        ["uvx", "twine", "check", "--strict", *files],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
