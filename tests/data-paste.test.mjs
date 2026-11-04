import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from './artifact-url.mjs';
import {parseDataPaste,pasteNumber} from '../dist/data-paste.js';
import {chartHTML} from './svg-chart-fixtures.mjs';
import {stackedHTML} from './svg-stacked-fixtures.mjs';
import {waterfallHTML} from './svg-waterfall-fixtures.mjs';
import {bubbleHTML} from './svg-bubble-fixtures.mjs';
import {htmlBarsHTML,canvasHTML} from './non-svg-fixtures.mjs';
import {matrixHTML} from './table-editing-fixtures.mjs';

const mode=process.env.TEST_URL?'http':'file',dir=path.resolve(`qa/data-paste-thumbnails-v0.3.13/${mode}`);await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1512,height:982},acceptDownloads:true,permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage(),results=[],errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
const state=fn=>page.evaluate(fn),close=()=>page.locator('#dialog-close').click();
const load=html=>page.evaluate(async html=>{document.querySelector('#dialog').close();await htmlStudio.newDocument(html,'粘贴测试');},html);
const select=selector=>page.evaluate(selector=>htmlStudio.select([htmlStudio.id(htmlStudio.doc.querySelector(selector))]),selector);
const open=async selector=>{await select(selector);await page.locator('[data-action="edit-chart-data"]').click();if(await page.locator('#dialog').getAttribute('data-kind')==='canvas-chart-loading')await page.waitForFunction(()=>document.querySelector('#dialog').dataset.kind!=='canvas-chart-loading');if((await page.locator('#dialog').getAttribute('data-kind')).endsWith('-bind'))await page.getByRole('button',{name:'绑定并编辑数据',exact:true}).click();};
const model=()=>state(()=>JSON.parse(htmlStudio.doc.querySelector('[data-studio-svg-chart]')?.getAttribute('data-studio-svg-chart')||'null'));
async function paste(selector,text,{real=false,error=false}={}){
 const input=page.locator(selector).first();await input.focus();
 await page.locator('.data-paste-status').evaluateAll(ns=>ns.forEach(n=>{n.textContent='';delete n.dataset.state;}));
 if(real){await page.evaluate(text=>navigator.clipboard.writeText(text),text);await input.press(process.platform==='darwin'?'Meta+v':'Control+v');}
 else await input.evaluate((n,text)=>{const data=new DataTransfer();data.setData('text/plain',text);n.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},text);
 await page.locator(`.data-paste-status[data-state="${error?'error':'success'}"]`).waitFor();
}
const history=()=>state(()=>htmlStudio.historyIndex);
const markup=()=>state(()=>htmlStudio.doc.body.innerHTML);
async function save(button,name){const wait=page.waitForEvent('download');await page.locator(button).click();const d=await wait;const f=path.join(dir,name);await d.saveAs(f);return {file:f,text:await fs.readFile(f,'utf8')};}
async function test(name,run){const t=Date.now();try{await run();results.push({name,pass:true,ms:Date.now()-t});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);await page.screenshot({path:path.join(dir,'paste-failure.png')});throw e;}}
try{
 await page.goto(process.env.TEST_URL||pathToFileURL(path.resolve('HTML Studio.html')).href);await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await state(()=>htmlStudio.ready);
 await test('P01 TSV 引号、换行、空格、空单元格、千分位与容量边界',async()=>{
  assert.deepEqual(parseDataPaste('\uFEFFA\tB\r\n"双""引号"\t"两\n行"\r\n'),[['A','B'],['双"引号','两\n行']]);
  assert.deepEqual(parseDataPaste('a\t\n b \t2'),[['a',''],[' b ','2']]);
  assert.equal(pasteNumber('1,200.5'),1200.5);assert.equal(pasteNumber('−20',{negative:true}),-20);
  for(const text of ['a\tb\nc','"未结束','a'.repeat(270000),Array(100).fill('汉'.repeat(1000)+'\t1').join('\n'),Array(202).fill('1').join('\n'),Array(27).fill('1').join('\t')])assert.throws(()=>parseDataPaste(text));
  for(const text of ['1,2','5%','1e3','NaN','-2','1000000000001'])assert.throws(()=>pasteNumber(text));
 });
 for(const type of ['bar','line','pie'])await test(`P02 内置 ${type} 图表真实键盘整块粘贴、公式及单步撤回`,async()=>{
  await load('<h1>内置数据</h1>');await page.evaluate(type=>htmlStudio.insertDataElement(type),type);
  const before=await markup(),h=await history();await paste('#data-grid [data-r="1"][data-c="0"]','甲\t100\n乙\t=B2*2',{real:true});
  assert.equal(await history(),h+1);assert.deepEqual(await state(()=>JSON.parse(htmlStudio.doc.querySelector('[data-studio-chart]').dataset.studioChart).grid.slice(1,3).map(row=>row.slice(0,2))),[['甲','100'],['乙','=B2*2']]);
  assert.match(await page.locator('#data-chart-preview').textContent(),type==='pie'?/57\.1%/:/200/);await close();await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await markup(),before);await page.locator('#redo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.match(await markup(),/乙/);
 });
 await test('P03 内置图表越界、错误公式、饼图负数整批拒绝且历史不变',async()=>{
  await load('<h1>校验</h1>');await state(()=>htmlStudio.insertDataElement('pie'));const before=await markup(),h=await history();
  for(const text of ['1\t2\t3\n4\t5\t6','-20\n30','=1/0\n5','=B2\n5','abc\n20']){await paste('#data-grid [data-r="1"][data-c="1"]',text,{error:true});assert.equal(await markup(),before);assert.equal(await history(),h);}
 });
 await test('P04 普通表格批量更新保留 span/样式、自动行列合计',async()=>{
  await load(matrixHTML());await select('table');await state(()=>htmlStudio.openDataEditor());
  const original=await state(()=>[...htmlStudio.doc.querySelectorAll('td span')].map(n=>[n.tagName,n.getAttribute('style')]));
  await paste('#data-grid [data-r="1"][data-c="1"]','200\t300\n150\t250');
  assert.deepEqual(await state(()=>[...htmlStudio.doc.querySelectorAll('td span')].map(n=>[n.tagName,n.getAttribute('style')])),original);
  assert(await state(()=>htmlStudio.doc.querySelectorAll('[data-studio-auto-sum]').length)>0);assert.deepEqual(await state(()=>[...htmlStudio.doc.querySelectorAll('.row-total')].map(n=>n.textContent)),['840','560','590']);assert.equal(await state(()=>htmlStudio.doc.querySelector('#total-row').lastElementChild.textContent),'1,990');assert.equal(await page.locator('#data-grid [data-r="1"][data-c="1"]').inputValue(),'200');
  await page.screenshot({path:path.join(dir,'table-paste.png')});
 });
 await test('P05 普通表格带引号多行文本为纯文本；复杂/锁定单元格拒绝',async()=>{
  await load('<table id="t"><tr><th>A</th><th>B</th></tr><tr><td>one</td><td><strong>two</strong></td></tr><tr><td>three</td><td>four</td></tr></table>');await select('table');await state(()=>htmlStudio.openDataEditor());
  await paste('#data-grid [data-r="1"][data-c="0"]','"<img onerror=alert(1)>"\t"a\nb"\nx\ty');assert.equal(await state(()=>htmlStudio.doc.querySelector('#t img')),null);assert.equal(await state(()=>htmlStudio.doc.querySelectorAll('#t td')[1].textContent),'a\nb');await close();
  await state(()=>htmlStudio.doc.querySelectorAll('#t td')[1].dataset.hsLocked='true');await state(()=>htmlStudio.openDataEditor());const before=await markup();await paste('#data-grid [data-r="1"][data-c="0"]','1\t2',{error:true});assert.equal(await markup(),before);
 });
 for(const horizontal of [false,true])await test(`P06 SVG ${horizontal?'横向':'纵向'}分组柱状图批量数据/表头映射与样式保留`,async()=>{
  await load(chartHTML({horizontal}));await open('#sales-chart');const h=await history();const before=await state(()=>[...htmlStudio.doc.querySelectorAll('#sales-chart rect')].map(n=>[n.getAttribute('fill'),n.getAttribute('stroke')]));
  await paste('#svg-data-grid input','分类\t预算\t实际\n4月\t1000\t900\n5月\t1200\t1100\n6月\t1500\t1400');assert.equal(await history(),h+1);assert.deepEqual((await model()).bars.map(b=>b.value),[1000,900,1200,1100,1500,1400]);assert.deepEqual(await state(()=>[...htmlStudio.doc.querySelectorAll('#sales-chart rect')].map(n=>[n.getAttribute('fill'),n.getAttribute('stroke')])),before);
 });
 await test('P07 SVG 非首格粘贴及格式/范围错误不部分写入',async()=>{
  const h=await history();await paste('#svg-data-grid tbody tr:nth-child(2) input:nth-child(1)','700\t600\n500\t400');assert.equal(await history(),h+1);const before=await markup();
  for(const text of ['10\tbad','10\t-2','10\t20%','1,2\t30','10\t20\n30']){await paste('#svg-data-grid input',text,{error:true});assert.equal(await markup(),before);}
 });
 await test('P08 SVG 堆叠图跨系列更新、零值及总计',async()=>{
  await load(stackedHTML({gradient:true}));await open('svg');await paste('#svg-data-grid input','10\t20\t30\n40\t50\t60\n0\t0\t0');const m=await model();assert.deepEqual(m.bars.map(b=>b.value),[10,20,30,40,50,60,0,0,0]);assert.match(await page.locator('#svg-chart-preview').textContent(),/150/);
 });
 await test('P09 SVG 瀑布图原子更新正负增量，自动合计不覆盖',async()=>{
  await load(waterfallHTML({subtotal:true,gradient:true}));await open('svg');await paste('#svg-data-grid input','300\n100\n-20\n999\n50\n999');const m=await model();assert.equal(m.result,430);assert.equal(m.bars[3].value,380);assert.match(await page.locator('.data-paste-status').textContent(),/2 个合计/);
  const before=await markup();await paste('#svg-data-grid input','10\n-100\n2',{error:true});assert.equal(await markup(),before);
 });
 await test('P10 气泡图三维数值批量更新，超轴范围/负面积整批拒绝',async()=>{
  await load(bubbleHTML({gradient:true}));await open('svg');const original=await model();const rows=original.points.map(p=>[p.x,p.y,Math.round(p.size*.8)].join('\t')).join('\n');await paste('#svg-bubble-grid input',rows);assert.deepEqual((await model()).points.map(p=>p.size),original.points.map(p=>Math.round(p.size*.8)));
  const before=await markup();await paste('#svg-bubble-grid input','999999\t0\t10',{error:true});assert.equal(await markup(),before);await paste('#svg-bubble-grid input','0\t0\t-1',{error:true});assert.equal(await markup(),before);
 });
 for(const vertical of [false,true])await test(`P11 HTML/CSS ${vertical?'纵柱':'横条'}批量更新保留渐变`,async()=>{
  await load(htmlBarsHTML({vertical}));await open('#css-chart');const styles=await state(()=>[...htmlStudio.doc.querySelectorAll('.bar-fill')].map(n=>n.style.background));await paste('#html-bar-grid input','分类\t数值\nAlpha\t10\nBeta\t20\nGamma\t30');assert.deepEqual(await state(()=>JSON.parse(htmlStudio.doc.querySelector('#css-chart').dataset.studioHtmlChart).bars.map(b=>b.value)),[10,20,30]);assert.deepEqual(await state(()=>[...htmlStudio.doc.querySelectorAll('.bar-fill')].map(n=>n.style.background)),styles);
 });
 await test('P12 实际报告 HTML 占比条批量更改、百分比同步；全零拒绝',async()=>{
  const file=process.env.SALES_FILE||path.resolve('../outputs/blockframe-q2-review/杭州栖物电商_2026Q2销售复盘_BlockFrame.html');await load(await fs.readFile(file,'utf8'));
  await state(()=>{htmlStudio.switchPage(15);const bar=htmlStudio.pageRoot.querySelector('div[style*="width:81.865%"]');bar.parentElement.id='paste-share';});await open('#paste-share');await paste('#html-bar-grid input','200\n100');assert.match(await markup(),/66\.7%/);const before=await markup();await paste('#html-bar-grid input','0\n0',{error:true});assert.equal(await markup(),before);
 });
 for(const stacked of [false,true])await test(`P13 Chart.js ${stacked?'堆叠':'分组'}多系列原子更新及单步撤回`,async()=>{
  await load(canvasHTML({stacked}));await open('canvas');await page.locator('#canvas-chart-grid').waitFor();const h=await history();await paste('#canvas-chart-grid input','分类\t实际\t目标\nAlpha\t10\t20\nBeta\t30\t40\nGamma\t50\t60');assert.equal(await history(),h+1);assert.deepEqual(await state(()=>JSON.parse(htmlStudio.doc.querySelector('canvas').dataset.studioChartjs).values),[[10,30,50],[20,40,60]]);const before=await markup();await paste('#canvas-chart-grid input','10\t20\n30\tno',{error:true});assert.equal(await markup(),before);
  await close();await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.deepEqual(await state(()=>JSON.parse(htmlStudio.doc.querySelector('canvas').dataset.studioChartjs).values),[[25,50,75],[40,60,80]]);await page.locator('#redo').click();await page.waitForFunction(()=>!htmlStudio.loading);
 });
 await test('P14 保存工程、重新导入、预览及导出保留整批 Chart.js 数据',async()=>{
  const saved=await save('#save-button','paste-chart.htmlstudio');await page.evaluate(p=>htmlStudio.load(p),JSON.parse(saved.text));const expected=[[10,30,50],[20,40,60]];assert.deepEqual(await state(()=>JSON.parse(htmlStudio.doc.querySelector('canvas').dataset.studioChartjs).values),expected);
  await page.locator('#preview-button').click();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');assert.deepEqual(await page.frameLocator('#preview-frame').locator('canvas').evaluate(n=>Chart.getChart(n).data.datasets.map(d=>d.data)),expected);await page.locator('#exit-preview').click();
  const exported=await save('#export-button','paste-chart.html');assert(!exported.text.includes('data-paste-status'));const p=await context.newPage();await p.goto(pathToFileURL(exported.file).href);await p.waitForFunction(()=>window.Chart?.getChart(document.querySelector('canvas')));assert.deepEqual(await p.locator('canvas').evaluate(n=>Chart.getChart(n).data.datasets.map(d=>d.data)),expected);await p.close();
 });
 await test('P17 Chart.js 粘贴未完成时立即关闭，等待落盘且只创建一次历史',async()=>{
  await open('canvas');const h=await history();await page.locator('#canvas-chart-grid input').first().evaluate(n=>{const d=new DataTransfer();d.setData('text/plain','70\t80\n90\t100\n110\t120');n.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}));});await close();await page.locator('#dialog').waitFor({state:'hidden'});assert.equal(await history(),h+1);assert.deepEqual(await state(()=>JSON.parse(htmlStudio.doc.querySelector('canvas').dataset.studioChartjs).values),[[70,90,110],[80,100,120]]);
 });
 await test('P18 普通单格粘贴保持原有行为；200 行批量更新与容量限制',async()=>{
  await load('<table><tr><th>名</th><th>值</th></tr>'+Array.from({length:199},(_,i)=>`<tr><td>项目${i}</td><td>1</td></tr>`).join('')+'</table>');await select('table');await state(()=>htmlStudio.openDataEditor());const input=page.locator('#data-grid [data-r="1"][data-c="0"]');await input.focus();await input.selectText();await page.evaluate(()=>navigator.clipboard.writeText('单格文本'));await input.press(process.platform==='darwin'?'Meta+v':'Control+v');await input.press('Tab');assert.equal(await state(()=>htmlStudio.doc.querySelector('table').rows[1].cells[0].textContent),'单格文本');const h=await history(),start=Date.now();await paste('#data-grid input','名称\t数值\n'+Array.from({length:199},(_,i)=>`分类${i}\t${i}`).join('\n'));assert.equal(await history(),h+1);assert.equal(await state(()=>htmlStudio.doc.querySelector('table').rows[199].cells[1].textContent),'198');assert(Date.now()-start<5000);const before=await markup();await paste('#data-grid input',Array(201).fill('1\t2').join('\n'),{error:true});assert.equal(await markup(),before);
 });
 await test('P19 长表格粘贴反馈位于滚动区外且无需滚动即可看到',async()=>{
  assert.equal(await page.locator('.data-paste-status').evaluate(n=>!n.closest('.data-grid-scroll')),true);const b=await page.locator('.data-paste-status').boundingBox();assert(b.y>=0&&b.y+b.height<982);assert.equal(await page.locator('.data-grid-scroll').evaluate(n=>n.scrollTop),0);
 });
 await test('P15 已绑定表格的图表不能覆盖数据源；过期面板不写新文档',async()=>{
  await load('<table><tr><th>项目</th><th>值</th></tr><tr><td>A</td><td>10</td></tr><tr><td>B</td><td>20</td></tr></table>');await state(()=>htmlStudio.insertDataElement('bar'));await page.locator('#data-chart-source').selectOption('0');const before=await markup();await paste('#data-grid [data-r="1"][data-c="1"]','50\n60',{error:true});assert.equal(await markup(),before);
  await state(()=>window.oldPasteInput=document.querySelector('#data-grid input'));await load('<p id="new">新文档</p>');await state(()=>{const d=new DataTransfer();d.setData('text/plain','1\t2');oldPasteInput.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d}));});assert.equal(await state(()=>htmlStudio.doc.querySelector('#new').textContent),'新文档');
 });
 await test('P16 全程无未捕获脚本异常',async()=>assert.deepEqual(errors,[]));
}catch{process.exitCode=1;}finally{const report={date:new Date().toISOString(),mode,results,errors};await fs.writeFile(path.join(dir,'data-paste-results.json'),JSON.stringify(report,null,2));await fs.writeFile('qa/data-paste-results.json',JSON.stringify(report,null,2));await browser.close();}
