#!/usr/bin/env python3
"""Build trusted LuaTeX font data once per native image architecture.

LuaLaTeX documents (pdf-engine: lualatex) would otherwise rebuild the
luaotfload names database and convert each font on every job. The cache comes
from this fixed document only and is copied into each LuaLaTeX job.
"""
import json
import os
import pathlib
import shutil
import subprocess

work = pathlib.Path('/work')
# The default fonts, Pretendard and kotex (luatexko) for Hangul and Hanja.
source = r'''---
pdf-engine: lualatex
header-includes: |
  \usepackage{kotex}
  \newfontfamily\pretendard{Pretendard}
  \newfontfamily\pretendardb{Pretendard Bold}
  \setmainhanjafont{Noto Sans CJK KR}
---

# Qollab LuaLaTeX

English and 한글, 漢字, **굵게 Bold**, *기울임 Italic*, `monospace 123`.

```{=latex}
{\pretendard 프리텐다드 Pretendard} {\pretendardb 굵게 Bold}
```

$$E=mc^2 \qquad \int_0^1 x^2 dx=\frac{1}{3}$$
'''
job = {'target': 'warmup.qmd', 'timeout': 300,
       'files': [{'path': 'warmup.qmd', 'source': source}]}
result = subprocess.run(
    ['python3', '/opt/qollab/render.py'], input=json.dumps(job).encode(),
    capture_output=True, check=True, timeout=320,
    env={**os.environ, 'HOME': '/work'},
)
output = json.loads(result.stdout)
if not output.get('pdf'):
    raise RuntimeError(output.get('log', 'LuaTeX warmup failed'))
cache = work / '.texlive'
assert list(cache.rglob('luaotfload-names.*')), 'No font names cache'
for name in ('notoserifcjk', 'notosanscjk', 'pretendard-regular', 'pretendard-bold'):
    assert list(cache.rglob(name + '*.luc')), 'No font cache for ' + name
destination = pathlib.Path('/opt/qollab/tex-cache')
shutil.move(cache, destination)
for path in [destination, *destination.rglob('*')]:
    path.chmod(0o755 if path.is_dir() else 0o644)
for path in work.iterdir():
    shutil.rmtree(path) if path.is_dir() else path.unlink()
print('Trusted LuaTeX font cache:', sum(p.stat().st_size for p in destination.rglob('*') if p.is_file()), 'bytes')
