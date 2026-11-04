import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {templateLibrary} from '../dist/templates.js';
const mode=process.env.TEST_URL?'http':'file',dir=path.resolve(`qa/preview-v0.3.7/${mode}`);await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1512,height:982},acceptDownloads:true}),results=[],errors=[];
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
const state=fn=>page.evaluate(fn),frame=()=>page.frameLocator('#preview-frame'),open=()=>page.locator('#preview-button').click(),exit=()=>page.locator('#exit-preview').click();
const load=html=>page.evaluate(html=>htmlStudio.newDocument(html,'Preview test'),html);
const ready=()=>page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');
const deck=({delay=0,script='',api=true}={})=>`<!doctype html><html><head><style>body{margin:0}.slides{position:absolute;width:960px;height:540px}.slide{position:absolute;inset:0;width:960px;height:540px;visibility:hidden;opacity:0;background:#e8dcfa}.slide.active{visibility:visible;opacity:1}h1{padding:60px;font:50px sans-serif}</style></head><body><main class="slides">${[0,1,2].map(i=>`<section class="slide" data-title="Page ${i+1}"><h1>Page ${i+1}</h1></section>`).join('')}</main><script>${script}${api?`setTimeout(()=>{window.presentation={slides:[...document.querySelectorAll('.slide')],showSlide(i){this.currentSlide=i;this.slides.forEach((s,n)=>s.classList.toggle('active',i===n))}};presentation.showSlide(0);document.addEventListener('keydown',e=>{if(e.key==='ArrowRight')presentation.showSlide(Math.min(2,presentation.currentSlide+1))});},${delay})`:''}</script></body></html>`;
async function test(name,fn){if(process.env.PREVIEW_TEMPLATE_ONLY&&!name.startsWith('P10'))return;const start=Date.now();try{await fn();results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);await page.screenshot({path:path.join(dir,'failure.png')});throw e;}}
async function save(name,button='#save-button'){const wait=page.waitForEvent('download');await page.locator(button).click();const d=await wait;await d.saveAs(path.join(dir,name));return fs.readFile(path.join(dir,name),'utf8');}
try{
 await page.goto(process.env.TEST_URL||pathToFileURL(path.resolve('HTML Studio.html')).href);await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await state(()=>htmlStudio.ready);
 await test('P01 presentation 延迟初始化后从当前页播放，真实按键可翻页，返回编辑保留页码',async()=>{
  await load(deck({delay:500}));await page.locator('#page-select').selectOption('1');await open();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');await frame().locator('.slide.active h1').filter({hasText:'Page 2'}).waitFor();const b=await page.locator('#preview-frame').boundingBox();await page.mouse.click(b.x+100,b.y+100);await page.keyboard.press('ArrowRight');assert.equal(await frame().locator('.slide.active h1').textContent(),'Page 3');await exit();assert.equal(await page.locator('#page-select').inputValue(),'1');
 });
 await test('P02 快速进入/退出和重新播放只保留最后一次预览，不沿用旧页码',async()=>{
  for(let i=0;i<8;i++){await state(()=>{htmlStudio.togglePreview(true);htmlStudio.togglePreview(false);});await page.locator('#page-select').selectOption(String(i%3));await open();await page.waitForTimeout(600);assert.equal(await frame().locator('.slide.active h1').textContent(),`Page ${i%3+1}`);await page.locator('#restart-preview').click();await page.waitForTimeout(600);assert.equal(await frame().locator('.slide.active h1').textContent(),`Page ${i%3+1}`);await exit();}
 });
 await test('P03 抛错与拒绝的 Promise 显示诊断，返回编辑不丢文档，诊断内容转义',async()=>{
  for(const script of ['throw Error("fixture-preview-error <img src=x>");','Promise.reject(Error("fixture-preview-rejection"));']){await load(deck({api:false,script}));const before=await state(()=>htmlStudio.doc.documentElement.outerHTML);await open();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='error');await page.locator('#preview-details').click();assert.match(await page.locator('#dialog-body').textContent(),/fixture-preview/);assert.equal(await page.locator('#dialog-body img').count(),0);await page.locator('#dialog-close').click();await exit();assert.equal(await state(()=>htmlStudio.doc.documentElement.outerHTML),before);}
 });
 await test('P04 脚本未启动导致所有页面隐藏时提示内容不可见，不假报正常播放',async()=>{await load(deck({api:false}));await open();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='empty');assert.match(await page.locator('#preview-status').textContent(),/未完整显示/);await exit();});
 await test('P05 外部脚本加载失败显示诊断，普通静态/CSS 动效预览正常',async()=>{
  await load(deck({api:false}).replace('</body>','<script src="https://example.test/missing-preview.js"></script></body>'));await open();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='error');assert.match(await state(()=>htmlStudio.previewStatus.message),/脚本未能加载/);await exit();await load('<h1>Static preview</h1><style>@keyframes spin{to{transform:rotate(360deg)}}.box{background:purple;width:50px;height:50px;animation:spin 2s linear infinite}</style><div class="box"></div>');await open();await ready();assert.equal(await frame().locator('h1').isVisible(),true);assert.equal(await frame().locator('.box').evaluate(n=>getComputedStyle(n).animationName),'spin');await exit();
 });
 await test('P06 预览状态消息丢失时提示加载超时，重新播放恢复，不产生永久白屏无反馈',async()=>{
  await load('<h1>Recovered preview</h1>');await state(()=>{window.dropPreviewStatus=e=>{if(e.data?.previewStatus)e.stopImmediatePropagation();};window.addEventListener('message',window.dropPreviewStatus,true);});await open();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='slow',null,{timeout:10000});await state(()=>window.removeEventListener('message',window.dropPreviewStatus,true));await page.locator('#restart-preview').click();await ready();assert.equal(await frame().locator('h1').textContent(),'Recovered preview');await exit();
 });
 await test('P07 换文档时取消旧预览状态与报错，不污染新预览',async()=>{await load(deck({script:'setTimeout(()=>{throw Error("fixture-preview-old")},800);'}));await open();await load('<h1>Latest document</h1>');await open();await ready();await page.waitForTimeout(900);assert.equal(await state(()=>htmlStudio.previewStatus.state),'ready');assert.deepEqual(await state(()=>htmlStudio.previewDiagnostics),[]);await exit();});
 await test('P12 末页位于大量隐藏文字之后时仍识别可见内容，不因扫描截断误报空白',async()=>{
  const hiddenText=Array.from({length:1200},(_,i)=>`<span>Earlier hidden content ${i}</span>`).join('');
  await load(deck().replace('<h1>Page 1</h1>','<h1>Page 1</h1>'+hiddenText));await page.locator('#page-select').selectOption('2');await open();await ready();assert.equal(await frame().locator('.slide.active h1').textContent(),'Page 3');await page.waitForTimeout(3700);assert.equal(await state(()=>htmlStudio.previewStatus.state),'ready');assert.deepEqual(await state(()=>htmlStudio.previewDiagnostics),[]);await exit();
 });
 if(process.env.SALES_FILE){
  const source=await fs.readFile(process.env.SALES_FILE),hash=b=>createHash('sha256').update(b).digest('hex');await load(source.toString());
  for(let i=0;i<26;i++)await test(`P08 报告第 ${String(i+1).padStart(2,'0')} 页：正确当前页、标题/内容可见、完整画布内呈现`,async()=>{
   await page.locator('#page-select').selectOption(String(i));const title=await state(()=>htmlStudio.pageRoot.dataset.title);await open();await ready();const active=frame().locator('.slide.active');assert.equal(await active.getAttribute('data-title'),title);assert.equal(await active.evaluate(n=>[...document.querySelectorAll('.slide')].indexOf(n)),i);assert.equal(await active.locator('h1,h2').first().isVisible(),true);await active.locator('.reveal').first().evaluate(n=>new Promise(resolve=>{const check=()=>getComputedStyle(n).opacity==='1'?resolve():requestAnimationFrame(check);check();}));const rect=await active.evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,w:innerWidth,h:innerHeight}});assert.ok(rect.width>0&&rect.height>0&&rect.x>=-1&&rect.y>=-1&&rect.x+rect.width<=rect.w+1&&rect.y+rect.height<=rect.h+1);assert.deepEqual(await state(()=>htmlStudio.previewDiagnostics),[]);await page.locator('#preview-frame').screenshot({path:path.join(dir,`sales-${String(i+1).padStart(2,'0')}.png`)});if(i===18)await page.screenshot({path:path.join(dir,'editor-preview-page19.png')});await exit();assert.equal(await page.locator('#page-select').inputValue(),String(i));
  });
  await test('P09 报告工程重开/重排后按新当前页预览；导出保持原播放入口，原文件不变',async()=>{
   await page.locator('#page-select').selectOption('18');await state(()=>htmlStudio.reorderPage(htmlStudio.id(htmlStudio.pageRoot),2));const title=await state(()=>htmlStudio.pageRoot.dataset.title);const project=JSON.parse(await save('preview-report.htmlstudio'));await page.evaluate(p=>htmlStudio.load(p),project);await open();await ready();assert.equal(await frame().locator('.slide.active').getAttribute('data-title'),title);assert.equal(await frame().locator('body').evaluate(()=>presentation.currentSlide),2);await exit();const html=await save('preview-report-export.html','#export-button');assert.ok(!html.includes('startPagePreview'));assert.ok(!html.includes('previewStatus'));assert.ok(!html.includes('studio-preview-navigation-error'));assert.equal(hash(await fs.readFile(process.env.SALES_FILE)),hash(source));
  });
 }
 for(const template of templateLibrary)await test(`P10 ${template.slug} 模板：预览内容载入，原生可见内容不为空`,async()=>{
  await page.evaluate(slug=>htmlStudio.createFromTemplate(slug),template.slug);await open();await frame().locator('body').waitFor({state:'attached'});await ready();const info=await frame().locator('body').evaluate(()=>({text:document.body.innerText.trim().length,media:document.querySelectorAll('svg,canvas,img').length}));assert.ok(info.text>0||info.media>0);assert.deepEqual(await state(()=>htmlStudio.previewDiagnostics),[]);await exit();
 });
 await test('P11 除刻意构造的脚本失败外没有未捕获错误',async()=>assert.deepEqual(errors.filter(e=>!e.includes('fixture-preview-')),[]));
}catch{process.exitCode=1;}finally{
 const report={date:new Date().toISOString(),mode,salesIncluded:!!process.env.SALES_FILE,browser:await browser.version(),results,errors};await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(report,null,2));await fs.writeFile('qa/preview-results.json',JSON.stringify(report,null,2));await browser.close();
}
