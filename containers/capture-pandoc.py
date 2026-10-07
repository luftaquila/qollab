#!/usr/bin/env python3
"""Image-build-only capture of the pinned Quarto defaults and template files.

Never installed as a runtime command. Only the trusted warmup fixture reaches
this wrapper; captured environment variables are explicitly selected.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys

args = sys.argv[1:]
if '--defaults' in args:
    defaults = Path(args[args.index('--defaults') + 1])
    session = next(p for p in defaults.parents if p.name.startswith('quarto-session'))
    files = {}
    for p in session.rglob('*'):
        if p.is_file() and 'project-cache' not in p.parts:
            data = p.read_bytes()
            if len(data) > 1024 * 1024:
                raise ValueError('CAPTURE_LIMIT')
            files[str(p)] = base64.b64encode(data).decode()
    keys = ['QUARTO_FILTER_PARAMS', 'QUARTO_EXECUTE_INFO',
            'QUARTO_FILTER_DEPENDENCY_FILE', 'QUARTO_BIN_PATH',
            'QUARTO_SHARE_PATH', 'QUARTO_ROOT', 'LUA_CPATH']
    Path('/work/pandoc-context.json').write_text(json.dumps({
        'args': args, 'env': {k: os.environ[k] for k in keys if k in os.environ},
        'session': str(session), 'files': files,
    }))
binary = next(Path('/opt/quarto/bin/tools').glob('*/pandoc'), None)
binary = binary or Path('/opt/quarto/bin/tools/pandoc')
sys.exit(subprocess.call([str(binary), *args]))
