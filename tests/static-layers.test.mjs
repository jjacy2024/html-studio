import {importSample} from './static-support.mjs';
import {chromium} from 'playwright';import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const root=path.resolve(process.env.STATIC_QA_DIR||'qa/static-20261028');await fs.mkdir(root,{recursive:true});
const editor=path.resolve(process.env.EDITOR_FILE||'HTML Studio.html');
let samples=JSON.parse(await fs.readFile('qa/web-corpus-20261028/manifest.json','utf8')).map(x=>({id:x.id,title:x.title,folder:path.resolve('qa/web-corpus-20261028',x.id,'bundle')}));
for(const [key,id] of [['DECK_FILE','private-deck'],['MERCHANT_FILE','private-merchant']])if(process.env[key])samples.push({id,title:id,file:process.env[key]});
if(process.env.STATIC_CASE)samples=samples.filter(s=>s.id===process.env.STATIC_CASE);
const browser=await chromium.launch({headless:true,channel:'chrome'}),results=[];
for(const sample of samples){const r={id:sample.id,title:sample.title,layers:[],errors:[],started:new Date().toISOString()};results.push(r);const context=await browser.newContext({viewport:{width:1512,height:982}});await context.route(/^https?:/,route=>route.abort());const page=await context.newPage();page.setDefaultTimeout(4000);page.on('pageerror',e=>r.errors.push(e.message));let originalHash;
try{
 if(sample.file)originalHash=createHash('sha256').update(await fs.readFile(sample.file)).digest('hex');
 await page.goto(pathToFileURL(editor).href);await page.evaluate(()=>htmlStudio.ready);await importSample(page,sample);
 await page.evaluate(()=>{htmlStudio.switchPage(-1);htmlStudio.zoomTo(.5);htmlStudio.collapsed.clear();htmlStudio.renderLayers()});
 const ids=await page.evaluate(()=>[...htmlStudio.doc.body.querySelectorAll('[data-hs-id]')].map(el=>({id:htmlStudio.id(el),tag:el.localName,name:(el.id||el.textContent.trim()).slice(0,60),page:htmlStudio.pages.pages.findIndex(p=>p===el||p.contains(el))})));
 r.nodes=ids.length;r.pages=await page.evaluate(()=>htmlStudio.pages.pages.length);console.log('START',sample.id,ids.length);
 for(const info of ids){const record={...info};r.layers.push(record);try{const row=page.locator(`.layer-row[data-id="${info.id}"] .layer-text`);await row.click();record.layer=await page.evaluate(id=>htmlStudio.selection.length===1&&htmlStudio.selection[0]===id,info.id);if(!record.layer)record.error='Layer click selected a different node';}catch(e){record.layer=false;record.error=e.message.slice(0,400)}if(r.layers.length%100===0)console.log('LAYERS',sample.id,r.layers.length+'/'+ids.length)}
 let active=-1;
 for(const record of r.layers){try{
  if(record.page!==active){await page.evaluate(n=>{htmlStudio.switchPage(n);htmlStudio.zoomTo(.5)},record.page);active=record.page}
  const p=await page.evaluate(id=>{const e=htmlStudio;e.select([]);const el=e.get(id),s=e.style(el),rs=[...el.getClientRects()];if(!rs.length||s.display==='none'||s.visibility!=='visible')return{reason:'hidden-or-no-box'};if(e.locked(el))return{reason:'locked'};const w=e.doc.defaultView.innerWidth,h=e.doc.defaultView.innerHeight;let inViewport=false;for(const r of rs){if(r.width<=0||r.height<=0)continue;for(const fx of [.5,.05,.95])for(const fy of [.5,.05,.95]){const x=r.x+r.width*fx,y=r.y+r.height*fy;if(x<0||x>=w||y<0||y>=h)continue;inViewport=true;const hit=e.hit(e.doc.elementFromPoint(x,y),true,{x,y});if(hit===el)return{x,y,w};}}return{reason:inViewport?'covered-or-no-direct-hit':'outside-canvas'}},record.id);
  if(p.reason){record.canvas={status:'not-directly-hittable',reason:p.reason};continue}
  await page.evaluate(p=>{const pane=document.querySelector('#canvas-scroll'),r=pane.getBoundingClientRect(),f=document.querySelector('#edit-frame').getBoundingClientRect(),z=f.width/p.w;pane.scrollLeft+=f.x+p.x*z-r.x-r.width/2;pane.scrollTop+=f.y+p.y*z-r.y-r.height/2},p);
  const f=await page.locator('#edit-frame').boundingBox();await page.keyboard.down('Meta');await page.mouse.click(f.x+p.x*f.width/p.w,f.y+p.y*f.width/p.w);await page.keyboard.up('Meta');const selected=await page.evaluate(id=>htmlStudio.selection.length===1&&htmlStudio.selection[0]===id,record.id);record.canvas={status:selected?'pass':'fail'};if(!selected){record.canvas.debug=await page.evaluate(({id,x,y})=>({selection:htmlStudio.nodes.map(n=>n.id||n.localName),target:htmlStudio.get(id).outerHTML.slice(0,120),outer:document.elementFromPoint(x,y)?.outerHTML.slice(0,160),textEditing:!!htmlStudio.finishText,x,y}),{id:record.id,x:f.x+p.x*f.width/p.w,y:f.y+p.y*f.width/p.w});await page.screenshot({path:path.join(root,sample.id+'-canvas-fail.png')});}
 }catch(e){await page.keyboard.up('Meta');record.canvas={status:'fail',error:e.message.slice(0,400)}}}
 if(sample.file)r.originalUnchanged=originalHash===createHash('sha256').update(await fs.readFile(sample.file)).digest('hex');
}catch(e){r.error=e.stack}finally{
 r.summary={layers:r.layers.length,layerPass:r.layers.filter(x=>x.layer).length,layerFail:r.layers.filter(x=>!x.layer).length,canvasPass:r.layers.filter(x=>x.canvas?.status==='pass').length,canvasFail:r.layers.filter(x=>x.canvas?.status==='fail').length,notDirect:r.layers.filter(x=>x.canvas?.status==='not-directly-hittable').length};
 console.log('RESULT',sample.id,JSON.stringify(r.summary));await fs.writeFile(path.join(root,sample.id+'-layers.json'),JSON.stringify(r,null,2));await context.close()}
}
const report={date:new Date().toISOString(),editorHash:createHash('sha256').update(await fs.readFile(editor)).digest('hex'),browser:await browser.version(),results};await fs.writeFile(process.env.STATIC_REPORT||path.join(root,'layers-results.json'),JSON.stringify(report,null,2));await browser.close();if(results.some(r=>r.error||r.summary.layerFail||r.summary.canvasFail||r.errors.length))process.exitCode=1;
