"""The ci-ok gate script, fed sample `toJSON(needs)` payloads."""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / ".github" / "scripts" / "ci_ok.sh"
JOBS = [
    "lint",
    "pr-title",
    "frontend",
    "test",
    "mongo",
    "e2e",
    "build",
    "wheel-smoke",
    "slow",
    "release-config",
]

pytestmark = pytest.mark.skipif(
    sys.platform == "win32" or shutil.which("jq") is None or shutil.which("bash") is None,
    reason="needs bash and jq (the gate runs on ubuntu)",
)


def needs(**overrides: str) -> str:
    results = dict.fromkeys(JOBS, "success") | overrides
    return json.dumps({job: {"result": result, "outputs": {}} for job, result in results.items()})


def run(payload: str, event: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT), payload, event], capture_output=True, text=True, check=False
    )


def test_all_success_passes():
    assert run(needs(), "pull_request").returncode == 0


def test_failure_fails():
    result = run(needs(test="failure"), "push")
    assert result.returncode == 1
    assert "test: failure" in result.stderr


def test_cancelled_fails():
    result = run(needs(e2e="cancelled"), "pull_request")
    assert result.returncode == 1
    assert "e2e: cancelled" in result.stderr


def test_skipped_test_job_fails():
    result = run(needs(test="skipped"), "push")
    assert result.returncode == 1
    assert "test: skipped" in result.stderr


def test_pr_title_skipped_on_push_passes():
    assert run(needs(**{"pr-title": "skipped"}), "push").returncode == 0


@pytest.mark.parametrize("event", ["workflow_dispatch", "workflow_call"])
def test_pr_title_skipped_outside_pull_requests_passes(event: str):
    assert run(needs(**{"pr-title": "skipped"}), event).returncode == 0


def test_pr_title_skipped_on_pull_request_fails():
    result = run(needs(**{"pr-title": "skipped"}), "pull_request")
    assert result.returncode == 1
    assert "pr-title: skipped" in result.stderr
