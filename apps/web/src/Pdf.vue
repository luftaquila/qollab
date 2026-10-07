<script setup lang="ts">
import {ref,shallowRef,watch,onBeforeUnmount,nextTick} from 'vue';
import {getDocument,GlobalWorkerOptions,type PDFDocumentProxy,type RenderTask} from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {t} from './i18n';
GlobalWorkerOptions.workerSrc=worker;
const props=defineProps<{project:string;build?:string}>();const doc=shallowRef<PDFDocumentProxy>();const container=ref<HTMLElement>();const pages=ref<number[]>([]);const zoom=ref(1);const error=ref('');
let task:ReturnType<typeof getDocument>|undefined,observer:IntersectionObserver|undefined,version=0;const renders=new Set<RenderTask>();const rendered=new Set<number>();
async function paint(page:number,element:HTMLCanvasElement,v:number){
 if(!doc.value||rendered.has(page))return;rendered.add(page);
 try{const p=await doc.value.getPage(page);if(v!==version)return;const viewport=p.getViewport({scale:zoom.value}),ratio=Math.min(devicePixelRatio,2);element.height=viewport.height*ratio;element.width=viewport.width*ratio;element.style.width=viewport.width+'px';element.style.height=viewport.height+'px';const r=p.render({canvas:element,viewport,transform:[ratio,0,0,ratio,0,0]});renders.add(r);await r.promise;renders.delete(r);}catch(e:any){if(e.name!=='RenderingCancelledException')error.value=e.message;}
}
async function observe(){await nextTick();const v=version;observer?.disconnect();observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)void paint(Number((e.target as HTMLElement).dataset.page),e.target.querySelector('canvas')!,v);},{root:container.value,rootMargin:'600px'});container.value?.querySelectorAll('[data-page]').forEach(e=>observer!.observe(e));}
watch(()=>props.build,async()=>{
 const v=++version,scroll=container.value?.scrollTop||0;error.value='';observer?.disconnect();for(const r of renders)r.cancel();renders.clear();rendered.clear();await task?.destroy();doc.value=undefined;pages.value=[];
 if(!props.build)return;
 try{task=getDocument({url:`/api/projects/${props.project}/pdf?build=${props.build}`,withCredentials:true});const pdf=await task.promise;if(v!==version){await task.destroy();return;}doc.value=pdf;pages.value=Array.from({length:pdf.numPages},(_,i)=>i+1);await observe();if(container.value)container.value.scrollTop=scroll;}catch(e:any){if(v===version)error.value=e.message;}
},{immediate:true});
watch(zoom,()=>{version++;for(const r of renders)r.cancel();renders.clear();rendered.clear();void observe();});
onBeforeUnmount(()=>{version++;observer?.disconnect();for(const r of renders)r.cancel();void task?.destroy();});
</script>
<template><div class="pdf-panel"><div class="pdf-tools"><span>{{t('pdf')}}</span><span class="spacer"/><button @click="zoom=Math.max(.4,zoom-.1)">−</button><span>{{Math.round(zoom*100)}}%</span><button @click="zoom=Math.min(2,zoom+.1)">+</button><a v-if="build" :href="`/api/projects/${project}/pdf`" download="document.pdf">↓ {{t('download')}}</a></div><div ref="container" class="pdf-pages"><div v-if="!build" class="pdf-empty"><div class="paper-icon">PDF</div><p>{{t('noPdf')}}</p></div><p v-if="error" class="notice">{{error}}</p><div v-for="page in pages" :key="page" :data-page="page" class="pdf-page" :style="{minHeight:800*zoom+'px'}"><canvas/><small>{{page}}</small></div></div></div></template>
