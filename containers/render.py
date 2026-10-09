#!/usr/bin/env python3
"""Job entry point: bounded JSON stdin, no credentials, one isolated /work.

Pandoc turns the document into Typst with qollab's template and filters
(/opt/qollab/typst) and Typst makes the PDF. Settings come from _quarto.yml
and the document's front matter, as the editor writes them.
"""
import base64, datetime, json, os, pathlib, re, shutil, subprocess, sys, threading, time
import yaml
ROOT=pathlib.Path('/work')
LIMIT=250*1024*1024
TYPST=pathlib.Path('/opt/qollab/typst')
# Project files a job may contain. .tex/.sty are kept for projects written
# for LaTeX; Typst does not read them.
TYPES=['.qmd','.md','.yml','.yaml','.bib','.csl','.png','.jpg','.jpeg','.typ','.tex','.sty']
# Document settings that only meant something to LaTeX.
LATEX_ONLY={'documentclass','classoption','pdf-engine','pdf-engine-opt','pdf-engine-opts','pagestyle',
            'keep-tex','block-headings','fig-pos','boxlinks','colorlinks','geometry','lof','lot',
            'toccolor','urlcolor','header-includes'}
FRONT=re.compile(r'---\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)',re.S)
warnings=[]

def margin(geometry):
    """LaTeX geometry list (margin=25mm, top=20mm…) as a Typst margin map."""
    out={}
    for item in geometry if isinstance(geometry,list) else [geometry]:
        m=re.fullmatch(r'\s*(margin|top|bottom|left|right)\s*=\s*([\d.]+\s*(?:mm|cm|in|pt))\s*',str(item))
        if m:
            if m.group(1)=='margin':out.update({'x':m.group(2),'y':m.group(2)})
            else:out[m.group(1)]=m.group(2)
    return out

# LaTeX paper names as Typst's.
PAPERS={'letter':'us-letter','letterpaper':'us-letter','legal':'us-legal','legalpaper':'us-legal',
        'executive':'us-executive','b5':'iso-b5','b5paper':'iso-b5','a4paper':'a4','a5paper':'a5','a3paper':'a3'}

def migrate(options):
    """Settings written for the LaTeX PDF format, translated for Typst."""
    if not isinstance(options,dict):return {}
    out={k:v for k,v in options.items() if k not in LATEX_ONLY}
    if options.get('geometry') and 'margin' not in out:
        out['margin']=margin(options['geometry'])
    for side in ('top','bottom','left','right'):
        if f'margin-{side}' in out:
            value=out.pop(f'margin-{side}')
            if isinstance(out.get('margin',{}),dict):out['margin']={**out.get('margin',{}),side:value}
    if options.get('colorlinks') is False:out['linkcolor']='none'
    if isinstance(out.get('papersize'),str):out['papersize']=PAPERS.get(out['papersize'].lower(),out['papersize'])
    if options.get('pagestyle')=='empty' and 'page-numbering' not in out:out['page-numbering']=False
    classes=options.get('classoption')
    if 'twocolumn' in (classes if isinstance(classes,list) else [classes]) and 'columns' not in out:out['columns']=2
    header=options.get('header-includes')
    if header:
        if re.search(r'\\[A-Za-z@]',str(header)):warnings.append('LaTeX preamble (header-includes) is not used by Typst and was left out')
        else:out['header-includes']=header
    for k in options:
        if k in LATEX_ONLY-{'geometry','colorlinks','header-includes','pagestyle','classoption'}:warnings.append(f'LaTeX setting {k} is not used by Typst')
    return out

# Names the document language gives to captions, references, callouts, the
# abstract and the contents; the document settings panel shows the same.
LABELS={
    'ko':{'fig-title':'그림','tbl-title':'표','eq-prefix':'방정식','sec-prefix':'섹션','toc-title':'목차',
          'abstract-title':'초록','note':'참고','tip':'팁','warning':'경고','important':'중요','caution':'주의'},
    'en':{'fig-title':'Figure','tbl-title':'Table','eq-prefix':'Equation','sec-prefix':'Section','toc-title':'Table of contents',
          'abstract-title':'Abstract','note':'Note','tip':'Tip','warning':'Warning','important':'Important','caution':'Caution'},
}
# Settings the template and filters use. Others are reported in the log.
USED={'title','subtitle','author','date','date-format','abstract','abstract-title','lang','region','toc','toc-depth','toc-title',
      'number-sections','section-numbering','papersize','margin','page-numbering','columns','fontsize','linestretch',
      'indent','linkcolor','mainfont','sansfont','monofont','mathfont','CJKmainfont','CJKsansfont','CJKmonofont',
      'bibliography','csl','header-includes','template-partials','crossref','fig-cap-location','tbl-cap-location'}
CROSSREF={'fig-title','tbl-title','fig-prefix','tbl-prefix','eq-prefix','sec-prefix'}
MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December']
DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

def format_date(day,style,korean):
    """date-format long/full/medium/short, as the browser (ICU) shows them in
    the document settings panel."""
    y,m,d=day.year,day.month,day.day
    if korean:return {'full':f'{y}년 {m}월 {d}일 {"월화수목금토일"[day.weekday()]}요일','long':f'{y}년 {m}월 {d}일',
                      'medium':f'{y}. {m}. {d}.','short':f'{y%100:02d}. {m}. {d}.'}[style]
    return {'full':f'{DAYS[day.weekday()]}, {MONTHS[m-1]} {d}, {y}','long':f'{MONTHS[m-1]} {d}, {y}',
            'medium':f'{MONTHS[m-1][:3]} {d}, {y}','short':f'{m}/{d}/{y%100:02d}'}[style]
PARTIALS={'typst-template.typ','typst-show.typ'}

def settings(target):
    """Project settings (_quarto.yml) overridden by the document's, each with
    its format options; the paths of template partials resolved."""
    project=ROOT/'_quarto.yml'
    if (ROOT/'_quarto.yaml').is_file() and not project.is_file():project=ROOT/'_quarto.yaml'
    source=(ROOT/target).read_text(errors='replace');front=FRONT.match(source)
    merged={}
    for data,base in ((yaml.safe_load(project.read_text()) if project.is_file() else None,ROOT),
                      (yaml.safe_load(front.group(1)) if front else None,(ROOT/target).parent)):
        if not isinstance(data,dict):continue
        fmt=data.pop('format',None)
        opts=migrate(fmt.get('typst') if isinstance(fmt,dict) and isinstance(fmt.get('typst'),dict) else
                     fmt.get('pdf') if isinstance(fmt,dict) else None)
        for options in (migrate(data),opts):
            partials=options.pop('template-partials',None)
            if partials:merged['template-partials']=[base/str(p) for p in (partials if isinstance(partials,list) else [partials])]
            if isinstance(options.get('crossref'),dict):options['crossref']={**merged.get('crossref',{}),**options['crossref']}
            merged.update(options)
    merged.pop('keep-typ',None)
    return merged,source[front.end():] if front else source

def metadata(options):
    """Every variable the template and filters use, with qollab's defaults."""
    for k in sorted(set(options)-USED):warnings.append(f'Setting {k} is not used by the renderer')
    data={k:v for k,v in options.items() if k in USED and k not in ('header-includes','template-partials','date-format')}
    lang=str(data.get('lang') or 'en');korean=lang.lower().startswith('ko')
    names=LABELS['ko' if korean else 'en']
    date=data.get('date')
    if isinstance(date,str) and date.strip() in ('today','now','last-modified'):date=datetime.date.today()
    if isinstance(date,str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}',date.strip()):date=datetime.date.fromisoformat(date.strip())
    if isinstance(date,datetime.datetime):date=date.date()
    style=options.get('date-format')
    if isinstance(date,datetime.date):
        if style in ('full','long','medium','short'):data['date']=format_date(date,style,korean)
        else:
            if style:warnings.append(f'date-format {style} is not supported; the date is written as {date.isoformat()}')
            data['date']=date.isoformat()
    if 'author' in data:data['author']=[str(a) for a in (data['author'] if isinstance(data['author'],list) else [data['author']])]
    if isinstance(data.get('bibliography'),str):data['bibliography']=[data['bibliography']]
    data.setdefault('papersize','us-letter')
    data.setdefault('columns',1)
    if data.get('page-numbering',True) is True:data['page-numbering']='1'
    elif data['page-numbering'] is False:del data['page-numbering']
    if data.get('number-sections') and not data.get('section-numbering'):data['section-numbering']='1.1.a'
    data.setdefault('toc-depth',3)
    data.setdefault('toc-title',names['toc-title'])
    data.setdefault('abstract-title',names['abstract-title'])
    for key,default in (('fig-cap-location','bottom'),('tbl-cap-location','top')):
        if data.get(key,default) not in ('top','bottom'):warnings.append(f'{key}: {data[key]} is not supported; {default} is used')
        if data.get(key) not in ('top','bottom'):data[key]=default
    crossref=data.get('crossref') if isinstance(data.get('crossref'),dict) else {}
    for k in sorted(set(crossref)-CROSSREF):warnings.append(f'Setting crossref.{k} is not used by the renderer')
    crossref={k:v for k,v in crossref.items() if k in CROSSREF}
    for k in ('fig-title','tbl-title','eq-prefix','sec-prefix'):crossref.setdefault(k,names[k])
    crossref.setdefault('fig-prefix',crossref['fig-title'])
    crossref.setdefault('tbl-prefix',crossref['tbl-title'])
    data['crossref']=crossref
    data['qollab-callout']={k:names[k] for k in ('note','tip','warning','important','caution')}
    return data

# What the filters look for. A walk over every paragraph or word costs a
# noticeable part of a long document's build, so the filters skip it when the
# source cannot contain what it looks for.
SCAN={'latex':r'\\[A-Za-z]','labels':r'\\label\b','equations':r'\{#eq-','shortcodes':r'\{\{<',
      'references':r'@(?:fig|tbl|eq|sec)-'}

# Quarto code cells (```{python}) are shown as code; nothing is executed.
CELL=re.compile(r'^([ \t]*(?:`{3,}|~{3,})[ \t]*)\{([A-Za-z][\w+-]*)[^}\n]*\}[ \t]*$',re.M)

def convert(target,deadline,log):
    """Pandoc (template and filters in /work/.qollab). Returns the exit code,
    the metrics and the Typst source."""
    options,body=settings(target)
    work=ROOT/'.qollab';shutil.copytree(TYPST,work,dirs_exist_ok=True)
    template=work/'template'
    template.mkdir(exist_ok=True)
    for name in ('template.typ',*PARTIALS):shutil.copyfile(TYPST/name,template/name)
    for p in options.get('template-partials',[]):
        if ROOT not in p.resolve().parents:raise ValueError('Template partials must be files in the project')
        if p.name not in PARTIALS:warnings.append(f'Template partial {p.name} is not one of {", ".join(sorted(PARTIALS))} and was left out')
        elif not p.is_file():raise ValueError(f'Template partial not found: {p.relative_to(ROOT)}')
        else:shutil.copyfile(p,template/p.name)
    header=options.get('header-includes')
    source=CELL.sub(r'\1{.\2 .cell-code}',body)
    data=metadata(options)
    data['qollab-scan']={k:bool(re.search(pattern,source)) for k,pattern in SCAN.items()}
    (work/'metadata.yml').write_text(yaml.safe_dump(data,allow_unicode=True,sort_keys=False))
    (work/'input.md').write_text(source)
    cmd=['pandoc',str(work/'input.md'),'-f','markdown','-t','typst','-s','--template',str(template/'template.typ'),
         '--wrap=none','--syntax-highlighting',str(work/'arrow-light.theme'),'--metadata-file',str(work/'metadata.yml'),
         '-L',str(work/'qollab.lua'),'-L',str(work/'qmd.lua'),'-o',str(work/'out.typ')]
    if header:
        # Typst code, included as written (metadata would be read as Markdown).
        (work/'header.typ').write_text('\n'.join(map(str,header)) if isinstance(header,list) else str(header))
        cmd[-2:-2]=['-H',str(work/'header.typ')]
    log.write(''.join(f'WARNING (qollab): {w}\n' for w in dict.fromkeys(warnings)).encode());log.flush()
    started=time.monotonic()
    code=subprocess.run(cmd,cwd=(ROOT/target).parent,stdout=log,stderr=subprocess.STDOUT,timeout=max(1,deadline-started)).returncode
    metrics={'pandocMs':round((time.monotonic()-started)*1000)}
    if code:return code,metrics,None
    # Code blocks keep the padded box of Quarto's look (Quarto patches the
    # same line of Pandoc's highlighting definitions).
    text=(work/'out.typ').read_text().replace('block(fill: bgcolor, blocks)','block(fill: bgcolor, width: 100%, inset: 8pt, radius: 2pt, blocks)',1)
    return 0,metrics,text

STATUS=re.compile(r'compiled (successfully|with warnings|with errors)(?: in ([\d.]+) ?(ms|s)\b)?')
ANSI=re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')

class Typst:
    """`typst watch` for one document. It keeps the last layout in memory and
    lays out again only what changed: each replacement of the document's .typ,
    and each change of a file the last compile read, starts one compile."""
    def __init__(self,target):
        self.target=target;self.cwd=(ROOT/target).parent
        self.lines=[];self.closed=False;self.cond=threading.Condition()
        self.deps_file=ROOT/'.qollab/deps.json'
        self.proc=subprocess.Popen(['typst','watch','--no-serve','--root',str(ROOT),'--deps',str(self.deps_file),
                                    f'{target.stem}.typ','qollab.pdf'],cwd=self.cwd,stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        threading.Thread(target=self._read,daemon=True).start()
    def _read(self):
        for raw in self.proc.stdout:
            line=ANSI.sub('',raw.decode('utf-8','replace')).rstrip()
            with self.cond:
                self.lines.append(line)
                self.cond.notify_all()
        with self.cond:
            self.closed=True;self.cond.notify_all()
    def position(self):
        with self.cond:return len(self.lines)
    def deps(self):
        """Files the last compile read."""
        try:inputs=json.loads(self.deps_file.read_text()).get('inputs') or []
        except (OSError,ValueError):return set()
        return {(self.cwd/p).resolve() for p in inputs}
    def compiled(self,since,deadline):
        """The first compile that starts after line `since`: (succeeded, Typst
        milliseconds, diagnostics)."""
        with self.cond:
            while True:
                begun=next((i for i in range(since,len(self.lines)) if self.lines[i].endswith('compiling ...')),None)
                end=None if begun is None else next((i for i in range(begun,len(self.lines)) if STATUS.search(self.lines[i])),None)
                if end is not None:break
                if self.closed:raise RuntimeError('typst watch stopped:\n'+'\n'.join(self.lines[since:])[-4000:])
                left=deadline-time.monotonic()
                if left<=0:raise subprocess.TimeoutExpired('typst watch',0)
                self.cond.wait(min(left,0.5))
            # Diagnostics follow the status line; take what arrives before a pause.
            seen=len(self.lines)
            while self.cond.wait(0.1) and len(self.lines)>seen:seen=len(self.lines)
            m=STATUS.search(self.lines[end])
            ms=round(float(m.group(2))*(1 if m.group(3)=='ms' else 1000)) if m.group(2) else 0
            noise=('watching ','writing to ')
            diagnostics=[l for l in self.lines[end+1:] if not l.startswith(noise) and 'compiling ...' not in l]
            return m.group(1)!='with errors',ms,'\n'.join(diagnostics).strip()
    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:self.proc.wait(5)
            except subprocess.TimeoutExpired:self.proc.kill()

PNG=b'\x89PNG'

def checked(name):
    p=pathlib.PurePosixPath(name)
    if p.is_absolute() or any(x in ('.','..') or x.startswith('.') for x in p.parts) or '\\' in name or ':' in name:raise ValueError('INVALID_PATH')
    if p.suffix.lower() not in TYPES:raise ValueError('FILE_TYPE')
    return ROOT/name

def replace(dest,data):
    """Writes a file in one step, so a running `typst watch` never reads half of it."""
    dest.parent.mkdir(parents=True,exist_ok=True)
    tmp=dest.with_name('.qollab-'+dest.name)
    tmp.write_bytes(data);os.replace(tmp,dest)

class Session:
    """One project's files and compiler, kept between builds. Each request
    carries the files that changed since the last one (all of them at first)."""
    def __init__(self):
        self.sizes={};self.typst=None
    def apply(self,request):
        files,removed=request.get('files',[]),request.get('remove',[])
        if len(files)>1000 or len(removed)>1000:raise ValueError('FILE_COUNT')
        changed=set()
        for name in removed:
            dest=checked(name);self.sizes.pop(name,None)
            for f in (dest,dest.with_name(dest.name+'.png')):
                if f.is_file():f.unlink();changed.add(f.resolve())
        for f in files:
            dest=checked(f['path'])
            data=base64.b64decode(f['bytes'],validate=True) if f.get('bytes') is not None else f.get('source','').encode('utf-8')
            self.sizes[f['path']]=len(data)
            if len(self.sizes)>1000:raise ValueError('FILE_COUNT')
            if sum(self.sizes.values())>LIMIT:raise ValueError('INPUT_LIMIT')
            replace(dest,data);changed.add(dest.resolve())
            # Typst decides the image format from the extension; PNG data named .jpg
            # gets a .png copy, which the LaTeX syntax filter points the image to.
            copy=dest.with_name(dest.name+'.png')
            if dest.suffix.lower() in ('.jpg','.jpeg') and data[:4]==PNG:replace(copy,data);changed.add(copy.resolve())
            elif copy.is_file():copy.unlink();changed.add(copy.resolve())
        return changed
    def handle(self,request):
        started=time.monotonic();warnings.clear()
        since=self.typst.position() if self.typst else 0
        changed=self.apply(request)
        target=pathlib.PurePosixPath(request['target'])
        if target.is_absolute() or '..' in target.parts or not str(target).endswith('.qmd'):raise ValueError('INVALID_TARGET')
        deadline=started+int(request['timeout'])
        if self.typst and (self.typst.target!=target or self.typst.closed):self.stop()
        # A changed file that the last compile read starts a compile of the
        # previous document. Let it finish; the next compile is this build's.
        if self.typst and changed&self.typst.deps():self.typst.compiled(since,deadline)
        prepared=time.monotonic()
        # Logs go to a bounded tmpfs file, never to an unbounded memory PIPE.
        logfile=ROOT/'render.log'
        with logfile.open('wb') as log:
            code,metrics,text=convert(target,deadline,log)
        metrics['prepareMs']=round((prepared-started)*1000)
        with logfile.open('rb') as log:
            log.seek(max(0,logfile.stat().st_size-60000));report=log.read().decode('utf-8','replace')
        if code:return {'log':report[-60000:],'metrics':metrics}
        cwd=(ROOT/target).parent
        metrics['incremental']=int(self.typst is not None)
        since=self.typst.position() if self.typst else 0
        replace(cwd/f'{target.stem}.typ',text.encode())
        if not self.typst:self.typst=Typst(target)
        ok,metrics['typstMs'],diagnostics=self.typst.compiled(since,deadline)
        report=(report+f'typst {target.stem}.typ\n'+(diagnostics+'\n' if diagnostics else ''))[-60000:]
        pdf=cwd/'qollab.pdf'
        if not ok or not pdf.is_file():return {'log':report+('' if ok else 'ERROR: Typst compilation failed\n'),'metrics':metrics}
        if pdf.is_symlink() or pdf.stat().st_size>50*1024*1024:raise ValueError('OUTPUT_LIMIT')
        return {'pdf':base64.b64encode(pdf.read_bytes()).decode(),'log':report,'metrics':metrics}
    def stop(self):
        if self.typst:self.typst.stop();self.typst=None

LINE=360*1024*1024

def main():
    """Requests arrive one JSON object per line; each answer is one line. A
    single request without a newline (one build per container) works too."""
    session=Session()
    try:
        while True:
            line=sys.stdin.buffer.readline(LINE+1)
            if not line:break
            if not line.strip():continue
            if len(line)>LINE:
                respond({'log':'INPUT_LIMIT','reset':True});break
            try:response=session.handle(json.loads(line))
            except subprocess.TimeoutExpired:
                session.stop();response={'log':'RENDER_TIMEOUT','reset':True}
            except yaml.YAMLError:response={'log':'Invalid YAML'}
            # The project files may be half applied: the renderer starts over.
            except Exception as e:response={'log':str(e),'reset':True}
            respond(response)
    finally:
        session.stop()

def respond(response):
    sys.stdout.write(json.dumps(response,ensure_ascii=False)+'\n');sys.stdout.flush()

if __name__=='__main__':
    main()
