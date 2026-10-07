"""Bounded, project-scoped TeX reference state. Never transports arbitrary paths."""
import base64
import hashlib
import pathlib
import re

SUFFIXES = ('.aux', '.toc', '.out', '.lof', '.lot')
LIMIT = 1024 * 1024


def validate(cache):
    try:
        if not isinstance(cache, dict) or cache.get('version') != 1:
            return None
        if not re.fullmatch('[a-f0-9]{64}', cache['preamble']):
            return None
        files = cache['files']
        if not isinstance(files, dict) or not set(files) <= set(SUFFIXES):
            return None
        size = 0
        for value in files.values():
            if not isinstance(value, str) or len(value) > LIMIT * 4 // 3 + 4:
                return None
            size += len(base64.b64decode(value, validate=True))
        return cache if size <= LIMIT else None
    except (KeyError, TypeError, ValueError):
        return None


def preamble(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * LIMIT:
        return None
    data = path.read_bytes()
    marker = re.search(rb'^\\begin\{document\}\s*$', data, re.M)
    return hashlib.sha256(data[:marker.start()]).hexdigest() if marker else None


def restore(cache, tex):
    cache = validate(cache)
    if not cache or preamble(tex) != cache['preamble']:
        return False
    for suffix, encoded in cache['files'].items():
        target = tex.with_suffix(suffix)
        if target.is_symlink():
            return False
        target.write_bytes(base64.b64decode(encoded, validate=True))
    return bool(cache['files'])


def capture(tex):
    digest = preamble(tex)
    if not digest:
        return None
    files, size = {}, 0
    for suffix in SUFFIXES:
        p = tex.with_suffix(suffix)
        if p.is_symlink():
            return None
        if p.is_file():
            size += p.stat().st_size
            if size > LIMIT:
                return None
            files[suffix] = base64.b64encode(p.read_bytes()).decode()
    return {'version': 1, 'preamble': digest, 'files': files}
