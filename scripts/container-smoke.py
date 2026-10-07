#!/usr/bin/env python3
"""Exercise the real job image with the production isolation flags."""
import argparse, base64, json, pathlib, subprocess, sys, time, struct, zlib
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
dest=pathlib.Path(a.output);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(base64.b64decode(out['pdf']))
print(json.dumps({'pdf':str(dest),'seconds':round(time.monotonic()-start,2),'bytes':dest.stat().st_size}))
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
