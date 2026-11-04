import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=path.resolve(process.env.DIAGNOSTICS_REPORT_DIR||'qa/preview-diagnostics/file'),results=[],errors=[];await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE,headless:!process.env.HEADED}:{channel:'chrome'}),p=await browser.newPage({viewport:{width:1480,height:956},acceptDownloads:true});
p.on('pageerror',e=>errors.push(e.message));await p.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());p.setDefaultTimeout(10000);
const original='<!doctype html><style>html,body{margin:0;width:100%;height:100%}.viewport{position:fixed;inset:0}.deck-stage{width:960px;height:540px}.slide{width:960px;height:540px;background:#ffd}</style><div class="viewport"><main class="deck-stage"><section class="slide active"><h1>PRIVATE BODY SENTINEL</h1></section></main></div>';
const preview=()=>p.frameLocator('#preview-frame');
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);throw e;}}
async function download(name){await p.locator('#preview-details').click();const pending=p.waitForEvent('download');await p.getByRole('button',{name:'下载诊断',exact:true}).click();const d=await pending,file=path.join(dir,name+'.json');await d.saveAs(file);await p.locator('#dialog-close').click();return JSON.parse(await fs.readFile(file,'utf8'));}
let before;
try{
await p.goto(process.env.TEST_URL||pathToFileURL(path.resolve(process.env.EDITOR_FILE||'HTML Studio.html')).href);await p.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await p.evaluate(()=>htmlStudio.ready);await p.evaluate(html=>htmlStudio.newDocument(html,'Diagnostics'),original);before=await p.evaluate(()=>htmlStudio.doc.documentElement.outerHTML);
await test('D01 诊断包含内部根节点、祖先和外部宿主尺寸，保持沙箱隔离且不含正文',async()=>{
 await p.locator('#preview-button').click();await p.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');const d=await download('visible');assert.equal(d.diagnosticVersion,2);assert.equal(d.freshInspection,true);assert.ok(d.runtime.root.width>0);assert.ok(d.runtime.body.height>0);assert.ok(d.runtime.ancestors.some(n=>n.element==='div.viewport'));assert.ok(d.host.ancestors.some(n=>n.element==='div#artboard'));assert.equal(await p.locator('#preview-frame').getAttribute('sandbox'),'allow-scripts');assert.ok(!JSON.stringify(d).includes('PRIVATE BODY SENTINEL'));
});
await test('D02 播放后父容器变成 display:none 时，下载即时读数指明隐藏祖先，不沿用旧的正常尺寸',async()=>{
 await p.waitForTimeout(4000);await preview().locator('body').evaluate(()=>document.querySelector('.viewport').style.display='none');const d=await download('hidden-ancestor');assert.equal(d.freshInspection,true);assert.equal(d.runtime.stage.width,0);assert.ok(d.runtime.ancestors.some(n=>n.element==='div.viewport'&&n.display==='none'));assert.ok(d.runtime.root.width>0);assert.equal(d.runtime.stage.cssWidth,'960px');
});
await test('D03 根节点隐藏时记录零尺寸起点，诊断不会擅自移除原页面隐藏样式',async()=>{
 await preview().locator('body').evaluate(()=>{document.querySelector('.viewport').style.display='';document.documentElement.style.display='none';});const d=await download('hidden-root');assert.equal(d.runtime.root.display,'none');assert.equal(d.runtime.root.width,0);assert.equal(d.runtime.body.width,0);assert.equal(await preview().locator('html').getAttribute('style'),'display: none;');
});
await test('D04 诊断进行中退出预览会取消旧会话；重新播放后返回编辑保持原文档',async()=>{
 const value=await p.evaluate(async()=>{const pending=htmlStudio.cancelPreview.inspect();htmlStudio.togglePreview(false);return pending;});assert.equal(value,null);await p.locator('#preview-button').click();await p.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');const d=await download('restarted');assert.ok(d.runtime.root.width>0);assert.ok(d.runtime.stage.width>0);await p.locator('#exit-preview').click();assert.equal(await p.evaluate(()=>htmlStudio.doc.documentElement.outerHTML),before);
});
await test('D05 无未捕获异常',async()=>assert.deepEqual(errors,[]));
}catch{process.exitCode=1;}finally{await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({date:new Date().toISOString(),browser:await browser.version(),results,errors},null,2));await browser.close();}
