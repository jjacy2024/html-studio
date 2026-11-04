import { watchTemplateFontPreview } from './template-fonts.js';

// A preview owns a new browsing context, created while visible. Never navigate
// the iframe that spent the editing session hidden or reuse a failed renderer.
export function startCanvasPreview(placeholder, html, assets, onStatus) {
  let frame=placeholder, session=null, cancelled=false, attempt=0, raf=0, timer=0, sequence=0, firstFailure=null;
  const meta=()=>({frameStrategy:'fresh-visible',automaticRebuilds:attempt,firstLayoutFailure:firstFailure});
  const annotate=status=>({...status,details:{...status.details,...meta()}});
  const makeFrame=hidden=>{
    const next=document.createElement('iframe');
    next.id=frame.id;next.title=frame.title;next.setAttribute('sandbox','allow-scripts');next.hidden=hidden;
    return next;
  };
  const hostVisible=()=>{
    const r=frame.getBoundingClientRect();
    if(r.width<=0||r.height<=0||r.bottom<=0||r.right<=0||r.top>=innerHeight||r.left>=innerWidth)return false;
    for(let n=frame;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||s.contentVisibility==='hidden')return false;}
    return true;
  };
  const missingLayout=status=>{
    const d=status.details,r=d?.root;
    return status.state==='empty'&&d?.readyState==='complete'&&d.visibilityState==='visible'&&
      d.viewport?.[0]>0&&d.viewport?.[1]>0&&r?.connected&&r.rects===0&&r.width===0&&r.height===0&&
      r.display!=='none'&&r.display!=='contents'&&r.visibility==='visible'&&r.contentVisibility!=='hidden'&&
      !r.hidden&&Number(r.opacity)>0&&hostVisible();
  };
  const stopPending=()=>{cancelAnimationFrame(raf);clearTimeout(timer);session?.();session=null;};
  const mount=()=>{
    stopPending();const current=++sequence;
    const next=makeFrame(false);frame.replaceWith(next);frame=next;
    let started=false;
    const start=()=>{
      if(started||cancelled||current!==sequence||!frame.isConnected)return;
      started=true;cancelAnimationFrame(raf);clearTimeout(timer);
      // Force the visible host's layout before its document is initialized.
      frame.getBoundingClientRect();
      session=watchTemplateFontPreview(frame,html,assets,{onStatus:status=>{
        if(cancelled||current!==sequence)return;
        if(missingLayout(status)){
          if(attempt===0){
            firstFailure={root:status.details.root,viewport:status.details.viewport};attempt=1;
            onStatus(annotate({state:'loading',message:'检测到预览文档没有生成布局，正在重新初始化…',details:status.details}));
            mount();return;
          }
          status={...status,message:'预览文档已加载，但浏览器仍未生成页面布局；已尝试重建一次，请查看诊断或重新播放。'};
        }
        onStatus(annotate(status));
      }});
    };
    // Let the new visible frame reach a rendering opportunity. Bound the wait
    // when requestAnimationFrame is throttled (for example in a background tab).
    raf=requestAnimationFrame(()=>{raf=requestAnimationFrame(start);});
    timer=setTimeout(start,250);
  };
  onStatus(annotate({state:'loading'}));mount();
  const cancel=()=>{
    if(cancelled)return;cancelled=true;sequence++;stopPending();
    if(frame.isConnected){const empty=makeFrame(true);frame.replaceWith(empty);frame=empty;}
  };
  cancel.inspect=async()=>{const d=await session?.inspect?.();return d&&!cancelled?{...d,...meta()}:null;};
  return cancel;
}
