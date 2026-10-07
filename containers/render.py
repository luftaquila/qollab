#!/usr/bin/env python3
"""Job entry point: bounded JSON stdin, no credentials, one isolated /work."""
import base64, json, os, pathlib, re, subprocess, sys
ROOT=pathlib.Path('/work')
LIMIT=250*1024*1024

def main():
    raw=sys.stdin.buffer.read(360*1024*1024+1)
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
    cmd=['quarto','render',str(target),'--to','pdf','--no-execute','--no-cache','--output','qollab.pdf','-M','latex-auto-install:false','-M','latex-clean:true','-M','mainfont:Noto Serif CJK KR','-M','sansfont:Noto Sans CJK KR','-M','monofont:DejaVu Sans Mono','--pdf-engine','lualatex','--pdf-engine-opt=-no-shell-escape']
    # Logs go to a bounded tmpfs file, never to an unbounded memory PIPE.
    logfile=ROOT/'render.log'
    with logfile.open('wb') as out:
        try:result=subprocess.run(cmd,cwd=ROOT,stdout=out,stderr=subprocess.STDOUT,timeout=int(job['timeout']),env={**os.environ,'QUARTO_PRINT_STACK':'false','QUARTO_DISABLE_VERSION_CHECK':'true'})
        except subprocess.TimeoutExpired:return {'log':'RENDER_TIMEOUT'}
    with logfile.open('rb') as log:
        log.seek(max(0,logfile.stat().st_size-60000));text=log.read().decode('utf-8','replace')
    pdf=ROOT/target.parent/'qollab.pdf'
    if result.returncode or not pdf.is_file():
        detail=ROOT/target.with_suffix('.log')
        if detail.is_file():text+='\n'+detail.read_text(errors='replace')[-12000:]
        return {'log':text[-60000:]}
    if pdf.is_symlink() or pdf.stat().st_size>50*1024*1024:raise ValueError('OUTPUT_LIMIT')
    return {'pdf':base64.b64encode(pdf.read_bytes()).decode(),'log':text}
try:
    print(json.dumps(main(),ensure_ascii=False))
except Exception as e:
    print(json.dumps({'log':str(e)}))
