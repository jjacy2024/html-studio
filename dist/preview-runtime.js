// Serialized into the opaque preview. Keep this function self-contained.
export function installPreviewRuntime(token, loader) {
  let scriptFailed = false, inspection = 0, loaded = false;
  const rect = node => {
    if (!node) return null;
    const r = node.getBoundingClientRect(), s = getComputedStyle(node);
    return {width:Math.round(r.width),height:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y),
      display:s.display,visibility:s.visibility,opacity:s.opacity,transform:s.transform,
      cssWidth:s.width,cssHeight:s.height,position:s.position,contentVisibility:s.contentVisibility,
      hidden:node.hasAttribute('hidden'),connected:node.isConnected,rects:node.getClientRects().length};
  };
  const identify = node => `${node.localName}${node.id?'#'+node.id.slice(0,80):''}${[...node.classList].slice(0,4).map(c=>'.'+c.slice(0,60)).join('')}`;
  const ancestry = node => {
    const result=[];
    for(let p=node;p&&result.length<10;p=p.parentElement)result.push({element:identify(p),...rect(p)});
    return result;
  };
  const details = () => {
    try {
      const active = document.querySelector('.slide.active,.slide.visible,.slide.present,[data-deck-active]');
      const stage = document.querySelector('#deckStage,.deck-stage,deck-stage,.slides');
      return {loader,readyState:document.readyState,viewport:[innerWidth,innerHeight],
        visibilityState:document.visibilityState,stylesheets:document.styleSheets.length,printMedia:matchMedia('print').matches,
        nodes:document.getElementsByTagName('*').length,scripts:document.scripts.length,
        pages:document.querySelectorAll('.slide,[data-slide]').length,
        activePages:document.querySelectorAll('.slide.active,.slide.visible,.slide.present,[data-deck-active]').length,
        presentation:typeof window.presentation?.showSlide === 'function',deck:typeof window.deck?.show === 'function',
        active:rect(active),stage:rect(stage),root:rect(document.documentElement),body:rect(document.body),
        ancestors:ancestry((active||stage)?.parentElement||document.body)};
    } catch { return {loader,readyState:document.readyState,viewport:[innerWidth,innerHeight]}; }
  };
  const report = (state,message='') => parent.postMessage({previewStatus:token,state,message,details:details()},'*');
  const fail = message => { scriptFailed = true; report('error',String(message).slice(0,1000)); };
  addEventListener('error',event=>{
    if(event.message)fail(event.message);
    else if(event.target?.tagName==='SCRIPT')fail('页面脚本未能加载，请检查原 HTML 的外部依赖。');
  },true);
  addEventListener('unhandledrejection',event=>fail(event.reason?.message||event.reason||'页面脚本出现未处理的错误。'));
  document.addEventListener('studio-preview-navigation-error',event=>fail(event.detail));
  document.addEventListener('securitypolicyviolation',event=>{
    if(event.effectiveDirective?.startsWith('script-src'))fail('原 HTML 的内容安全策略阻止了预览脚本。');
  });
  const inspect = (settled=false) => {
    if(scriptFailed)return;
    const version=++inspection;
    const visible=node=>{
      const r=node.getBoundingClientRect();
      if(r.width<=0||r.height<=0||r.bottom<=0||r.right<=0||r.top>=innerHeight||r.left>=innerWidth)return false;
      if(getComputedStyle(node).visibility==='hidden')return false;
      for(let p=node;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||Number(s.opacity)===0)return false;}
      return true;
    };
    const nodes=document.querySelectorAll('h1,h2,h3,p,svg,img,canvas,video,table,button,div,span,section');
    let index=0,hasContent=false;
    const scan=()=>{
      if(scriptFailed||version!==inspection)return;
      const deadline=performance.now()+8;
      let visited=0;
      while(index<nodes.length&&visited++<120){
        const node=nodes[index++];
        if(node.matches('svg,img,canvas,video,table')||[...node.childNodes].some(c=>c.nodeType===3&&c.textContent.trim())){
          hasContent=true;
          if(visible(node)){report('ready');return;}
        }
        if(performance.now()>=deadline)break;
      }
      if(index<nodes.length){setTimeout(scan,0);return;}
      if(hasContent){if(settled)report('empty','页面已载入，但没有检测到可见内容；可能是播放脚本未启动或内容被隐藏。');}
      else report('ready');
    };
    scan();
  };
  document.addEventListener('DOMContentLoaded',()=>{
    loaded=true;parent.postMessage({previewMounted:token},'*');
    setTimeout(inspect,350);setTimeout(()=>inspect(true),3500);
  },{once:true});
  document.addEventListener('studio-preview-page-ready',()=>setTimeout(inspect,350),{once:true});
  let resizeTimer;
  addEventListener('resize',()=>{if(loaded){clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>inspect(true),100);}});
  // Preserve safe fragment navigation without granting same-origin access.
  for(const method of ['pushState','replaceState']){
    const native=history[method];
    history[method]=function(...args){
      if(typeof args[2]==='string'&&args[2].startsWith('#')&&location.href.startsWith('about:srcdoc'))args[2]=location.href.split('#')[0]+args[2];
      return Reflect.apply(native,this,args);
    };
  }
  const urls=new Map();
  addEventListener('message',event=>{
    if(event.source!==parent||event.data?.token!==token)return;
    if(event.data.inspect){parent.postMessage({previewInspection:token,request:event.data.inspect,details:details()},'*');return;}
    if(!event.data.fontCSS)return;
    const update=event.data;
    for(const e of update.entries)if(!urls.has(e.url))urls.set(e.url,URL.createObjectURL(e.blob));
    const replace=text=>{for(const [from,to] of update.pairs)text=text.split(from).join(to.replace(/blob:[a-zA-Z0-9:/._-]+/g,url=>urls.get(url)||url));return text;};
    for(const style of document.querySelectorAll('style')){const next=replace(style.textContent);if(next!==style.textContent)style.textContent=next;}
  });
  report('loading');
}
