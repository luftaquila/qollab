<script setup lang="ts">
import {ref,shallowRef,onMounted,onBeforeUnmount} from 'vue';
import {CrepeBuilder} from '@milkdown/crepe/builder';
import {topBar} from '@milkdown/crepe/feature/top-bar';
import {listItem} from '@milkdown/crepe/feature/list-item';
import {linkTooltip} from '@milkdown/crepe/feature/link-tooltip';
import {cursor} from '@milkdown/crepe/feature/cursor';
import {imageBlock} from '@milkdown/crepe/feature/image-block';
import {table} from '@milkdown/crepe/feature/table';
import {codeMirror} from '@milkdown/crepe/feature/code-mirror';
import {latex} from '@milkdown/crepe/feature/latex';
import {placeholder} from '@milkdown/crepe/feature/placeholder';
import {blockEdit} from '@milkdown/crepe/feature/block-edit';
import {syncHeadingIdPlugin} from '@milkdown/kit/preset/commonmark';
import {history} from '@milkdown/kit/plugin/history';
import {trailing} from '@milkdown/kit/plugin/trailing';
import {collab,collabServiceCtx} from '@milkdown/plugin-collab';
import {editorViewCtx,parserCtx,serializerCtx,schemaCtx} from '@milkdown/kit/core';
import {undo,redo} from 'y-prosemirror';
import {rawNode,imageAttributes,sourceIds} from '../../../packages/codec/src/schema';
import {encode} from '../../../packages/codec/src/index';
import {DocumentSession} from './session';
import {api,base64,downloadText} from './api';
import {t,errorText} from './i18n';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/classic.css';
const props=defineProps<{project:any;file:any;user:any}>();
const emit=defineEmits(['revision','changed','error']);
const host=ref<HTMLElement>();const editor=shallowRef<CrepeBuilder>();const session=shallowRef<DocumentSession>();const status=ref('loading');const ready=ref(false);let disposed=false;
const uploadIds=new WeakMap<File,string>();
async function upload(file:File){
 const id=uploadIds.get(file)||crypto.randomUUID();uploadIds.set(file,id);
 try{const r=await api(`/projects/${props.project.id}/images`,'POST',{revision:Number(props.project.revision),uploadId:id,name:file.name||'image.png',bytes:await base64(file),documentId:props.file.id});emit('revision',r.revision);emit('changed');return r.result.relative;}catch(e:any){emit('error',e.code);throw e;}
}
function proxy(src:string){
 try{if(/^[a-z]+:|^\/\//i.test(src))return '';const resolved=new URL(src,'https://project.invalid/'+props.file.path);return `/api/projects/${props.project.id}/resource?path=${encodeURIComponent(decodeURIComponent(resolved.pathname.slice(1)))}`;}catch{return '';}
}
onMounted(()=>{
 const s=new DocumentSession(props.project.id,props.file.id,props.file.epoch,props.user);session.value=s;
 s.onStatus=v=>{status.value=v;if(v==='stale')editor.value?.setReadonly(true);};s.onRevision=r=>emit('revision',r);
 s.onReady=async()=>{
  if(disposed)return;
  const c=new CrepeBuilder({root:host.value!});editor.value=c;
  c.addFeature(topBar,{headingOptions:[{label:t('text'),level:null},...Array.from({length:6},(_,i)=>({label:`${t('heading')} ${i+1}`,level:i+1}))]})
   .addFeature(listItem).addFeature(linkTooltip,{inputPlaceholder:t('link')}).addFeature(cursor)
   .addFeature(imageBlock,{onUpload:upload,inlineOnUpload:upload,blockOnUpload:upload,proxyDomURL:proxy,blockCaptionPlaceholderText:t('caption'),blockUploadPlaceholderText:t('upload'),inlineUploadPlaceholderText:t('upload')})
   .addFeature(table).addFeature(codeMirror,{languages:[],searchPlaceholder:t('search'),copyText:t('copy'),noResultText:t('noResult'),previewToggleText:v=>v?t('edit'):t('hide')})
   .addFeature(latex,{katexOptions:{trust:false,strict:'error'}}).addFeature(placeholder,{text:t('placeholder')})
   .addFeature(blockEdit,{textGroup:{label:t('text'),text:{label:t('text')},h1:{label:`${t('heading')} 1`},h2:{label:`${t('heading')} 2`},h3:{label:`${t('heading')} 3`},h4:{label:`${t('heading')} 4`},h5:{label:`${t('heading')} 5`},h6:{label:`${t('heading')} 6`},quote:{label:t('quote')},divider:{label:t('divider')}},listGroup:{label:t('list'),bulletList:{label:t('bullet')},orderedList:{label:t('ordered')},taskList:{label:t('task')}},advancedGroup:{label:t('advanced'),image:{label:t('images')},codeBlock:{label:t('code')},table:{label:t('table')},math:{label:t('math')}}});
  await c.editor.remove(syncHeadingIdPlugin);await c.editor.remove(history);await c.editor.remove(trailing);c.editor.use(rawNode).use(imageAttributes).use(sourceIds).use(collab);
  try{await c.create();if(disposed){await c.destroy();return;}c.editor.action(ctx=>{ctx.get(collabServiceCtx).bindDoc(s.doc).setAwareness(s.awareness).connect();});c.setReadonly(props.project.role==='viewer');ready.value=true;}catch(e:any){emit('error',e.message);}
 };
 s.connect();window.addEventListener('beforeunload',beforeUnload);
});
function beforeUnload(e:BeforeUnloadEvent){if(session.value?.outbox.size){e.preventDefault();e.returnValue='';}}
function runUndo(isRedo=false){editor.value?.editor.action(ctx=>{const view=ctx.get(editorViewCtx);(isRedo?redo:undo)(view.state);view.focus();});}
function source(){if(!editor.value||!session.value?.preservation)return props.file.source||'';return editor.value.editor.action(ctx=>encode(ctx.get(editorViewCtx).state.doc,session.value!.preservation!,{schema:ctx.get(schemaCtx),parse:ctx.get(parserCtx),serialize:ctx.get(serializerCtx)}));}
function insertImage(attrs:any){editor.value?.editor.action(ctx=>{const v=ctx.get(editorViewCtx),type=v.state.schema.nodes['image-block'];v.dispatch(v.state.tr.replaceSelectionWith(type.create(attrs)));v.focus();});}
function insertRaw(text:string){editor.value?.editor.action(ctx=>{const v=ctx.get(editorViewCtx);v.dispatch(v.state.tr.replaceSelectionWith(v.state.schema.nodes.qollab_raw.create(null,v.state.schema.text(text))));});}
defineExpose({source,insertImage,insertRaw,pending:()=>session.value?.outbox.size||0});
onBeforeUnmount(()=>{disposed=true;window.removeEventListener('beforeunload',beforeUnload);if(editor.value)void editor.value.destroy().finally(()=>session.value?.destroy());else session.value?.destroy();});
</script>
<template>
 <div class="editor-session">
  <div class="edit-status"><span :class="['status-dot',status]"/>{{ ['loading','saving','saved','offline','stale'].includes(status)?t(status as any):errorText(status) }}<span class="spacer"/><button :disabled="!ready||project.role==='viewer'" @click="runUndo()" :title="t('undo')">↶</button><button :disabled="!ready||project.role==='viewer'" @click="runUndo(true)" :title="t('redo')">↷</button><button @click="downloadText(file.path,source())">{{t('downloadPending')}}</button></div>
  <div v-if="status==='stale'" class="notice">{{t('stale')}}</div>
  <div ref="host" class="editor-host"/>
 </div>
</template>
