"""Exact, limited fast path for the pinned default Quarto PDF format.

The image owns the conversion context and preamble. User configuration, raw
syntax and references fall back to Quarto. A preamble mismatch also falls back.
Only one snapshot is ever sent to the prepared XeTeX process.
"""
import base64
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
from render_cache import capture, restore

MATH_COMMANDS = set(('frac dfrac tfrac sqrt sum prod int iint iiint oint lim '
                     'sin cos tan log ln exp min max sup inf det '
                     'left right big Big bigg Bigg '
                     'alpha beta gamma delta epsilon varepsilon zeta eta theta '
                     'vartheta iota kappa lambda mu nu xi pi varpi rho varrho '
                     'sigma varsigma tau upsilon phi varphi chi psi omega '
                     'Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega '
                     'infty partial nabla times cdot div pm mp le leq ge geq '
                     'ne neq approx equiv sim simeq propto in notin subset '
                     'subseteq supset supseteq cup cap emptyset forall exists '
                     'to rightarrow leftarrow leftrightarrow Rightarrow '
                     'Leftarrow Leftrightarrow mapsto '
                     'mathrm mathbf mathit mathsf mathtt mathbb mathcal text '
                     'overline underline hat widehat bar vec dot ddot '
                     'overbrace underbrace ldots cdots vdots ddots '
                     'quad qquad sin cos tan').split())


def eligible(job):
    target = job.get('target', '')
    if not re.fullmatch(r'[\w-]+\.qmd', target):
        return False
    files = job.get('files', [])
    if any(Path(f['path']).suffix.lower() not in ('.qmd', '.png', '.jpg', '.jpeg') for f in files):
        return False
    source = next((f.get('source') for f in files if f['path'] == target), None)
    if not isinstance(source, str) or len(source.encode()) > 100_000:
        return False
    # Fail closed around Quarto preprocessing, executable/raw syntax, metadata,
    # references and features whose initialization depends on document analysis.
    if re.search(r'@|<|`|~~~|\^\^|\{\{|:::|\[\^|\{#|^\s*(---|\+\+\+)\s*$', source, re.M):
        return False
    for command in re.findall(r'\\([a-zA-Z]+|[^\n])', source):
        if command not in MATH_COMMANDS and command not in ('{', '}', '_', '%', '$', '#', '&', ',', ';', ':', '!', ' '):
            return False
    return True


class Prepared:
    def __init__(self, root=Path('/work'), trusted=Path('/opt/qollab')):
        self.root, self.trusted = root, trusted
        self.process = None
        self.output = None
        self.control = None
        self.context = None
        self.dir = root / '.qollab-fast'
        context_file = trusted / 'pandoc-context.json'
        library = trusted / 'warm-input.so'
        if not context_file.is_file() or not library.is_file():
            return
        self.context = json.loads(context_file.read_text())
        self.dir.mkdir()
        (self.dir / 'qollab-body.tex').touch()
        self.preamble = self.context['preamble']
        (self.dir / 'prepared.tex').write_text(
            self.preamble + '\\begin{document}\n\\input{qollab-body.tex}\n')
        self.output = (self.dir / 'stdout.log').open('wb')
        self.control = (self.dir / 'control.log').open('wb')
        self.process = subprocess.Popen([
            '/usr/bin/xelatex', '-interaction=nonstopmode', '-halt-on-error',
            '-no-shell-escape', '-jobname=output', 'prepared.tex',
        ], cwd=self.dir, stdin=subprocess.PIPE, stdout=self.output,
            stderr=self.control, start_new_session=True,
            env={**os.environ, 'LD_PRELOAD': str(library)})

    def close(self):
        if self.process:
            if self.process.poll() is None:
                try:os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:pass
            self.process.wait()
            self.process.stdin.close()
        if self.output:
            self.output.close()
        if self.control:
            self.control.close()

    def render(self, job):
        if not self.process or not eligible(job) or self.process.poll() is not None:
            return None
        start = time.monotonic()
        context_dir = self.root / '.qollab-pandoc'
        target = job['target']
        def replace(value):
            return (value.replace(self.context['session'], str(context_dir))
                    .replace('warmup.qmd', target))
        for name, encoded in self.context['files'].items():
            path = Path(replace(name))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(replace(base64.b64decode(encoded).decode()))
        args = [replace(arg) for arg in self.context['args']]
        input_path = next(Path(arg) for arg in args if arg.endswith('.md'))
        input_path.write_text((self.root / target).read_text())
        output_path = self.dir / 'converted.tex'
        args[args.index('--output') + 1] = str(output_path)
        env = {**os.environ, **{k: replace(v) for k, v in self.context['env'].items()}}
        params = replace(base64.b64decode(env['QUARTO_FILTER_PARAMS']).decode())
        env['QUARTO_FILTER_PARAMS'] = base64.b64encode(params.encode()).decode()
        env.update(QUARTO_DOCUMENT_FILE=target, QUARTO_DOCUMENT_PATH=str(self.root),
                   QUARTO_PROJECT_DIR=str(self.root), QUARTO_PROJECT_ROOT=str(self.root))
        binary = next(Path('/opt/quarto/bin/tools').glob('*/pandoc'), None)
        binary = binary or Path('/opt/quarto/bin/tools/pandoc')
        log_path = self.dir / 'pandoc.log'
        with log_path.open('wb') as log:
            result = subprocess.run([str(binary), *args], cwd=self.root, env=env,
                                    stdout=log, stderr=subprocess.STDOUT, timeout=10)
        if result.returncode:
            return None
        tex = output_path.read_text()
        if '\\begin{document}' not in tex:
            return None
        preamble, body = tex.split('\\begin{document}', 1)
        if preamble != self.preamble:
            return None
        converted = time.monotonic()
        # Hard links stay inside this disposable filesystem; no host mount is
        # used and user content is never written into the trusted image.
        for f in job['files']:
            path = self.dir / f['path']
            path.parent.mkdir(parents=True, exist_ok=True)
            os.link(self.root / f['path'], path)
        # Only reuse inert longtable column dimensions. Loading an arbitrary aux
        # file after begin-document would change LaTeX package initialization.
        seed = ''
        if restore(job.get('cache'), output_path):
            aux = output_path.with_suffix('.aux')
            if aux.is_file():
                text = aux.read_text(errors='replace')
                entries = re.findall(
                    r'\\gdef\s*\\LT@[ivxlcdm]+\s*\{(?:\\LT@entry\s*\{\d+\}\s*\{[\d.]+pt\}\s*)+\}', text)
                seed = '\\makeatletter\n' + '\n'.join(entries) + '\n\\makeatother\n'
        (self.dir / 'qollab-body.tex').write_text(seed + body)
        self.process.stdin.write(b'G')
        self.process.stdin.close()
        self.process.wait(timeout=10)
        end = time.monotonic()
        pdf = self.dir / 'output.pdf'
        if self.process.returncode or not pdf.is_file() or pdf.stat().st_size > 50 * 1024 * 1024:
            return None
        # Undefined references / multi-pass content must never be published as
        # a completed PDF. Unreferenced auto-generated heading labels are safe.
        log = (self.dir / 'output.log').read_text(errors='replace')[-60000:]
        if re.search(r'undefined references|undefined citations|Table widths have changed', log):
            return None
        (self.dir / 'output.tex').write_text(tex)
        return {'pdf': base64.b64encode(pdf.read_bytes()).decode(), 'log': log,
                'cache': capture(self.dir / 'output.tex'),
                'metrics': {'fastPath': 1, 'pandocMs': round((converted-start)*1000),
                            'texMs': round((end-converted)*1000), 'texPasses': 1}}
