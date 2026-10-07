"""Build native code caches from a trusted fixture, without retaining documents."""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess

source='# Cache warmup\n\n한글 **English** and $E=mc^2$.\n\n| A | B |\n|---|---|\n| 한글 | 표 |\n'
job={'target':'warmup.qmd','timeout':120,'files':[{'path':'warmup.qmd','source':source}]}
r=subprocess.run(['python3','/opt/qollab/render.py'],input=json.dumps(job).encode(),capture_output=True,check=True,timeout=150,env={**os.environ,'HOME':'/work'})
result=json.loads(r.stdout)
assert result.get('pdf'),result.get('log')
dest=Path('/opt/qollab/deno-cache');dest.mkdir()
# Snapshot only Deno's code/dependency databases; never copy Quarto localStorage.
for name in ['v8_code_cache_v2','dep_analysis_cache_v2','node_analysis_cache_v2']:
    src=Path('/work/.deno')/name
    assert src.is_file(),name
    with sqlite3.connect(src) as source_db,sqlite3.connect(dest/name) as target_db:source_db.backup(target_db)
    (dest/name).chmod(0o644)
for p in Path('/work').iterdir():
    shutil.rmtree(p) if p.is_dir() else p.unlink()
print('Trusted Quarto code cache:',sum(p.stat().st_size for p in dest.iterdir()),'bytes')
