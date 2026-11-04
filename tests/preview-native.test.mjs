import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const mode=process.env.TEST_URL?'http':'file',dir=path.resolve(`qa/preview-native-20261031/${mode}`);await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome'}),results=[];
async function test(name,fn,{blockWrite=false}={}){
 const page=await browser.newPage({viewport:{width:1512,height:982},acceptDownloads:true}),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
 const start=Date.now();try{
  if(blockWrite)await page.addInitScript(()=>{if(window!==top)Document.prototype.write=function(){throw Error('document.write disabled in this test');};});
  await page.goto(process.env.TEST_URL||pathToFileURL(path.resolve(process.env.EDITOR_FILE||'HTML Studio.html')).href);await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await page.evaluate(()=>htmlStudio.ready);await fn(page);assert.deepEqual(errors,[]);results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name);
 }catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);await page.screenshot({path:path.join(dir,'failure.png')});throw e;}finally{await page.close();}
}
const load=(p,html)=>p.evaluate(html=>htmlStudio.newDocument(html,'Native preview test'),html),ready=p=>p.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready'),preview=p=>p.frameLocator('#preview-frame');
try{
 await test('N01 document.write 被禁用时原生加载仍执行原脚本，保留解析顺序和图片，维持隔离',async p=>{
  await load(p,`<!doctype html><head><script>window.order=['head'];document.addEventListener('DOMContentLoaded',()=>order.push('dom'));</script></head><body><h1>Native</h1><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12'%3E%3C/svg%3E"><script>order.push('body');document.querySelector('h1').textContent='Native script ran';try{parent.document.body;window.isolated=false}catch{window.isolated=true}</script></body>`);
  await p.locator('#preview-button').click();await ready(p);assert.equal(await p.evaluate(()=>htmlStudio.previewStatus.details.loader),'native');assert.equal(await preview(p).locator('h1').textContent(),'Native script ran');assert.deepEqual(await preview(p).locator('body').evaluate(()=>({order,isolated})),{order:['head','body','dom'],isolated:true});assert.equal(await preview(p).locator('img').evaluate(n=>n.naturalWidth),12);assert.equal(await p.locator('#preview-frame').getAttribute('sandbox'),'allow-scripts');
 },{blockWrite:true});
 await test('N02 大资源自动保留 Blob 传递，不做巨型 Base64 预览，脚本和资源正常',async p=>{
  await p.evaluate(async()=>{const url=htmlStudio.assets.add(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13"></svg>'+' '.repeat(13*1024*1024)],{type:'image/svg+xml'}));await htmlStudio.newDocument('<h1>Large resource</h1><img src="'+url+'"><script>window.largePreview=true</script>','Large preview');});
  await p.locator('#preview-button').click();await ready(p);assert.equal(await p.evaluate(()=>htmlStudio.previewStatus.details.loader),'transfer');assert.equal(await preview(p).locator('img').evaluate(async n=>{await n.decode();return n.naturalWidth;}),13);assert.match(await preview(p).locator('img').getAttribute('src'),/^blob:/);assert.equal(await preview(p).locator('body').evaluate(()=>window.largePreview),true);
 });
 await test('N03 原生资源准备期间切换文档，旧读取完成不能覆盖新预览',async p=>{
  await p.evaluate(async()=>{const url=htmlStudio.assets.add(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"></svg>'],{type:'image/svg+xml'}));await htmlStudio.newDocument('<h1>Old document</h1><img src="'+url+'">','Old document');const native=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(...args){setTimeout(()=>native.apply(this,args),600)};htmlStudio.togglePreview(true);await htmlStudio.newDocument('<h1>Latest native document</h1>','Latest');htmlStudio.togglePreview(true);FileReader.prototype.readAsDataURL=native;});
  await ready(p);await p.waitForTimeout(900);assert.equal(await preview(p).locator('h1').textContent(),'Latest native document');assert.deepEqual(await p.evaluate(()=>htmlStudio.previewDiagnostics),[]);
 });
 await test('N04 隐藏页面诊断含原生加载、脚本接口、激活页和尺寸，可下载且不写入工程',async p=>{
  await load(p,'<style>.slide{visibility:hidden;width:960px;height:540px}</style><section class="slide"><h1>Hidden content</h1></section>');const before=await p.evaluate(()=>htmlStudio.doc.documentElement.outerHTML);await p.locator('#preview-button').click();await p.waitForFunction(()=>htmlStudio.previewStatus.state==='empty');const info=await p.evaluate(()=>htmlStudio.previewStatus.details);assert.equal(info.loader,'native');assert.equal(info.pages,1);assert.equal(info.activePages,0);assert.equal(info.presentation,false);assert.ok(info.viewport[0]>0&&info.viewport[1]>0);await p.locator('#preview-details').click();const wait=p.waitForEvent('download');await p.getByRole('button',{name:'下载诊断',exact:true}).click();const d=await wait,file=path.join(dir,'diagnostics.txt');await d.saveAs(file);const json=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(json.runtime.loader,'native');assert.equal(json.runtime.pages,1);assert.ok(json.browser.includes('Chrome'));await p.locator('#dialog-close').click();await p.locator('#exit-preview').click();assert.equal(await p.evaluate(()=>htmlStudio.doc.documentElement.outerHTML),before);
 });
 await test('N05 同一资源重复引用按展开后大小计算，保持共享 Blob，避免重复内嵌膨胀',async p=>{
  await p.evaluate(async()=>{const url=htmlStudio.assets.add(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15"></svg>'+' '.repeat(1024*1024)],{type:'image/svg+xml'}));await htmlStudio.newDocument('<h1>Repeated resource</h1>'+('<img src="'+url+'">').repeat(13),'Repeated resource');});await p.locator('#preview-button').click();await ready(p);assert.equal(await p.evaluate(()=>htmlStudio.previewStatus.details.loader),'transfer');const urls=await preview(p).locator('img').evaluateAll(ns=>ns.map(n=>n.src));assert.equal(new Set(urls).size,1);assert.match(urls[0],/^blob:/);assert.equal(await preview(p).locator('img').first().evaluate(async n=>{await n.decode();return n.naturalWidth}),15);
 });
}catch{process.exitCode=1;}finally{await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({date:new Date().toISOString(),mode,browser:await browser.version(),results},null,2));await browser.close();}
