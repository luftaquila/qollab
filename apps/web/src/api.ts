let csrf='';
export function setCsrf(value:string){csrf=value;}
export async function api<T=any>(path:string,method='GET',body?:unknown):Promise<T>{
 const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method==='GET'?{}:{'x-csrf-token':csrf})},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok){const e=await r.json().catch(()=>({code:'NETWORK'}));throw Object.assign(new Error(e.code),e);}return r.json();
}
export async function base64(file:Blob){const bytes=new Uint8Array(await file.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
export function downloadText(name:string,source:string){const url=URL.createObjectURL(new Blob([source],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
