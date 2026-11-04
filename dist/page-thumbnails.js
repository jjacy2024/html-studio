import {PageNavigator} from './pages.js';

// Native, script-free miniature pages. Only visible rows own frames; templates,
// fonts and document data are never copied into the editor's saved HTML.
export function bindPageThumbnails(editor,list,valid) {
  const MAX_FRAMES=6,nav=editor.pages,source=editor.doc;
  let stopped=false,scheduled=0,timer=0,base=null,loading=null;
  const frames=new Map();
  const live=()=>!stopped&&list.isConnected&&valid();
  const selector=id=>`[data-hs-id="${CSS.escape(id)}"]`;
  function reset(){for(const entry of frames.values()){clearTimeout(entry.timer);entry.frame.remove();entry.holder.dataset.state='idle';}frames.clear();loading=null;base=null;}
  function skeleton(){
    const clone=source.documentElement.cloneNode(true);
    clone.querySelectorAll('script,meta[http-equiv],style[data-hs-runtime="page-view"]').forEach(n=>n.remove());
    clone.querySelectorAll('[contenteditable],[autofocus]').forEach(n=>{n.removeAttribute('contenteditable');n.removeAttribute('autofocus');});
    // Retain page shells/order for nth-child styles; mount only one page's DOM.
    for(const page of nav.pages){const p=clone.querySelector(selector(editor.id(page)));if(p){const defs=[...p.querySelectorAll('svg:has(defs)')].map(svg=>{const copy=svg.cloneNode(false);for(const d of svg.querySelectorAll(':scope > defs'))copy.append(d.cloneNode(true));return copy;});p.replaceChildren(...defs);}}
    return clone;
  }
  function htmlFor(page){
    base ||= skeleton();
    const root=base.cloneNode(true),copy=page.cloneNode(true),slot=root.querySelector(selector(editor.id(page)));
    if(!slot)throw Error('页面已改变');slot.replaceWith(copy);
    root.querySelectorAll('script,meta[http-equiv]').forEach(n=>n.remove());
    // Embedded browsing contexts cannot be both static and an accurate preview.
    // Leave their authored box and explain the same limitation as edit mode.
    root.querySelectorAll('iframe,object,embed').forEach(n=>{n.removeAttribute('src');n.removeAttribute('srcdoc');n.removeAttribute('data');n.setAttribute('sandbox','');});
    root.querySelectorAll('video,audio').forEach(n=>{n.removeAttribute('autoplay');n.setAttribute('preload','none');});
    root.querySelectorAll('[autofocus],[contenteditable]').forEach(n=>{n.removeAttribute('autofocus');n.removeAttribute('contenteditable');});
    const style=source.createElement('style');style.dataset.hsRuntime='thumbnail';
    style.textContent='html,body{overflow:hidden!important;scroll-behavior:auto!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    root.querySelector('head').append(style);
    return '<!DOCTYPE html>\n'+root.outerHTML;
  }
  function fit(entry){
    const scale=Math.min(entry.holder.clientWidth/entry.width,entry.holder.clientHeight/entry.height);
    Object.assign(entry.frame.style,{width:entry.width+'px',height:entry.height+'px',left:(entry.holder.clientWidth-entry.width*scale)/2+'px',top:(entry.holder.clientHeight-entry.height*scale)/2+'px',transform:`scale(${scale})`});
  }
  function mount(row){
    const id=row.dataset.orderId,page=nav.pages.find(p=>editor.id(p)===id),holder=row.querySelector('.page-thumbnail');
    if(!page||!holder)return;
    const frame=document.createElement('iframe');frame.className='page-thumbnail-frame';frame.setAttribute('sandbox','allow-same-origin');frame.setAttribute('aria-hidden','true');frame.setAttribute('tabindex','-1');frame.title='页面缩略图';
    const entry={frame,holder,width:editor.width,height:editor.height,timer:0};frames.set(id,entry);loading=entry;holder.dataset.state='loading';fit(entry);
    const done=()=>{if(loading===entry)loading=null;schedule();};
    frame.addEventListener('load',()=>{
      if(!live()||frames.get(id)!==entry)return;
      try{
        const doc=frame.contentDocument;
        const proxy={doc,width:entry.width,height:entry.height,id:n=>n?.getAttribute('data-hs-id'),style:n=>doc.defaultView.getComputedStyle(n),layout(){entry.width=this.width;entry.height=this.height;fit(entry);}};
        const navigation=new PageNavigator(proxy,{id,viewport:nav.viewport});
        if(!navigation.current||proxy.id(navigation.current)!==id)throw Error('页面结构暂不能缩略显示');
        // Canvas bitmap content is not cloned; use the existing bound chart poster.
        for(const canvas of doc.querySelectorAll('canvas[data-studio-chartjs-image]')){canvas.style.backgroundImage=`url("${canvas.getAttribute('data-studio-chartjs-image')}")`;canvas.style.backgroundSize='100% 100%';}
        holder.dataset.state='ready';
      }catch{holder.dataset.state='error';holder.querySelector('.page-thumbnail-note').textContent='请打开页面查看';}
      clearTimeout(entry.timer);done();
    },{once:true});
    entry.timer=setTimeout(()=>{if(frames.get(id)===entry&&holder.dataset.state==='loading'){holder.dataset.state='error';holder.querySelector('.page-thumbnail-note').textContent='资源加载较慢';done();}},6000);
    try{frame.srcdoc=htmlFor(page);holder.append(frame);}catch{clearTimeout(entry.timer);holder.dataset.state='error';done();}
  }
  function draw(){
    scheduled=0;if(!live())return;
    const bounds=list.getBoundingClientRect();
    const rows=[...list.children].filter(row=>{const r=row.getBoundingClientRect();return r.bottom>bounds.top+1&&r.top<bounds.bottom-1;}).slice(0,MAX_FRAMES);
    const ids=new Set(rows.map(r=>r.dataset.orderId));
    for(const [id,entry] of frames){if(!ids.has(id)||!entry.frame.isConnected){clearTimeout(entry.timer);entry.frame.remove();entry.holder.dataset.state='idle';frames.delete(id);if(loading===entry)loading=null;}else fit(entry);}
    if(!loading){const row=rows.find(r=>!frames.has(r.dataset.orderId));if(row)mount(row);}
  }
  function schedule(){if(!stopped&&!scheduled)scheduled=requestAnimationFrame(draw);}
  function refresh(){if(!live())return;clearTimeout(timer);reset();schedule();}
  const observer=new MutationObserver(changes=>{
    if(!live()||changes.every(c=>(c.target.nodeType===1?c.target:c.target.parentElement)?.closest('[data-hs-runtime="page-view"]')))return;
    clearTimeout(timer);timer=setTimeout(refresh,180);
  });
  observer.observe(source.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
  const resize=new ResizeObserver(schedule);resize.observe(list);list.addEventListener('scroll',schedule,{passive:true});
  return {refresh,dispose(){stopped=true;cancelAnimationFrame(scheduled);clearTimeout(timer);observer.disconnect();resize.disconnect();list.removeEventListener('scroll',schedule);reset();}};
}
