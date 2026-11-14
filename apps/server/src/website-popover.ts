/**
 * Previews of reference targets on published sites: hovering a reference
 * link, or holding it on a touch screen, shows the target without leaving the
 * page. The script runs in the generated VitePress theme, so it is kept as
 * source text and written into the theme with the rest of the site.
 */
export const popoverCss = (base: string) =>
  `.ref-popover{position:absolute;z-index:15;box-sizing:border-box;width:min(560px,calc(100vw - 24px));max-height:min(50vh,420px);overflow:auto;overscroll-behavior:contain;padding:12px 16px;border:1px solid var(--vp-c-divider);border-radius:8px;background:var(--vp-c-bg-elv);box-shadow:var(--vp-shadow-3);font-size:14px}` +
  `.ref-popover .vp-doc :is(h1,h2,h3,h4,h5,h6){margin:16px 0 8px;border:0;padding:0;letter-spacing:0;line-height:1.5;font-size:1em}` +
  `.ref-popover .vp-doc p{margin:8px 0;line-height:1.7}` +
  `.ref-popover .vp-doc :is(ul,ol){margin:8px 0}` +
  `.ref-popover .document-content>:first-child{margin-top:0}` +
  `.ref-popover .document-content>:last-child{margin-bottom:0}` +
  // Holding a reference shows its preview in place of the link callout and text selection.
  `.document-content a[href^="#"]:not(.header-anchor),.document-content a[href^=${JSON.stringify(base)}][href*="#"]{-webkit-touch-callout:none}` +
  `.ref-pressing{-webkit-user-select:none;user-select:none}`;

export const popoverScript = String.raw`
function referencePopovers(base){
  const pages=new Map();
  const page=(path)=>path.endsWith('/')?path+'index.html':path;
  const level=(el)=>/^H[1-6]$/.test(el.tagName)?Number(el.tagName[1]):0;
  let pop,anchor,openTimer,closeTimer,press,pressed,held=false,pointer='',run=0;
  // A reference is a link in the document body to an anchor of this site.
  const reference=(target)=>{
    const link=target instanceof Element?target.closest('a[href]'):null;
    if(!link||link.classList.contains('header-anchor')||link.closest('.ref-popover')||!link.closest('.vp-doc .document-content'))return null;
    let url;
    try{url=new URL(link.href)}catch{return null}
    return url.origin===location.origin&&url.hash.length>1&&url.pathname.startsWith(base)?link:null;
  };
  // The target's page: the open document, or the static page fetched once.
  const source=(url)=>{
    const path=page(url.pathname);
    if(path===page(location.pathname))return Promise.resolve(document);
    if(!pages.has(path))pages.set(path,fetch(path,{headers:{accept:'text/html'}}).then((r)=>{
      if(!r.ok||page(new URL(r.url).pathname)!==path)throw new Error('unavailable');
      return r.text();
    }).then((text)=>new DOMParser().parseFromString(text,'text/html')).catch(()=>{pages.delete(path);return null}));
    return pages.get(path);
  };
  // A heading brings everything up to the next heading of its level or above;
  // a label inside a list item, figure, table, quote or paragraph brings that block.
  const excerpt=(doc,url)=>{
    let id;
    try{id=decodeURIComponent(url.hash.slice(1))}catch{return null}
    let target=doc.getElementById(id);
    if(!target||!target.closest('.document-content')||target.closest('.ref-popover'))return null;
    target=target.closest('h1,h2,h3,h4,h5,h6')||target;
    const box=document.createElement('div');
    box.className='document-content';
    const depth=level(target);
    if(depth){
      for(let node=target;node;node=node.nextElementSibling){
        if(node!==target&&level(node)&&level(node)<=depth)break;
        box.append(document.importNode(node,true));
      }
    }else{
      if(target.tagName==='SPAN'&&!target.firstChild)target=target.closest('li,figure,table,blockquote')||target.closest('p')||target;
      const list=target.tagName==='LI'?target.parentElement:null;
      if(list){
        const copy=document.importNode(list,false);
        if(list.tagName==='OL'&&!target.hasAttribute('data-marker'))copy.start=list.start+[...list.children].filter((item)=>item.tagName==='LI').indexOf(target);
        copy.append(document.importNode(target,true));
        box.append(copy);
      }else box.append(document.importNode(target,true));
    }
    for(const el of box.querySelectorAll('.header-anchor'))el.remove();
    for(const el of box.querySelectorAll('[id]'))el.removeAttribute('id');
    for(const el of box.querySelectorAll('[tabindex]'))el.removeAttribute('tabindex');
    // Links and images keep pointing where they did on the target's page.
    for(const [selector,name] of [['a[href]','href'],['img[src]','src']])for(const el of box.querySelectorAll(selector)){
      try{el.setAttribute(name,new URL(el.getAttribute(name),url).href)}catch{}
    }
    return box;
  };
  const place=(link,point)=>{
    const rects=[...link.getClientRects()];
    const rect=rects.find((r)=>point.x>=r.left-1&&point.x<=r.right+1&&point.y>=r.top-1&&point.y<=r.bottom+1)||rects[0];
    if(!rect)return false;
    const margin=12,gap=6,below=window.innerHeight-rect.bottom-gap-margin,above=rect.top-gap-margin;
    const down=pop.offsetHeight<=below||below>=above,room=Math.max(down?below:above,96);
    if(pop.offsetHeight>room)pop.style.maxHeight=room+'px';
    pop.style.left=Math.max(margin,Math.min(rect.left,document.documentElement.clientWidth-pop.offsetWidth-margin))+window.scrollX+'px';
    pop.style.top=(down?rect.bottom+gap:rect.top-gap-pop.offsetHeight)+window.scrollY+'px';
    return true;
  };
  const hide=()=>{clearTimeout(closeTimer);run++;pop?.remove();pop=anchor=undefined};
  const close=()=>{clearTimeout(openTimer);hide()};
  const leave=()=>{clearTimeout(closeTimer);closeTimer=setTimeout(hide,200)};
  const open=async(link,point)=>{
    clearTimeout(openTimer);clearTimeout(closeTimer);
    const current=++run,url=new URL(link.href);
    anchor=link;
    const doc=await source(url);
    if(current!==run)return;
    const box=doc&&link.isConnected?excerpt(doc,url):null;
    pop?.remove();pop=undefined;
    if(!box){anchor=undefined;return}
    pop=document.createElement('div');
    pop.className='ref-popover';
    const body=document.createElement('div');
    body.className='vp-doc';
    body.append(box);
    pop.append(body);
    pop.addEventListener('pointerenter',()=>clearTimeout(closeTimer));
    pop.addEventListener('pointerleave',(e)=>{if(e.pointerType!=='touch')leave()});
    document.body.append(pop);
    if(!place(link,point))hide();
  };
  document.addEventListener('pointerover',(e)=>{
    if(e.pointerType==='touch')return;
    const link=reference(e.target);
    if(!link)return;
    if(link===anchor){clearTimeout(closeTimer);return}
    const point={x:e.clientX,y:e.clientY};
    clearTimeout(openTimer);
    openTimer=setTimeout(()=>open(link,point),250);
  });
  document.addEventListener('pointerout',(e)=>{
    if(e.pointerType==='touch')return;
    const link=reference(e.target);
    if(!link||(e.relatedTarget instanceof Node&&link.contains(e.relatedTarget)))return;
    clearTimeout(openTimer);
    if(link!==anchor)return;
    if(pop)leave();else hide();
  });
  // Touch: holding a reference opens its preview, and the release does not follow the link.
  const release=()=>{clearTimeout(press?.timer);press=undefined;pressed?.classList.remove('ref-pressing');pressed=undefined};
  const hold=(link,point)=>{clearTimeout(press?.timer);press=undefined;held=true;open(link,point)};
  document.addEventListener('pointerdown',(e)=>{
    pointer=e.pointerType;held=false;
    const link=reference(e.target);
    if(anchor&&link!==anchor&&!(pop&&e.target instanceof Node&&pop.contains(e.target)))close();
    if(e.pointerType!=='touch'||!e.isPrimary||!link)return;
    release();
    const point={x:e.clientX,y:e.clientY};
    pressed=link;
    link.classList.add('ref-pressing');
    press={link,point,timer:setTimeout(()=>hold(link,point),500)};
  });
  document.addEventListener('pointermove',(e)=>{
    if(press&&e.pointerType==='touch'&&Math.hypot(e.clientX-press.point.x,e.clientY-press.point.y)>10)release();
  });
  for(const type of ['pointerup','pointercancel'])document.addEventListener(type,(e)=>{if(e.pointerType==='touch')release()});
  // Where a long press opens the link menu, the preview replaces it.
  document.addEventListener('contextmenu',(e)=>{
    if(pointer!=='touch')return;
    const link=reference(e.target);
    if(!link)return;
    e.preventDefault();
    if(press||link!==anchor)hold(link,{x:e.clientX,y:e.clientY});
  });
  for(const type of ['touchend','touchcancel'])document.addEventListener(type,(e)=>{
    if(!held)return;
    held=false;
    if(e.cancelable)e.preventDefault();
  },{passive:false});
  document.addEventListener('click',(e)=>{if(anchor&&e.target instanceof Element&&e.target.closest('a'))close()});
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape')close()});
  window.addEventListener('popstate',close);
  window.addEventListener('resize',close);
}
`;
