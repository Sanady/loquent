"""Hatchling build hook: bundle the prebuilt React UI into the wheel.

For a wheel (built from the repo or from the sdist) this runs ``npm ci`` and
``npm run build`` in ``frontend/``, which writes ``src/loquent/server/static/``; the
``artifacts`` setting in pyproject.toml puts that gitignored output in the wheel. Users who
install the wheel never need Node.

- ``LOQUENT_SKIP_UI_BUILD=1`` skips npm entirely (Python-only development).
- Editable installs (``uv sync``, ``pip install -e``) build the UI only if it is not built
  yet (and only warn when npm is missing), so syncing never wipes ``node_modules``
  mid-development. Rebuild by hand with ``npm --prefix frontend run build``.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

SKIP_ENV = "LOQUENT_SKIP_UI_BUILD"


class UIBuildHook(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        if self.target_name != "wheel":
            return  # the sdist ships frontend/ sources; its wheel build runs this hook
        root = Path(self.root)
        index = root / "src" / "loquent" / "server" / "static" / "index.html"
        if os.environ.get(SKIP_ENV) == "1":
            if not index.is_file():
                self.app.display_warning(
                    f"{SKIP_ENV}=1: building without the UI ({index} is missing)"
                )
            return
        if version == "editable" and index.is_file():
            return
        frontend = root / "frontend"
        if not (frontend / "package.json").is_file():
            raise RuntimeError(
                f"cannot build the UI: {frontend / 'package.json'} not found. "
                f"Build from the repository or an sdist, or set {SKIP_ENV}=1."
            )
        npm = shutil.which("npm")
        if npm is None and version == "editable":
            self.app.display_warning(
                "npm not found: installing without the UI. Install Node.js and run "
                "`npm --prefix frontend ci && npm --prefix frontend run build` to add it."
            )
            return
        if npm is None:
            raise RuntimeError(
                "cannot build the UI: npm not found on PATH. Install Node.js to build "
                f"Loquent from source, or set {SKIP_ENV}=1 to build without the UI."
            )
        for args in (["ci"], ["run", "build"]):
            self.app.display_info(f"loquent: npm {' '.join(args)} (in {frontend})")
            result = subprocess.run([npm, *args], cwd=frontend, check=False)
            if result.returncode != 0:
                raise RuntimeError(
                    f"UI build failed: `npm {' '.join(args)}` exited with {result.returncode}"
                )
        if not index.is_file():
            raise RuntimeError(f"UI build finished but {index} is missing")
