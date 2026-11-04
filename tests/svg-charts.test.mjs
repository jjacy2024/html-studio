import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from './artifact-url.mjs';
import {createHash} from 'node:crypto';
import {chartHTML,chartSVG} from './svg-chart-fixtures.mjs';
import {acknowledgeCompatibility} from './compatibility-support.mjs';
const mode=process.env.TEST_URL?'http':'file',dir=path.resolve(process.env.SVG_CHART_QA_DIR||`qa/svg-charts-v0.2.9/${mode}`);await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1512,height:982},acceptDownloads:true}),results=[],errors=[];
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());
const state=fn=>page.evaluate(fn);
const canvas=s=>page.frameLocator('#edit-frame').locator(s);
const close=()=>page.locator('#dialog-close').click();
const cell=(r,c)=>page.locator(`[data-svg-bar="bar-${r}-${c}"]`);
const edit=async(r,c,v)=>{await cell(r,c).fill(String(v));await cell(r,c).press('Tab');};
const load=html=>page.evaluate(async html=>{document.querySelector('#dialog').close();await htmlStudio.newDocument(html,'SVG数据测试');},html);
const select=selector=>page.evaluate(selector=>{const e=htmlStudio;e.select([e.id(e.doc.querySelector(selector))]);},selector);
async function doubleClick(selector) {
  const el=canvas(selector);await el.scrollIntoViewIfNeeded();const box=await el.boundingBox();
  await page.locator('#canvas-scroll').evaluate((p,b)=>{const r=p.getBoundingClientRect();p.scrollTop+=b.y+b.height/2-r.y-r.height/2;p.scrollLeft+=b.x+b.width/2-r.x-r.width/2;},box);
  await el.dblclick();
}
async function bind() {await select('#sales-chart');await page.locator('[data-action="edit-chart-data"]').click();await page.getByRole('button',{name:'绑定并编辑数据',exact:true}).click();}
const snapshot=()=>state(()=>{const s=htmlStudio.doc.querySelector('#sales-chart'),m=s.hasAttribute('data-studio-svg-chart')?JSON.parse(s.getAttribute('data-studio-svg-chart')):null;return{m,rects:[...s.querySelectorAll('rect')].map(r=>({x:+r.getAttribute('x'),y:+r.getAttribute('y'),width:+r.getAttribute('width'),height:+r.getAttribute('height'),fill:r.getAttribute('fill'),stroke:r.getAttribute('stroke')})),labels:[...s.querySelectorAll('text')].map(t=>({x:+t.getAttribute('x'),y:+t.getAttribute('y'),text:t.textContent})),other:[htmlStudio.doc.querySelector('#independent')?.textContent,htmlStudio.doc.querySelector('#unrelated')?.outerHTML,htmlStudio.doc.querySelector('#ledger')?.textContent]};});
async function download(selector,name){const [d]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);const file=path.join(dir,name);await d.saveAs(file);return fs.readFile(file,'utf8');}
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);await page.screenshot({path:path.join(dir,'failure.png')});throw e;}}
let original,edited,exported;
try{
  await page.goto(process.env.TEST_URL||pathToFileURL(path.resolve(process.env.EDITOR_FILE||'HTML Studio.html')).href);await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await state(()=>htmlStudio.ready);
  await test('S01 识别六根分组柱、月份及图例；取消不修改源结构',async()=>{
    await load(chartHTML());original=await snapshot();await select('#sales-chart');assert.equal(await page.getByRole('button',{name:'编辑图表数据…',exact:true}).count(),1);assert.equal(await page.locator('[data-action="convert-chart"],[data-action="edit-svg-data"]').count(),0);await page.screenshot({path:path.join(dir,'single-entry.png')});await page.locator('[data-action="edit-chart-data"]').click();
    assert.equal(await page.locator('#dialog').getAttribute('data-kind'),'svg-chart-bind');assert.match(await page.locator('#dialog-body').textContent(),/3 个分类、2 个系列/);
    assert.deepEqual(await page.locator('#dialog-body th').allTextContents(),['分类','预算','实际','4月','5月','6月']);assert.deepEqual(await page.locator('#dialog-body td').allTextContents(),['1,100','1,020','1,350','1,210','1,750','1,630']);
    await page.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await snapshot(),original);
  });
  await test('S02 真实双击未绑定柱子、确认绑定并聚焦对应数据，原始几何和样式不变',async()=>{
    await doubleClick('#sales-chart rect[x="850"]');assert.equal(await page.locator('#dialog').getAttribute('data-kind'),'svg-chart-bind');await page.getByRole('button',{name:'绑定并编辑数据',exact:true}).click();
    assert.equal(await state(()=>document.activeElement.dataset.svgBar),'bar-2-1');assert.deepEqual((await snapshot()).rects,original.rects);assert.deepEqual((await snapshot()).labels,original.labels);
    assert.deepEqual((await snapshot()).m.bars.map(b=>b.value),[1100,1020,1350,1210,1750,1630]);
  });
  await test('S03 修改 1630 → 1900 实时更新柱高、标签、标题与面板预览',async()=>{
    await edit(2,1,1900);const s=await snapshot();assert.equal(s.rects[5].height,361);assert.equal(s.rects[5].y,69);assert.equal(s.labels.find(t=>t.x===890).y,53);assert.equal(s.labels.find(t=>t.x===890).text,'1,900');
    assert.equal(await page.locator('#svg-chart-preview [data-studio-svg-key="bar-2-1"]').getAttribute('height'),'361');assert.match(await canvas('[data-studio-svg-key="bar-2-1"] title').textContent(),/6月 · 实际：1,900/);
    assert.deepEqual(s.other,original.other);assert.equal(s.rects[5].fill,original.rects[5].fill);await page.screenshot({path:path.join(dir,'data-editor.png')});
  });
  await test('S04 超出原量程时统一扩展刻度并重算全部柱高',async()=>{
    await edit(2,1,2500);const s=await snapshot();assert.equal(s.m.maximum,4000);assert.deepEqual(s.labels.slice(0,5).map(t=>t.text),['0','1,000','2,000','3,000','4,000']);
    for(const [i,b]of s.m.bars.entries())assert.ok(Math.abs(s.rects[i].height-b.value*380/4000)<1e-6);assert.ok(s.rects[5].y>=50);
  });
  await test('S05 零值、小数和千分位输入；归零后可继续编辑',async()=>{
    await edit(2,1,0);assert.equal((await snapshot()).rects[5].height,0);await close();await select('#sales-chart');await page.locator('[data-action="edit-chart-data"]').click();assert.equal(await cell(2,1).inputValue(),'0');
    await edit(2,1,'1,900.25');const s=await snapshot();assert.equal(s.m.maximum,2000);assert.equal(s.labels.find(t=>t.x===890).text,'1,900.25');assert.ok(Math.abs(s.rects[5].height-361.0475)<1e-6);
  });
  await test('S06 负值、空输入、非数与过大值均不部分写入图表',async()=>{
    const s=await snapshot();for(const invalid of ['-20','','abc','1e7','1000000000001','25%']){await cell(2,1).fill(invalid);assert.equal(await cell(2,1).getAttribute('aria-invalid'),'true');assert.deepEqual(await snapshot(),s);}
    await edit(2,1,1900);await close();
  });
  await test('S07 已绑定数值标签真实双击定位数据；撤回和重做数值修改',async()=>{
    await doubleClick('#sales-chart [data-studio-svg-key="value-2-1"]');assert.equal(await state(()=>document.activeElement.dataset.svgBar),'bar-2-1');await edit(2,1,1800);await close();
    await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal((await snapshot()).m.bars[5].value,1900);
    await page.locator('#redo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal((await snapshot()).m.bars[5].value,1800);edited=await snapshot();
  });
  await test('S08 编辑与脚本隔离预览的全部 SVG 几何及标签一致',async()=>{
    await page.locator('#preview-button').click();const f=page.frameLocator('#preview-frame');await f.locator('#sales-chart').waitFor();
    const s=await f.locator('#sales-chart').evaluate(s=>({rects:[...s.querySelectorAll('rect')].map(r=>({x:+r.getAttribute('x'),y:+r.getAttribute('y'),width:+r.getAttribute('width'),height:+r.getAttribute('height'),fill:r.getAttribute('fill'),stroke:r.getAttribute('stroke')})),labels:[...s.querySelectorAll('text')].map(t=>({x:+t.getAttribute('x'),y:+t.getAttribute('y'),text:t.textContent}))}));assert.deepEqual(s.rects,edited.rects);assert.deepEqual(s.labels,edited.labels);await page.locator('#exit-preview').click();
  });
  await test('S09 保存工程重开和导出 HTML 重开保留数据绑定及原样式',async()=>{
    const project=JSON.parse(await download('#save-button','chart.htmlstudio'));await page.evaluate(p=>htmlStudio.load(p),project);assert.deepEqual(await snapshot(),edited);
    exported=await download('#export-button','chart.html');assert.ok(!exported.includes('data-hs-'));await load(exported);assert.deepEqual((await snapshot()).rects,edited.rects);assert.deepEqual((await snapshot()).m,edited.m);
    await select('#sales-chart');await page.locator('[data-action="edit-chart-data"]').click();await edit(2,1,1700);assert.equal((await snapshot()).m.bars[5].value,1700);await close();
  });
  await test('S10 导出文件独立打开无需编辑器运行时，几何保持一致',async()=>{
    const p=await browser.newPage();await p.goto(pathToFileURL(path.join(dir,'chart.html')).href);assert.equal(await p.locator('[data-studio-svg-key="bar-2-1"]').getAttribute('height'),String(edited.rects[5].height));assert.equal(await p.locator('[data-studio-svg-key="value-2-1"]').textContent(),'1,800');await p.close();
  });
  await test('S11 复制整图后仅修改副本，原图数据和标记不冲突',async()=>{
    await select('#sales-chart');await state(()=>htmlStudio.duplicate());const before=await state(()=>JSON.parse(htmlStudio.doc.querySelector('#sales-chart').getAttribute('data-studio-svg-chart')));
    await page.locator('[data-action="edit-chart-data"]').click();await edit(0,0,777);await close();const pair=await state(()=>[...htmlStudio.doc.querySelectorAll('[data-studio-svg-chart]')].map(s=>JSON.parse(s.getAttribute('data-studio-svg-chart')).bars[0].value));assert.deepEqual(pair,[before.bars[0].value,777]);
  });
  await test('S12 复制演示页后数据独立，绑定也可撤回重做',async()=>{
    await load(chartHTML({slides:true}));await bind();await close();await state(()=>htmlStudio.undo());assert.equal((await snapshot()).m,null);await state(()=>htmlStudio.redo());assert.ok((await snapshot()).m);
    await state(()=>{const e=htmlStudio;e.changePages('copy',[e.id(e.pages.pages[0])],1);e.select([e.id(e.pages.pages[1].querySelector('svg'))]);});await page.locator('[data-action="edit-chart-data"]').click();await edit(2,1,999);await close();assert.deepEqual(await state(()=>htmlStudio.pages.pages.slice(0,2).map(p=>JSON.parse(p.querySelector('svg').getAttribute('data-studio-svg-chart')).bars[5].value)),[1630,999]);
  });
  await test('S13 横向分组条形图修改数值后宽度和标签位置联动',async()=>{
    await load(chartHTML({horizontal:true}));await bind();await edit(2,1,1900);const s=await snapshot();assert.equal(s.m.orientation,'horizontal');assert.equal(s.rects[5].width,361);assert.equal(s.labels.find(t=>t.text==='1,900').x,493);await close();
  });
  await test('S14 堆叠、瀑布、无刻度、复杂变换保持原图并说明不支持',async()=>{
    const html=chartHTML();const fixtures=[html.replace('height="309.7"','height="150"'),html.replace('y="120.30000000000001"','y="80"'),html.replace(/<line[^>]*\/>/g,''),html.replace('<rect x="150"','<rect transform="translate(1,0)" x="150"')];
    // Explicit extra stacked segment prevents partial detection even when other bars match.
    fixtures.push(html.replace('</svg>','<rect x="850" y="80" width="80" height="40" fill="red"/></svg>'));
    for(const fixture of fixtures){await load(fixture);await select('#sales-chart');const before=await state(()=>htmlStudio.doc.querySelector('#sales-chart').outerHTML);await page.locator('[data-action="edit-chart-data"]').click();assert.match(await page.locator('#dialog-title').textContent(),/暂无法保留原图表样式/);assert.equal(await state(()=>htmlStudio.doc.querySelector('#sales-chart').outerHTML),before);await close();}
  });
  await test('S15 普通 SVG 图标双击不弹数据窗口，锁定图表不可修改',async()=>{
    await load('<svg id="icon" width="200" height="100"><rect x="10" y="10" width="80" height="60" fill="red"/></svg>');await doubleClick('#icon rect');assert.equal(await page.locator('#dialog').evaluate(d=>d.open),false);
    await load(chartHTML());await bind();await close();await state(()=>{htmlStudio.doc.querySelector('#sales-chart').dataset.hsLocked='true';});await doubleClick('#sales-chart rect[x="850"]');assert.equal(await page.locator('#dialog').evaluate(d=>d.open),false);
  });
  await test('S16 损坏或恶意元数据拒绝写入，不报未捕获错误或修改原图',async()=>{
    await load(chartHTML());await bind();await close();const model=(await snapshot()).m;
    for(const kind of ['format','missing','duplicate','keys','axis','geometry','text']){
      await page.evaluate(({model,kind})=>{const s=htmlStudio.doc.querySelector('#sales-chart'),m=structuredClone(model);if(kind==='format')delete m.bars[0].format;if(kind==='missing')m.bars.pop();if(kind==='duplicate')m.bars[1].row=m.bars[0].row,m.bars[1].column=m.bars[0].column;if(kind==='keys')m.bars[1].key=m.bars[0].key;if(kind==='axis')m.far=m.zero;if(kind==='geometry')delete m.bars[0].geometry.height;if(kind==='text')s.querySelector('[data-studio-svg-key="value-0-0"]').innerHTML='<tspan>1</tspan><tspan>100</tspan>';s.setAttribute('data-studio-svg-chart',JSON.stringify(m));}, {model,kind});
      const before=await state(()=>htmlStudio.doc.querySelector('#sales-chart').outerHTML);await select('#sales-chart');await page.locator('[data-action="edit-chart-data"]').click();assert.equal(await page.locator('#dialog').getAttribute('data-kind'),kind==='text'?'chart-conversion':'svg-chart-bind');assert.equal(await state(()=>htmlStudio.doc.querySelector('#sales-chart').outerHTML),before);await page.getByRole('button',{name:'取消',exact:true}).click();
    }
  });
  await test('S17 单个样式 tspan 保留，渐变引用在面板预览中正确重映射',async()=>{
    let html=chartHTML().replace('>1,630</text>','><tspan font-weight="900">1,630</tspan></text>');html=html.replace('<line x1="95"','<defs><linearGradient id="bar-grad"><stop stop-color="#FFFDF5"/><stop offset="1" stop-color="#FE90E8"/></linearGradient></defs><line x1="95"').replaceAll('fill="#FE90E8"','fill="url(#bar-grad)"');
    await load(html);await bind();await edit(2,1,1900);assert.equal(await canvas('[data-studio-svg-key="value-2-1"] tspan').textContent(),'1,900');assert.equal(await canvas('[data-studio-svg-key="value-2-1"] tspan').getAttribute('font-weight'),'900');
    const preview=await page.locator('#svg-chart-preview svg').evaluate(s=>({grad:s.querySelector('linearGradient').id,fill:s.querySelector('[data-studio-svg-key="bar-2-1"]').style.fill}));assert.ok(preview.fill.includes('#'+preview.grad));await close();
  });
  if(process.env.SALES_FILE){
    await test('S18 用户销售复盘原文件：第4页真实双击、六根柱识别、编辑及独立数据不变',async()=>{
      const file=path.resolve(process.env.SALES_FILE),bytes=await fs.readFile(file),sha=createHash('sha256').update(bytes).digest('hex');await state(()=>htmlStudio.dirty=false);await page.locator('#file-input').setInputFiles(file);await page.waitForFunction(name=>htmlStudio.name===name&&!htmlStudio.loading,path.basename(file,'.html'));await acknowledgeCompatibility(page);await page.locator('#page-select').selectOption('3');
      await state(()=>{const s=htmlStudio.doc.querySelector('svg[aria-label="月度净销售额与预算，万元"]');s.id='sales-chart';});
      const independent=await state(()=>{const d=htmlStudio.doc,p=htmlStudio.pageRoot;return [p.querySelector('h2').textContent,p.querySelector('table').outerHTML,...[...d.querySelectorAll('script')].map(s=>s.textContent)];});
      await doubleClick('#sales-chart rect[x="850"]');await page.getByRole('button',{name:'绑定并编辑数据',exact:true}).click();assert.equal(await state(()=>document.activeElement.dataset.svgBar),'bar-2-1');assert.deepEqual((await snapshot()).m.series,['预算','实际']);await edit(2,1,1900);assert.equal((await snapshot()).rects[5].height,361);const layout=await page.locator('#svg-data-grid').evaluate(t=>({scroll:t.parentElement.scrollWidth,width:t.parentElement.clientWidth}));assert.ok(layout.scroll<=layout.width+1,'Common three-column table must fit beside preview');await page.screenshot({path:path.join(dir,'source-data-editor.png')});await close();
      await page.locator('#preview-button').click();await page.frameLocator('#preview-frame').locator('#sales-chart').waitFor({state:'attached'});await page.waitForTimeout(200);const previewFrame=page.frameLocator('#preview-frame');assert.equal(await previewFrame.locator('body').evaluate(()=>!!window.presentation),true);await state(()=>htmlStudio.fit());const previewBounds=await page.locator('#preview-frame').boundingBox();await page.mouse.click(previewBounds.x+40,previewBounds.y+40);assert.equal(await previewFrame.locator('body').evaluate(()=>window.presentation.currentSlide),3);await page.keyboard.press('ArrowRight');assert.equal(await previewFrame.locator('body').evaluate(()=>window.presentation.currentSlide),4);await page.keyboard.press('ArrowLeft');assert.equal(await previewFrame.locator('body').evaluate(()=>window.presentation.currentSlide),3);await previewFrame.locator('#sales-chart').waitFor({state:'visible'});assert.equal(await previewFrame.locator('[data-studio-svg-key="bar-2-1"]').getAttribute('height'),'361');const sourceFrame=await(await page.locator('#preview-frame').elementHandle()).contentFrame();await sourceFrame.waitForFunction(()=>getComputedStyle(document.querySelector('.slide.active .reveal')).opacity==='1');await page.screenshot({path:path.join(dir,'source-preview.png')});await page.locator('#exit-preview').click();
      await download('#export-button','source-edited.html');const exportedPage=await browser.newPage();await exportedPage.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());await exportedPage.goto(pathToFileURL(path.join(dir,'source-edited.html')).href);assert.equal(await exportedPage.locator('#sales-chart [data-studio-svg-key="bar-2-1"]').getAttribute('height'),'361');assert.equal(await exportedPage.locator('#sales-chart [data-studio-svg-key="value-2-1"]').textContent(),'1,900');await exportedPage.close();
      assert.deepEqual(await state(()=>{const d=htmlStudio.doc,p=htmlStudio.pageRoot;return [p.querySelector('h2').textContent,p.querySelector('table').outerHTML,...[...d.querySelectorAll('script')].map(s=>s.textContent)];}),independent);assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'),sha);
    });
  }
  await test('S20 关闭与 Escape 提交当前有效修改，窄窗口无弹窗越界',async()=>{
    await load(chartHTML());await page.setViewportSize({width:1280,height:800});await bind();await cell(2,1).fill('1800');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#dialog').open);await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal((await snapshot()).m.bars[5].value,1630);
    await select('#sales-chart');await page.locator('[data-action="edit-chart-data"]').click();const bounds=await page.locator('#dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=1280&&bounds.y>=0&&bounds.y+bounds.height<=800);await cell(2,1).fill('1750');await close();assert.equal((await snapshot()).m.bars[5].value,1750);await page.setViewportSize({width:1512,height:982});
  });
  await test('S21 单系列、百分比刻度的识别及缩放保持单位',async()=>{
    await load(chartHTML());await state(()=>{const svg=htmlStudio.doc.querySelector('#sales-chart');[...svg.querySelectorAll('rect')].filter((_,i)=>i%2).forEach(r=>{r.nextElementSibling.remove();r.remove();});for(const t of svg.querySelectorAll('text')){if(t.getAttribute('y')==='480')t.setAttribute('x',+t.getAttribute('x')-50);else t.textContent=t.textContent+'%';}htmlStudio.commit('test fixture');});await bind();assert.deepEqual((await snapshot()).m.series,['预算']);await edit(1,0,1900);assert.equal((await snapshot()).labels.find(t=>t.x===490).text,'1,900%');await close();
  });
  await test('S22 预览允许本地页码 hash，保留历史 state 和跨源隔离；不写入导出',async()=>{
    const html=`<!doctype html><html><body><h1>Hash navigation</h1><script>history.replaceState({slide:2},'', '#2');window.hashResult={initial:location.hash,state:history.state};history.pushState({slide:3},'', '#3');window.hashResult.next=location.hash;try{history.replaceState({},'', 'https://example.test/blocked')}catch(e){window.hashResult.cross=e.name}try{parent.document.body}catch(e){window.hashResult.parent=e.name}</script></body></html>`;
    await load(html);await page.locator('#preview-button').click();const f=page.frameLocator('#preview-frame');await f.locator('h1').waitFor();assert.deepEqual(await f.locator('body').evaluate(()=>window.hashResult),{initial:'#2',state:{slide:2},next:'#3',cross:'SecurityError',parent:'SecurityError'});await page.locator('#exit-preview').click();const exported=await download('#export-button','hash.html');assert.ok(!exported.includes('Reflect.apply'));assert.ok(exported.includes("history.replaceState({slide:2},'', '#2')"));
  });
  await test('S23 统一入口在转换前不改图；取消、关闭、Escape 均保留原图与历史',async()=>{
    await load('<svg id="foreign" width="500" height="300"><path d="M0,100L200,20" stroke="red"/></svg>');await select('#foreign');
    const before=await state(()=>({html:htmlStudio.doc.body.innerHTML,history:htmlStudio.historyIndex}));
    for(const dismiss of ['cancel','close','escape']){
      await page.getByRole('button',{name:'编辑图表数据…',exact:true}).click();assert.equal(await page.locator('#dialog').getAttribute('data-kind'),'chart-conversion');assert.match(await page.locator('#dialog-body').textContent(),/原有样式、动画和交互无法保留/);if(dismiss==='cancel')await page.screenshot({path:path.join(dir,'conversion-confirmation.png')});
      assert.equal(await state(()=>htmlStudio.doc.querySelectorAll('[data-studio-chart]').length),0);
      if(dismiss==='cancel')await page.getByRole('button',{name:'取消',exact:true}).click();else if(dismiss==='close')await close();else await page.keyboard.press('Escape');
      assert.deepEqual(await state(()=>({html:htmlStudio.doc.body.innerHTML,history:htmlStudio.historyIndex})),before);
    }
  });
  await test('S24 确认转换只询问一次，直接打开数据编辑，可修改、撤回与重做',async()=>{
    await page.locator('[data-action="edit-chart-data"]').click();await page.getByRole('button',{name:'继续编辑（转换样式）',exact:true}).click();assert.equal(await page.locator('#dialog').getAttribute('data-kind'),'data');
    assert.equal(await canvas('#foreign').evaluate(s=>getComputedStyle(s).display),'none');assert.equal(await canvas('[data-studio-chart]').count(),1);
    await page.locator('#data-grid input[aria-label="B2"]').fill('90');await page.locator('#data-grid input[aria-label="B2"]').press('Tab');await close();assert.equal(await state(()=>JSON.parse(htmlStudio.doc.querySelector('[data-studio-chart]').dataset.studioChart).grid[1][1]),'90');
    await state(()=>htmlStudio.undo());await state(()=>htmlStudio.undo());assert.equal(await canvas('[data-studio-chart]').count(),0);assert.notEqual(await canvas('#foreign').evaluate(s=>getComputedStyle(s).display),'none');await state(()=>htmlStudio.redo());assert.equal(await canvas('[data-studio-chart]').count(),1);
  });
  await test('S25 选中图表外层容器也优先保留 SVG 和图例样式',async()=>{
    await load(chartHTML());await select('.card');await page.getByRole('button',{name:'编辑图表数据…',exact:true}).click();assert.equal(await page.locator('#dialog').getAttribute('data-kind'),'svg-chart-bind');await page.getByRole('button',{name:'绑定并编辑数据',exact:true}).click();await edit(2,1,1900);await close();assert.equal((await snapshot()).rects[5].height,361);assert.equal(await canvas('[data-studio-chart]').count(),0);assert.equal(await canvas('.legend').textContent(),'预算实际');assert.notEqual(await canvas('.card').evaluate(s=>getComputedStyle(s).display),'none');
  });
  await test('S26 Canvas 和多个 SVG 的容器使用同一个入口，明确同意前不转换',async()=>{
    for(const html of ['<canvas id="foreign" width="500" height="300"></canvas>','<figure id="foreign"><svg><circle r="20"/></svg><svg><path d="M0,0L20,20"/></svg></figure>']){
      await load(html);await select('#foreign');await page.getByRole('button',{name:'编辑图表数据…',exact:true}).click();await page.locator('#dialog[data-kind="chart-conversion"]').waitFor();assert.equal(await page.locator('#dialog').getAttribute('data-kind'),'chart-conversion');assert.equal(await canvas('[data-studio-chart]').count(),0);await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await canvas('[data-studio-chart]').count(),0);
    }
  });
  await test('S27 确认弹窗不能对已切换的文档或之后被锁定的图层进行转换',async()=>{
    const fixture='<svg id="foreign" width="200" height="100"><circle r="10"/></svg>';
    await load(fixture);await select('#foreign');await page.locator('[data-action="edit-chart-data"]').click();await state(async()=>{const pending=document.querySelector('#dialog-actions .primary-button').onclick;await htmlStudio.newDocument('<h1>Another document</h1>','另一个文档');pending();});assert.equal(await canvas('[data-studio-chart]').count(),0);
    await load(fixture);await select('#foreign');await page.locator('[data-action="edit-chart-data"]').click();await state(()=>{htmlStudio.doc.querySelector('#foreign').dataset.hsLocked='true';});await page.getByRole('button',{name:'继续编辑（转换样式）',exact:true}).click();assert.equal(await canvas('[data-studio-chart]').count(),0);assert.notEqual(await canvas('#foreign').evaluate(s=>getComputedStyle(s).display),'none');
  });
  await test('S28 旧绑定损坏时先尝试原样式重新识别，确认后可继续修改',async()=>{
    await load(chartHTML());await bind();await close();await state(()=>{const svg=htmlStudio.doc.querySelector('#sales-chart'),m=JSON.parse(svg.getAttribute('data-studio-svg-chart'));delete m.bars[0].format;svg.setAttribute('data-studio-svg-chart',JSON.stringify(m));});const before=(await snapshot()).rects;
    await select('#sales-chart');await page.locator('[data-action="edit-chart-data"]').click();assert.equal(await page.locator('#dialog').getAttribute('data-kind'),'svg-chart-bind');assert.match(await page.locator('#dialog-body').textContent(),/重新识别/);await page.getByRole('button',{name:'绑定并编辑数据',exact:true}).click();assert.deepEqual((await snapshot()).rects,before);await edit(2,1,1900);assert.equal((await snapshot()).rects[5].height,361);assert.equal(await canvas('[data-studio-chart]').count(),0);await close();
  });
  for(const horizontal of [false,true])await test(`S29-${horizontal?'H':'V'} 单系列各分类独立颜色：保留样式编辑、扩展量程、撤回与导出`,async()=>{
    await load(chartHTML({horizontal}).replace(chartSVG({horizontal}),chartSVG({horizontal,categoryColors:true})));
    await state(()=>htmlStudio.doc.querySelector('.legend').remove());const before=await snapshot();
    await bind();assert.equal((await snapshot()).m.series.length,1);assert.deepEqual((await snapshot()).m.categories,['4月','5月','6月']);assert.deepEqual((await snapshot()).rects,before.rects);
    await edit(1,0,1600);let s=await snapshot();const dimension=horizontal?'width':'height';assert.equal(s.rects[1][dimension],304);assert.equal(s.rects[0][dimension],before.rects[0][dimension]);assert.equal(s.rects[2][dimension],before.rects[2][dimension]);
    await edit(1,0,2500);s=await snapshot();assert.equal(s.m.maximum,4000);for(const [i,b]of s.m.bars.entries())assert.ok(Math.abs(s.rects[i][dimension]-b.value*380/4000)<1e-6);
    assert.deepEqual(s.rects.map(r=>[r.fill,r.stroke]),before.rects.map(r=>[r.fill,r.stroke]));assert.deepEqual(s.other,before.other);await close();
    await state(()=>htmlStudio.undo());assert.equal((await snapshot()).m.bars[1].value,1600);await state(()=>htmlStudio.redo());assert.equal((await snapshot()).m.bars[1].value,2500);
    const html=await download('#export-button',`category-colors-${horizontal?'horizontal':'vertical'}.html`);const exportedPage=await browser.newPage();await exportedPage.setContent(html);
    assert.deepEqual(await exportedPage.locator('#sales-chart rect').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('fill'),n.getAttribute('stroke')])),before.rects.map(r=>[r.fill,r.stroke]));assert.equal(await exportedPage.locator('[data-studio-svg-key="value-1-0"]').textContent(),'2,500');await exportedPage.close();
  });
  await test('S30 多系列的颜色对应不一致仍拒绝绑定，取消后原图不变',async()=>{
    await load(chartHTML());await state(()=>htmlStudio.doc.querySelectorAll('#sales-chart rect')[2].setAttribute('fill','#99E885'));const before=await snapshot();await select('#sales-chart');await page.locator('[data-action="edit-chart-data"]').click();assert.equal(await page.locator('#dialog').getAttribute('data-kind'),'chart-conversion');await page.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await snapshot(),before);
  });
  if(process.env.SALES_FILE)await test('S31 用户第5页彩色条形图：真实双击、保留六色、预览导出及独立说明不变',async()=>{
    const file=path.resolve(process.env.SALES_FILE),bytes=await fs.readFile(file),hash=buffer=>createHash('sha256').update(buffer).digest('hex');await load(bytes.toString());await page.locator('#page-select').selectOption('4');await state(()=>htmlStudio.pageRoot.querySelector('svg').id='sales-chart');
    const independent=()=>state(()=>({heading:htmlStudio.pageRoot.querySelector('h2').outerHTML,aside:htmlStudio.doc.querySelector('#sales-chart').closest('.nb-card').nextElementSibling.outerHTML,scripts:[...htmlStudio.doc.querySelectorAll('script')].map(s=>s.textContent)}));const originalIndependent=await independent(),before=await snapshot();
    await select('#sales-chart');await page.locator('[data-action="edit-chart-data"]').click();assert.equal(await page.locator('#dialog').getAttribute('data-kind'),'svg-chart-bind');await page.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual((await snapshot()).rects,before.rects);
    await doubleClick('#sales-chart rect:nth-of-type(2)');assert.equal(await page.locator('#dialog').getAttribute('data-kind'),'svg-chart-bind');await page.getByRole('button',{name:'绑定并编辑数据',exact:true}).click();assert.equal(await state(()=>document.activeElement.dataset.svgBar),'bar-1-0');
    assert.deepEqual((await snapshot()).m.categories,['收纳箱','保温杯','坐垫','升降桌','床头灯','循环扇']);assert.deepEqual((await snapshot()).m.bars.map(b=>b.value),[1050,840,590,520,400,460]);
    await edit(1,0,900);const edited=await snapshot();assert.equal(edited.rects[1].width,596.25);assert.deepEqual(edited.rects.map(r=>[r.fill,r.stroke]),before.rects.map(r=>[r.fill,r.stroke]));assert.equal(await page.locator('#svg-chart-preview [data-studio-svg-key="bar-1-0"]').getAttribute('width'),'596.25');await page.screenshot({path:path.join(dir,'source-category-colors-editor.png')});await close();
    await state(()=>htmlStudio.undo());assert.equal((await snapshot()).m.bars[1].value,840);await state(()=>htmlStudio.redo());assert.equal((await snapshot()).m.bars[1].value,900);assert.deepEqual(await independent(),originalIndependent);
    await page.locator('#preview-button').click();const preview=page.frameLocator('#preview-frame');await preview.locator('#sales-chart').waitFor({state:'attached'});assert.equal(await preview.locator('[data-studio-svg-key="bar-1-0"]').getAttribute('width'),'596.25');assert.equal(await preview.locator('[data-studio-svg-key="value-1-0"]').textContent(),'900');await page.locator('#exit-preview').click();
    await download('#export-button','source-category-colors-edited.html');const exportedPage=await browser.newPage();await exportedPage.goto(pathToFileURL(path.join(dir,'source-category-colors-edited.html')).href);assert.equal(await exportedPage.locator('#sales-chart [data-studio-svg-key="bar-1-0"]').getAttribute('width'),'596.25');assert.equal(await exportedPage.locator('#sales-chart [data-studio-svg-key="value-1-0"]').textContent(),'900');assert.deepEqual(await exportedPage.locator('#sales-chart rect').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('fill'),n.getAttribute('stroke')])),before.rects.map(r=>[r.fill,r.stroke]));await exportedPage.close();assert.deepEqual(await independent(),originalIndependent);assert.equal(hash(await fs.readFile(file)),hash(bytes));
  });
  await test('S19 全程无页面未捕获错误',async()=>assert.deepEqual(errors,[]));
}catch{process.exitCode=1;}finally{
  await fs.writeFile(process.env.SVG_CHART_REPORT||'qa/svg-charts-results.json',JSON.stringify({date:new Date().toISOString(),browser:await browser.version(),mode,salesIncluded:!!process.env.SALES_FILE,results,errors},null,2));await browser.close();
}
