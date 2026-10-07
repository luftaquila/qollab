#!/usr/bin/env python3
"""Job entry point: bounded JSON stdin, no credentials, one isolated /work."""
import base64, json, os, pathlib, re, shutil, subprocess, sys, time
from render_cache import capture, validate
from render_fast import Prepared
ROOT=pathlib.Path('/work')
LIMIT=250*1024*1024

def main():
    # The image contains only caches compiled from trusted Quarto code. Each
    # worker gets its own writable copy, prepared before any document arrives.
    trusted=pathlib.Path('/opt/qollab/deno-cache')
    if trusted.is_dir():shutil.copytree(trusted,ROOT/'.deno',dirs_exist_ok=True)
    os.environ['DENO_DIR']=str(ROOT/'.deno')
    os.environ['PATH']='/opt/qollab/bin:'+os.environ['PATH']
    os.environ['TEXMFVAR']=str(ROOT/'.texlive')
    # Only trusted package/font initialization runs before the snapshot arrives.
    # This process is consumed once, or killed before the regular Quarto path.
    prepared_engine=None
    try:prepared_engine=Prepared(ROOT)
    except (OSError,ValueError):pass
    raw=sys.stdin.buffer.read(360*1024*1024+1)
    started=time.monotonic()
    if len(raw)>360*1024*1024: raise ValueError('INPUT_LIMIT')
    job=json.loads(raw);total=0
    if len(job['files'])>1000:raise ValueError('FILE_COUNT')
    for f in job['files']:
        name=f['path'];p=pathlib.PurePosixPath(name)
        if p.is_absolute() or any(x in ('.','..') or x.startswith('.') for x in p.parts) or '\\' in name or ':' in name:raise ValueError('INVALID_PATH')
        if p.suffix.lower() not in ['.qmd','.md','.yml','.yaml','.bib','.csl','.png','.jpg','.jpeg','.tex']:raise ValueError('FILE_TYPE')
        data=base64.b64decode(f['bytes'],validate=True) if f.get('bytes') else f.get('source','').encode('utf-8')
        total+=len(data)
        if total>LIMIT:raise ValueError('INPUT_LIMIT')
        dest=ROOT/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
    target=pathlib.PurePosixPath(job['target'])
    if target.is_absolute() or '..' in target.parts or not str(target).endswith('.qmd'):raise ValueError('INVALID_TARGET')
    os.environ['TEXMFVAR']=str(ROOT/'.texlive')
    cache=validate(job.get('cache'))
    if cache:(ROOT/'.qollab-aux.json').write_text(json.dumps(cache))
    if prepared_engine:
        try:
            if int(job['timeout'])>=20:
                fast=prepared_engine.render(job)
                if fast:
                    fast['metrics']['totalMs']=round((time.monotonic()-started)*1000)
                    return fast
        except (OSError,ValueError,subprocess.TimeoutExpired):pass
        finally:prepared_engine.close()
    # XeTeX uses the image's fontconfig index without deserializing the large
    # Lua font tables on every pass. Keep Quarto's automatic reference reruns.
    cmd=['quarto','render',str(target),'--to','pdf','--no-execute','--no-cache','--output','qollab.pdf','-M','latex-auto-install:false','-M','latex-clean:false','-M','keep-tex:true','-M','mainfont:Noto Serif CJK KR','-M','sansfont:Noto Sans CJK KR','-M','monofont:DejaVu Sans Mono','--pdf-engine','xelatex','--pdf-engine-opt=-no-shell-escape']
    # Logs go to a bounded tmpfs file, never to an unbounded memory PIPE.
    logfile=ROOT/'render.log'
    prepared=time.monotonic()
    def execute():
        remaining=int(job['timeout'])-(time.monotonic()-started)
        if remaining<=0:raise subprocess.TimeoutExpired(cmd,job['timeout'])
        with logfile.open('wb') as out:
            return subprocess.run(cmd,cwd=ROOT,stdout=out,stderr=subprocess.STDOUT,timeout=remaining,env={**os.environ,'QUARTO_PRINT_STACK':'false','QUARTO_DISABLE_VERSION_CHECK':'true'})
    def stats():
        try:return json.loads((ROOT/'.qollab-tex.json').read_text())
        except (OSError,ValueError):return {}
    fallback=False
    try:
        result=execute()
        if result.returncode and stats().get('reused'):
            fallback=True
            (ROOT/'.qollab-aux.json').unlink(missing_ok=True)
            (ROOT/'.qollab-tex.json').unlink(missing_ok=True)
            result=execute()
    except subprocess.TimeoutExpired:return {'log':'RENDER_TIMEOUT'}
    rendered=time.monotonic()
    metrics={'prepareMs':round((prepared-started)*1000),'quartoMs':round((rendered-prepared)*1000),'texPasses':stats().get('passes',0),'texMs':stats().get('texMs',0),'reusedAux':int(bool(stats().get('reused'))),'cacheFallback':int(fallback)}
    with logfile.open('rb') as log:
        log.seek(max(0,logfile.stat().st_size-60000));text=log.read().decode('utf-8','replace')
    pdf=ROOT/target.parent/'qollab.pdf'
    if result.returncode or not pdf.is_file():
        detail=ROOT/target.with_suffix('.log')
        if detail.is_file():text+='\n'+detail.read_text(errors='replace')[-12000:]
        return {'log':text[-60000:],'metrics':metrics}
    if pdf.is_symlink() or pdf.stat().st_size>50*1024*1024:raise ValueError('OUTPUT_LIMIT')
    return {'pdf':base64.b64encode(pdf.read_bytes()).decode(),'log':text,'metrics':metrics,'cache':capture(ROOT/target.with_suffix('.tex'))}
try:
    print(json.dumps(main(),ensure_ascii=False))
except Exception as e:
    print(json.dumps({'log':str(e)}))
