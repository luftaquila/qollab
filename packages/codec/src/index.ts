import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Node as PMNode, Schema } from '@milkdown/kit/prose/model';

export const SCHEMA_VERSION = 1;
export interface CodecRuntime { schema: Schema; parse: (source: string) => PMNode; serialize: (doc: PMNode) => string }
export interface Segment { key: string; source: string; before: string }
export interface Preservation { segments: Segment[]; suffix: string; original: string; fingerprint: string }
export interface Decoded { doc: PMNode; preservation: Preservation; safe: boolean; reason?: string }
const parser = unified().use(remarkParse).use(remarkGfm);
const key = (node: PMNode) => JSON.stringify(node.toJSON());

// A deliberately conservative boundary: unsupported inline syntax promotes its
// containing block to editable raw text. Never guess where malformed fences end.
function ranges(source: string): {start:number;end:number;raw:boolean}[] {
  const result: {start:number;end:number;raw:boolean}[] = [];
  let cursor = 0;
  if (/^---\r?\n/.test(source)) {
    const end = /^---\s*$/gm; end.lastIndex = source.indexOf('\n') + 1;
    const match = end.exec(source);
    if (!match) throw new Error('UNCLOSED_YAML');
    cursor = match.index + match[0].length;
    result.push({start:0,end:cursor,raw:true});
  }
  const rest = source.slice(cursor);
  let fence = ''; let depth = 0;
  for (const line of rest.split('\n')) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) { if (!fence) fence=f[1]; else if(f[1][0]===fence[0] && f[1].length>=fence.length) fence=''; continue; }
    if(fence) continue;
    if (/^\s*:{3,}/.test(line)) { if(/^\s*:{3,}\s*$/.test(line)) depth--; else depth++; if(depth<0) throw new Error('DIV_BOUNDARY'); }
  }
  if(fence || depth) throw new Error('UNCLOSED_STRUCTURE');
  const tree = parser.parse(rest);
  const nodes = tree.children;
  let divStart: number | null = null; let divDepth=0;
  for (const child of nodes) {
    const start=cursor+child.position!.start.offset!;
    const end=cursor+child.position!.end.offset!;
    const text=source.slice(start,end);
    for(const line of text.split('\n')) {
      if(/^\s*:{3,}/.test(line)) {
        if(/^\s*:{3,}\s*$/.test(line)) divDepth--; else {if(divStart===null) divStart=start; divDepth++;}
      }
    }
    if(divStart!==null) { if(divDepth===0) {result.push({start:divStart,end,raw:true});divStart=null;} continue; }
    const raw = ['html','definition','footnoteDefinition'].includes(child.type)
      || /(?:\{[#.=]|\{\{|\[@|(?<![\w])@[a-zA-Z][\w:-]*|\[\^|^\s*#\||```\{|~~~\{|\\(?:begin|end|input|include|newcommand)|\]\{)/m.test(text);
    result.push({start,end,raw});
  }
  return result;
}
export function decode(source: string, rt: CodecRuntime): Decoded {
  const segments: Segment[]=[]; const children: PMNode[]=[]; let end=0;
  try {
    for(const r of ranges(source)) {
      const text=source.slice(r.start,r.end);
      let parsed: PMNode[]=[];
      const figure=/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)(?:\{([^}]*)\})?$/.exec(text);
      if(figure){const attrs=figure[4]||'';const known=attrs.replace(/#[\w-]+|(?:fig-alt|width|fig-align)=(?:"[^"]*"|'[^']*'|[^\s]+)/g,'').trim();
       if(!known){const prop=(name:string)=>new RegExp(name+'=(?:"([^"]*)"|\'([^\']*)\'|([^\\s]+))').exec(attrs)?.slice(1).find(v=>v!==undefined)||'';
       parsed=[rt.schema.nodes['image-block'].create({src:figure[2],caption:figure[1],alt:prop('fig-alt'),width:prop('width'),align:prop('fig-align'),identifier:/#([\w-]+)/.exec(attrs)?.[1]||''})];}
      }
      if(parsed.length){}
      else if(r.raw) parsed=[rt.schema.nodes.qollab_raw.create(null, text ? rt.schema.text(text) : undefined)];
      else rt.parse(text).forEach(n=>parsed.push(n));
      if(parsed.length!==1) parsed=[rt.schema.nodes.qollab_raw.create(null, text ? rt.schema.text(text) : undefined)];
      const first=parsed[0];const node=first.type.create({...first.attrs,qollabId:`source-${r.start}`},first.content,first.marks);children.push(node);
      segments.push({key:key(node),source:text,before:source.slice(end,r.start)});end=r.end;
    }
    const doc=rt.schema.node('doc',null,children.length ? children : [rt.schema.node('paragraph')]);
    return {doc,safe:true,preservation:{segments,suffix:source.slice(end),original:source,fingerprint:key(doc)}};
  } catch(error) {
    const doc=rt.schema.node('doc',null,[rt.schema.nodes.qollab_raw.create(null,source ? rt.schema.text(source) : undefined)]);
    return {doc,safe:false,reason:(error as Error).message,preservation:{segments:[],suffix:'',original:source,fingerprint:key(doc)}};
  }
}
export function encode(doc: PMNode, saved: Preservation, rt: CodecRuntime): string {
  doc.check();
  if(key(doc)===saved.fingerprint) return saved.original;
  const used=new Set<number>(); const output:string[]=[];
  doc.forEach(node=>{
    const match=saved.segments.findIndex((s,i)=>!used.has(i)&&s.key===key(node));
    if(match>=0) {used.add(match);const s=saved.segments[match];output.push((output.length ? s.before || '\n\n' : s.before)+s.source);}
    else {const rendered=node.type.name==='qollab_raw' ? node.textContent : render(node,rt);output.push((output.length?'\n\n':'')+rendered.trimEnd());}
  });
  return output.join('')+saved.suffix;
}
function render(node: PMNode, rt: CodecRuntime): string {
  if(node.type.name==='image-block') {
    const a=node.attrs;
    const safe=(s:unknown)=>String(s||'').replaceAll('"','\\"').replaceAll('\n',' ');
    let attrs='';
    if(a.identifier) attrs+=` #${safe(a.identifier)}`;
    if(a.alt) attrs+=` fig-alt="${safe(a.alt)}"`;
    if(a.width) attrs+=` width="${safe(a.width)}"`;
    if(a.align) attrs+=` fig-align="${safe(a.align)}"`;
    return `![${String(a.caption||'').replaceAll(']','\\]')}](${a.src})${attrs?'{' + attrs.trim() + '}':''}`;
  }
  return rt.serialize(rt.schema.node('doc',null,[node]));
}
export function validateDocument(doc: PMNode) {
  let count=0;
  doc.descendants(node=>{
    if(++count>100000) throw new Error('DOCUMENT_COMPLEXITY');
    if(node.type.name==='image' || node.type.name==='image-block') {
      const src=String(node.attrs.src||'');
      if(/^(?:blob:|data:|javascript:|file:|\/)/i.test(src) || src.includes('\\')) throw new Error('IMAGE_PATH');
    }
    if(node.type.name==='qollab_raw' && /(?:blob:|data:image\/)/i.test(node.textContent)) throw new Error('IMAGE_PATH');
  });
}
