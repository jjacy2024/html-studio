import { acknowledgeCompatibility } from "./compatibility-support.mjs";
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve('qa/web-corpus-20261028');
const fixtures=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8')).filter(f=>!process.env.WEB_CASE||f.id===process.env.WEB_CASE);
const reportPath=process.env.WEB_REPORT||'qa/web-results.json';
const editorFile=path.resolve(process.env.EDITOR_FILE||'HTML Studio.html');
const editorHash=createHash('sha256').update(await fs.readFile(editorFile)).digest('hex');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.webm':'video/webm'};
const server=http.createServer(async(req,res)=>{try{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(pathname==='/__baseline'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><style>body{margin:0}iframe{border:0}</style><iframe sandbox="allow-same-origin"></iframe>');}
 const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error('Outside fixtures');
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
}catch{res.writeHead(404).end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:'chrome'});const results=[];
const stats=xs=>{const s=[...xs].sort((a,b)=>a-b);return{count:s.length,median:s[Math.floor(s.length/2)]??null,p95:s[Math.min(s.length-1,Math.floor(s.length*.95))]??null,max:s.at(-1)??null}};
async function probe(surface,spec){
 return surface.locator('html').evaluate(async(el,kind)=>{
  const doc=el.ownerDocument,w=doc.defaultView;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const require=(condition,message)=>{if(!condition)throw Error(message)};
  if(kind==='dialog'){
   doc.querySelector('#updateDetails').click();require(doc.querySelector('dialog').open,'Dialog failed to open');doc.querySelector('#cancel').click();require(!doc.querySelector('dialog').open,'Dialog failed to close');return{interaction:'open / close dialog'};
  }
  if(kind==='css-animation'){
   const control=doc.querySelector('#animate');control.checked=true;await sleep(100);const animations=doc.getAnimations();require(animations.some(a=>a.playState==='running'),'CSS animation did not run');const running=animations.find(a=>a.playState==='running');await running.ready;const t=running.currentTime;await sleep(180);require(running.currentTime>t,'Animation clock stalled');return{running:animations.length};
  }
  if(kind==='canvas'){
   const canvases=[...doc.querySelectorAll('canvas')];const drawn=canvases.filter(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v));require(drawn.length===2,'Canvas bitmap not drawn');return{drawn:drawn.length};
  }
  if(kind==='shadow'){
   const hosts=[...doc.querySelectorAll('element-details')];require(hosts.every(h=>h.shadowRoot),'Shadow DOM missing');const detail=hosts[0].shadowRoot.querySelector('details');detail.querySelector('summary').click();require(detail.open,'Shadow disclosure did not open');return{shadowRoots:hosts.length};
  }
  if(kind==='native-select'){
   const custom=doc.querySelector('#custom .select');require(custom,'Custom select UI missing');custom.click();return{customSelects:doc.querySelectorAll('.select').length};
  }
  if(kind==='dynamic-app'){
   const input=doc.querySelector('.new-todo');input.value='HTML Studio compatibility check';input.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(100);require(doc.querySelectorAll('.todo-list li').length>0,'Adding a todo failed');return{todos:doc.querySelectorAll('.todo-list li').length};
  }
  if(kind==='slides'){
   for(let i=0;i<30&&!w.Reveal?.isReady?.();i++)await sleep(100);require(w.Reveal?.isReady?.(),'Reveal initialization failed');const before=w.Reveal.getIndices();w.Reveal.next();await sleep(400);const after=w.Reveal.getIndices();require(after.h!==before.h||after.v!==before.v,'Reveal navigation did not advance');return{before,after};
  }
  if(kind==='carousel'){
   const carousel=doc.querySelector('.carousel'),items=[...carousel.querySelectorAll('.carousel-item')];const before=items.findIndex(x=>x.classList.contains('active'));carousel.querySelector('.carousel-control-next').click();await sleep(750);const after=items.findIndex(x=>x.classList.contains('active'));require(before!==after,'Carousel did not advance');return{before,after};
  }
  if(kind==='checkout'){
   const form=doc.querySelector('form.needs-validation');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));require(form.classList.contains('was-validated'),'Form validation handler missing');return{validation:true};
  }
  if(kind==='dashboard'){
   require(w.Chart&&Object.keys(w.Chart.instances).length>0,'Dashboard chart initialization failed');return{charts:Object.keys(w.Chart.instances).length};
  }
  const images=[...doc.images].filter(img=>img.getAttribute('src')&&!img.loading?.includes('lazy'));
  const failures=[];await Promise.all(images.map(async img=>{try{await Promise.race([img.decode(),sleep(4000).then(()=>{throw Error('timeout')})]);}catch{failures.push(img.getAttribute('src').slice(0,120));}}));require(!failures.length,'Image decode failures: '+failures.join(', '));
  return{images:images.length,svg:doc.querySelectorAll('svg').length,direction:w.getComputedStyle(doc.body).direction};
 },spec.kind);
}
async function interactionResult(surface,spec){try{return{pass:true,value:await probe(surface,spec)}}catch(e){return{pass:false,error:e.message}}}
for(const spec of fixtures){
 const started=Date.now(),r={id:spec.id,title:spec.title,kind:spec.kind,source:spec.source,steps:[],issues:[],warnings:[],metrics:{},baselineErrors:[],previewErrors:[],exportErrors:[],editorErrors:[]};results.push(r);
 const context=await browser.newContext({viewport:{width:1512,height:982},acceptDownloads:true});
 await context.route(/^https?:/,route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const page=await context.newPage();let phase='editor';page.on('pageerror',e=>(phase==='preview'?r.previewErrors:r.editorErrors).push(e.message));page.setDefaultTimeout(10000);
 let timer;
 async function step(name,fn){const t=Date.now();try{await fn();r.steps.push({name,status:'pass',ms:Date.now()-t});}catch(e){r.steps.push({name,status:'fail',ms:Date.now()-t,error:e.message});throw e;}}
 try{await Promise.race([(async()=>{
  assert.ok(spec.downloadOK,'Source download failed');assert.equal(spec.failures.filter(f=>!f.licenseOnly).length,0,'Missing source dependencies');
  const sourceUrl=`${origin}/${spec.id}/bundle/index.html`;
  const original=await context.newPage();original.on('pageerror',e=>r.baselineErrors.push(e.message));await original.goto(sourceUrl,{waitUntil:'domcontentloaded',timeout:15000});await original.waitForTimeout(250);r.originalRuntime=await interactionResult(original,spec);await original.close();
  await page.goto(pathToFileURL(editorFile).href);await page.evaluate(()=>htmlStudio.ready);
  await step('import',async()=>{const t=Date.now();await page.locator('#folder-input').setInputFiles(path.join(root,spec.id,'bundle'));await page.waitForFunction(()=>htmlStudio.name==='index'&&!htmlStudio.loading);await acknowledgeCompatibility(page);r.metrics.importMs=Date.now()-t;r.document=await page.evaluate(()=>({nodes:htmlStudio.doc.querySelectorAll('*').length,layers:htmlStudio.doc.querySelectorAll('[data-hs-id]').length,width:htmlStudio.width,height:htmlStudio.height,pages:htmlStudio.pages?.pages.length||0}));r.warnings=await page.evaluate(()=>htmlStudio.warnings);assert.ok(r.document.layers>1);assert.ok(!r.warnings.some(w=>w.includes('未找到资源')||w.includes('未找到样式')));});
  const candidates=await page.evaluate(()=>{
   const e=htmlStudio;const selector=el=>{const chain=[];while(el&&el!==e.doc.body){const parent=el.parentElement;chain.unshift(el.localName+':nth-child('+([...parent.children].indexOf(el)+1)+')');el=parent;}return'body > '+chain.join(' > ')};
   const info=el=>{const s=e.style(el),b=el.getBoundingClientRect();return{id:e.id(el),selector:selector(el),tag:el.localName,text:el.textContent.trim().slice(0,50),fontSize:s.fontSize,fontFamily:s.fontFamily,color:s.color,direction:s.direction,opacity:s.opacity,x:b.x,y:b.y,w:b.width,h:b.height}};
   const visible=el=>{const s=e.style(el),b=el.getBoundingClientRect();return e.inCurrentPage(el)&&s.visibility==='visible'&&s.display!=='none'&&(b.width>3||(el.localName==='canvas'&&b.width>0))&&b.height>3&&[...el.getClientRects()].some(r=>{const x=r.x+r.width/2,y=r.y+Math.min(r.height/2,12);return el.contains(e.doc.elementFromPoint(x,y))})};
   let items=[...e.doc.querySelectorAll('h1,h2,h3,p,button,label,legend,td,th,a,span,div')].filter(el=>e.id(el)&&el.children.length===0&&el.textContent.trim()&&visible(el));
   if(!items.length)items=[...e.doc.querySelectorAll('svg,canvas,img,input,select')].filter(el=>e.id(el)&&visible(el));
   return [...new Set([...items.slice(0,4),...items.slice(Math.floor(items.length/2),Math.floor(items.length/2)+2),...items.slice(-2)])].map(info);
  });r.candidates=candidates;assert.ok(candidates.length,'No visible static target');const target=candidates[0];
  const baseline=await context.newPage();await baseline.goto(origin+'/__baseline');await baseline.evaluate(({url,width,height})=>{const f=document.querySelector('iframe');f.style.width=width+'px';f.style.height=height+'px';f.src=url;},{url:sourceUrl,...r.document});
  await baseline.waitForFunction(()=>document.querySelector('iframe').contentDocument?.readyState==='complete'&&document.querySelector('iframe').contentDocument?.body?.children.length>0);
  await step('source-style',async()=>{
   r.styles=await baseline.evaluate(items=>{const d=document.querySelector('iframe').contentDocument;return items.slice(0,3).map(item=>{const el=d.querySelector(item.selector);if(!el)return{selector:item.selector,missing:true};const s=d.defaultView.getComputedStyle(el);return{selector:item.selector,fontSize:s.fontSize,fontFamily:s.fontFamily,color:s.color,direction:s.direction}})},candidates);
   for(let i=0;i<r.styles.length;i++){const expected=r.styles[i],actual=candidates[i];assert.ok(!expected.missing);for(const key of ['fontSize','fontFamily','color','direction'])assert.equal(actual[key],expected[key],`${actual.selector}: ${key}`);}
  });await baseline.close();
  await page.evaluate(()=>htmlStudio.zoomTo(.5));await page.waitForTimeout(50);
  await step('canvas-selection',async()=>{
   r.canvasSelection=[];
   for(const candidate of [...new Map([target,candidates[Math.floor(candidates.length/2)],candidates.at(-1)].map(c=>[c.id,c])).values()]){
    const point=await page.evaluate(id=>{const e=htmlStudio,el=e.get(id);for(const b of el.getClientRects()){for(const fy of [.25,.5,.75]){const x=b.x+b.width/2,y=b.y+b.height*fy;if(el.contains(e.doc.elementFromPoint(x,y)))return{x,y,w:e.doc.defaultView.innerWidth};}}return null;},candidate.id);
    assert.ok(point,'No hittable fragment for '+candidate.selector);
    await page.evaluate(point=>{const frame=document.querySelector('#edit-frame').getBoundingClientRect(),pane=document.querySelector('#canvas-scroll'),r=pane.getBoundingClientRect(),scale=frame.width/point.w;pane.scrollLeft+=frame.x+point.x*scale-(r.x+r.width/2);pane.scrollTop+=frame.y+point.y*scale-(r.y+r.height/2);},point);
    const b=await page.locator('#edit-frame').boundingBox(),x=b.x+point.x*b.width/point.w,y=b.y+point.y*b.width/point.w;
    await page.mouse.click(x,y);await page.evaluate(()=>new Promise(requestAnimationFrame));const actual=await page.evaluate(id=>({selection:htmlStudio.selection,inside:htmlStudio.nodes.some(n=>htmlStudio.get(id).contains(n))}),candidate.id);r.canvasSelection.push({id:candidate.id,...point,...actual});assert.ok(actual.inside,'Canvas click did not select target or child: '+candidate.selector);
   }
  });
  await step('layer-selection',async()=>{for(const candidate of candidates.slice(0,3)){await page.locator(`.layer-row[data-id="${candidate.id}"] .layer-text`).click();assert.ok(await page.evaluate(id=>htmlStudio.selection.includes(id),candidate.id));}await page.evaluate(id=>htmlStudio.select([id]),target.id);});
  await step('edit-undo-redo',async()=>{
   r.metrics.edits=await page.evaluate(()=>{const e=htmlStudio,times=[];for(let i=0;i<12;i++){const t=performance.now();e.property('opacity',String(61+i));times.push(performance.now()-t);}return times});r.metrics.editTiming=stats(r.metrics.edits);assert.ok(r.metrics.editTiming.max<1500,'Synchronous edit exceeded 1.5s');assert.equal(await page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).opacity),'0.72');await page.evaluate(()=>htmlStudio.undo());assert.equal(await page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).opacity),'0.71');await page.evaluate(()=>htmlStudio.redo());assert.equal(await page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).opacity),'0.72');
  });

  await step('project-roundtrip',async()=>{
   const [saved]=await Promise.all([page.waitForEvent('download'),page.locator('#save-button').click()]);
   const file=path.join(root,spec.id,'saved.htmlstudio');await saved.saveAs(file);
   const fresh=await browser.newContext({viewport:{width:1512,height:982}});await fresh.route(/^https?:/,route=>route.abort());
   try{const reopened=await fresh.newPage();await reopened.goto(pathToFileURL(editorFile).href);await reopened.evaluate(()=>htmlStudio.ready);await reopened.locator('#file-input').setInputFiles(file);await reopened.waitForFunction(()=>htmlStudio.name==='index'&&!htmlStudio.loading);assert.equal(await reopened.evaluate(id=>htmlStudio.style(htmlStudio.get(id)).opacity,target.id),'0.72');assert.equal(await reopened.evaluate(()=>htmlStudio.doc.querySelectorAll('[data-hs-id]').length),r.document.layers);}finally{await fresh.close()}
  });
  await page.screenshot({path:path.join(root,spec.id,'editor.png')});
  await step('export',async()=>{
   const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-button').click()]);await download.saveAs(path.join(root,spec.id,'export.html'));const html=await fs.readFile(path.join(root,spec.id,'export.html'),'utf8');assert.ok(!/blob:(?:null\/|https?:\/\/)[a-zA-Z0-9/:._-]+/.test(html),'Session asset URL leaked');
   const checks=await page.evaluate(html=>{const d=new DOMParser().parseFromString(html,'text/html');const scripts=doc=>[...doc.querySelectorAll('script:not([src])')].map(s=>s.textContent);return{marked:[...d.querySelectorAll('*')].some(el=>[...el.attributes].some(a=>a.name.startsWith('data-hs-'))),original:scripts(htmlStudio.doc),exported:scripts(d)}},html);assert.equal(checks.marked,false);assert.deepEqual(checks.exported,checks.original);
   const exported=await context.newPage();exported.on('pageerror',e=>r.exportErrors.push(e.message));await exported.goto(`${origin}/${spec.id}/export.html`,{waitUntil:'domcontentloaded',timeout:15000});await exported.waitForTimeout(250);r.exportRuntime=await interactionResult(exported,spec);await exported.close();
   if(r.originalRuntime.pass)assert.ok(r.exportRuntime.pass,r.exportRuntime.error);
   const local=await context.newPage();await local.goto(pathToFileURL(path.join(root,spec.id,'export.html')).href,{waitUntil:'load'});r.localExportRuntime=await interactionResult(local,spec);await local.close();if(r.originalRuntime.pass)assert.ok(r.localExportRuntime.pass,r.localExportRuntime.error);
  });
  phase='preview';await page.locator('#preview-button').click();await page.waitForFunction(()=>['ready','error','empty'].includes(htmlStudio.previewStatus?.state));const preview=page.frameLocator('#preview-frame');await preview.locator('body').waitFor({state:'attached'});await preview.locator('html').evaluate(()=>new Promise(resolve=>document.readyState==='complete'?resolve():addEventListener('load',resolve,{once:true})));r.previewRuntime=await interactionResult(preview,spec);await page.screenshot({path:path.join(root,spec.id,'preview.png')});
  await page.locator('#exit-preview').click();phase='editor';await step('return-to-edit',async()=>{assert.equal(await page.evaluate(()=>htmlStudio.preview),false);await page.evaluate(id=>htmlStudio.select([id]),target.id);assert.ok(await page.locator(`.layer-row[data-id="${target.id}"]`).evaluate(el=>el.classList.contains('selected')));assert.deepEqual(r.editorErrors,[]);});
 })(),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Sample exceeded 60 seconds')),60000))]);
 }catch(e){r.error=e.message;if(!r.steps.some(s=>s.status==='fail'))r.steps.push({name:'runtime',status:'fail',error:e.message});try{await page.screenshot({path:path.join(root,spec.id,'failure.png'),timeout:3000})}catch{}}
 finally{clearTimeout(timer);r.ms=Date.now()-started;
  r.status=r.steps.some(s=>s.status==='fail')?'failed':(!r.originalRuntime?.pass||!r.exportRuntime?.pass||!r.previewRuntime?.pass||r.previewErrors.length||['canvas','dashboard','shadow','dynamic-app','native-select','slides'].includes(spec.kind))?'limited':'passed';
  console.log(r.status.toUpperCase(),spec.id,r.error||'',r.metrics.editTiming?.median??'');
  await fs.writeFile(path.join(root,spec.id,'result.json'),JSON.stringify(r,null,2));await context.close();
 }
}
const report={date:new Date().toISOString(),browser:await browser.version(),editorFile,editorHash,results,summary:{samples:results.length,passed:results.filter(r=>r.status==='passed').length,limited:results.filter(r=>r.status==='limited').length,failed:results.filter(r=>r.status==='failed').length,passedChecks:results.flatMap(r=>r.steps).filter(s=>s.status==='pass').length}};
await fs.writeFile(reportPath,JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));console.log(JSON.stringify(report.summary));if(report.summary.failed)process.exitCode=1;
