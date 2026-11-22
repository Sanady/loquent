"""The README's commands, settings, snippets, sections and badges, checked against the code."""

import ast
import importlib
import re
from pathlib import Path

import pytest

from loquent.cli import main
from loquent.settings import Settings

README = (Path(__file__).resolve().parent.parent / "README.md").read_text(encoding="utf-8")
# `--lq-*` and `--lqi-*` are CSS variables, not flags.
FLAG = re.compile(r"(?<![\w-])--(?!lqi?-)[a-z][a-z-]*")
# Flags of other tools' command lines that the README shows. Each belongs to the named tool.
FOREIGN_FLAGS = {
    "--enable-auto-tool-choice",  # vllm serve
    "--tool-call-parser",  # vllm serve
    "--api-key",  # vllm serve
    "--prefix",  # npm --prefix frontend
    "--run",  # npm test -- --run (vitest)
}
RAW_SCREENSHOT = (
    "https://raw.githubusercontent.com/Sanady/loquent/main/docs/assets/loquent-chat.png"
)


def _help(capsys, *argv: str) -> str:
    assert main([*argv, "--help"]) == 0
    return capsys.readouterr().out


def _python_blocks() -> list[str]:
    return re.findall(r"^```python\n(.*?)^```", README, flags=re.DOTALL | re.MULTILINE)


def test_every_documented_cli_flag_exists(capsys):
    helps = {
        "loquent serve": _help(capsys, "serve"),
        "loquent user add": _help(capsys, "user", "add"),
    }
    checked = 0
    for line in README.splitlines():
        mentions = sorted(
            (m.start(), command) for command in helps for m in re.finditer(command, line)
        )
        if not mentions:
            continue
        for flag in FLAG.finditer(line):
            # A flag belongs to the closest command mentioned before it on the line; a flag
            # before every mention must belong to one of the commands on the line.
            before = [command for pos, command in mentions if pos < flag.start()]
            owners = before[-1:] or [command for _, command in mentions]
            assert any(
                re.search(rf"(?<![\w-]){flag.group()}(?![\w-])", helps[c]) for c in owners
            ), f"{flag.group()} (README line {line!r}) is not a flag of {owners}"
            checked += 1
    assert checked >= 5

    # Every flag anywhere in the README is a Loquent flag or a known flag of another tool.
    ours = "\n".join(helps.values())
    for flag in set(FLAG.findall(README)):
        assert flag in FOREIGN_FLAGS or re.search(rf"(?<![\w-]){flag}(?![\w-])", ours), (
            f"{flag} is neither a loquent flag nor in FOREIGN_FLAGS"
        )

    # The settings table's "CLI flag" column names `loquent serve` flags too.
    rows = [line for line in README.splitlines() if re.match(r"\| `\w+` \| `LOQUENT_", line)]
    assert rows
    for row in rows:
        cli_column = row.split("|")[3]
        for flag in FLAG.findall(cli_column):
            assert re.search(rf"(?<![\w-]){flag}(?![\w-])", helps["loquent serve"]), row


def test_every_documented_env_var_is_a_setting():
    known = {f"LOQUENT_{name.upper()}" for name in Settings.model_fields}
    known |= {"LOQUENT_SKIP_UI_BUILD", "LOQUENT_TEST_MONGO_URL"}
    documented = set(re.findall(r"LOQUENT_[A-Z0-9_]+", README))
    assert documented
    assert documented <= known, f"not settings: {sorted(documented - known)}"


def test_python_snippets_compile():
    blocks = _python_blocks()
    assert len(blocks) >= 5
    for src in blocks:
        compile(src, "README", "exec")


def test_python_imports_resolve():
    # Ruling P1: only imports of loquent itself are executed; illustrative imports of the
    # reader's own modules (my_project.agent, ...) are skipped.
    def ours(module: str) -> bool:
        return module == "loquent" or module.startswith("loquent.")

    ran = 0
    for src in _python_blocks():
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.ImportFrom) and ours(node.module or ""):
                module = importlib.import_module(node.module)
                for alias in node.names:  # `from m import x`: an attribute or a submodule
                    if not hasattr(module, alias.name):
                        importlib.import_module(f"{node.module}.{alias.name}")
                ran += 1
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if ours(alias.name):
                        importlib.import_module(alias.name)
                        ran += 1
    assert ran >= 5


@pytest.mark.parametrize(
    "heading",
    [
        "## Quickstart",
        "## Coming from Chainlit?",
        "## Use with OpenAI, Ollama, vLLM and AG-UI agents",
        "## Loquent vs Chainlit, Gradio and Open WebUI",
        "## FAQ",
    ],
)
def test_required_sections_present(heading):
    assert re.search(rf"^{re.escape(heading)}", README, flags=re.MULTILINE), heading


def test_badges_and_screenshot():
    assert "actions/workflows/ci.yml/badge.svg" in README
    assert "img.shields.io/pypi/v/loquent" in README
    assert "img.shields.io/pypi/pyversions/loquent" in README
    assert "img.shields.io/github/license/Sanady/loquent" in README
    assert re.search(rf"!\[[^\]]{{20,}}\]\({re.escape(RAW_SCREENSHOT)}\)", README)
    shot = Path(__file__).resolve().parent.parent / "docs" / "assets" / "loquent-chat.png"
    assert shot.is_file()
    assert shot.stat().st_size < 400 * 1024


def test_links_are_absolute_or_anchors():
    # PyPI renders the README too, and it resolves no relative links or images.
    prose = re.sub(r"^```.*?^```", "", README, flags=re.DOTALL | re.MULTILINE)
    targets = re.findall(r"\]\(([^)\s]*)", prose)
    assert len(targets) >= 10
    bad = [t for t in targets if not t.startswith(("http://", "https://", "#"))]
    assert not bad, f"relative link targets: {bad}"


def test_in_page_anchors_resolve():
    def slug(heading: str) -> str:  # GitHub's heading anchors
        return re.sub(r"[^\w\- ]", "", heading.strip().lower()).replace(" ", "-")

    prose = re.sub(r"^```.*?^```", "", README, flags=re.DOTALL | re.MULTILINE)
    anchors = {slug(h) for h in re.findall(r"^#{1,6} (.+)$", prose, flags=re.MULTILINE)}
    for target in re.findall(r"\]\(#([^)\s]*)", prose):
        assert target in anchors, f"#{target} matches no heading"
