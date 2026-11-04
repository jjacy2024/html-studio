import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const mode=process.env.TEST_URL?'http':'file',dir=path.resolve(process.env.CLONE_QA_DIR||`qa/clone-layout-v0.3.12/${mode}`);await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1512,height:982},acceptDownloads:true}),results=[],errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
const source=process.env.SALES_FILE||path.resolve('../outputs/blockframe-q2-review/杭州栖物电商_2026Q2销售复盘_BlockFrame.html'),bytes=await fs.readFile(source),hash=b=>createHash('sha256').update(b).digest('hex');
const state=fn=>page.evaluate(fn),frame=s=>page.frameLocator('#edit-frame').locator(s),close=()=>page.locator('#dialog-close').click();
const load=html=>page.evaluate(async html=>{await htmlStudio.newDocument(html,'复制布局测试');},html);
const select=s=>page.evaluate(s=>{const nodes=[...htmlStudio.doc.querySelectorAll(s)];htmlStudio.select(nodes.map(n=>htmlStudio.id(n)));document.activeElement?.blur();},s);
const key=s=>page.keyboard.press('ControlOrMeta+'+s);
async function test(name,fn){const t=Date.now();try{await fn();results.push({name,pass:true,ms:Date.now()-t});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);await page.screenshot({path:path.join(dir,'failure.png')});throw e;}}
function fixture(display='flex',extra='',itemExtra='',contents=false){return `<!doctype html><style>body{margin:30px;font:20px Arial}*{box-sizing:border-box}#host{display:${display};position:relative;gap:28px;align-items:start;grid-template-columns:repeat(4,minmax(0,1fr));width:800px;${extra}}[data-item]{flex:0 0 100px;width:${display.includes('grid')?'auto':'100px'};height:80px;padding:10px;background:#aee5fd;border:2px solid black;${itemExtra}}#note{margin-top:40px}</style><div id="host" data-hs-frame="true">${contents?'<div id="contents" style="display:contents">':''}${['a','b','c'].map(n=>`<div id="${n}" data-item="${n}">${n.toUpperCase()}</div>`).join('')}${contents?'</div>':''}</div><p id="note">独立说明</p>`;}
const boxes=()=>state(()=>[...htmlStudio.doc.querySelectorAll('[data-item]')].map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height,translate:htmlStudio.style(n).translate}}));
const near=(a,b,message='')=>assert.ok(Math.abs(a-b)<.2,`${message}: ${a} != ${b}`);
async function row(count){const rs=await boxes();assert.equal(rs.length,count);for(let i=0;i<rs.length;i++){near(rs[i].y,rs[0].y,'top');if(i)near(rs[i].x-rs[i-1].right,28,'gap');assert.equal(rs[i].translate,'none');}return rs;}
async function download(button,name){const pending=page.waitForEvent('download');await page.locator(button).click();const d=await pending,file=path.join(dir,name);await d.saveAs(file);return {file,text:await fs.readFile(file,'utf8')};}
let unaffected,realGeometry;
try{
 await page.goto(process.env.TEST_URL||pathToFileURL(path.resolve('HTML Studio.html')).href);await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await state(()=>htmlStudio.ready);
 await test('L01 实际第19页四列布局：真实快捷键复制，顶对齐及28px间距一致',async()=>{
  await load(bytes.toString());await state(()=>{const e=htmlStudio,slide=e.pages.pages.find(n=>n.textContent.includes('18 / PROFIT BRIDGE'));e.switchPage(e.pages.pages.indexOf(slide));const host=slide.querySelector('.grid3');host.id='host';[...host.children].forEach((n,i)=>n.dataset.item=String(i));e.select([e.id(host)]);});
  // The supplied original is a three-column grid. Set four columns through the
  // same inspector used by an edited draft so all four cards occupy one row.
  const cols=page.locator('[data-prop="gridColumns"]');await cols.fill('4');await cols.press('Tab');
  unaffected=await state(()=>({chart:htmlStudio.pageRoot.querySelector('svg').outerHTML,title:htmlStudio.pageRoot.querySelector('h2').outerHTML,footer:htmlStudio.pageRoot.querySelector('footer').outerHTML,scripts:[...htmlStudio.doc.scripts].map(n=>n.textContent)}));
  await select('#host > :last-child');await key('d');realGeometry=await row(4);assert.equal(await state(()=>htmlStudio.nodes[0].parentElement.id),'host');await page.screenshot({path:path.join(dir,'actual-page19-duplicate.png')});
  assert.deepEqual(await state(()=>({chart:htmlStudio.pageRoot.querySelector('svg').outerHTML,title:htmlStudio.pageRoot.querySelector('h2').outerHTML,footer:htmlStudio.pageRoot.querySelector('footer').outerHTML,scripts:[...htmlStudio.doc.scripts].map(n=>n.textContent)})),unaffected);
 });
 await test('L02 实际卡片复制粘贴、单步撤回重做，样式与尺寸保留',async()=>{
  await key('z');await page.waitForFunction(()=>!htmlStudio.loading);assert.equal((await boxes()).length,3);await select('#host > :last-child');await key('c');await key('v');await row(4);
  assert.deepEqual(await frame('#host > :nth-child(3)').evaluate(n=>[getComputedStyle(n).background,getComputedStyle(n).border,getComputedStyle(n).fontSize,n.offsetWidth,n.offsetHeight]),await frame('#host > :nth-child(4)').evaluate(n=>[getComputedStyle(n).background,getComputedStyle(n).border,getComputedStyle(n).fontSize,n.offsetWidth,n.offsetHeight]));
  await key('z');await page.waitForFunction(()=>!htmlStudio.loading);assert.equal((await boxes()).length,3);await key('Shift+z');await page.waitForFunction(()=>!htmlStudio.loading);await row(4);
 });
 await test('L03 实际报告保存重开、预览、导出布局一致，源文件不变',async()=>{
  const saved=await download('#save-button','cloned-layout.htmlstudio');await page.evaluate(p=>htmlStudio.load(p),JSON.parse(saved.text));await row(4);
  await page.locator('#preview-button').click();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');const f=page.frameLocator('#preview-frame');await f.locator('.slide.active .body').evaluate(n=>new Promise(resolve=>{const poll=()=>getComputedStyle(n).opacity==='1'?resolve():requestAnimationFrame(poll);poll();}));
  const preview=await f.locator('#host').evaluate(host=>{const s=getComputedStyle(host);return {gap:s.gap,positions:[...host.children].map(n=>[n.offsetTop,n.offsetLeft,n.offsetWidth]),translate:[...host.children].map(n=>getComputedStyle(n).translate)};});assert.equal(preview.gap,'28px');assert.ok(preview.positions.every(p=>p[0]===preview.positions[0][0]));for(let i=1;i<4;i++)near(preview.positions[i][1]-preview.positions[i-1][1]-preview.positions[i-1][2],28);assert.ok(preview.translate.every(t=>t==='none'));await page.locator('#preview-frame').screenshot({path:path.join(dir,'actual-page19-preview.png')});await page.locator('#exit-preview').click();
  const exported=await download('#export-button','cloned-layout.html');assert.ok(!exported.text.includes('data-hs-'));const p=await browser.newPage({viewport:{width:1716,height:966}});await p.goto(pathToFileURL(exported.file).href);await p.evaluate(()=>presentation.showSlide([...document.querySelectorAll('.slide')].findIndex(n=>n.querySelector('#host'))));await p.waitForFunction(()=>[...document.querySelectorAll('.slide.active .reveal')].every(n=>getComputedStyle(n).opacity==='1'));assert.deepEqual(await p.locator('#host').evaluate(host=>({gap:getComputedStyle(host).gap,positions:[...host.children].map(n=>[n.offsetTop,n.offsetLeft,n.offsetWidth]),translate:[...host.children].map(n=>getComputedStyle(n).translate)})),preview);await p.screenshot({path:path.join(dir,'actual-page19-export.png')});await p.close();assert.equal(hash(await fs.readFile(source)),hash(bytes));
 });
 for(const display of ['flex','inline-flex','grid','inline-grid'])await test(`L04 ${display} 单选/多选副本及连续粘贴遵循间距`,async()=>{
  await load(fixture(display));await select('#c');await key('d');await row(4);await load(fixture(display,display.includes('grid')?'grid-template-columns:repeat(8,100px);width:1100px':'width:1100px'));await select('#a,#b');await key('c');await key('v');await row(5);await key('v');await row(7);
 });
 await test('L05 垂直Flex和换行Flex遵循各自方向、28px行列间距',async()=>{
  await load(fixture('flex','flex-direction:column;','flex:none'));await select('#c');await key('d');let rs=await boxes();for(let i=1;i<4;i++){near(rs[i].x,rs[0].x);near(rs[i].y-rs[i-1].bottom,28);}
  await load(fixture('flex','width:300px;flex-wrap:wrap;'));await select('#c');await key('d');rs=await boxes();near(rs[2].y,rs[3].y);near(rs[3].x-rs[2].right,28);near(rs[2].y-rs[0].bottom,28);
 });
 await test('L06 三列Grid仍按原列数换行，行间距保持28px',async()=>{
  await load(fixture('grid','grid-template-columns:repeat(3,100px)'));await select('#c');await key('d');const rs=await boxes();near(rs[3].x,rs[0].x);near(rs[3].y-rs[0].bottom,28);assert.equal(await frame('#host').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),3);
 });
 await test('L07 display:contents透明包装内的副本仍参与外层自动布局',async()=>{
  await load(fixture('flex','','',true));await select('#c');await key('d');await row(4);await key('c');await key('v');await row(5);
 });
 await test('L08 跨文档粘贴按目标容器布局排布',async()=>{
  await load(fixture('block'));await select('#c');await key('c');await load(fixture('flex'));await select('#host');await key('v');await row(4);assert.equal(await state(()=>htmlStudio.nodes[0].parentElement.id),'host');
 });
 await test('L09 自动布局内绝对/固定定位层仍使用20px副本偏移',async()=>{
  for(const pos of ['absolute','fixed']){await load(fixture('flex','height:300px',`position:${pos};left:80px;top:70px;`));await select('#c');const before=await state(()=>htmlStudio.rect(htmlStudio.nodes[0]));await key('d');const after=await state(()=>htmlStudio.rect(htmlStudio.nodes[0]));near(after.x-before.x,20);near(after.y-before.y,20);}
 });
 await test('L10 自由布局和缩放旋转祖先仍保留屏幕20px偏移',async()=>{
  await load(fixture('block','height:300px;transform:rotate(12deg) scale(.8);transform-origin:0 0','position:absolute;left:50px;top:50px;translate:7px 9px'));await select('#c');const before=await state(()=>htmlStudio.rect(htmlStudio.nodes[0]));await key('d');let after=await state(()=>htmlStudio.rect(htmlStudio.nodes[0]));near(after.x-before.x,20);near(after.y-before.y,20);await key('c');const next=after;await key('v');after=await state(()=>htmlStudio.rect(htmlStudio.nodes[0]));near(after.x-next.x,20);near(after.y-next.y,20);
 });
 await test('L11 保留原有手工变换，不将旧偏移或设计变换擅自清零',async()=>{
  await load(fixture('flex','','translate:7px 9px;transform:rotate(2deg)'));await select('#c');const before=await frame('#c').getAttribute('style');await key('d');assert.equal(await state(()=>htmlStudio.style(htmlStudio.nodes[0]).translate),'7px 9px');assert.equal(await state(()=>htmlStudio.style(htmlStudio.nodes[0]).transform),await frame('#c').evaluate(n=>getComputedStyle(n).transform));assert.equal(await frame('#c').getAttribute('style'),before);
 });
 if(process.env.PREVIEW_PROJECT)await test('L12 实际工程内复制不改写原文件，原三列Grid正确排到下一行',async()=>{
  const file=process.env.PREVIEW_PROJECT,original=await fs.readFile(file);await page.evaluate(p=>htmlStudio.load(p),JSON.parse(original));await state(()=>{const e=htmlStudio,slide=e.pages.pages.find(n=>n.textContent.includes('18 / PROFIT BRIDGE'));e.switchPage(e.pages.pages.indexOf(slide));const host=slide.querySelector('.grid3');host.id='host';[...host.children].forEach(n=>n.dataset.item='source');});await select('#host>:last-child');await key('d');const rs=await boxes();near(rs[3].x,rs[0].x);near(rs[3].y-Math.max(...rs.slice(0,3).map(r=>r.bottom)),28);assert.equal(hash(await fs.readFile(file)),hash(original));
 });
 await test('L13 全程无未捕获脚本异常',async()=>assert.deepEqual(errors,[]));
}catch{process.exitCode=1;}finally{const report={date:new Date().toISOString(),mode,browser:await browser.version(),version:JSON.parse(await fs.readFile('package.json','utf8')).version,sourceSHA256:hash(bytes),results,errors};await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(report,null,2));await fs.writeFile('qa/clone-layout-results.json',JSON.stringify(report,null,2));await browser.close();}
