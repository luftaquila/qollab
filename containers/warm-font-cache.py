#!/usr/bin/env python3
"""Build trusted LuaTeX font data once for each native image architecture."""
import json
import os
import pathlib
import shutil
import subprocess

work = pathlib.Path('/work')
source = '''# Qollab 한글 PDF

English and 한글, **굵게 Bold**, *기울임 Italic*, `monospace 123`.

| 항목 | 결과 |
|---|---|
| 한글 | 미리보기 |

$$E=mc^2 \\qquad \\int_0^1 x^2 dx=\\frac{1}{3}$$
'''
job = {'target': 'warmup.qmd', 'timeout': 180,
       'files': [{'path': 'warmup.qmd', 'source': source}]}
result = subprocess.run(
    ['python3', '/opt/qollab/render.py'], input=json.dumps(job).encode(),
    capture_output=True, check=True, timeout=200,
    env={**os.environ, 'HOME': '/work', 'TEXMFVAR': '/work/.texlive'},
)
output = json.loads(result.stdout)
if not output.get('pdf'):
    raise RuntimeError(output.get('log', 'Font warmup failed'))
cache = work / '.texlive'
assert list(cache.rglob('luaotfload-names.*')), 'No font names cache'
assert list(cache.rglob('notoserifcjk-regular*.luc')), 'No Korean font cache'
destination = pathlib.Path('/opt/qollab/tex-cache')
shutil.move(cache, destination)
for path in [destination, *destination.rglob('*')]:
    path.chmod(0o755 if path.is_dir() else 0o644)
for path in work.iterdir():
    shutil.rmtree(path) if path.is_dir() else path.unlink()
print('Trusted font cache prepared:', sum(p.stat().st_size for p in destination.rglob('*') if p.is_file()), 'bytes')
