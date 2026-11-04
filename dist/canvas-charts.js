import {focusStructureChange,mountChartStructure} from './chart-structure.js';
import {bindDataPaste,pasteNumber} from './data-paste.js';
import {cleanDocument,escapeHTML} from './document.js';

// This function is also embedded in exports. It only supplies bound data to
// the original Chart.js renderer; it never serializes or replaces its options.
export function chartJSDataRuntime(probe={}) {
  const attr='data-studio-chartjs';
  const valid=m=>m?.version===1&&Array.isArray(m.labels)&&m.labels.length>0&&m.labels.length<=200&&m.labels.every(s=>typeof s==='string'&&s.length<=300)&&Array.isArray(m.series)&&m.series.length>0&&m.series.length<=12&&m.series.every(s=>typeof s==='string'&&s.length<=300)&&Array.isArray(m.values)&&m.values.length===m.series.length&&m.values.every(v=>Array.isArray(v)&&v.length===m.labels.length&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e12));
  const types=['bar','line','radar','pie','doughnut','polarArea'],roundTypes=['pie','doughnut','polarArea'];
  const sources=new WeakMap();
  const info=chart=>{
    const data=chart.data,ds=data?.datasets,labels=data?.labels;
    if(!types.includes(chart.config.type)||!Array.isArray(labels)||!Array.isArray(ds)||ds.some(d=>d.type&&d.type!==chart.config.type))throw Error('当前支持 Chart.js 柱状、折线、雷达、饼图、环形及极坐标面积图；混合图表暂不能安全绑定。');
    const axis=chart.options.indexAxis==='y'?'x':'y';
    if(['bar','line'].includes(chart.config.type)&&chart.scales[axis]?.type!=='linear')throw Error('当前仅支持线性数值轴。');
    const m={version:1,labels:labels.map(x=>typeof x==='string'||typeof x==='number'?String(x):null),series:ds.map((d,i)=>String(d.label||`系列 ${i+1}`)),values:ds.map(d=>Array.isArray(d.data)?d.data.slice():null)};
    if(!valid(m))throw Error('图表需要分类与数值数组；对象坐标或浮动区间暂不能安全绑定。');
    let bound;try{bound=JSON.parse(chart.canvas.getAttribute(attr));}catch{}
    m.type=chart.config.type;m.rowSources=bound?.rowSources||labels.map((_,i)=>i);m.seriesSources=bound?.seriesSources||ds.map((_,i)=>i);
    return m;
  };
  const bounds=new WeakMap();
  const apply=chart=>{
    try {
      const raw=chart.canvas?.getAttribute(attr);if(!raw||raw.length>200000)return;const m=JSON.parse(raw);if(!valid(m))return;
      if(!types.includes(chart.config.type)||m.type&&m.type!==chart.config.type)return;
      if(roundTypes.includes(chart.config.type)&&m.values.some(a=>a.some(n=>n<0)))return;
      if(!sources.has(chart))sources.set(chart,{labels:chart.data.labels.slice(),datasets:chart.data.datasets.map(d=>Object.fromEntries(Object.entries(d).map(([k,v])=>[k,Array.isArray(v)?v.slice():v])))});
      const source=sources.get(chart),rowSources=m.rowSources||m.labels.map((_,i)=>i),seriesSources=m.seriesSources||m.series.map((_,i)=>i);
      if(rowSources.length!==m.labels.length||seriesSources.length!==m.series.length||rowSources.some(i=>!Number.isInteger(i)||i<0||i>=source.labels.length)||seriesSources.some(i=>!Number.isInteger(i)||i<0||i>=source.datasets.length))return;
      const indexed=new Set(['backgroundColor','borderColor','borderWidth','borderRadius','hoverBackgroundColor','hoverBorderColor','hoverBorderWidth','pointBackgroundColor','pointBorderColor','pointBorderWidth','pointRadius','pointHoverRadius','pointHoverBackgroundColor','pointHoverBorderColor','pointStyle','offset','hoverOffset']);
      chart.data.labels=m.labels.slice();
      chart.data.datasets=m.series.map((label,i)=>{const d={...source.datasets[seriesSources[i]],label,data:m.values[i].slice()};for(const key of indexed)if(Array.isArray(d[key])&&d[key].length)d[key]=rowSources.map(r=>d[key][r%d[key].length]);return d;});
      const axis=chart.config.options.indexAxis==='y'?'x':'y',scale=chart.config.options.scales?.[axis];
      if(scale){if(!bounds.has(chart))bounds.set(chart,{min:scale.min,max:scale.max});const original=bounds.get(chart);let values=m.values.flat();if(scale.stacked)values=values.concat(m.labels.map((_,r)=>m.values.reduce((n,c)=>n+Math.max(0,c[r]),0)),m.labels.map((_,r)=>m.values.reduce((n,c)=>n+Math.min(0,c[r]),0)));for(const key of ['min','max']){const bound=original[key],outside=key==='min'?Math.min(...values)<bound:Math.max(...values)>bound;if(typeof bound==='number'){if(outside)delete scale[key];else scale[key]=bound;}}}
    }catch{}
  };
  const installed=new WeakSet();
  const install=Chart=>{
    if(typeof Chart!=='function'||!Chart.register||!/^([34])\./.test(Chart.version)||installed.has(Chart))return;
    installed.add(Chart);Chart.register({id:'html-studio-bound-bar-data',beforeInit:apply,beforeUpdate:apply});
  };
  let current=window.Chart;install(current);
  const descriptor=Object.getOwnPropertyDescriptor(window,'Chart');
  if(!current&&(!descriptor||descriptor.configurable))Object.defineProperty(window,'Chart',{configurable:true,enumerable:true,get:()=>current,set:Chart=>{current=Chart;Object.defineProperty(window,'Chart',{configurable:true,enumerable:true,writable:true,value:Chart});install(Chart);}});
  if(!probe.token)return;
  const send=data=>parent.postMessage({chartProbe:probe.token,...data},'*');let target,chart,closed=false;
  const capture=()=>{
    chart.stop();chart.resize();chart.update('none');const canvas=chart.canvas;
    if(!canvas.width||!canvas.height||!chart.width||!chart.height)throw Error('图表尚未显示或尺寸为零，无法保留原样式。');
    const scale=Math.min(1,1600/canvas.width,1000/canvas.height),copy=document.createElement('canvas');copy.width=Math.max(1,Math.round(canvas.width*scale));copy.height=Math.max(1,Math.round(canvas.height*scale));copy.getContext('2d').drawImage(canvas,0,0,copy.width,copy.height);
    let background='transparent';for(let el=canvas;el;el=el.parentElement){const color=getComputedStyle(el).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent'){background=color;break;}}
    return {model:info(chart),image:copy.toDataURL('image/png'),width:chart.width,height:chart.height,background};
  };
  addEventListener('message',event=>{
    if(event.source!==parent||event.data?.token!==probe.token||!chart||closed)return;
    const {id,model}=event.data;if(!Number.isInteger(id)||!valid(model))return;
    try{info(chart);if(roundTypes.includes(chart.config.type)&&model.values.some(a=>a.some(n=>n<0)))throw Error('饼图、环形及极坐标面积图不支持负数。');target.setAttribute(attr,JSON.stringify(model));apply(chart);const result=capture();if(JSON.stringify(result.model.labels)!==JSON.stringify(model.labels)||JSON.stringify(result.model.series)!==JSON.stringify(model.series)||JSON.stringify(result.model.values)!==JSON.stringify(model.values))throw Error('图表数据未能完整应用，保留上一次结果。');send({id,result});}catch(e){send({id,error:e.message});}
  });
  const start=async()=>{
    target=document.querySelector(`[data-studio-chart-probe="${probe.token}"]`);if(!target)return send({error:'未找到要编辑的 Canvas。'});
    // Navigation occurs only in the isolated copy, to initialize lazy slide charts.
    for(let i=0;i<Math.min(probe.pageIndex||0,100);i++){document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await new Promise(r=>setTimeout(r,60));}
    const end=performance.now()+5000;
    while(performance.now()<end){const Chart=window.Chart;install(Chart);chart=Chart?.getChart?.(target);if(chart)break;await new Promise(r=>setTimeout(r,80));}
    if(!chart)return send({error:'未找到可读取的 Chart.js 3/4 图表实例。自定义 Canvas、模块私有实例或未加载成功的脚本暂不能保留原样式编辑。'});
    try{info(chart);await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,1200))]);send({ready:true,result:capture()});}catch(e){send({error:e.message});}
  };
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',start,{once:true});else start();
}
function chartJSRuntimeScript(doc,probe) {
  let script=doc.querySelector('script[data-studio-chartjs-runtime]');if(!script){script=doc.createElement('script');script.setAttribute('data-studio-chartjs-runtime','1');doc.head.prepend(script);}
  script.textContent=`(${chartJSDataRuntime.toString()})(${JSON.stringify(probe||{})});`;return script;
}
export function validCanvasModel(m) {
  return m?.version===1&&Array.isArray(m.labels)&&m.labels.length>0&&m.labels.length<=200&&m.labels.every(s=>typeof s==='string'&&s.length<=300)&&Array.isArray(m.series)&&m.series.length>0&&m.series.length<=12&&m.series.every(s=>typeof s==='string'&&s.length<=300)&&Array.isArray(m.values)&&m.values.length===m.series.length&&m.values.every(v=>Array.isArray(v)&&v.length===m.labels.length&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e12));
}
function validCanvasResult(r) {return validCanvasModel(r?.model)&&typeof r.image==='string'&&r.image.length<8000000&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(r.image)&&Number.isFinite(r.width)&&r.width>0&&r.width<=16000&&Number.isFinite(r.height)&&r.height>0&&r.height<=16000;}
export function probeChartJS(editor,canvas) {
  const token=crypto.randomUUID(),copy=new DOMParser().parseFromString(cleanDocument(editor.doc,{exporting:true}),'text/html'),index=[...editor.doc.querySelectorAll('canvas')].indexOf(canvas),target=copy.querySelectorAll('canvas')[index];
  if(!target)throw Error('Canvas 已被移除。');target.setAttribute('data-studio-chart-probe',token);
  const pageIndex=Math.max(0,editor.pages?.pages.findIndex(p=>p.contains(canvas))??0);chartJSRuntimeScript(copy,{token,pageIndex});
  const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;frame.dataset.chartProbe=token;Object.assign(frame.style,{position:'fixed',left:'-30000px',top:'0',width:Math.min(editor.width,4000)+'px',height:Math.min(editor.height,4000)+'px',border:'0',pointerEvents:'none'});document.body.append(frame);
  let resolveReady,rejectReady,cancel,done=false,sequence=0;const requests=new Map();
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const timer=setTimeout(()=>{rejectReady(Error('图表读取超时，请检查脚本和资源是否完整。'));close();},14000);
  const listener=event=>{
    if(event.source!==frame.contentWindow||event.data?.chartProbe!==token||done)return;
    const {id,result,error}=event.data;
    if(Number.isInteger(id)){const pending=requests.get(id);if(!pending)return;requests.delete(id);clearTimeout(pending.timer);error?pending.reject(Error(String(error).slice(0,500))):validCanvasResult(result)?pending.resolve(result):pending.reject(Error('图表返回的数据无效。'));return;}
    clearTimeout(timer);if(error)rejectReady(Error(String(error).slice(0,500)));else if(validCanvasResult(result))resolveReady(result);else rejectReady(Error('无法读取图表数据。'));
  };
  function close(){if(done)return;done=true;clearTimeout(timer);window.removeEventListener('message',listener);cancel?.();frame.remove();rejectReady(Error('图表面板已关闭'));for(const pending of requests.values()){clearTimeout(pending.timer);pending.reject(Error('图表面板已关闭'));}requests.clear();}
  // This offscreen measurement session needs the existing transfer lifecycle;
  // ordinary user-facing previews can use native page navigation independently.
  window.addEventListener('message',listener);cancel=editor.assets.preview(frame,'<!doctype html>\n'+copy.documentElement.outerHTML,{loader:'transfer'});
  return {ready,close,update:model=>new Promise((resolve,reject)=>{if(done||!validCanvasModel(model))return reject(Error('图表会话或数据无效'));const id=++sequence,timer=setTimeout(()=>{requests.delete(id);reject(Error('图表更新超时，保留上一次有效结果。'));},5000);requests.set(id,{resolve,reject,timer});frame.contentWindow.postMessage({token,id,model},'*');})};
}
export async function paintCanvasPreview(canvas) {
  const url=canvas.getAttribute('data-studio-chartjs-image');if(!url||!(/^(data:image\/png;base64,|blob:)/.test(url)))return;
  let size;try{size=JSON.parse(canvas.getAttribute('data-studio-chartjs-size'));}catch{return;}
  if(!size||![size.width,size.height].every(n=>Number.isFinite(n)&&n>0&&n<=16000))return;
  const image=new Image();image.src=url;try{await image.decode();}catch{return;}
  if(!canvas.isConnected||canvas.getAttribute('data-studio-chartjs-image')!==url)return;
  if(!canvas.hasAttribute('data-hs-canvas-width')){canvas.setAttribute('data-hs-canvas-width',canvas.getAttribute('width')??'');canvas.setAttribute('data-hs-canvas-height',canvas.getAttribute('height')??'');}
  canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d')?.drawImage(image,0,0);
  const doc=canvas.ownerDocument,id=canvas.getAttribute('data-hs-id');if(!id)return;
  let style=doc.querySelector(`style[data-hs-runtime="canvas-${id}"]`);if(!style){style=doc.createElement('style');style.setAttribute('data-hs-runtime',`canvas-${id}`);doc.head.append(style);}style.textContent=`canvas[data-hs-id="${id}"]{display:inline-block;width:${size.width}px;height:${size.height}px;background-image:url("${url}")!important;background-size:100% 100%!important;background-repeat:no-repeat!important}`;
}
const canvasPainted = new WeakMap();
export function hydrateCanvasCharts(doc){
  // With scripts disabled, Chromium lays canvas out as fallback content (often 0 x 0).
  // Give it a selectable box without changing the original attributes or export CSS.
  for(const canvas of doc.querySelectorAll('canvas:not([data-studio-chartjs-image])')) {
    const rect=canvas.getBoundingClientRect(),id=canvas.getAttribute('data-hs-id');
    if(!id||(rect.width>0&&rect.height>0))continue;
    let style=doc.querySelector(`style[data-hs-runtime="canvas-${id}"]`);
    if(!style){style=doc.createElement('style');style.setAttribute('data-hs-runtime',`canvas-${id}`);doc.head.append(style);}
    style.textContent=`canvas[data-hs-id="${id}"]{display:inline-block;width:${rect.width||canvas.width||300}px;height:${rect.height||canvas.height||150}px}`;
  }
  return Promise.all([...doc.querySelectorAll('canvas[data-studio-chartjs-image]')].map(canvas=>{const url=canvas.getAttribute('data-studio-chartjs-image');if(canvasPainted.get(canvas)===url)return;canvasPainted.set(canvas,url);return paintCanvasPreview(canvas);}));}
export async function prepareCanvasResult(editor,canvas,result,valid) {
  if(!validCanvasResult(result))throw Error('图表返回的数据无效。');
  const blob=await(await fetch(result.image)).blob();
  if(!valid())return null;
  // All asynchronous work precedes applying the attributes. Callers can
  // write the result and its undo entry together in one synchronous turn.
  return ()=>{
    if(!valid())return false;
    canvas.setAttribute('data-studio-chartjs',JSON.stringify(result.model));canvas.setAttribute('data-studio-chartjs-image',editor.assets.add(blob));canvas.setAttribute('data-studio-chartjs-size',JSON.stringify({width:result.width,height:result.height}));chartJSRuntimeScript(editor.doc);
    return true;
  };
}
export async function storeCanvasResult(editor,canvas,result,valid) {
  const apply=await prepareCanvasResult(editor,canvas,result,valid);if(!apply?.())return false;
  await paintCanvasPreview(canvas);return valid();
}
export function changeCanvasChartStructure(model,{axis,operation,index,name}) {
  const next=structuredClone(model),names=axis==='row'?next.labels:next.series,refs=axis==='row'?next.rowSources:next.seriesSources;
  if(operation==='delete'&&names.length<=1)throw Error('至少保留一个分类和一个系列。');
  if(operation==='add'&&names.length>=(axis==='row'?200:12))throw Error('已达到图表容量上限。');
  if(operation==='rename')names[index]=name;
  else if(operation==='add'){names.splice(index+1,0,name);refs.splice(index+1,0,refs[index]);if(axis==='row')next.values.forEach(a=>a.splice(index+1,0,0));else next.values.splice(index+1,0,next.labels.map(()=>0));}
  else{names.splice(index,1);refs.splice(index,1);if(axis==='row')next.values.forEach(a=>a.splice(index,1));else next.values.splice(index,1);}
  return next;
}
export function installCanvasCharts(Editor,{modal,closeModal}) {
  const q=s=>document.querySelector(s);
  Editor.prototype.openCanvasChartEditor=async function(canvas,{fallbackSource=canvas}={}) {
    if(!canvas||this.loading||this.preview||this.locked(canvas))return false;
    this.finishText?.();
    const editor=this,version=this.loadVersion;let session,active=true,closeHandler,cleanups=[];
    const valid=()=>active&&version===editor.loadVersion&&canvas.isConnected&&canvas.ownerDocument===editor.doc&&!editor.locked(canvas);
    modal('读取 Canvas 图表', '<p>正在隔离预览中读取 Chart.js 图表数据与原样式…</p><p class="source-note">原页面脚本仅在隔离副本中运行；尚未确认绑定时不会修改当前文档。</p>',[{label:'取消',run:closeModal}]);q('#dialog').dataset.kind='canvas-chart-loading';
    const cleanup=()=>{cleanups.forEach(f=>f());active=false;session?.close();q('#dialog').removeEventListener('close',closeHandler);};closeHandler=cleanup;q('#dialog').addEventListener('close',closeHandler,{once:true});
    try {
      session=probeChartJS(editor,canvas);const initial=await session.ready;if(!valid())return;
      const openData=async()=>{
        if(!valid())return;if(!canvas.hasAttribute('data-studio-chartjs')){await storeCanvasResult(editor,canvas,initial,valid);if(!valid())return;editor.commit('绑定 Chart.js 图表数据');}
        let desired=structuredClone(initial.model),applied=structuredClone(initial.model),dirty=false,running=null,pending=false,timer,pasteJob=null,structureJob=null;
        const body=modal('编辑 Canvas / Chart.js 数据 · 保留样式',`<p>使用原 Chart.js 配置绘制，保留颜色、渐变、坐标轴与图例；修改数值后实时更新。</p><div class="data-editor-workspace with-chart"><div class="data-grid-scroll"><table class="data-grid" id="canvas-chart-grid"><thead><tr><th>分类</th>${desired.series.map(s=>`<th>${escapeHTML(s)}</th>`).join('')}</tr></thead><tbody>${desired.labels.map((label,r)=>`<tr><th>${escapeHTML(label)}</th>${desired.series.map((s,c)=>`<td><input data-canvas-row="${r}" data-canvas-column="${c}" aria-label="${escapeHTML(label+' · '+s)}" value="${desired.values[c][r]}" inputmode="decimal"></td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="data-live-preview"><span>原图实时预览</span><img id="canvas-chart-preview" alt="Chart.js 图表预览"></div></div><p id="canvas-chart-status" aria-live="polite"></p><p class="source-note">支持增删分类与系列，新增项沿用所选项的样式。页面其他指标不会联动；导出继续保留并依赖原图表脚本。</p>`,[{label:'完成',primary:true,run:()=>closeAfter()}]);q('#dialog').dataset.kind='canvas-chart-data';
        const image=body.querySelector('#canvas-chart-preview');image.src=initial.image;image.style.background=initial.background;Object.assign(image.style,{display:'block',width:'100%',maxHeight:'350px',objectFit:'contain'});
        const flush=()=>{if(pending&&valid()){pending=false;editor.commit('修改 Chart.js 图表数据');}};q('#dialog').flushData=flush;
        const process=()=>{
          clearTimeout(timer);if(running)return running;
          running=(async()=>{while(dirty&&valid()){dirty=false;const next=structuredClone(desired);try{const result=await session.update(next);if(dirty||!valid())continue;if(!await storeCanvasResult(editor,canvas,result,()=>valid()&&!dirty))continue;applied=structuredClone(result.model);pending=true;image.src=result.image;image.style.background=result.background;body.querySelector('#canvas-chart-status').textContent='已更新';editor.draw();}catch(e){if(valid()){desired=structuredClone(applied);body.querySelector('#canvas-chart-status').textContent=e.message;}}}})().finally(()=>{running=null;});return running;
        };
        bindDataPaste(body.querySelector('#canvas-chart-grid'),{
          valid:()=>valid()&&!structureJob,rowNames:()=>desired.labels,columnNames:()=>desired.series,
          apply:async changes=>{
            const values=changes.map(cell=>({...cell,value:pasteNumber(cell.raw,{negative:true})}));
            const grid=body.querySelector('#canvas-chart-grid');grid.inert=true;
            pasteJob=(async()=>{
              await process();if(!valid())return false;flush();
              const next=structuredClone(applied);for(const cell of values)next.values[cell.column][cell.row]=cell.value;
              desired=next;dirty=true;await process();if(!valid())return false;
              if(JSON.stringify(applied.values)!==JSON.stringify(next.values))throw Error('图表更新失败，整批数据未应用；保留上次有效结果。');
              pending=false;editor.commit('批量粘贴 Chart.js 图表数据');
              for(const input of grid.querySelectorAll('[data-canvas-row]')){input.value=applied.values[Number(input.dataset.canvasColumn)][Number(input.dataset.canvasRow)];input.removeAttribute('aria-invalid');}
            })();
            try{return await pasteJob;}finally{grid.inert=false;pasteJob=null;}
          }
        });
        const drawStructure=()=>{
          body.querySelector('.chart-structure-tools')?.remove();
          const grid=body.querySelector('#canvas-chart-grid');
          grid.innerHTML=`<thead><tr><th>分类</th>${applied.series.map(s=>`<th>${escapeHTML(s)}</th>`).join('')}</tr></thead><tbody>${applied.labels.map((label,r)=>`<tr><th>${escapeHTML(label)}</th>${applied.series.map((s,c)=>`<td><input data-canvas-row="${r}" data-canvas-column="${c}" aria-label="${escapeHTML(label+' · '+s)}" value="${applied.values[c][r]}" inputmode="decimal"></td>`).join('')}</tr>`).join('')}</tbody>`;
          mountChartStructure(body,{rows:applied.labels,columns:applied.series,maxRows:200,valid,change:async({axis,operation,index,name})=>{
            if(structureJob)return;
            structureJob=(async()=>{
            await pasteJob?.catch(()=>{});await process();if(!valid())return;flush();
            const next=changeCanvasChartStructure(applied,{axis,operation,index,name});
            grid.inert=true;
            try{const result=await session.update(next);if(!valid())return;if(!await storeCanvasResult(editor,canvas,result,valid))return;desired=structuredClone(result.model);applied=structuredClone(result.model);image.src=result.image;image.style.background=result.background;editor.commit('调整 Chart.js 图表行列');drawStructure();focusStructureChange({axis,operation,index,name});}
            finally{grid.inert=false;}
            })();
            try{await structureJob;}finally{structureJob=null;}
          }});
        };
        drawStructure();
        const closeAfter=async()=>{await structureJob?.catch(()=>{});await pasteJob?.catch(()=>{});await process();flush();if(valid())closeModal();};
        body.querySelector('#canvas-chart-grid').addEventListener('input',event=>{const input=event.target;if(!input.matches('[data-canvas-row]')||!valid()||pasteJob||structureJob)return;const raw=input.value.trim().replaceAll(',',''),value=Number(raw);if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)||!Number.isFinite(value)||Math.abs(value)>1e12){input.setAttribute('aria-invalid','true');body.querySelector('#canvas-chart-status').textContent='请输入 -1 万亿至 1 万亿之间的有效数值。';return;}input.removeAttribute('aria-invalid');desired.values[Number(input.dataset.canvasColumn)][Number(input.dataset.canvasRow)]=value;dirty=true;body.querySelector('#canvas-chart-status').textContent='正在更新…';clearTimeout(timer);timer=setTimeout(process,80);});
        body.querySelector('#canvas-chart-grid').addEventListener('change',async()=>{await process();flush();});
        const onCloseClick=event=>{event.preventDefault();event.stopImmediatePropagation();closeAfter();},onCancel=event=>{event.preventDefault();closeAfter();};q('#dialog-close').addEventListener('click',onCloseClick,true);q('#dialog').addEventListener('cancel',onCancel);
        cleanups.push(()=>{clearTimeout(timer);flush();if(valid()&&!editor.loading)editor.assets.prune(editor.history.map(h=>h.html).join('\n')+cleanDocument(editor.doc)+JSON.stringify(editor.clipboard||''));q('#dialog-close').removeEventListener('click',onCloseClick,true);q('#dialog').removeEventListener('cancel',onCancel);if(q('#dialog').flushData===flush)delete q('#dialog').flushData;});
      };
      if(canvas.hasAttribute('data-studio-chartjs'))await openData();
      else {modal('识别 Chart.js 图表 · 保留原样式',`<p>识别到 ${initial.model.labels.length} 个分类、${initial.model.series.length} 个系列。确认后继续使用原图表脚本和绘图配置。</p><div class="data-grid-scroll"><table class="data-grid"><thead><tr><th>分类</th>${initial.model.series.map(s=>`<th>${escapeHTML(s)}</th>`).join('')}</tr></thead><tbody>${initial.model.labels.map((s,r)=>`<tr><th>${escapeHTML(s)}</th>${initial.model.series.map((_,c)=>`<td>${initial.model.values[c][r]}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="source-note">绑定不会把图表转换成其他图形；仅保存本图数据覆盖值，其他说明不自动重算。</p>`,[{label:'取消',run:closeModal},{label:'绑定并编辑数据',primary:true,run:()=>openData().catch(e=>{if(valid())q('#dialog-body').textContent=e.message;})}]);q('#dialog').dataset.kind='canvas-chart-bind';}
    } catch(e){const canFallback=valid();cleanup();if(canFallback)this.convertDataChart(fallbackSource,{reason:e.message});}
    return true;
  };
}
