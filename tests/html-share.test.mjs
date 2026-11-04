import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from './artifact-url.mjs';
import {createHash} from 'node:crypto';
const mode=process.env.TEST_URL?'http':'file',dir=path.resolve(`qa/html-share-v0.3.11/${mode}`);await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1512,height:982},acceptDownloads:true}),results=[],errors=[];
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
const source=process.env.SALES_FILE||path.resolve('../outputs/blockframe-q2-review/杭州栖物电商_2026Q2销售复盘_BlockFrame.html');
const original=await fs.readFile(source),hash=b=>createHash('sha256').update(b).digest('hex');
const state=fn=>page.evaluate(fn),frame=s=>page.frameLocator('#edit-frame').locator(s),close=()=>page.locator('#dialog-close').click(),kind=()=>page.locator('#dialog').getAttribute('data-kind');
const load=html=>page.evaluate(async html=>{document.querySelector('#dialog').close();await htmlStudio.newDocument(html,'占比条测试');},html);
const select=s=>page.evaluate(s=>htmlStudio.select([htmlStudio.id(htmlStudio.doc.querySelector(s))]),s);
const open=async s=>{await select(s);await page.locator('[data-action="edit-chart-data"]').click();};
const bind=()=>page.getByRole('button',{name:'绑定并编辑数据',exact:true}).click();
const cell=i=>page.locator(`[data-html-bar="${i}"]`),edit=async(i,v)=>{await cell(i).fill(String(v));await cell(i).press('Tab');};
const model=()=>state(()=>JSON.parse(htmlStudio.doc.querySelector('[data-studio-html-chart]').getAttribute('data-studio-html-chart')));
async function dbl(s){const e=frame(s).first();await e.scrollIntoViewIfNeeded();const b=await e.boundingBox();await page.locator('#canvas-scroll').evaluate((p,b)=>{const r=p.getBoundingClientRect();p.scrollTop+=b.y+b.height/2-r.y-r.height/2;p.scrollLeft+=b.x+b.width/2-r.x-r.width/2;},b);await e.dblclick();}
async function download(button,name){const waiting=page.waitForEvent('download');await page.locator(button).click();const d=await waiting,file=path.join(dir,name);await d.saveAs(file);return {file,text:await fs.readFile(file,'utf8')};}
async function test(name,fn){const start=Date.now();try{await fn();results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);await page.screenshot({path:path.join(dir,'failure.png')});throw e;}}
function fixture(){return `<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:30px;font:18px Arial}.card{width:1000px;padding:20px;border:2px solid black}#share-chart{display:flex;height:150px;border:3px solid black}#share-chart>div{padding:20px;border-right:2px solid black;box-shadow:inset 0 -3px #0002;font-weight:800}#share-chart strong{font-size:28px}#share-chart span{font-size:42px}</style></head><body><h1 id="normal">普通标题</h1><div class="card" id="card"><h2>销售占比</h2><div id="share-chart"><div id="part-a" style="width:10%;background:linear-gradient(120deg,#f19ce8,#ffbfef)"><strong>甲类 100万元</strong><br><span>10.0%</span></div><div id="part-b" style="width:30%;background:#aef3fc"><strong>乙类 300万</strong><br><span>30.0%</span></div><div id="part-c" style="flex:1;background:#ffe176"><strong>丙类 600万元</strong><br><span>60.0%</span></div></div><p id="independent">合计说明不自动修改</p></div></body></html>`;}
const properties=['backgroundImage','backgroundColor','borderTop','borderBottom','borderLeft','borderRight','borderRadius','boxShadow','fontFamily','fontSize','fontWeight','paddingLeft','paddingRight'];
const appearance=()=>frame('#share-chart').evaluate((root,props)=>[root,...root.querySelectorAll('*')].map(n=>({tag:n.tagName,style:props.map(p=>getComputedStyle(n)[p])})),properties);
const geometry=()=>frame('#share-chart').evaluate(root=>{const r=root.getBoundingClientRect(),s=getComputedStyle(root),available=root.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);return {width:r.width,available,segments:[...root.children].map(n=>{const b=n.getBoundingClientRect();return {width:b.width,x:b.x,right:b.right,text:n.textContent}})};});
async function proportions(expected){const g=await geometry();for(let i=0;i<expected.length;i++){assert.ok(Math.abs(g.segments[i].width/g.available-expected[i])<.002,JSON.stringify(g));if(i)assert.ok(Math.abs(g.segments[i].x-g.segments[i-1].right)<1);}assert.ok(Math.abs(g.segments.reduce((n,b)=>n+b.width,0)-g.available)<1);}
let beforeAppearance,independent,editedExport;
try{
 await page.goto(process.env.TEST_URL||pathToFileURL(path.resolve(process.env.EDITOR_FILE||'HTML Studio.html')).href);await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await state(()=>htmlStudio.ready);
 await test('S01 实际第16页匿名 Flex 占比条：从分段入口识别；取消无修改',async()=>{
  await load(original.toString());await state(()=>{const bar=htmlStudio.doc.querySelector('div[style*="width:81.865%"]');if(!bar)throw Error('Missing source segment');const root=bar.parentElement;root.id='share-chart';htmlStudio.switchPage(htmlStudio.pages.pages.findIndex(p=>p.contains(root)));});
  const before=await state(()=>({html:htmlStudio.doc.body.innerHTML,history:htmlStudio.history.length}));await open('#share-chart > div');assert.equal(await kind(),'html-chart-bind');assert.match(await page.locator('#dialog-body').textContent(),/归一化占比/);await close();assert.deepEqual(await state(()=>({html:htmlStudio.doc.body.innerHTML,history:htmlStudio.history.length})),before);
 });
 await test('S02 实际图表真实双击绑定；节点、几何、金额格式与外观原样保留',async()=>{
  beforeAppearance=await appearance();const before=await geometry();independent=await state(()=>({title:htmlStudio.pageRoot.querySelector('h2').outerHTML,table:htmlStudio.pageRoot.querySelector('table').outerHTML,scripts:[...htmlStudio.doc.scripts].map(s=>s.textContent)}));
  await dbl('#share-chart > div > span');assert.equal(await kind(),'html-chart-bind');await bind();assert.equal(await kind(),'html-chart-data');assert.equal((await model()).kind,'share');assert.deepEqual((await model()).bars.map(b=>b.value),[3160,700]);assert.deepEqual(await appearance(),beforeAppearance);assert.deepEqual(await geometry(),before);assert.equal(await state(()=>document.activeElement.dataset.htmlBar),'0');
 });
 await test('S03 修改金额同步更新两段宽度和百分比，保留嵌套字号/颜色/描边',async()=>{
  await edit(0,2800);assert.match(await frame('#share-chart > div').nth(0).textContent(),/新客 2,800万元/);assert.equal(await frame('#share-chart span').nth(0).textContent(),'80.0%');assert.equal(await frame('#share-chart span').nth(1).textContent(),'20.0%');await proportions([.8,.2]);assert.deepEqual(await appearance(),beforeAppearance);
  await page.frameLocator('#html-bar-preview iframe').locator('span').first().filter({hasText:'80.0%'}).waitFor();await page.screenshot({path:path.join(dir,'real-page16-data.png')});await close();
  assert.deepEqual(await state(()=>({title:htmlStudio.pageRoot.querySelector('h2').outerHTML,table:htmlStudio.pageRoot.querySelector('table').outerHTML,scripts:[...htmlStudio.doc.scripts].map(s=>s.textContent)})),independent);
 });
 await test('S04 撤回重做、工程保存重开、数字双击再编辑',async()=>{
  await state(()=>htmlStudio.undo());assert.equal((await model()).bars[0].value,3160);await state(()=>htmlStudio.redo());assert.equal((await model()).bars[0].value,2800);const saved=await download('#save-button','actual-share.htmlstudio');await page.evaluate(p=>htmlStudio.load(p),JSON.parse(saved.text));await dbl('#share-chart > div:nth-child(2) span');assert.equal(await state(()=>document.activeElement.dataset.htmlBar),'1');await edit(1,1200);await close();await proportions([.7,.3]);assert.equal(await frame('#share-chart span').nth(1).textContent(),'30.0%');
 });
 await test('S05 实际报告编辑、连续预览、独立导出及再导入一致',async()=>{
  for(let i=0;i<3;i++){await page.locator('#preview-button').click();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');assert.equal(await page.frameLocator('#preview-frame').locator('#share-chart span').first().textContent(),'70.0%');assert.equal(await page.frameLocator('#preview-frame').locator('.slide.active').evaluate(n=>n.contains(document.querySelector('#share-chart'))),true);if(i===0){await page.frameLocator('#preview-frame').locator('.slide.active .body').evaluate(n=>new Promise(resolve=>{const poll=()=>getComputedStyle(n).opacity==='1'?resolve():requestAnimationFrame(poll);poll();}));}if(i===0)await page.locator('#preview-frame').screenshot({path:path.join(dir,'real-page16-preview.png')});await page.locator('#exit-preview').click();}
  editedExport=await download('#export-button','actual-share.html');assert.ok(!editedExport.text.includes('data-hs-'));const p=await browser.newPage({viewport:{width:1716,height:966}});await p.goto(pathToFileURL(editedExport.file).href);await p.evaluate(()=>presentation.showSlide([...document.querySelectorAll('.slide')].findIndex(s=>s.contains(document.querySelector('#share-chart')))));assert.equal(await p.locator('#share-chart span').last().textContent(),'30.0%');assert.deepEqual(await p.locator('#share-chart').evaluate((root,props)=>[root,...root.querySelectorAll('*')].map(n=>({tag:n.tagName,style:props.map(k=>getComputedStyle(n)[k])})),properties),beforeAppearance);await p.waitForFunction(()=>[...document.querySelectorAll('.slide.active .reveal')].every(n=>getComputedStyle(n).opacity==='1'));await p.locator('.slide.active').screenshot({path:path.join(dir,'real-page16-export.png')});await p.close();await load(editedExport.text);await state(()=>htmlStudio.switchPage(htmlStudio.pages.pages.findIndex(p=>p.contains(htmlStudio.doc.querySelector('#share-chart')))));await open('#share-chart');assert.equal(await kind(),'html-chart-data');assert.equal(await cell(1).inputValue(),'1200');await close();assert.equal(hash(await fs.readFile(source)),hash(original));
 });
 await test('S06 通用三段结构：渐变、混合标签嵌套及 flex 剩余宽度',async()=>{
  await load(fixture());beforeAppearance=await appearance();await open('#card');assert.equal(await kind(),'html-chart-bind');await bind();await edit(0,300);await proportions([.25,.25,.5]);assert.deepEqual(await appearance(),beforeAppearance);assert.equal(await frame('#part-a span').textContent(),'25.0%');await close();
 });
 await test('S07 零值、极小分段不撑宽或覆盖相邻段，增大后样式恢复',async()=>{
  await open('#part-a');await edit(0,0);await proportions([0,1/3,2/3]);await edit(0,.01);await proportions([.01/900.01,300/900.01,600/900.01]);await edit(0,300);assert.deepEqual(await appearance(),beforeAppearance);await proportions([.25,.25,.5]);await close();
 });
 await test('S08 非法输入及全零合计不破坏上次结果；快速输入关闭保存最新值',async()=>{
  await open('#share-chart');for(const v of ['','-1','abc','1000000000001']){await cell(0).fill(v);assert.equal(await cell(0).getAttribute('aria-invalid'),'true');assert.equal((await model()).bars[0].value,300);}await edit(0,0);await edit(1,0);await cell(2).fill('0');assert.equal(await cell(2).getAttribute('aria-invalid'),'true');assert.equal((await model()).bars[2].value,600);assert.match(await page.locator('#html-bar-status').textContent(),/大于 0/);await cell(0).fill('300');await cell(0).fill('400');await close();assert.equal((await model()).bars[0].value,400);
 });
 await test('S09 混合单位、错误占比、间距、纵向及普通卡片不误判',async()=>{
  const fixtures=[fixture().replace('乙类 300万','乙类 300亿'),fixture().replace('30.0%','40.0%'),fixture().replace('display:flex;height','display:flex;gap:20px;height'),fixture().replace('display:flex;height','display:flex;flex-direction:column;height'),fixture().replaceAll(/\d+\.0%/g,'说明')];
  for(const html of fixtures){await load(html);const before=await frame('#share-chart').evaluate(e=>e.outerHTML);await open('#share-chart');assert.equal(await kind(),'chart-conversion');await close();assert.equal(await frame('#share-chart').evaluate(e=>e.outerHTML),before);}
 });
 await test('S10 普通标题双击仍编辑文字，锁定图表不打开数据编辑',async()=>{
  await load(fixture());await dbl('#normal');assert.equal(await page.locator('#dialog').evaluate(d=>d.open),false);assert.equal(await frame('#normal').getAttribute('contenteditable'),'true');await state(()=>htmlStudio.finishText?.());await state(()=>{const root=htmlStudio.doc.querySelector('#share-chart');root.setAttribute('data-hs-locked','true');});await dbl('#part-b span');assert.equal(await page.locator('#dialog').evaluate(d=>d.open),false);
 });
 await test('S11 已绑定结构被改动时安全拒绝，不部分改写',async()=>{
  await load(fixture());await open('#share-chart');await bind();await close();await state(()=>htmlStudio.doc.querySelector('#part-b strong').remove());const before=await frame('#share-chart').evaluate(e=>e.outerHTML);await open('#share-chart');assert.equal(await kind(),'chart-conversion');await close();assert.equal(await frame('#share-chart').evaluate(e=>e.outerHTML),before);
 });
 if(process.env.PREVIEW_PROJECT)await test('S12 用户原工程同类型占比条可原样编辑，原文件保持不变',async()=>{
  const file=process.env.PREVIEW_PROJECT,bytes=await fs.readFile(file);await page.evaluate(p=>htmlStudio.load(p),JSON.parse(bytes));
  const selector=await state(()=>{const segment=[...htmlStudio.doc.querySelectorAll('div')].find(n=>n.childElementCount===2&&n.textContent.startsWith('新客 3,160万元'));if(!segment)throw Error('Missing project chart');segment.id='share-chart';htmlStudio.switchPage(htmlStudio.pages.pages.findIndex(p=>p.contains(segment)));return '#share-chart';});await open(selector);assert.equal(await kind(),'html-chart-bind');await bind();await edit(0,2800);assert.equal(await frame('#share-chart span').first().textContent(),'80.0%');await close();assert.equal(hash(await fs.readFile(file)),hash(bytes));
 });
 await test('S13 无未捕获脚本错误',async()=>assert.deepEqual(errors,[]));
}catch{process.exitCode=1;}finally{const report={date:new Date().toISOString(),mode,browser:await browser.version(),version:JSON.parse(await fs.readFile('package.json','utf8')).version,sourceSHA256:hash(original),results,errors};await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(report,null,2));await fs.writeFile('qa/html-share-results.json',JSON.stringify(report,null,2));await browser.close();}
