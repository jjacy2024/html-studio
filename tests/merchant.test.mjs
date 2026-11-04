import { acknowledgeCompatibility } from "./compatibility-support.mjs";
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

if (!process.env.MERCHANT_FILE) throw Error('Set MERCHANT_FILE to the local merchant HTML fixture');
const filename=path.resolve(process.env.MERCHANT_FILE),source=await fs.readFile(filename),hash=createHash('sha256').update(source).digest('hex');
const base=process.env.TEST_URL||pathToFileURL(path.resolve(process.env.EDITOR_FILE||'HTML Studio.html')).href;
const output=process.env.MERCHANT_REPORT||'qa/merchant-results.json';
await fs.mkdir(path.dirname(output),{recursive:true});await fs.mkdir('qa/merchant-20261028',{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:1512,height:982},acceptDownloads:true});
const page=await context.newPage(),results=[],errors=[],metrics={};page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
async function test(name,fn){const t=Date.now();try{await fn();results.push({name,pass:true,ms:Date.now()-t});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.message});console.error('FAIL',name,e.message);throw e;}}
const frame=page.frameLocator('#edit-frame');
async function point(selector){const p=await frame.locator(selector).first().evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:innerWidth,id:el.dataset.hsId}});const b=await page.locator('#edit-frame').boundingBox();return{x:b.x+p.x*b.width/p.w,y:b.y+p.y*b.width/p.w,id:p.id};}
async function clickCanvas(selector){const p=await point(selector);await page.mouse.click(p.x,p.y);await page.evaluate(()=>new Promise(requestAnimationFrame));const selection=await page.evaluate(id=>({ids:htmlStudio.selection,inside:htmlStudio.selection.length===1&&htmlStudio.get(id).contains(htmlStudio.nodes[0])}),p.id);assert.ok(selection.inside,selector);return selection.ids[0];}
const selectors=['.anpm-brand-logo-svg svg','.anpm-account-switcher button','.anpm-enter-ai-workbench img','.anpm-sidebar-item > span:not(.anpm-sidebar-icon)','#lowMsg','h2','#demoTrigger'];
try{
 await page.goto(base);await page.evaluate(()=>htmlStudio.ready);
 await test('M01 Import the supplied file without executing its scripts',async()=>{
  const t=Date.now();await page.locator('#file-input').setInputFiles(filename);await page.waitForFunction(name=>htmlStudio.name===name&&!htmlStudio.loading,path.basename(filename,'.html'));await acknowledgeCompatibility(page);metrics.importMs=Date.now()-t;
  metrics.structure=await page.evaluate(()=>({nodes:htmlStudio.doc.querySelectorAll('*').length,layers:htmlStudio.doc.querySelectorAll('[data-hs-id]').length,staticProductRows:htmlStudio.doc.querySelectorAll('#lE tr').length}));
  assert.ok(metrics.structure.layers>500);assert.equal(metrics.structure.staticProductRows,0);assert.ok(metrics.importMs<10000);
  await page.evaluate(()=>htmlStudio.zoomTo(.42));await page.waitForTimeout(100);
 });
 let ids=[];
 await test('M02 Real canvas clicks select text, buttons, SVG and embedded images',async()=>{for(const selector of selectors)ids.push(await clickCanvas(selector));});
 await test('M03 Layer-panel clicks select each corresponding existing element',async()=>{
  for(const id of ids){await page.locator(`.layer-row[data-id="${id}"] .layer-text`).click();assert.ok(await page.evaluate(id=>htmlStudio.selection.includes(id),id));assert.ok(await page.locator(`.layer-row[data-id="${id}"]`).evaluate(el=>el.classList.contains('selected')));}
 });
 await test('M04 Repeated text edits stay responsive and retain history',async()=>{
  metrics.edits=await page.evaluate(()=>{const e=htmlStudio;e.select([e.id(e.doc.querySelector('h2'))]);const values=[];for(let i=0;i<40;i++){const t=performance.now();e.property('fontSize',String(20+i));values.push(performance.now()-t);}return values;});
  const sorted=[...metrics.edits].sort((a,b)=>a-b);metrics.editTiming={median:sorted[20],p95:sorted[38],max:sorted.at(-1)};
  assert.ok(metrics.editTiming.max<1500);assert.equal(await page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).fontSize),'59px');
 });
 await test('M05 Undo and redo retain the text selection and value',async()=>{
  await page.evaluate(()=>htmlStudio.undo());assert.equal(await page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).fontSize),'58px');
  await page.evaluate(()=>htmlStudio.redo());assert.equal(await page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).fontSize),'59px');
 });
 await test('M06 Canvas drag moves an existing image and can be undone',async()=>{
  await page.evaluate(()=>htmlStudio.zoomTo(.42));await page.waitForTimeout(60);
  const selector='.anpm-enter-ai-workbench img',p=await point(selector);const before=await page.evaluate(id=>htmlStudio.translation(htmlStudio.get(id)),p.id);
  await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+20,p.y+10,{steps:5});await page.mouse.up();
  const after=await page.evaluate(id=>htmlStudio.translation(htmlStudio.get(id)),p.id);assert.ok(after.x>before.x+30);await page.evaluate(()=>htmlStudio.undo());
  assert.deepEqual(await page.evaluate(id=>htmlStudio.translation(htmlStudio.get(id)),p.id),before);
 });
 await test('M07 Preview runs dynamic rows and balance modal while editing is disabled',async()=>{
  await page.locator('#preview-button').click();const preview=page.frameLocator('#preview-frame');
  await preview.locator('#mBalance.show').waitFor({state:'visible'});
  metrics.preview=await preview.locator('body').evaluate(()=>({rows:document.querySelectorAll('#lE tr').length,chartShapes:document.querySelectorAll('#incChart path,#incChart polyline,#incChart circle').length,rootInert:document.querySelector('#root').inert}));
  assert.ok(metrics.preview.rows>0);assert.ok(metrics.preview.chartShapes>0);assert.ok(metrics.preview.rootInert);
  assert.equal(await page.locator('#layer-list').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  await preview.locator('#incBalanceActions button').first().evaluate(el=>el.click());await preview.locator('#mBalance.show').waitFor({state:'hidden'});
  await page.screenshot({path:'qa/merchant-20261028/verified-preview.png'});
 });
 await test('M08 Returning to edit restores selection but does not import runtime DOM',async()=>{
  await page.locator('#exit-preview').click();assert.equal(await page.evaluate(()=>htmlStudio.doc.querySelectorAll('#lE tr').length),0);
  await page.evaluate(()=>htmlStudio.zoomTo(.42));await page.waitForTimeout(60);await clickCanvas('h2');
  assert.equal(await page.locator('#layer-list').evaluate(el=>getComputedStyle(el).pointerEvents),'auto');
 });
 await test('M09 At 1280px viewport both canvas and layer selection still work',async()=>{
  await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>htmlStudio.zoomTo(.35));await page.waitForTimeout(60);
  const id=await clickCanvas('h2');await page.locator(`.layer-row[data-id="${id}"] .layer-text`).click();assert.deepEqual(await page.evaluate(()=>htmlStudio.selection),[id]);
  await page.screenshot({path:'qa/merchant-20261028/verified-edit.png'});
 });
 await test('M10 Export preserves source scripts and dynamic rendering; original file unchanged',async()=>{
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-button').click()]);const out=path.resolve('qa/merchant-20261028/exported.html');await download.saveAs(out);
  const html=await fs.readFile(out,'utf8');assert.ok(!html.includes('blob:'));assert.ok(!html.includes('data-hs-'));
  const scripts=await page.evaluate(({source,output})=>{const parse=s=>[...new DOMParser().parseFromString(s,'text/html').scripts].map(s=>s.textContent);return{source:parse(source),output:parse(output)}},{source:source.toString(),output:html});assert.deepEqual(scripts.output,scripts.source);
  const other=await context.newPage();await other.goto(pathToFileURL(out).href);assert.ok(await other.locator('#lE tr').count()>0);await other.close();
  assert.equal(createHash('sha256').update(await fs.readFile(filename)).digest('hex'),hash);assert.deepEqual(errors,[]);
 });
}catch{process.exitCode=1;}finally{
 await fs.writeFile(output,JSON.stringify({date:new Date().toISOString(),browser:await browser.version(),editor:base,source:{name:path.basename(filename),sha256:hash,bytes:source.length},metrics,results,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,errors},null,2));await browser.close();
}
