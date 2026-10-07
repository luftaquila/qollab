import { $node } from '@milkdown/kit/utils';
import { imageBlockSchema } from '@milkdown/kit/component/image-block';
export const rawNode=$node('qollab_raw',()=>({
  group:'block',content:'text*',marks:'',code:true,defining:true,isolating:true,
  parseDOM:[{tag:'pre[data-qollab-raw]'}],toDOM:()=>['pre',{'data-qollab-raw':'true',class:'qollab-raw',spellcheck:'false'},['code',0]],
  parseMarkdown:{match:()=>false,runner:()=>{}},
  toMarkdown:{match:n=>n.type.name==='qollab_raw',runner:(state,node)=>{state.addNode('code',undefined,node.textContent,{lang:'quarto-source'});}}
}));
export const imageAttributes=imageBlockSchema.extendSchema(prev=>ctx=>{
 const schema=prev(ctx); return {...schema,attrs:{...schema.attrs,alt:{default:''},width:{default:''},align:{default:''},identifier:{default:''}}};
});
