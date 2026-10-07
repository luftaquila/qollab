import * as Y from 'yjs';
import {Awareness} from 'y-protocols/awareness';
import {SCHEMA_VERSION,type Preservation} from '../../../packages/codec/src/index';
const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const base64=(b:Uint8Array)=>{let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);};
export class DocumentSession {
 readonly doc=new Y.Doc();readonly awareness=new Awareness(this.doc);readonly outbox=new Map<string,string>();
 preservation?:Preservation;private ws?:WebSocket;private timer?:ReturnType<typeof setTimeout>;private stopped=false;private retry=0;private ready=false;
 onReady?:()=>void;onStatus?:(status:string)=>void;onRevision?:(revision:number)=>void;
 constructor(readonly project:string,readonly file:string,readonly epoch:number,readonly user:{name:string}){
  this.doc.on('update',(update:Uint8Array,origin:unknown)=>{if(origin==='remote')return;const id=crypto.randomUUID(),value=base64(update);this.outbox.set(id,value);this.onStatus?.('saving');this.send({type:'update',id,update:value});});
  this.awareness.setLocalStateField('user',{name:user.name,color:'#237f79'});
  this.awareness.on('update',({added,updated,removed}:any,origin:unknown)=>{if(origin==='remote')return;if([...added,...updated,...removed].includes(this.doc.clientID))this.send({type:'presence',state:this.awareness.getLocalState()});});
 }
 connect(){
  if(this.stopped)return;const url=new URL(`/api/projects/${this.project}/documents/${this.file}/ws`,location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';url.search=new URLSearchParams({epoch:String(this.epoch),schema:String(SCHEMA_VERSION),clientId:String(this.doc.clientID)}).toString();
  this.ws=new WebSocket(url);this.ws.onmessage=e=>{
   const m=JSON.parse(e.data);
   if(m.type==='sync'){
    Y.applyUpdate(this.doc,bytes(m.state),'remote');this.preservation=m.preservation;this.retry=0;this.onRevision?.(m.revision);
    if(!this.ready){this.ready=true;this.onReady?.();}for(const [id,update] of this.outbox)this.send({type:'update',id,update});this.send({type:'presence',state:this.awareness.getLocalState()});this.onStatus?.(this.outbox.size?'saving':'saved');
   }else if(m.type==='update'){Y.applyUpdate(this.doc,bytes(m.update),'remote');this.onRevision?.(m.revision);}
   else if(m.type==='ack'){this.outbox.delete(m.id);this.onRevision?.(m.revision);this.onStatus?.(this.outbox.size?'saving':'saved');}
   else if(m.type==='presence'){
    if(m.clientId===this.doc.clientID)return;const states=this.awareness.getStates(),existed=states.has(m.clientId);if(m.state)states.set(m.clientId,m.state);else states.delete(m.clientId);
    this.awareness.emit('change',[{added:m.state&&!existed?[m.clientId]:[],updated:m.state&&existed?[m.clientId]:[],removed:!m.state?[m.clientId]:[]},'remote']);
   }else if(m.type==='error'){this.onStatus?.(m.code);}
  };
  this.ws.onclose=e=>{if(this.stopped)return;if(e.code>=4400){this.stopped=true;this.onStatus?.('stale');return;}this.onStatus?.('offline');this.timer=setTimeout(()=>this.connect(),Math.min(1000*2**this.retry++,15000));};
 }
 private send(data:unknown){if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(data));}
 destroy(){this.stopped=true;clearTimeout(this.timer);this.awareness.setLocalState(null);this.ws?.close();this.awareness.destroy();this.doc.destroy();}
}
