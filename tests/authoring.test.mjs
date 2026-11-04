import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { templateLibrary } from '../dist/templates.js';
import { evaluateGrid, shiftFormula } from '../dist/data-tools.js';
const dir=path.resolve('qa/authoring-v0.2.0');await fs.mkdir(dir,{recursive:true});
const results=[],errors=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1480,height:1000},acceptDownloads:true});
page.on('pageerror',error=>errors.push(error.message));
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>route.abort());
const test=async(name,run)=>{const start=Date.now();try{await run();results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name);}catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL',name,error.message);throw error;}};
const load=html=>page.evaluate(async html=>{document.querySelector('#dialog').close();await htmlStudio.newDocument(html,'测试文件');},html);
const select=selector=>page.evaluate(selector=>{const e=htmlStudio; e.select([e.id(e.doc.querySelector(selector))]);},selector);
const close=()=>page.locator('#dialog-close').click();
const state=fn=>page.evaluate(fn);
const cell=(address)=>page.locator(`#data-grid input[aria-label="${address}"]`);
const edit=async(address,value)=>{await cell(address).fill(value);await cell(address).press('Tab');};
const save=async(button,file)=>{const [download]=await Promise.all([page.waitForEvent('download'),page.locator(button).click()]);const dest=path.join(dir,file);await download.saveAs(dest);return fs.readFile(dest,'utf8');};
const fixture='<!doctype html><html><head><style>.slide{position:absolute;width:960px;height:540px;display:none;background:#f1eef9}.slide.active{display:block}</style></head><body><main data-deck><section class="slide active" id="one"><h1>One</h1><label for="input-one">Label</label><input id="input-one"><svg><defs><linearGradient id="grad"><stop stop-color="red"/></linearGradient></defs><rect fill="url(#grad)"/></svg></section><section class="slide" id="two"><h1>Two</h1></section><section class="slide" id="three"><h1>Three</h1></section></main><script>const slides=[...document.querySelectorAll(".slide")];let index=0;document.addEventListener("keydown",e=>{if(e.key==="ArrowRight"){slides[index].classList.remove("active");index=(index+1)%slides.length;slides[index].classList.add("active")}});</script></body></html>';
try {
  await page.goto(process.env.TEST_URL || pathToFileURL(path.resolve('HTML Studio.html')).href);
  await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await state(()=>htmlStudio.ready);
  await test('Formula parser: arithmetic, functions, dependencies, errors, no code execution',async()=>{
    const values=evaluateGrid([['label','a','b'],['x','2','3'],['y','=B2*4','=SUM(B2:C2)'],['total','=SUM(B2:B3)','=AVERAGE(B2:C3)'],['bad','=B5','=1/0'],['ref','=Z99','=window.alert(1)']]);
    assert.equal(values[2][1],8);assert.equal(values[2][2],5);assert.equal(values[3][1],10);assert.equal(values[3][2],4.5);assert.equal(values[4][1],'#CYCLE!');assert.equal(values[4][2],'#DIV/0!');assert.equal(values[5][1],'#REF!');assert.equal(values[5][2],'#FORMULA!');
    assert.equal(shiftFormula('=SUM(B2:B4)+C4','row',2),'=SUM(B2:B5)+C5');assert.equal(shiftFormula('=SUM(B2:B4)+C4','row',3,true),'=SUM(B2:B3)+#REF!');assert.equal(shiftFormula('=SUM(B2:C4)','column',1,true),'=SUM(B2:B4)');
  });
  await test('New document UI exposes exactly 34 templates and preview, no blank-document form',async()=>{
    await page.locator('#new-button').click();assert.equal(await page.locator('[data-template]').count(),34);assert.equal(await page.locator('#new-width').count(),0);await page.locator('#template-search').fill('blue professional');assert.equal(await page.locator('[data-template]').count(),1);await page.locator('[data-template="blue-professional"]').click();
    const preview=page.frameLocator('#template-preview');await preview.locator('.slide.active').waitFor();const text=await preview.locator('.slide.active').textContent();await page.locator('#template-next').click();await page.waitForTimeout(150);assert.notEqual(await preview.locator('.slide.active').textContent(),text);
    await page.waitForTimeout(600);await page.screenshot({path:path.join(dir,'template-library.png')});await page.getByRole('button',{name:'使用此模板新建',exact:true}).click();await page.waitForFunction(()=>htmlStudio.name==='Blue Professional'&&!htmlStudio.loading);await page.waitForFunction(()=>document.querySelector('#dialog').dataset.kind==='compatibility'||!document.querySelector('#dialog').open);if(await page.locator('#dialog').isVisible())await close();assert.equal(await state(()=>htmlStudio.pages.pages.length),10);
  });
  for (const item of templateLibrary) await test(`Template ${item.slug}: page recognition, last-page canvas and offline preview after copying a page`,async()=>{
    await state(()=>document.querySelector('#dialog').close());await page.evaluate(slug=>htmlStudio.createFromTemplate(slug),item.slug);
    assert.equal(await state(()=>htmlStudio.pages.pages.length),item.slide_count);
    await page.locator('#page-select').selectOption(String(item.slide_count-1));
    assert.ok(await state(()=>htmlStudio.rect(htmlStudio.pageRoot).width>100));
    await state(()=>{const e=htmlStudio;e.changePages('copy',[e.id(e.pages.pages[0])],1);});
    assert.equal(await state(()=>htmlStudio.pages.pages.length),item.slide_count+1);
    await page.locator('#preview-button').click();
    const preview=page.frameLocator('#preview-frame');await preview.locator('body').waitFor({state:'attached'});
    await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');
    await preview.locator('[data-studio-pages]').waitFor({state:'attached'});
    const count=await preview.locator('body').evaluate(()=>document.querySelector('[data-studio-pages]')?.children.length);
    assert.ok(count>=item.slide_count+1);
    await page.locator('#exit-preview').click();
  });
  await test('Page manager inserts at start, middle, end; multi-copy; deletes; undo/redo',async()=>{
    await load(fixture);await page.locator('#manage-pages').click();await page.locator('#page-insert-position').selectOption('0');await page.getByRole('button',{name:'新增空白页',exact:true}).click();assert.equal(await state(()=>htmlStudio.pages.pages.length),4);await close();
    assert.equal(await state(()=>htmlStudio.pages.index),0);
    await state(()=>{const e=htmlStudio;e.changePages('add',[],2);e.changePages('add',[],e.pages.pages.length);});assert.equal(await state(()=>htmlStudio.pages.pages.length),6);
    await page.locator('#manage-pages').click();await page.locator('[data-page-id]:checked').uncheck();await page.locator('[data-page-id]').nth(1).check();await page.locator('[data-page-id]').nth(3).check();await page.locator('#page-insert-position').selectOption('1');await page.getByRole('button',{name:'复制选中页',exact:true}).click();assert.equal(await state(()=>htmlStudio.pages.pages.length),8);await close();
    await state(()=>{const e=htmlStudio;e.changePages('delete',e.pages.pages.slice(1,3).map(p=>e.id(p)),0);});assert.equal(await state(()=>htmlStudio.pages.pages.length),6);
    await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await state(()=>htmlStudio.pages.pages.length),8);await page.locator('#redo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await state(()=>htmlStudio.pages.pages.length),6);
  });
  await test('Page copy remaps IDs, SVG references and label relationships; single page survives save/reopen',async()=>{
    await load(fixture);await state(()=>{const e=htmlStudio;e.changePages('copy',[e.id(e.pages.pages[0])],1);});
    const refs=await state(()=>{const e=htmlStudio,p=e.pages.pages[1];return {ids:[...e.doc.querySelectorAll('[id]')].map(n=>n.id),input:p.querySelector('input').id,label:p.querySelector('label').htmlFor,grad:p.querySelector('linearGradient').id,fill:p.querySelector('rect').getAttribute('fill')};});
    assert.equal(new Set(refs.ids).size,refs.ids.length);assert.equal(refs.label,refs.input);assert.equal(refs.fill,`url(#${refs.grad})`);
    await state(()=>{const e=htmlStudio;e.changePages('delete',e.pages.pages.slice(1).map(p=>e.id(p)),0);});assert.equal(await state(()=>htmlStudio.pages.pages.length),1);
    assert.equal(await state(()=>{const e=htmlStudio;return e.changePages('delete',[e.id(e.pageRoot)],0);}),false);
    const saved=JSON.parse(await save('#save-button','one-page.htmlstudio'));await page.evaluate(saved=>htmlStudio.load(saved),saved);assert.equal(await state(()=>htmlStudio.pages.pages.length),1);
    const html=await save('#export-button','pages.html');assert.ok(!html.includes('data-hs-'));assert.ok(html.includes('data-studio-pages'));
  });
  await test('Ordinary table data edits preserve untouched rich text; formulas recompute live',async()=>{
    await load('<html><body><table id="sales"><thead><tr><th>项目</th><th>金额</th><th>数量</th></tr></thead><tbody><tr><td><b>Apple</b></td><td>40</td><td>2</td></tr><tr><td>Berry</td><td>60</td><td>3</td></tr></tbody><tfoot><tr><td>合计</td><td>100</td><td>5</td></tr></tfoot></table></body></html>');
    await select('#sales');await page.locator('[data-action="edit-data"]').click();await edit('B4','=SUM(B2:B3)');await cell('B2').fill('80');assert.equal(await state(()=>htmlStudio.doc.querySelector('#sales').rows[3].cells[1].textContent),'140');await cell('B2').press('Tab');await close();assert.equal(await state(()=>htmlStudio.doc.querySelector('#sales b').textContent),'Apple');
  });
  await test('Table row/column insertion/deletion adjusts formulas and preserves undo',async()=>{
    await page.locator('[data-action="edit-data"]').click();await cell('B3').click();await page.locator('[data-grid-action="row-before"]').click();await edit('A3','Cherry');await edit('B3','20');await edit('C3','1');assert.equal(await cell('B5').inputValue(),'=SUM(B2:B4)');assert.equal(await state(()=>htmlStudio.doc.querySelector('#sales').rows[4].cells[1].textContent),'160');
    await cell('B3').click();await page.locator('[data-grid-action="column-before"]').click();assert.equal(await cell('C5').inputValue(),'=SUM(C2:C4)');await cell('B3').click();await page.locator('[data-grid-action="column-delete"]').click();assert.equal(await cell('B5').inputValue(),'=SUM(B2:B4)');await close();
    await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await state(()=>htmlStudio.doc.querySelector('#sales').rows[0].cells.length),4);await page.locator('#redo').click();await page.waitForFunction(()=>!htmlStudio.loading);
  });
  await test('Linked bar, line and pie charts reflect table data, exclude footer totals',async()=>{
    await page.locator('[data-left-tab="insert"]').click();await page.locator('[data-insert-data="bar"]').click();await page.locator('#data-chart-source').selectOption('0');await close();
    assert.equal(await state(()=>htmlStudio.doc.querySelectorAll('[data-studio-chart] rect[data-value]').length),6);
    const before=await state(()=>htmlStudio.doc.querySelector('[data-studio-chart]').innerHTML);
    await select('#sales');await page.locator('[data-action="edit-data"]').click();await cell('B2').fill('120');assert.notEqual(await state(()=>htmlStudio.doc.querySelector('[data-studio-chart]').innerHTML),before);await close();
    await select('[data-studio-chart]');await page.locator('[data-action="edit-data"]').click();await page.locator('#data-chart-type').selectOption('line');assert.equal(await state(()=>htmlStudio.doc.querySelectorAll('[data-studio-chart] polyline').length),2);await page.locator('#data-chart-type').selectOption('pie');assert.equal(await state(()=>htmlStudio.doc.querySelectorAll('[data-studio-chart] path').length),3);
    await page.screenshot({path:path.join(dir,'data-panel.png')});await close();
  });
  await test('Chart data and SVG survive preview, export and project reopen; no editor runtime leaked',async()=>{
    const before=await state(()=>htmlStudio.doc.querySelector('[data-studio-chart]').innerHTML);
    const saved=JSON.parse(await save('#save-button','data.htmlstudio'));await page.evaluate(saved=>htmlStudio.load(saved),saved);assert.equal(await state(()=>htmlStudio.doc.querySelector('[data-studio-chart]').innerHTML),before);
    await page.locator('#preview-button').click();const f=page.frameLocator('#preview-frame');await f.locator('[data-studio-chart] svg').waitFor();assert.equal(await f.locator('[data-studio-chart]').innerHTML(),before);await page.locator('#exit-preview').click();
    const html=await save('#export-button','data.html');assert.ok(!html.includes('data-hs-'));const exported=await browser.newPage();await exported.setContent(html);assert.equal(await exported.locator('[data-studio-chart]').innerHTML(),before);await exported.close();
  });
  await test('Foreign-chart conversion requires explicit action, hides source, can undo; merged tables explain limits',async()=>{
    await load('<html><body><svg id="foreign" width="500" height="300"><rect width="50" height="50"/></svg><table id="merged"><tr><td colspan="2">Merged</td></tr></table></body></html>');await select('#foreign');await page.locator('[data-action="edit-chart-data"]').click();assert.equal(await state(()=>htmlStudio.doc.querySelectorAll('[data-studio-chart]').length),0);await page.getByRole('button',{name:'继续编辑（转换样式）',exact:true}).click();assert.equal(await state(()=>htmlStudio.style(htmlStudio.doc.querySelector('#foreign')).display),'none');await close();await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await state(()=>htmlStudio.doc.querySelectorAll('[data-studio-chart]').length),0);await select('#merged');await page.locator('[data-action="edit-data"]').click();assert.match(await page.locator('#dialog-body').textContent(),/合并单元格/);await close();
  });
  await test('Video file insertion, controls, undo, project reopen, preview and portable export',async()=>{
    // A real browser-encoded WebM, with no network dependency.
    const bytes=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=64;c.height=36;const ctx=c.getContext('2d');ctx.fillStyle='#7951df';ctx.fillRect(0,0,64,36);const stream=c.captureStream(10),r=new MediaRecorder(stream,{mimeType:'video/webm'}),parts=[];r.ondataavailable=e=>parts.push(e.data);const done=new Promise(resolve=>r.onstop=resolve);r.start();let tick=0;const timer=setInterval(()=>{ctx.fillStyle=++tick%2?'#7951df':'#2eaaa3';ctx.fillRect(0,0,64,36);},50);await new Promise(r=>setTimeout(r,800));clearInterval(timer);r.stop();await done;stream.getTracks().forEach(t=>t.stop());return [...new Uint8Array(await new Blob(parts).arrayBuffer())];});
    await load(fixture);await page.locator('#page-select').selectOption('1');await page.locator('#video-input').setInputFiles({name:'clip.webm',mimeType:'video/webm',buffer:Buffer.from(bytes)});await page.waitForFunction(()=>htmlStudio.doc.querySelector('video'));
    assert.equal(await state(()=>htmlStudio.doc.querySelector('video').parentElement===htmlStudio.pageRoot),true);await page.locator('[data-video-prop="autoplay"]').check();assert.equal(await state(()=>htmlStudio.doc.querySelector('video').hasAttribute('muted')),true);
    const saved=JSON.parse(await save('#save-button','video.htmlstudio'));assert.ok(saved.html.includes('data:video/webm;base64,'));await page.evaluate(saved=>htmlStudio.load(saved),saved);
    await page.locator('#preview-button').click();const preview=page.frameLocator('#preview-frame');await preview.locator('video').waitFor({state:'attached'});await preview.locator('body').evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));await preview.locator('video').waitFor();await preview.locator('video').evaluate(v=>{v.currentTime=0;return v.play();});assert.ok(await preview.locator('video').evaluate(v=>v.readyState>=2));await page.locator('#exit-preview').click();
    const html=await save('#export-button','video.html');const exported=await browser.newPage();await exported.setContent(html);await exported.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));await exported.locator('video').evaluate(v=>{v.currentTime=0;return v.play();});assert.ok(await exported.locator('video').evaluate(v=>v.readyState>=2));await exported.close();
  });
  await test('No uncaught editor or template JavaScript errors',async()=>assert.deepEqual(errors,[]));
} catch {process.exitCode=1;await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});}
finally {
  // Keep completed assertions even if Chrome stalls while disposing downloads.
  const cleanup={};let timer;
  const report=()=>fs.writeFile(process.env.AUTHORING_REPORT||path.resolve('qa/authoring-results.json'),JSON.stringify({date:new Date().toISOString(),results,errors,cleanup},null,2));
  await report();
  try{await Promise.race([browser.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('browser cleanup timeout after 10 seconds')),10000);})]);cleanup.browser='closed';}
  catch(error){cleanup.browser=error.message;cleanup.forcedExit=true;console.warn(error.message);}
  finally{clearTimeout(timer);}
  await report();console.log(`${results.filter(r=>r.pass).length} passed / ${results.length} checks`);
  if(cleanup.forcedExit)process.exit(process.exitCode||0);
}
