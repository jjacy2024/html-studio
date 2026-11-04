import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {acknowledgeCompatibility} from './compatibility-support.mjs';

if(!process.env.SALES_FILE)throw Error('SALES_FILE is required for the edited-report workflow');
const mode=process.env.TEST_URL?'http':'file',dir=path.resolve(`qa/preview-v0.3.7/workflow-${mode}`);
await fs.mkdir(dir,{recursive:true});
const source=await fs.readFile(process.env.SALES_FILE),hash=b=>createHash('sha256').update(b).digest('hex');
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1512,height:982},acceptDownloads:true});
const results=[],errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
const state=fn=>page.evaluate(fn),edit=()=>page.frameLocator('#edit-frame'),preview=()=>page.frameLocator('#preview-frame');
let index=18,editedTitle,scripts,expectedOrder,chartEdited=false,editedPagesChecked=0;
const current=()=>edit().locator('.slide').nth(index);
async function test(name,fn){const start=Date.now();try{await fn();results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);await page.screenshot({path:path.join(dir,'failure.png')});throw e;}}
async function importFile(file){const before=await state(()=>{htmlStudio.dirty=false;return htmlStudio.loadVersion});await page.locator('#file-input').setInputFiles(file);await page.waitForFunction(v=>htmlStudio.loadVersion>v&&!htmlStudio.loading&&htmlStudio.compatibility!==null,before);await acknowledgeCompatibility(page);}
async function download(button,name){const wait=page.waitForEvent('download');await page.locator(button).click();const d=await wait,file=path.join(dir,name);await d.saveAs(file);return file;}
async function checkPreview(name){
 await page.locator('#preview-button').click();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');
 const active=preview().locator('.slide.active');assert.equal(await active.locator('h2').textContent(),editedTitle);
 assert.equal(await active.evaluate(n=>[...document.querySelectorAll('.slide')].indexOf(n)),index);
 await active.locator('h2').waitFor({state:'visible'});await page.waitForTimeout(700);assert.deepEqual(await state(()=>htmlStudio.previewDiagnostics),[]);
 if(chartEdited){await active.locator('svg').waitFor({state:'visible'});assert.equal(await active.locator('[data-studio-svg-key="value-8-0"]').textContent(),'130.1');}
 await page.locator('#preview-frame').screenshot({path:path.join(dir,name+'.png')});await page.locator('#exit-preview').click();
}
async function dbl(locator){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.locator('#canvas-scroll').evaluate((p,b)=>{const r=p.getBoundingClientRect();p.scrollTop+=b.y+b.height/2-r.y-r.height/2;},b);await locator.dblclick();}
try{
 await page.goto(process.env.TEST_URL||pathToFileURL(path.resolve('HTML Studio.html')).href);await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await state(()=>htmlStudio.ready);
 await test('C01 真实文件导入与兼容性提示后，双击改标题，未退出文字编辑直接点预览',async()=>{
  await importFile(process.env.SALES_FILE);scripts=await state(()=>[...htmlStudio.doc.scripts].map(n=>n.textContent));await page.locator('#page-select').selectOption('18');
  editedTitle=(await current().locator('h2').textContent())+' · 编辑后预览测试';await dbl(current().locator('h2'));await edit().locator('[data-hs-editing]').fill(editedTitle);await checkPreview('text-edit');
 });
 await test('C02 第19页真实双击瀑布图，原样绑定并改数值后预览可见且联动一致',async()=>{
  await dbl(current().locator('svg rect').nth(1));await page.getByRole('button',{name:'绑定并编辑数据',exact:true}).click();
  const cell=page.locator('[data-svg-bar="bar-1-0"]');await cell.fill('323.84');await cell.press('Tab');await page.locator('#dialog-close').click();chartEdited=true;await checkPreview('chart-edit');
  assert.equal(await current().locator('[data-studio-svg-key="value-8-0"]').textContent(),'130.1');
 });
 await test('C03 编辑后真实拖动第19页至第17页，再预览并检查顺序与可见内容',async()=>{
  await page.locator('#manage-pages').click();const rows=page.locator('.page-manager-row'),handle=rows.nth(18).locator('.page-drag-handle');await handle.scrollIntoViewIfNeeded();let b=await handle.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await rows.nth(16).evaluate(n=>n.scrollIntoView({block:"center"}));b=await rows.nth(16).boundingBox();await page.mouse.move(b.x+60,b.y+b.height*.25,{steps:12});await page.mouse.up();await page.locator('#dialog-close').click();
  index=16;assert.equal(await page.locator('#page-select').inputValue(),'16');expectedOrder=await state(()=>htmlStudio.pages.pages.map(n=>n.dataset.title));await checkPreview('edited-reordered');
 });
 await test('C04 排序撤回和重做后仍从正确当前页预览',async()=>{
  await state(()=>htmlStudio.undo());index=18;await checkPreview('undo-order');await state(()=>htmlStudio.redo());index=16;await checkPreview('redo-order');
 });
 await test('C05 修改并排序后的工程通过实际文件入口重开，页序、文字、图表与预览一致',async()=>{
  const file=await download('#save-button','workflow.htmlstudio');await importFile(file);
  assert.deepEqual(await state(()=>htmlStudio.pages.pages.map(n=>n.dataset.title)),expectedOrder);await checkPreview('project-reopened');assert.equal(await current().locator('[data-studio-svg-key="value-8-0"]').textContent(),'130.1');
 });
 await test('C06 修改后的整份报告逐页进入预览，26页标题与可见性均正常',async()=>{
  for(let i=0;i<26;i++){await page.locator('#page-select').selectOption(String(i));const title=await edit().locator('.slide').nth(i).locator('h1,h2').first().textContent();await page.locator('#preview-button').click();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');assert.equal(await preview().locator('.slide.active h1,.slide.active h2').first().textContent(),title);await preview().locator('.slide.active h1,.slide.active h2').first().waitFor({state:'visible'});assert.deepEqual(await state(()=>htmlStudio.previewDiagnostics),[]);await page.locator('#exit-preview').click();editedPagesChecked++;}
  await page.locator('#page-select').selectOption('16');
 });
 await test('C07 导出文件独立播放与重新导入后的预览均保留修改，原脚本和源文件不变',async()=>{
  const file=await download('#export-button','workflow-export.html'),out=await browser.newPage();await out.goto(pathToFileURL(file).href);await out.waitForFunction(()=>window.presentation);await out.evaluate(()=>presentation.showSlide(16));await out.locator('.slide.active h2').waitFor({state:'visible'});assert.equal(await out.locator('.slide.active h2').textContent(),editedTitle);assert.equal(await out.locator('.slide.active [data-studio-svg-key="value-8-0"]').textContent(),'130.1');await out.close();
  await importFile(file);await page.locator('#page-select').selectOption('16');await checkPreview('export-reimported');assert.deepEqual(await state(()=>[...htmlStudio.doc.scripts].map(n=>n.textContent)),scripts);assert.equal(hash(await fs.readFile(process.env.SALES_FILE)),hash(source));
 });
 await test('C08 全流程无未捕获脚本异常',async()=>assert.deepEqual(errors,[]));
}catch{process.exitCode=1;}finally{
 await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({mode,date:new Date().toISOString(),browser:await browser.version(),salesIncluded:true,editedPagesChecked,results,errors},null,2));await browser.close();
}
