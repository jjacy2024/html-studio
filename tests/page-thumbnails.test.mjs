import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {reorderFixture} from './page-reorder-fixtures.mjs';
import {templateLibrary} from '../dist/templates.js';
const mode=process.env.TEST_URL?'http':'file',dir=path.resolve(`qa/data-paste-thumbnails-v0.3.13/${mode}`);await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1512,height:982},acceptDownloads:true});
const page=await context.newPage(),results=[],errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
const state=fn=>page.evaluate(fn),open=()=>page.locator('#manage-pages').click(),close=()=>page.locator('#dialog-close').click(),rows=()=>page.locator('.page-manager-row');
const load=async html=>{if(await page.locator('#dialog').isVisible())await close();await page.evaluate(html=>htmlStudio.newDocument(html,'真实缩略图测试'),html);};
const ready=()=>page.waitForFunction(()=>{const l=document.querySelector('.page-manager-list'),b=l.getBoundingClientRect();return [...l.children].filter(r=>{const x=r.getBoundingClientRect();return x.bottom>b.top+1&&x.top<b.bottom-1;}).every(r=>r.querySelector('.page-thumbnail').dataset.state==='ready');});
const invariant=()=>state(()=>({html:htmlStudio.doc.documentElement.outerHTML,index:htmlStudio.pages.index,selection:htmlStudio.selection,history:htmlStudio.historyIndex,width:htmlStudio.width,height:htmlStudio.height}));
const thumbs=()=>page.locator('.page-thumbnail-frame').evaluateAll(fs=>fs.map(f=>{const d=f.contentDocument,id=f.closest('[data-order-id]').dataset.orderId,p=d.querySelector(`[data-hs-id="${id}"]`);return {id,title:p?.querySelector('h1,h2')?.textContent,text:p?.textContent,box:[p?.getBoundingClientRect().width,p?.getBoundingClientRect().height],visible:d.defaultView.getComputedStyle(p).display,scriptCount:d.scripts.length,sandbox:f.getAttribute('sandbox'),frameWidth:parseFloat(f.style.width),sourceWidth:parseFloat(d.defaultView.getComputedStyle(p).width),scale:parseFloat(f.style.transform.match(/scale\(([^)]+)/)[1])};}));
async function test(name,fn){const t=Date.now();try{await fn();results.push({name,pass:true,ms:Date.now()-t});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);await page.screenshot({path:path.join(dir,'thumbnail-failure.png')});throw e;}}
try{
 await page.goto(process.env.TEST_URL||pathToFileURL(path.resolve('HTML Studio.html')).href);await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await state(()=>htmlStudio.ready);
 await test('T01 真实页面内容、排版、SVG 渐变与等比缩放，非文字占位图',async()=>{
  await load(reorderFixture(20));await open();await ready();const ts=await thumbs();assert(ts.length>=3&&ts.length<=6);assert.deepEqual(ts.map(t=>t.title),ts.map((_,i)=>`页面 ${i+1}`));for(const t of ts){assert.deepEqual(t.box,[960,540]);assert.equal(t.visible,'block');assert(t.scale>0&&t.scale<1);assert.equal(t.frameWidth,960);}
  const visual=await page.locator('.page-thumbnail-frame').first().evaluate(f=>{const d=f.contentDocument;return {color:d.defaultView.getComputedStyle(d.querySelector('h1')).color,fill:d.querySelector('rect').getAttribute('fill'),stops:d.querySelectorAll('#g1 stop').length};});assert.deepEqual(visual,{color:'rgb(105, 67, 160)',fill:'url(#g1)',stops:2});await page.screenshot({path:path.join(dir,'thumbnails-fixture.png')});
 });
 await test('T02 缩略图不修改源文档、历史、当前页、选择与画布尺寸',async()=>{
  await close();await state(()=>{htmlStudio.switchPage(8);htmlStudio.select([htmlStudio.id(htmlStudio.pageRoot.querySelector('h1'))]);});const before=await invariant();await open();await ready();await page.locator('.page-manager-list').evaluate(n=>n.scrollTop=n.scrollHeight);await ready();assert.deepEqual(await invariant(),before);await close();assert.deepEqual(await invariant(),before);
 });
 await test('T03 静态沙箱移除脚本与嵌入页来源，不执行脚本/事件',async()=>{
  await load(reorderFixture(6).replace('<p>每一页','<img src="missing-image" onerror="window.thumbnailUnsafe=true"><iframe srcdoc="<script>parent.thumbnailUnsafe=true</script>"></iframe><p>每一页'));await open();await ready();for(const t of await thumbs()){assert.equal(t.scriptCount,0);assert.equal(t.sandbox,'allow-same-origin');}assert.equal(await page.locator('.page-thumbnail-frame').first().evaluate(f=>!!f.contentWindow.thumbnailUnsafe),false);assert.equal(await page.locator('.page-thumbnail-frame').first().evaluate(f=>f.contentDocument.querySelector('iframe').hasAttribute('srcdoc')),false);await close();
 });
 await test('T04 100 页滚动仅可见区域最多 6 个活动框架，离屏框架释放',async()=>{
  await load(reorderFixture(100));const start=Date.now();await open();await ready();const initial=await thumbs();assert(initial.length<=6);await page.locator('.page-manager-list').evaluate(n=>n.scrollTop=n.scrollHeight);await ready();const last=await thumbs();assert(last.some(t=>t.title==='页面 100'));assert(last.every(t=>!initial.some(i=>i.id===t.id)));assert(await page.locator('.page-thumbnail-frame').count()<=6);assert(Date.now()-start<15000);await close();assert.equal(await page.locator('.page-thumbnail-frame').count(),0);
 });
 await test('T05 源页面编辑后刷新内容，撤回后重新打开正确',async()=>{
  await load(reorderFixture(6));await open();await ready();await state(()=>{htmlStudio.pages.pages[0].querySelector('h1').textContent='更新后的标题';htmlStudio.commit('缩略图测试修改');});await page.waitForFunction(()=>document.querySelector('.page-thumbnail-frame')?.contentDocument?.querySelector('h1')?.textContent==='更新后的标题');await ready();await close();await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);await open();await ready();assert.equal((await thumbs())[0].title,'页面 1');await close();
 });
 await test('T06 键盘排序后缩略图对应新页序；新建、复制、删除同步刷新',async()=>{
  await load(reorderFixture(6));await open();await ready();await rows().first().locator('button').focus();await page.keyboard.press('Alt+ArrowDown');await ready();assert.equal((await thumbs())[0].title,'页面 2');await page.locator('#page-insert-position').selectOption('0');await page.getByRole('button',{name:'复制选中页',exact:true}).click();await ready();assert.equal(await rows().count(),7);assert.equal((await thumbs())[0].title,'页面 1');await page.getByRole('button',{name:'删除选中页',exact:true}).click();await ready();assert.equal(await rows().count(),6);await page.getByRole('button',{name:'新增空白页',exact:true}).click();await ready();assert.equal(await rows().count(),7);await close();
 });
 await test('T07 替换弹窗、导入新文档及连续开关释放所有缩略图',async()=>{
  await load(reorderFixture(10));for(let i=0;i<4;i++){await open();await ready();await close();assert.equal(await page.locator('.page-thumbnail-frame').count(),0);}await open();await ready();await state(()=>htmlStudio.showTemplates());assert.equal(await page.locator('.page-thumbnail-frame').count(),0);await close();await open();await ready();await page.evaluate(html=>htmlStudio.newDocument(html,'新文档'),reorderFixture(3));assert.equal(await page.locator('.page-thumbnail-frame').count(),0);await open();await ready();assert.equal(await rows().count(),3);await close();
 });
 await test('T08 小窗口缩略图缩放，页面管理弹窗不横向溢出',async()=>{
  await page.setViewportSize({width:800,height:650});await open();await ready();assert.equal(await page.locator('#dialog').evaluate(n=>n.scrollWidth<=n.clientWidth+1),true);const ts=await thumbs();assert(ts.every(t=>t.scale>0&&t.scale<1));await page.screenshot({path:path.join(dir,'thumbnails-small.png')});await close();await page.setViewportSize({width:1512,height:982});
 });
 await test('T09 已绑定 Canvas 使用现有图表海报，保持显示',async()=>{
  await load(reorderFixture(3).replace('<p>每一页','<canvas id="poster" width="160" height="80"></canvas><p>每一页'));await state(()=>{const c=document.createElement('canvas');c.width=160;c.height=80;const ctx=c.getContext('2d');ctx.fillStyle='#f06090';ctx.fillRect(0,0,160,80);htmlStudio.doc.querySelector('#poster').setAttribute('data-studio-chartjs-image',c.toDataURL());});await open();await ready();assert.match(await page.locator('.page-thumbnail-frame').first().evaluate(f=>f.contentDocument.querySelector('#poster').style.backgroundImage),/data:image\/png;base64/);await close();
 });
 for(const [label,file] of [['26 页销售报告',process.env.SALES_FILE||path.resolve('../outputs/blockframe-q2-review/杭州栖物电商_2026Q2销售复盘_BlockFrame.html')],['长篇述职报告',process.env.DECK_FILE]])if(file)await test(`T10 ${label}真实第一页/末页缩略图与性能`,async()=>{
  await load(await fs.readFile(file,'utf8'));const count=await state(()=>htmlStudio.pages.pages.length);assert(count>20);await open();await ready();assert((await thumbs()).every(t=>t.box[0]>100&&t.box[1]>100));await page.screenshot({path:path.join(dir,`thumbnails-${count}-pages.png`)});await page.locator('.page-manager-list').evaluate(n=>n.scrollTop=n.scrollHeight);await ready();const end=await state(()=>htmlStudio.id(htmlStudio.pages.pages.at(-1)));assert((await thumbs()).some(t=>t.id===end));assert(await page.locator('.page-thumbnail-frame').count()<=6);await close();
 });
 await test('T11 保存与导出不含缩略图框架、快照、监听标记，重开仍正确',async()=>{
  await load(reorderFixture(4));await open();await ready();await close();for(const [button,name] of [['#save-button','thumbs.htmlstudio'],['#export-button','thumbs.html']]){const wait=page.waitForEvent('download');await page.locator(button).click();const d=await wait,f=path.join(dir,name);await d.saveAs(f);const text=await fs.readFile(f,'utf8');assert(!text.includes('page-thumbnail-frame'));assert(!text.includes('data-hs-runtime="thumbnail"'));if(name.endsWith('htmlstudio')){await page.evaluate(p=>htmlStudio.load(p),JSON.parse(text));await open();await ready();assert.equal((await thumbs())[0].title,'页面 1');await close();}}
 });
 await test('T13 全部 34 个模板的首页和末页真实缩略图',async()=>{
  for(const template of templateLibrary){await page.evaluate(slug=>htmlStudio.createFromTemplate(slug),template.slug);await open();await ready();assert((await thumbs()).every(t=>t.box[0]>0&&t.box[1]>0),template.slug);await page.locator('.page-manager-list').evaluate(n=>n.scrollTop=n.scrollHeight);await ready();const last=await state(()=>htmlStudio.id(htmlStudio.pages.pages.at(-1)));assert((await thumbs()).some(t=>t.id===last),template.slug);await close();}
 });
 await test('T12 全程无未捕获 JavaScript 错误',async()=>assert.deepEqual(errors,[]));
}catch{process.exitCode=1;}finally{const report={date:new Date().toISOString(),mode,results,errors};await fs.writeFile(path.join(dir,'page-thumbnails-results.json'),JSON.stringify(report,null,2));await fs.writeFile('qa/page-thumbnails-results.json',JSON.stringify(report,null,2));await browser.close();}
