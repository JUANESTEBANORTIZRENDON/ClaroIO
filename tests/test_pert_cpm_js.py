"""Runs the PERT/CPM engine tests (node:test, no extra dependencies) from the regular pytest run."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(shutil.which('node') is None, reason='Node.js is required to run the client-side engine tests')
def test_pert_cpm_engine_suite():
    files = sorted(str(path) for path in (ROOT / 'tests' / 'js').glob('*.test.mjs'))
    assert files
    run = subprocess.run(['node', '--test', *files], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    assert run.returncode == 0, run.stdout + run.stderr
