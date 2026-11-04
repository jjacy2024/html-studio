// Reproduce a supplied saved project without reading the user's live browser.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

if(!process.env.PREVIEW_PROJECT)throw Error('Set PREVIEW_PROJECT to the saved .htmlstudio file');
const file=path.resolve(process.env.PREVIEW_PROJECT),source=await fs.readFile(file),project=JSON.parse(source);
const hash=b=>createHash('sha256').update(b).digest('hex'),mode=process.env.TEST_URL?'http':process.env.HEADED?'headed':'file';
const dir=path.resolve(process.env.PREVIEW_PROJECT_REPORT_DIR||`qa/preview-project-20261031/${mode}`);await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({...process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{channel:'chrome'},headless:!process.env.HEADED}),page=await browser.newPage({viewport:{width:1512,height:982},acceptDownloads:true});
const results=[],errors=[],observedLoaders=new Set();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
const state=fn=>page.evaluate(fn),frame=()=>page.frameLocator('#preview-frame'),ready=()=>page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');
const editorURL=process.env.TEST_URL||pathToFileURL(path.resolve(process.env.EDITOR_FILE||'HTML Studio.html')).href;
let original,selectedIndex,selectedTitle,pageCount;
const authored=()=>state(()=>({scripts:[...htmlStudio.doc.scripts].map(n=>[n.type,n.src,n.textContent]),pages:htmlStudio.pages.pages.map(p=>{const c=p.cloneNode(true);for(const n of [c,...c.querySelectorAll('*')])for(const a of [...n.attributes])if(a.name.startsWith('data-hs-'))n.removeAttribute(a.name);return c.outerHTML;})}));
async function loadProject(file){const version=await state(()=>{htmlStudio.dirty=false;return htmlStudio.loadVersion;});await page.locator('#file-input').setInputFiles(file);await page.waitForFunction(v=>htmlStudio.loadVersion>v&&!htmlStudio.loading&&htmlStudio.compatibility!==null,version);}
async function test(name,fn){const start=Date.now();try{await fn();results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);await page.screenshot({path:path.join(dir,'failure.png')});throw e;}}
async function inspectCurrent(screenshot){
 const index=await state(()=>htmlStudio.pages.index),title=await state(()=>htmlStudio.pageRoot.dataset.title);
 await page.locator('#preview-button').click();await ready();const active=frame().locator('.slide.active');assert.equal(await active.getAttribute('data-title'),title);assert.equal(await active.evaluate(n=>[...document.querySelectorAll('.slide')].indexOf(n)),index);
 await active.locator('h1,h2').first().waitFor({state:'visible'});await active.locator('.reveal').first().evaluate(n=>new Promise(resolve=>{const poll=()=>getComputedStyle(n).opacity==='1'?resolve():requestAnimationFrame(poll);poll();}));
 const r=await active.evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight}});assert.ok(r.w>0&&r.h>0&&r.x>=-1&&r.y>=-1&&r.x+r.w<=r.vw+1&&r.y+r.h<=r.vh+1);
 assert.deepEqual(await state(()=>htmlStudio.previewDiagnostics),[]);observedLoaders.add(await state(()=>htmlStudio.previewStatus.details?.loader));if(screenshot)await page.locator('#preview-frame').screenshot({path:path.join(dir,screenshot+'.png')});
 await page.locator('#exit-preview').click();assert.equal(await state(()=>htmlStudio.pages.index),index);
}
async function save(button,name){const waiting=page.waitForEvent('download');await page.locator(button).click();const d=await waiting,out=path.join(dir,name);await d.saveAs(out);return out;}
try{
 await page.goto(editorURL);await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await state(()=>htmlStudio.ready);
 await test('J01 实际工程导入保留保存的当前页与脚本，并能预览',async()=>{
  await loadProject(file);assert.equal(await state(()=>htmlStudio.id(htmlStudio.pageRoot)),project.pageView.id);original=await authored();selectedIndex=await state(()=>htmlStudio.pages.index);selectedTitle=await state(()=>htmlStudio.pageRoot.dataset.title);pageCount=await state(()=>htmlStudio.pages.pages.length);await inspectCurrent('saved-current-page');
 });
 for(let i=0;i<pageCount;i++)await test(`J02 实际已编辑工程第 ${i+1} 页：当前页、可见内容和画布位置正常`,async()=>{await page.locator('#page-select').selectOption(String(i));await inspectCurrent(`page-${String(i+1).padStart(2,'0')}`);});
 await test('J03 连续20次快速切换、5次重新播放后仍正确显示，文档修改保持不变',async()=>{
  await page.locator('#page-select').selectOption(String(selectedIndex));for(let i=0;i<20;i++)await state(()=>{htmlStudio.togglePreview(true);htmlStudio.togglePreview(false);});await page.locator('#preview-button').click();
  for(let i=0;i<5;i++){await page.locator('#restart-preview').click();await ready();assert.equal(await frame().locator('.slide.active').getAttribute('data-title'),selectedTitle);}await page.waitForTimeout(4000);assert.equal(await state(()=>htmlStudio.previewStatus.state),'ready');await page.screenshot({path:path.join(dir,'repeated-preview.png')});await page.locator('#exit-preview').click();assert.deepEqual(await authored(),original);
 });
 await test('J04 原生键盘翻页、首末页导航与返回编辑一致',async()=>{
  await page.locator('#preview-button').click();await ready();const b=await page.locator('#preview-frame').boundingBox();await page.mouse.click(b.x+40,b.y+40);await page.keyboard.press('End');assert.equal(await frame().locator('body').evaluate(()=>presentation.currentSlide),pageCount-1);await page.keyboard.press('Home');assert.equal(await frame().locator('body').evaluate(()=>presentation.currentSlide),0);await page.keyboard.press('ArrowRight');assert.equal(await frame().locator('body').evaluate(()=>presentation.currentSlide),1);await page.locator('#exit-preview').click();assert.equal(await state(()=>htmlStudio.pages.index),selectedIndex);
 });
 await test('J05 保存工程再从文件重开，原有文字、表格、图表与预览保持一致',async()=>{
  const saved=await save('#save-button','roundtrip.htmlstudio');await loadProject(saved);assert.deepEqual(await authored(),original);await inspectCurrent('project-roundtrip');
 });
 await test('J06 浏览器刷新恢复测试草稿后仍能预览，同一工程内容不变',async()=>{
  await state(()=>htmlStudio.scheduleDraft());await page.waitForTimeout(1200);await page.reload();await page.waitForFunction(name=>window.htmlStudio?.name===name&&!htmlStudio.loading,project.name);await state(()=>htmlStudio.ready);assert.deepEqual(await authored(),original);await inspectCurrent('draft-restored');
 });
 await test('J07 独立导出可播放实际第19页；未修改用户工程或原脚本',async()=>{
  const out=await save('#export-button','verified-export.html'),p=await browser.newPage();await p.goto(pathToFileURL(out).href);await p.waitForFunction(()=>window.presentation);await p.evaluate(i=>presentation.showSlide(i),selectedIndex);await p.locator('.slide.active h1,.slide.active h2').first().waitFor({state:'visible'});assert.equal(await p.locator('.slide.active').getAttribute('data-title'),selectedTitle);assert.deepEqual(await p.locator('script').evaluateAll(ns=>ns.map(n=>[n.type,n.src,n.textContent])),original.scripts);await p.close();assert.equal(hash(await fs.readFile(file)),hash(source));
 });
 await test('J08 全程无未捕获的脚本错误',async()=>assert.deepEqual(errors,[]));
}catch{process.exitCode=1;}finally{
 await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({date:new Date().toISOString(),mode,browser:await browser.version(),editorVersion:JSON.parse(await fs.readFile('package.json','utf8')).version,sourceSHA256:hash(source),pageCount,observedLoaders:[...observedLoaders],results,errors},null,2));await browser.close();
}
