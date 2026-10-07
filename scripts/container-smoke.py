#!/usr/bin/env python3
"""Exercise the real job image with the production isolation flags."""
import argparse, base64, json, pathlib, subprocess, sys, time, struct, zlib, re
p=argparse.ArgumentParser();p.add_argument('--engine',default='docker');p.add_argument('--image',required=True);p.add_argument('--output',default='tmp/render-smoke.pdf');a=p.parse_args()
flags=['--rm','-i','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','10001:10001','--cpus','1','--memory','2g','--pids-limit','64','--tmpfs','/work:rw,nosuid,nodev,mode=1777,size=512m','--tmpfs','/tmp:rw,nosuid,nodev,mode=1777,size=32m','-e','HOME=/work','-e','TEXMFVAR=/work/.texlive','-e','openin_any=p','-e','openout_any=p','-e','shell_escape=f','-w','/work']
# Tiny valid PNG, also used as an image inclusion assertion in the PDF.
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
image=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',120,40,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\x00'+bytes([35,127,121])*120)*40))+chunk(b'IEND',b'')
png=base64.b64encode(image).decode()
source='''---
title: "Qollab 렌더링 검증"
format: pdf
---

# 한글과 English

공동 편집 문서의 한글, 표, 수식, 이미지를 확인합니다.

| 항목 | 결과 |
|---|---|
| Korean | 한글 표시 |
| Math | 수식 표시 |

$$E = mc^2 \\qquad \\int_0^1 x^2 dx = \\frac{1}{3}$$

![이미지 포함 검증](assets/pixel.png){width=20%}
'''
job={'target':'report.qmd','timeout':120,'files':[{'path':'report.qmd','source':source},{'path':'assets/pixel.png','bytes':png}]}
start=time.monotonic();r=subprocess.run([a.engine,'run',*flags,a.image,'python3','/opt/qollab/render.py'],input=json.dumps(job).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=150)
if r.returncode:sys.exit(r.stderr.decode())
out=json.loads(r.stdout)
if not out.get('pdf'):sys.exit(out.get('log','No PDF'))
assert 'Font names database not found' not in out.get('log',''), 'Runtime rebuilt the font cache'
dest=pathlib.Path(a.output);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(base64.b64decode(out['pdf']))
report={'pdf':str(dest),'seconds':round(time.monotonic()-start,2),'bytes':dest.stat().st_size,'metrics':out.get('metrics')}
dest.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
def render(data):
    result=subprocess.run([a.engine,'run',*flags,a.image,'python3','/opt/qollab/render.py'],input=json.dumps(data).encode(),capture_output=True,timeout=150)
    assert result.returncode==0,result.stderr.decode()
    output=json.loads(result.stdout)
    assert output.get('pdf'),output.get('log')
    return output

assert out.get('cache'), 'No reference state captured'
job['cache']=out['cache']
job['files'][0]['source']=source.replace('확인합니다.','확인합니다!')
start=time.monotonic();incremental=render(job)
assert incremental['metrics']['reusedAux']==1,incremental['metrics']
assert incremental['metrics']['texPasses']==1,incremental['metrics']
incremental_report={'seconds':round(time.monotonic()-start,2),'metrics':incremental['metrics']}
dest.with_name('render-incremental.json').write_text(json.dumps(incremental_report,indent=2)+'\n')
print(json.dumps({'incremental':incremental_report}))
# A poisoned auxiliary state must fall back to a clean compile.
job['cache']={**out['cache'],'files':{'.aux':base64.b64encode(b'\\qollabUndefinedCommand\n').decode()}}
recovered=render(job)
assert recovered['metrics']['cacheFallback']==1,recovered['metrics']
job.pop('cache')
# Changing the serialized Quarto width must change the PDF's image rectangle.
job['files'][0]['source']=source.replace('width=20%', 'width=40%')
resized=render(job)
resized_pdf=dest.with_name('render-resized.pdf');resized_pdf.write_bytes(base64.b64decode(resized['pdf']))
def image_width(pdf):
    import xml.etree.ElementTree as ET
    xml=subprocess.check_output(['pdftohtml','-xml','-stdout','-hidden','-zoom','1',str(pdf)],stderr=subprocess.DEVNULL)
    images=ET.fromstring(xml).findall('.//image')
    assert len(images)==1,images
    return float(images[0].attrib['width'])
assert 1.9 < image_width(resized_pdf)/image_width(dest) < 2.1
print('Changing figure width from 20% to 40% doubles its actual PDF rectangle')
# The engine change must retain references that require more than one TeX pass.
fidelity='''---
title: "한글 참조 검증"
toc: true
number-sections: true
bibliography: references.bib
---

# 한글과 수식 {#sec-check}

**굵은 한글**과 *기울임 English*, `inline code`.
@fig-check, @tbl-check, @eq-energy, @sec-check, [@knuth1984].

| 항목 | 값 |
|---|---|
| 한글 | 검증 |

: 한글 표 {#tbl-check}

$$E=mc^2$$ {#eq-energy}

![한글 그림](assets/pixel.png){#fig-check width=20%}

```{=latex}
Resolved page: \\pageref{qollab-page}.
\\newpage
```

# 다음 페이지

```{=latex}
\\label{qollab-page}
```

한글 문장이 여러 줄에 걸쳐 표시되는지 확인합니다. 문장과 공백을 보존하고 표와 수식의 참조를 유지합니다.
'''
fidelity_job={'target':'references.qmd','timeout':120,'files':[{'path':'references.qmd','source':fidelity},{'path':'assets/pixel.png','bytes':png},{'path':'references.bib','source':'@book{knuth1984, title={The TeXbook}, author={Donald E. Knuth}, year={1984}, publisher={Addison-Wesley}}'}]}
r=subprocess.run([a.engine,'run',*flags,a.image,'python3','/opt/qollab/render.py'],input=json.dumps(fidelity_job).encode(),capture_output=True,timeout=150)
assert r.returncode==0,r.stderr.decode()
fidelity_out=json.loads(r.stdout)
assert fidelity_out.get('pdf'),fidelity_out.get('log')
fidelity_pdf=dest.with_name('render-references.pdf');fidelity_pdf.write_bytes(base64.b64decode(fidelity_out['pdf']))
content=subprocess.check_output(['pdftotext',str(fidelity_pdf),'-']).decode()
assert '??' not in content,content
assert re.search(r'Resolved page:\s*[2-9]',content),content
assert all(s in content for s in ['한글','TeXbook','Figure','Table']),content
print('Korean, image, math, table, bibliography and resolved page reference passed')
fidelity_job['files'][0]['source']=fidelity.replace('# 다음 페이지','# 추가 페이지\n\n추가 내용.\n\n```{=latex}\n\\newpage\n```\n\n# 다음 페이지')
fidelity_job['cache']=fidelity_out['cache']
changed=render(fidelity_job)
assert changed['metrics']['reusedAux']==1,changed['metrics']
assert changed['metrics']['texPasses']>=2,changed['metrics']
changed_pdf=dest.with_name('render-references-incremental.pdf');changed_pdf.write_bytes(base64.b64decode(changed['pdf']))
changed_text=subprocess.check_output(['pdftotext',str(changed_pdf),'-']).decode()
assert re.search(r'Resolved page:\s*3',changed_text),changed_text
fidelity_job.pop('cache')
cold=render(fidelity_job)
cold_pdf=dest.with_name('render-references-cold.pdf');cold_pdf.write_bytes(base64.b64decode(cold['pdf']))
assert subprocess.check_output(['pdftotext',str(cold_pdf),'-']).decode()==changed_text
print('Incremental references match cold output after page and TOC changes; invalid state recovers')
probe='''import os,socket,pathlib
assert os.getuid()==10001
assert not any(k in os.environ for k in ['DATABASE_URL','GOOGLE_CLIENT_SECRET','RENDERER_TOKEN','ADMIN_TOKEN'])
assert not pathlib.Path('/var/run/docker.sock').exists()
assert not pathlib.Path('/data').exists()
try: pathlib.Path('/forbidden').write_text('x'); raise AssertionError('writable root')
except OSError: pass
s=socket.socket(); s.settimeout(1)
try: s.connect(('1.1.1.1',443)); raise AssertionError('network is available')
except OSError: pass
print('isolation checks passed')'''
r=subprocess.run([a.engine,'run',*flags,a.image,'python3','-c',probe],capture_output=True,timeout=15);print(r.stdout.decode());assert r.returncode==0,r.stderr.decode()

job['timeout']=1
r=subprocess.run([a.engine,'run',*flags,a.image,'python3','/opt/qollab/render.py'],input=json.dumps(job).encode(),capture_output=True,timeout=15)
assert r.returncode==0,r.stderr.decode()
assert json.loads(r.stdout).get('log')=='RENDER_TIMEOUT',r.stdout.decode()[:1000]
print('timeout and disposable container cleanup passed')
# The warm path must produce the same pages as the complete Quarto pipeline.
# The extra inert YAML file selects the full pipeline for the reference only.
import hashlib, tempfile
fast_source='# 한글 검증\n\n한글 문서와 이미지입니다. **English** and *italic*.\n\n$$E=mc^2$$\n\n| A | B |\n|---|---|\n| 표 | 검증 |\n\n![그림](assets/pixel.png){width=30%}\n'
fast_job={'target':'report.qmd','timeout':120,'files':[{'path':'report.qmd','source':fast_source},{'path':'assets/pixel.png','bytes':png}]}
reference=render({**fast_job,'files':[*fast_job['files'],{'path':'reference-only.yml','source':''}]})
fast_job['cache']=reference['cache']

def warmed(data):
    container=subprocess.check_output([a.engine,'create',*flags[1:],a.image,'python3','/opt/qollab/render.py']).decode().strip()
    proc=subprocess.Popen([a.engine,'start','-ai',container],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        deadline=time.monotonic()+30
        while True:
            check=subprocess.run([a.engine,'exec',container,'cat','/work/.qollab-fast/control.log'],capture_output=True)
            if b'QOLLAB_READY' in check.stdout:break
            assert proc.poll() is None, 'Warm worker exited'
            assert time.monotonic()<deadline, 'Warm worker not ready'
            time.sleep(.1)
        started=time.monotonic()
        stdout,stderr=proc.communicate(json.dumps(data).encode(),timeout=130)
        assert proc.returncode==0,stderr.decode()
        output=json.loads(stdout)
        assert output.get('pdf'),output.get('log')
        return output,round((time.monotonic()-started)*1000)
    finally:
        subprocess.run([a.engine,'rm','-f',container],capture_output=True)
        if proc.poll() is None:proc.kill();proc.wait()

def page_hashes(pdf):
    with tempfile.TemporaryDirectory() as folder:
        subprocess.run(['pdftoppm','-r','120','-png',str(pdf),folder+'/page'],check=True,capture_output=True)
        return [hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(pathlib.Path(folder).glob('*.png'))]

fast_report=[]
for name,edited in [
    ('text',fast_source.replace('이미지입니다.','이미지입니다.가')),
    ('image',fast_source.replace('width=30%','width=60%')),
    ('math',fast_source.replace('E=mc^2',r'E=mc^2 \qquad \int_0^1 x^2 dx=\frac{1}{3}')),
    ('pages',fast_source+'\n\n'.join(['한글 문장이 길게 이어져 여러 페이지의 줄바꿈과 쪽 번호를 검증합니다. '*8]*12)),
    ('lists',fast_source+'\n- First\n- **Second**\n\n1. 하나\n2. 둘\n\n> Quote\n\n[Example](https://example.com)\n'),
]:
    fast_job['files'][0]['source']=edited
    output,elapsed=warmed(fast_job)
    assert output['metrics'].get('fastPath')==1,(name,output['metrics'])
    full=render({**fast_job,'files':[*fast_job['files'],{'path':'reference-only.yml','source':''}]})
    warm_pdf=dest.with_name('render-fast-'+name+'.pdf');warm_pdf.write_bytes(base64.b64decode(output['pdf']))
    full_pdf=dest.with_name('render-fast-'+name+'-reference.pdf');full_pdf.write_bytes(base64.b64decode(full['pdf']))
    hashes=page_hashes(warm_pdf)
    assert hashes==page_hashes(full_pdf), 'Warm PDF differs: '+name
    fast_report.append({'case':name,'milliseconds':elapsed,'metrics':output['metrics'],'pageHashes':hashes,'identicalPixels':True})
    fast_job['cache']=output['cache']
# A changed table width must trigger the established multi-pass Quarto path.
fast_job['files'][0]['source']=fast_source.replace('| 표 | 검증 |','| 훨씬 긴 표의 항목 | 검증 |')
changed_width,_=warmed(fast_job)
assert not changed_width['metrics'].get('fastPath'),changed_width['metrics']
fast_report.append({'case':'changed-table-width','fallback':True})
dest.with_name('render-fast-report.json').write_text(json.dumps(fast_report,indent=2)+'\n')
print('Warm PDF pages match full Quarto for text, image sizing, lists, links and pagination; changed table widths fall back')
