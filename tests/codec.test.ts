import {beforeAll,describe,it,expect} from 'vitest';
import * as Y from 'yjs';
import {prosemirrorToYDoc,yXmlFragmentToProseMirrorRootNode} from 'y-prosemirror';
import {initCodec,initialize,updateDocument,getRuntime} from '../apps/server/src/codec.js';
import {decode,encode} from '../packages/codec/src/index.js';
import {renderPolicy} from '../packages/codec/src/render-policy.js';
import {readZip} from '../apps/server/src/archive.js';
import {zipSync} from 'fflate';
beforeAll(initCodec);
const fixture='---\n# Preserve this comment\ntitle: "한글 문서"\nformat: pdf\n---\n\n# Heading  {#sec-head}\n\nA **bold** paragraph.\n\n::: {.callout-note}\n\nOuter\n\n::: {.inner}\n\nNested [@citation] and @fig-demo.\n\n:::\n\n:::\n\n![Caption](assets/a.png){#fig-demo fig-alt="image" width=80%}\n\n```{python}\n#| echo: false\nprint(1)\n```\n\n\\begin{equation}\nx=2\n\\end{equation}\n';
describe('source preservation',()=>{
 it('preserves YAML, unsupported inline syntax, nested div, cells, TeX and image attrs byte-for-byte',()=>{const rt=getRuntime(),d=decode(fixture,rt);expect(d.safe).toBe(true);expect(encode(d.doc,d.preservation,rt)).toBe(fixture);});
 it('changes only one visual block and stabilizes repeated saves',()=>{const rt=getRuntime(),d=decode(fixture,rt);const json=d.doc.toJSON();const p=json.content.find((n:any)=>n.type==='paragraph');p.content[0].text='An edited ';const edited=rt.schema.nodeFromJSON(json);const output=encode(edited,d.preservation,rt);expect(output).toContain('# Preserve this comment');expect(output).toContain('::: {.inner}');expect(output).toContain('#| echo: false');expect(output).toContain('An edited **bold** paragraph.');const second=decode(output,rt);expect(encode(second.doc,second.preservation,rt)).toBe(output);});
 it.each(['---\ntitle: broken','```{r}\n1','::: {.outer}\ntext'])('blocks uncertain boundaries %s',source=>expect(initialize(source).mode).toBe('raw'));
 it('merges character changes in raw nodes and recovers durable state',()=>{
  const base=initialize(fixture);const a=new Y.Doc(),b=new Y.Doc();Y.applyUpdate(a,Buffer.from(base.state,'base64'));Y.applyUpdate(b,Buffer.from(base.state,'base64'));const changes:Uint8Array[]=[];a.on('update',u=>changes.push(u));b.on('update',u=>changes.push(u));
  const ra=(a.getXmlFragment('prosemirror').get(0) as Y.XmlElement).get(0) as Y.XmlText,rb=(b.getXmlFragment('prosemirror').get(0) as Y.XmlElement).get(0) as Y.XmlText;
  ra.insert(4,'# Alice\n');rb.insert(4,'# Bob\n');let state=base.state,source='';for(const u of changes){const result=updateDocument(state,u,base.preservation);state=result.state;source=result.source;}
  expect(source).toContain('# Alice');expect(source).toContain('# Bob');const restored=new Y.Doc();Y.applyUpdate(restored,Buffer.from(state,'base64'));expect(encode(yXmlFragmentToProseMirrorRootNode(restored.getXmlFragment('prosemirror'),getRuntime().schema),base.preservation,getRuntime())).toBe(source);a.destroy();b.destroy();restored.destroy();
 });
});
describe('render and archive boundaries',()=>{
 it.each(['filters: [evil.lua]','pre-render: evil.sh','format:\n  pdf:\n    pdf-engine-opts: [-shell-escape]','execute: true','template: /etc/passwd'])('rejects %s',source=>expect(()=>renderPolicy([{path:'_quarto.yml',source}])).toThrow());
 it('accepts static Korean math tables and images',()=>expect(()=>renderPolicy([{path:'report.qmd',source:'---\ntitle: 한글\nformat: pdf\n---\n\n$$x^2$$\n\n![이미지](assets/a.png)'}])).not.toThrow());
 it('rejects executing cells',()=>expect(()=>renderPolicy([{path:'r.qmd',source:'```{python}\nprint(1)\n```'}])).toThrow());
 it.each(['../escape.qmd','/tmp/x.qmd','.git/config','_extensions/evil.lua','assets/a.svg'])('rejects ZIP path %s',path=>expect(()=>readZip(Buffer.from(zipSync({[path]:Buffer.from('x')})))).toThrow());
 it('rejects a symlink in the ZIP central directory',()=>{const zip=Buffer.from(zipSync({'a.qmd':Buffer.from('/etc/passwd')}));const at=zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));zip.writeUInt32LE((0xa1ff<<16)>>>0,at+38);expect(()=>readZip(zip)).toThrow();});
});
it('keeps source identity for identical paragraphs with different Markdown spelling',()=>{
 const rt=getRuntime(),source='**same**\n\n__same__\n',d=decode(source,rt),json=d.doc.toJSON();json.content.shift();const out=encode(rt.schema.nodeFromJSON(json),d.preservation,rt);expect(out).toContain('__same__');expect(out).not.toContain('**same**');
});
