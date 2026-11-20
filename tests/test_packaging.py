import tomllib
from pathlib import Path

PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"


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
