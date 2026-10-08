#!/usr/bin/python3
"""Restore references after Quarto's initial cleanup, before the first TeX pass.

Installed as /opt/qollab/bin/xelatex and /opt/qollab/bin/lualatex; runs the
engine it is named after."""
import json
import pathlib
import subprocess
import sys
import time

sys.path.insert(0, '/opt/qollab')
from render_cache import restore

root = pathlib.Path('/work')
engine = '/usr/bin/' + ('lualatex' if pathlib.Path(sys.argv[0]).name == 'lualatex' else 'xelatex')
tex = pathlib.Path(sys.argv[-1]).resolve() if len(sys.argv) > 1 else None
if not tex or not tex.is_relative_to(root) or tex.suffix != '.tex':
    sys.exit(subprocess.run([engine, *sys.argv[1:]]).returncode)
stats_path = root / '.qollab-tex.json'
try:
    stats = json.loads(stats_path.read_text())
except (OSError, ValueError):
    stats = {'passes': 0, 'reused': False, 'texMs': 0}
if not stats['passes']:
    try:
        stats['reused'] = restore(json.loads((root / '.qollab-aux.json').read_text()), tex)
    except (OSError, ValueError, TypeError):
        stats['reused'] = False
started = time.monotonic()
result = subprocess.run([engine, *sys.argv[1:]])
stats['passes'] += 1
stats['texMs'] += round((time.monotonic() - started) * 1000)
stats_path.write_text(json.dumps(stats))
sys.exit(result.returncode)
