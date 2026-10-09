#!/usr/bin/env python3
"""Exercise the real job image with the production isolation flags."""
import argparse, base64, json, pathlib, subprocess, sys, time, struct, zlib, re
p=argparse.ArgumentParser();p.add_argument('--engine',default='docker');p.add_argument('--image',required=True);p.add_argument('--output',default='tmp/render-smoke.pdf');a=p.parse_args()
flags=['--rm','-i','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','10001:10001','--cpus','1','--memory','2g','--pids-limit','64','--tmpfs','/work:rw,nosuid,nodev,mode=1777,size=512m','--tmpfs','/tmp:rw,nosuid,nodev,mode=1777,size=32m','-e','HOME=/work','-w','/work']
# Tiny valid PNG, also used as an image inclusion assertion in the PDF.
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
image=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',120,40,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\x00'+bytes([35,127,121])*120)*40))+chunk(b'IEND',b'')
png=base64.b64encode(image).decode()
dest=pathlib.Path(a.output);dest.parent.mkdir(parents=True,exist_ok=True)
def render(data):
    result=subprocess.run([a.engine,'run',*flags,a.image,'python3','/opt/qollab/render.py'],input=json.dumps(data).encode(),capture_output=True,timeout=150)
    assert result.returncode==0,result.stderr.decode()
    output=json.loads(result.stdout)
    assert output.get('pdf'),output.get('log')
    return output
def save(output,name):
    pdf=dest.with_name(name);pdf.write_bytes(base64.b64decode(output['pdf']));return pdf
def words(pdf):return ' '.join(subprocess.check_output(['pdftotext',str(pdf),'-']).decode().split())
def info(pdf):return subprocess.check_output(['pdfinfo',str(pdf)]).decode()

# Existing projects say format: pdf; they render with Typst unchanged.
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
start=time.monotonic();out=render(job);seconds=round(time.monotonic()-start,2)
save(out,dest.name)
assert '공동 편집 문서의 한글' in words(dest) and '한글 표시' in words(dest),words(dest)
fonts=subprocess.check_output(['pdffonts',str(dest)]).decode()
assert 'NotoSerifCJK' in fonts and 'NotoSansCJK' in fonts and 'LatinModernMath' in fonts,fonts
start=time.monotonic();repeated=render(job)
report={'pdf':str(dest),'seconds':seconds,'bytes':dest.stat().st_size,'metrics':out.get('metrics'),
        'repeated':{'seconds':round(time.monotonic()-start,2),'metrics':repeated.get('metrics')}}
dest.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
# Changing the serialized image width must change the PDF's image rectangle.
resized_pdf=save(render({**job,'files':[{'path':'report.qmd','source':source.replace('width=20%','width=40%')},job['files'][1]]}),'render-resized.pdf')
def image_width(pdf):
    import xml.etree.ElementTree as ET
    xml=subprocess.check_output(['pdftohtml','-xml','-stdout','-hidden','-zoom','1',str(pdf)],stderr=subprocess.DEVNULL)
    images=ET.fromstring(xml).findall('.//image')
    assert len(images)==1,images
    return float(images[0].attrib['width'])
assert 1.9 < image_width(resized_pdf)/image_width(dest) < 2.1
print('Changing figure width from 20% to 40% doubles its actual PDF rectangle')

# The editor's LaTeX inline syntax is translated; what Typst cannot do is
# reported in the log and left out instead of failing the build.
latex='''---
title: "서식"
---

[밑줄 친 한국어]{.underline}, ~~지운 한국어~~, \\textcolor{red}{빨간 \\ul{빨간 밑줄}}, \\char9312{} 원문자, 50\\% \\& \\#.

1. 첫 항목
2. 둘째 항목\\label{item-two}

항목 \\ref{item-two}를 봅니다. 끝은 \\pageref{last}쪽입니다. \\smallpar{}

```{=latex}
\\begin{center}LaTeX 블록\\end{center}
```

\\newpage

# 마지막

\\label{last}마지막 쪽입니다.
'''
latex_out=render({'target':'latex.qmd','timeout':120,'files':[{'path':'latex.qmd','source':latex}]})
latex_pdf=save(latex_out,'render-latex.pdf');text=words(latex_pdf)
for s in ('밑줄 친 한국어','지운 한국어','빨간 빨간 밑줄','① 원문자','50% & #','항목 2를 봅니다','끝은 2쪽입니다','마지막 쪽입니다'):assert s in text,(s,text)
assert 'LaTeX 블록' not in text and '??' not in text,text
assert re.search(r'Pages:\s+2\n',info(latex_pdf)),info(latex_pdf)
for s in ('\\smallpar is not supported by Typst','raw LaTeX block is not supported by Typst'):assert s in latex_out['log'],latex_out['log']
print('LaTeX inline syntax, list references, page references and page breaks passed; unsupported LaTeX is reported')

# Settings written for the LaTeX PDF format keep working where Typst has an
# equivalent and are reported where it has none.
legacy='---\ntitle: "설정"\ndocumentclass: report\npapersize: letter\ngeometry:\n  - margin=30mm\nheader-includes: |\n  \\usepackage{kotex}\nformat:\n  pdf:\n    pdf-engine: lualatex\n---\n\n본문입니다.\n'
legacy_out=render({'target':'legacy.qmd','timeout':120,'files':[{'path':'legacy.qmd','source':legacy}]})
legacy_pdf=save(legacy_out,'render-legacy.pdf')
assert '612 x 792 pts' in info(legacy_pdf),info(legacy_pdf)
for s in ('LaTeX setting documentclass is not used by Typst','LaTeX setting pdf-engine is not used by Typst','LaTeX preamble (header-includes) is not used by Typst'):assert s in legacy_out['log'],legacy_out['log']
print('LaTeX settings migrate to Typst (paper size) or are reported')

# Cross references and the bibliography resolve in one Typst run.
references='''---
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

# 다음 장

한글 문장이 여러 줄에 걸쳐 표시되는지 확인합니다. 문장과 공백을 보존하고 표와 수식의 참조를 유지합니다.
'''
references_out=render({'target':'references.qmd','timeout':120,'files':[{'path':'references.qmd','source':references},{'path':'assets/pixel.png','bytes':png},{'path':'references.bib','source':'@book{knuth1984, title={The TeXbook}, author={Donald E. Knuth}, year={1984}, publisher={Addison-Wesley}}'}]})
content=words(save(references_out,'render-references.pdf'))
assert '??' not in content,content
assert all(s in content for s in ['한글','TeXbook','Figure 1','Table 1','Equation 1','Section 1']),content
print('Korean, image, math, table, bibliography and cross references passed')

# Quarto syntax qollab supports without Quarto: caption and reference names,
# callouts, two columns and page breaks; other Quarto blocks keep their content.
qmd='''---
lang: ko
crossref:
  fig-title: 도
  fig-prefix: 도면
---

# 첫 절 {#sec-first}

참조 @fig-x, 절 @sec-first, 없는 @fig-none.

![캡션](assets/pixel.png){#fig-x width=20%}

::: {.callout-warning title="주의 제목"}
경고 내용.
:::

:::: {.columns}
::: {.column width="40%"}
왼쪽 단
:::
::: {.column width="60%"}
오른쪽 단
:::
::::

::: {.panel-tabset}
탭 내용
:::

{{< pagebreak >}}

```{python}
#| echo: false
print("셀")
```
'''
qmd_out=render({'target':'qmd.qmd','timeout':120,'files':[{'path':'qmd.qmd','source':qmd},{'path':'assets/pixel.png','bytes':png}]})
qmd_pdf=save(qmd_out,'render-qmd.pdf');text=words(qmd_pdf)
for s in ('참조 도면 1, 절 첫 절, 없는 ?@fig-none','도 1: 캡션','주의 제목 경고 내용','왼쪽 단 오른쪽 단','탭 내용','print("셀")'):assert s in text,(s,text)
assert 'echo' not in text,text
assert re.search(r'Pages:\s+2\n',info(qmd_pdf)),info(qmd_pdf)
for s in ('reference to a missing label fig-none','Quarto block .panel-tabset is not supported'):assert s in qmd_out['log'],qmd_out['log']
print('Caption names, references, callouts, columns, page breaks and code cells passed')

# A project's own Typst template partials replace the qollab style.
partials='---\ntitle: "사용자 양식"\nformat:\n  typst:\n    template-partials:\n      - template/typst-template.typ\n      - template/typst-show.typ\n---\n\n본문과 \\textcolor{blue}{파란 글자}.\n'
template='#let custom(title: none, doc) = {\n  set page(paper: "a5")\n  align(center, text(size: 18pt)[#title 표지])\n  doc\n}\n'
partials_out=render({'target':'custom.qmd','timeout':120,'files':[{'path':'custom.qmd','source':partials},{'path':'template/typst-template.typ','source':template},{'path':'template/typst-show.typ','source':'#show: custom.with(title: [$title$])\n'}]})
partials_pdf=save(partials_out,'render-partials.pdf')
assert '419.528 x 595.276 pts' in info(partials_pdf),info(partials_pdf)
assert '사용자 양식 표지' in words(partials_pdf) and '파란 글자' in words(partials_pdf),words(partials_pdf)
print('Project template partials replace the default style and keep the LaTeX syntax filter')

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

# Typst finishes these documents in about a second, so this one loops on
# purpose (small arrays: Typst's range builds the whole array).
slow={'target':'slow.qmd','timeout':3,'files':[{'path':'slow.qmd','source':'```{=typst}\n#for i in range(30000) { for j in range(30000) {} }\n```\n'}]}
r=subprocess.run([a.engine,'run',*flags,a.image,'python3','/opt/qollab/render.py'],input=json.dumps(slow).encode(),capture_output=True,timeout=30)
assert r.returncode==0,r.stderr.decode()
assert json.loads(r.stdout).get('log')=='RENDER_TIMEOUT',r.stdout.decode()[:1000]
print('timeout and disposable container cleanup passed')
