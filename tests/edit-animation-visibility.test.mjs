import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const dir='qa/edit-animation-visibility';await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1512,height:982}}),results=[],errors=[];
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:/,r=>r.abort());
const edit=()=>page.frameLocator('#edit-frame'),ready=()=>page.waitForFunction(()=>!htmlStudio.loading);
async function test(name,fn){try{const details=await fn();results.push({name,pass:true,...details});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});await page.screenshot({path:dir+'/failure.png'});throw e;}}
try{
 await page.goto(pathToFileURL(path.resolve('HTML Studio.html')).href);await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await page.evaluate(()=>htmlStudio.ready);
 for(const slug of ['broadside','monochrome','grove','studio','signal']){
  await page.evaluate(s=>htmlStudio.createFromTemplate(s),slug);
  await test(slug+' 每页的标题及标记入场元素在编辑态可见',async()=>{
   const all=await page.evaluate(()=>{const e=htmlStudio,out=[];for(let i=0;i<e.pages.pages.length;i++){e.switchPage(i);const candidates=[...e.pageRoot.querySelectorAll('[data-anim]')];const ns=candidates.filter(n=>{for(let p=n;p&&p!==e.pageRoot;p=p.parentElement)if(e.style(p).display==='none'||p.hidden)return false;return true;});out.push({page:i+1,count:ns.length,intentionallyHidden:candidates.length-ns.length,hidden:ns.filter(n=>{for(let p=n;p&&p!==e.doc.body;p=p.parentElement){const s=e.style(p);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return true;}const r=n.getBoundingClientRect();return !r.width||!r.height;}).map(n=>({tag:n.localName,text:n.textContent.trim().slice(0,50),style:e.style(n).opacity}))});}e.switchPage(0);return out;});
   assert.equal(all.flatMap(p=>p.hidden).length,0,JSON.stringify(all.filter(p=>p.hidden.length)));
   return {pages:all.length,elements:all.reduce((n,p)=>n+p.count,0),intentionallyHidden:all.reduce((n,p)=>n+p.intentionallyHidden,0)};
  });
  await test(slug+' 预览仍播放入场动画，返回编辑仍可见',async()=>{
   const classes=await page.evaluate(()=>htmlStudio.pages.pages.map(p=>p.className));
   await page.locator('#preview-button').click();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');
   const frame=page.frameLocator('#preview-frame');await frame.locator('.slide.is-active').waitFor({state:'visible'});
   await frame.locator('.slide.is-active :is(h1,h2)[data-anim]').first().evaluate(n=>Promise.all(n.ownerDocument.getAnimations().map(a=>a.finished.catch(()=>{}))));
   const state=await frame.locator('.slide.is-active :is(h1,h2)[data-anim]').first().evaluate(n=>({opacity:getComputedStyle(n).opacity,name:getComputedStyle(n).animationName,helpers:document.querySelectorAll('[data-hs-runtime="reveal-animation"]').length}));
   assert.equal(state.opacity,'1');assert.notEqual(state.name,'none');assert.equal(state.helpers,0);
   await page.locator('#exit-preview').click();assert.deepEqual(await page.evaluate(()=>htmlStudio.pages.pages.map(p=>p.className)),classes);
   assert.equal(await edit().locator('.slide [data-anim]').first().evaluate(n=>getComputedStyle(n).opacity),'1');
  });
 }
 await page.evaluate(()=>htmlStudio.createFromTemplate('broadside'));
 await test('Broadside 标题可点击、双击改字，撤回重做后仍显示',async()=>{
  const title=edit().locator('h1').first(),text=(await title.textContent()).trim();await title.dblclick();
  assert.equal(await title.getAttribute('contenteditable'),'true');await title.fill('BROAD SIDE EDITED');await page.keyboard.press('Escape');
  assert.equal(await title.textContent(),'BROAD SIDE EDITED');assert.equal(await title.evaluate(n=>getComputedStyle(n).opacity),'1');
  await page.locator('#undo').click();await ready();assert.equal((await title.textContent()).trim(),text);assert.equal(await title.evaluate(n=>getComputedStyle(n).opacity),'1');
  await page.locator('#redo').click();await ready();assert.equal(await title.textContent(),'BROAD SIDE EDITED');assert.equal(await title.evaluate(n=>getComputedStyle(n).opacity),'1');
  await page.evaluate(()=>htmlStudio.select([]));await page.screenshot({path:dir+'/broadside-fixed.png'});
 });
 await test('保留副标题原透明度；手动设置标题 0%/40% 与撤回、保存重开正确',async()=>{
  assert.equal(await edit().locator('.lead').first().evaluate(n=>getComputedStyle(n).opacity),'0.65');
  await page.evaluate(()=>{htmlStudio.select([htmlStudio.id(htmlStudio.doc.querySelector('h1'))]);htmlStudio.property('opacity',0);});
  assert.equal(await edit().locator('h1').first().evaluate(n=>getComputedStyle(n).opacity),'0');
  await page.locator('#undo').click();await ready();assert.equal(await edit().locator('h1').first().evaluate(n=>getComputedStyle(n).opacity),'1');
  await page.locator('#redo').click();await ready();assert.equal(await edit().locator('h1').first().evaluate(n=>getComputedStyle(n).opacity),'0');
  await page.evaluate(()=>htmlStudio.property('opacity',40));
  const artifact=await page.evaluate(()=>htmlStudioAPI.execute({command:'files.create',params:{format:'project',missingFonts:'online'},expected:htmlStudioAPI.getState().token}));assert.ok(artifact.ok,JSON.stringify(artifact));
  const project=JSON.parse(artifact.result.content);assert.ok(!project.html.includes('data-hs-runtime="reveal-animation"'));
  await page.evaluate(data=>htmlStudio.load(data),project);assert.equal(await edit().locator('h1').first().evaluate(n=>getComputedStyle(n).opacity),'0.4');
 });
 await test('副本沿用可见状态；导出无编辑辅助规则，原 CSS 和脚本保持',async()=>{
  await page.evaluate(()=>htmlStudio.createFromTemplate('broadside'));
  await page.evaluate(()=>{const e=htmlStudio,n=e.doc.querySelector('h1');e.select([e.id(n)]);e.duplicate();});
  assert.deepEqual(await edit().locator('.slide').first().locator('h1').evaluateAll(ns=>ns.map(n=>getComputedStyle(n).opacity)),['1','1']);
  const original=await page.evaluate(()=>({scripts:[...htmlStudio.doc.scripts].map(n=>n.textContent),css:[...htmlStudio.doc.querySelectorAll('style')].filter(n=>n.textContent.includes('[data-anim]')&&!n.hasAttribute('data-hs-runtime')).map(n=>n.textContent)}));
  const artifact=await page.evaluate(()=>htmlStudioAPI.execute({command:'files.create',params:{format:'html',missingFonts:'online'},expected:htmlStudioAPI.getState().token}));assert.ok(artifact.ok,JSON.stringify(artifact));
  const output=artifact.result.content;const exported=await page.evaluate(html=>{const d=new DOMParser().parseFromString(html,'text/html');return{scripts:[...d.scripts].map(n=>n.textContent),css:[...d.querySelectorAll('style')].filter(n=>n.textContent.includes('[data-anim]')).map(n=>n.textContent),helpers:d.querySelectorAll('[data-hs-runtime]').length};},output);
  assert.equal(exported.helpers,0);assert.deepEqual(exported.scripts,original.scripts);assert.deepEqual(exported.css,original.css);
  const file=path.resolve(dir,'broadside-export.html');await fs.writeFile(file,output);const p=await browser.newPage();await p.route(/^https?:/,r=>r.abort());await p.goto(pathToFileURL(file).href);await p.locator('.slide.is-active h1').first().evaluate(n=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));assert.equal(await p.locator('.slide.is-active h1').first().evaluate(n=>getComputedStyle(n).opacity),'1');await p.close();
 });
 await test('不显示普通隐藏元素、隐藏属性或未知动画标记；既有 CSS 入场仍可编辑',async()=>{
  const fixture='<style>.slide{width:960px;height:540px}[data-anim],.hidden{opacity:0}.css-entry{opacity:0;animation:show 1s forwards}@keyframes show{from{opacity:0}to{opacity:1}}</style><section class="slide"><h1 data-anim="fade-up">Title</h1><p class="hidden">hidden</p><p data-anim="not-an-entrance">unknown</p><p hidden data-anim="fade-up">hidden attr</p><p class="css-entry">animated</p></section>';
  await page.evaluate(html=>htmlStudio.newDocument(html,'Visibility guards'),fixture);
  const values=await page.evaluate(()=>{const d=htmlStudio.doc,s=n=>d.defaultView.getComputedStyle(n);return{title:s(d.querySelector('h1')).opacity,hidden:s(d.querySelector('.hidden')).opacity,unknown:s(d.querySelector('[data-anim="not-an-entrance"]')).opacity,hiddenAttr:s(d.querySelector('[hidden]')).display,css:s(d.querySelector('.css-entry')).opacity};});
  assert.deepEqual(values,{title:'1',hidden:'0',unknown:'0',hiddenAttr:'none',css:'1'});
 });
 await test('无未捕获脚本错误',async()=>assert.deepEqual(errors,[]));
}catch(e){console.error(e);process.exitCode=1;}finally{await fs.writeFile(dir+'/results.json',JSON.stringify({date:new Date().toISOString(),browser:await browser.version(),results,errors},null,2));await browser.close();}
