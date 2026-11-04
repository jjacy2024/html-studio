import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {templateLibrary} from '../dist/templates.js';
import {templateCovers} from '../dist/template-covers.js';
const dir=path.resolve(process.env.GROUPING_QA_DIR||'qa/templates-grouping-v0.2.3');await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1480,height:1000},acceptDownloads:true});
const page=await context.newPage(),results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
page.setDefaultTimeout(15000);
async function test(name,run){const start=Date.now();try{await run();results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name);}catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL',name,error.message);throw error;}}
const load=html=>page.evaluate(html=>htmlStudio.newDocument(html,'拆散测试',{width:1100,height:780}),html);
const select=selector=>page.evaluate(selector=>htmlStudio.select([htmlStudio.id(htmlStudio.doc.querySelector(selector))]),selector);
const ungroup=async()=>{await page.locator('#layer-actions').click();await page.locator('#menu').getByRole('button',{name:/解除组合/}).click();};
const close=()=>page.locator('#dialog-close').click();
const confirm=async()=>{await page.locator('#dialog[open]').waitFor();await page.locator('#dialog-actions .primary-button').click();};
const state=selectors=>page.evaluate(selectors=>selectors.map(selector=>{const el=htmlStudio.doc.querySelector(selector),s=htmlStudio.style(el);return{selector,rect:htmlStudio.rect(el),font:s.fontFamily,size:s.fontSize,color:s.color,weight:s.fontWeight,text:el.textContent};}),selectors);
function sameGeometry(before,after){before.forEach((a,i)=>{for(const key of ['x','y','width','height'])assert.ok(Math.abs(a.rect[key]-after[i].rect[key])<1,`${a.selector} ${key}: ${a.rect[key]} -> ${after[i].rect[key]}`);assert.equal(after[i].font,a.font);assert.equal(after[i].size,a.size);assert.equal(after[i].color,a.color);assert.equal(after[i].text,a.text);});}
async function exportHTML(name){const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-button').click()]);const file=path.join(dir,name+'.html');await download.saveAs(file);return{file,html:await fs.readFile(file,'utf8')};}
try{
 await page.goto(process.env.TEST_URL||pathToFileURL(path.resolve('HTML Studio.html')).href);await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await page.evaluate(()=>htmlStudio.ready);
 await test('TG01 Top template entry precedes Import and stays visible at 1280px; all 34 covers load locally',async()=>{
   await page.setViewportSize({width:1280,height:850});
   const rect=await page.locator('#new-template-button').boundingBox(),importRect=await page.locator('#import-button').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=importRect.x+1);assert.ok(importRect.x+importRect.width<1280);
   await page.locator('#new-template-button').click();assert.equal(await page.locator('[data-template]').count(),34);assert.equal(Object.keys(templateCovers).length,34);assert.equal(new Set(Object.values(templateCovers)).size,34);
   for(const item of templateLibrary){const img=page.locator(`[data-template="${item.slug}"] img`);await img.scrollIntoViewIfNeeded();await img.evaluate(el=>el.decode());assert.deepEqual(await img.evaluate(el=>[el.naturalWidth,el.naturalHeight]),[480,270]);assert.match(await img.getAttribute('alt'),/第 1 页封面/);}
   await page.locator('#template-search').fill('blue professional');await page.locator('[data-template="blue-professional"] img').click();assert.equal(await page.locator('#template-name').textContent(),'Blue Professional');
   assert.equal(await page.locator('#template-list iframe').count(),0);assert.equal(await page.locator('#template-preview').count(),1);
   await page.screenshot({path:path.join(dir,'templates-1280.png')});await close();
   assert.equal(await page.locator('#new-button').count(),0);await page.setViewportSize({width:1480,height:1000});
   await page.locator('#new-template-button').click();await page.screenshot({path:path.join(dir,'templates-desktop.png')});await close();
 });
 await test('TG02 Editor-created groups ungroup from left layer menu, with undo/redo and geometry preserved',async()=>{
   await load('<html><body style="margin:0"><div id="a" style="position:absolute;left:90px;top:60px;width:160px;height:45px">Alpha</div><div id="b" style="position:absolute;left:320px;top:100px;width:140px;height:65px">Beta</div></body></html>');
   await page.evaluate(()=>htmlStudio.select(['a','b'].map(id=>htmlStudio.id(htmlStudio.doc.getElementById(id)))));const before=await state(['#a','#b']);
   await page.keyboard.press('Meta+g');assert.equal(await page.evaluate(()=>htmlStudio.nodes[0].dataset.hsGroup),'true');
   await ungroup();assert.equal(await page.locator('#dialog[open]').count(),0);sameGeometry(before,await state(['#a','#b']));
   await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await page.evaluate(()=>htmlStudio.doc.querySelectorAll('[data-hs-group]').length),1);
   await page.locator('#redo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await page.evaluate(()=>htmlStudio.doc.querySelectorAll('[data-hs-group]').length),0);
 });
 const imported=`<html><head><style>body{margin:0}.wrap{position:absolute;left:70px;top:60px;width:420px;height:240px;color:#275d85;font:22px/1.4 Georgia}.wrap > .item{position:absolute;width:180px;height:60px;box-sizing:border-box;border:2px solid currentColor}.wrap .item strong{color:#943259;font-weight:700}.item:nth-child(1){left:20px;top:30px}.item:nth-child(2){left:210px;top:130px}</style></head><body><div class="wrap" id="group"><div class="item" id="one"><strong id="nested">Inherited text</strong></div><div class="item" id="two">Second</div><script>window.unwrappedScript=true</script><!-- keep comment --></div></body></html>`;
 await test('TG03 Imported containers can be unpacked; inherited and ancestor-selector text styles and inert scripts survive',async()=>{
   await load(imported);await select('#group');const before=await state(['#one','#two','#nested']);
   await ungroup();await confirm();assert.equal(await page.evaluate(()=>!!htmlStudio.doc.getElementById('group')),false);
   sameGeometry(before,await state(['#one','#two','#nested']));assert.equal(await page.evaluate(()=>htmlStudio.selection.length),2);
   assert.ok(await page.evaluate(()=>htmlStudio.doc.body.innerHTML.includes('window.unwrappedScript=true')));
   const saved=await exportHTML('imported-ungrouped');assert.ok(saved.html.includes('window.unwrappedScript=true'));assert.ok(!saved.html.includes('data-hs-'));
   const exported=await context.newPage();await exported.goto(pathToFileURL(saved.file).href);assert.equal(await exported.evaluate(()=>window.unwrappedScript),true);
   const external=await exported.evaluate(()=>['#one','#two','#nested'].map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),s=getComputedStyle(el);return{selector,rect:{x:r.x,y:r.y,width:r.width,height:r.height},font:s.fontFamily,size:s.fontSize,color:s.color,text:el.textContent};}));sameGeometry(before,external);await exported.close();
 });
 await test('TG04 Flex/Grid parent conversion requires confirmation and preserves child and sibling positions',async()=>{
   await load(`<html><head><style>body{margin:0}#parent{display:grid;grid-template-columns:180px 420px;gap:25px;padding:40px;width:740px;background:#eee}#group{display:flex;align-items:center;gap:17px;padding:22px;border:3px solid #333;color:#623;}#one{font:20px Georgia;width:110px;height:80px}#two{width:140px;height:60px}#sibling{width:150px;height:95px;background:#ddd}</style></head><body><div id="parent"><div id="sibling">Sibling</div><div id="group"><div id="one">Flex one</div><div id="two">Flex two</div></div></div></body></html>`);
   await select('#group');const before=await state(['#one','#two','#sibling']);const original=await page.evaluate(()=>htmlStudio.doc.body.innerHTML);
   await ungroup();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>htmlStudio.doc.body.innerHTML),original);
   await page.keyboard.press('Meta+Shift+g');await confirm();sameGeometry(before,await state(['#one','#two','#sibling']));assert.equal(await page.evaluate(()=>htmlStudio.style(htmlStudio.doc.getElementById('parent')).display),'block');
   await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await page.evaluate(()=>htmlStudio.style(htmlStudio.doc.getElementById('parent')).display),'grid');
 });
 await test('TG05 2D rotation, scaling, parent transforms and child transforms survive unpacking',async()=>{
   await load(`<html><body style="margin:0"><div style="position:absolute;left:150px;top:100px;width:620px;height:480px;transform:rotate(5deg) scale(.9)"><div id="group" style="position:absolute;left:70px;top:60px;width:350px;height:230px;transform:translate(20px,14px) rotate(18deg) scale(1.2,.8);rotate:12deg"><div id="one" style="position:absolute;left:24px;top:32px;width:120px;height:50px;transform:rotate(-7deg);translate:10% 8px">Rotated one</div><div id="two" style="position:absolute;left:200px;top:110px;width:90px;height:85px;scale:.8 1.1;background:#bd9">Rotated two</div></div></div></body></html>`);
   const before=await state(['#one','#two']);await select('#group');await ungroup();await confirm();sameGeometry(before,await state(['#one','#two']));
 });
 await test('TG06 Exported groups remain unpackable after re-import without editor group markers',async()=>{
   await load('<html><body style="margin:0"><div id="one" style="position:absolute;left:50px;top:50px;width:100px;height:40px">One</div><div id="two" style="position:absolute;left:180px;top:80px;width:100px;height:40px">Two</div></body></html>');
   await page.evaluate(()=>{htmlStudio.select(['one','two'].map(id=>htmlStudio.id(htmlStudio.doc.getElementById(id))));htmlStudio.group();});const before=await state(['#one','#two']);
   const exported=await exportHTML('grouped');await load(exported.html);await page.evaluate(()=>htmlStudio.select([htmlStudio.id(htmlStudio.doc.getElementById('one').parentElement)]));
   assert.equal(await page.evaluate(()=>htmlStudio.nodes[0].hasAttribute('data-hs-group')),false);await ungroup();await confirm();sameGeometry(before,await state(['#one','#two']));
 });
 await test('TG07 Multiple containers unpack together, keeping descendant IDs and layer order',async()=>{
   await load('<html><body style="margin:0"><div id="g1" style="position:absolute;left:50px;top:60px"><div id="one">First</div></div><div id="g2" style="position:absolute;left:300px;top:100px"><div id="two">Second</div></div></body></html>');
   const before=await state(['#one','#two']);await page.evaluate(()=>htmlStudio.select(['g1','g2'].map(id=>htmlStudio.id(htmlStudio.doc.getElementById(id)))));await ungroup();await confirm();sameGeometry(before,await state(['#one','#two']));assert.deepEqual(await page.evaluate(()=>[...htmlStudio.doc.body.children].map(el=>el.id)),['one','two']);
 });
 await test('TG08 Locked descendants, direct text and unsupported structures are preserved without partial mutations',async()=>{
   await load('<html><body><div id="group"><div id="one" data-hs-locked="true">Locked</div></div><div id="textgroup">Direct text<span>Nested</span></div><table id="table"><tr><td>Cell</td></tr></table><svg id="svg"><rect width="30" height="30"/></svg></body></html>');
   await select('#group');const before=await page.evaluate(()=>htmlStudio.doc.body.innerHTML);await ungroup();assert.match(await page.locator('#toast').textContent(),/锁定/);assert.equal(await page.evaluate(()=>htmlStudio.doc.body.innerHTML),before);
   await select('#textgroup');await ungroup();assert.match(await page.locator('#toast').textContent(),/直接文字/);assert.equal(await page.evaluate(()=>htmlStudio.doc.body.innerHTML),before);
   for(const selector of ['#table','#svg']){await select(selector);await page.locator('#layer-actions').click();assert.equal(await page.locator('#menu').getByRole('button',{name:/解除组合/}).isDisabled(),true);await page.keyboard.press('Escape');}
 });
 await test('TG09 Actual context menu exposes unpack for an imported container',async()=>{
   await load(imported);await select('#group');
   const row=page.locator('.layer-row.selected').first();await row.click({button:'right'});const menu=page.locator('#menu');await menu.waitFor();await menu.getByRole('button',{name:/解除组合/}).click();await confirm();assert.equal(await page.evaluate(()=>!!htmlStudio.doc.getElementById('group')),false);
 });
 await test('TG10 SVG children keep their local dimensions through rotated-group unpacking',async()=>{
   await load('<html><body style="margin:0"><div id="group" style="position:absolute;left:200px;top:180px;width:400px;height:250px;rotate:23deg;scale:1.2"><svg id="one" width="140" height="85" viewBox="0 0 140 85" style="position:absolute;left:35px;top:25px"><rect width="140" height="85" fill="#b9a"/></svg><div id="two" style="position:absolute;left:220px;top:120px;width:100px;height:40px">SVG sibling</div></div></body></html>');
   const before=await state(['#one','#two']);await select('#group');await ungroup();await confirm();sameGeometry(before,await state(['#one','#two']));
 });
 await test('TG11 Hidden containers and 3D transforms are rejected without changing source content',async()=>{
   for(const style of ['display:none','transform:rotateY(30deg)']){
     await load(`<html><body><div id="group" style="${style}"><div>Keep child</div></div></body></html>`);await select('#group');const original=await page.evaluate(()=>htmlStudio.doc.body.innerHTML);await ungroup();assert.equal(await page.evaluate(()=>htmlStudio.doc.body.innerHTML),original);assert.equal(await page.locator('#dialog[open]').count(),0);
   }
 });
 await test('TG12 Template covers remain a small static bundle, with no uncaught runtime errors',async()=>{
   const bytes=Object.values(templateCovers).reduce((sum,url)=>sum+Buffer.from(url.split(',')[1],'base64').length,0);assert.ok(bytes<600000);assert.deepEqual(errors,[]);
 });
}catch{process.exitCode=1;await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});}
finally{await browser.close();await fs.writeFile(process.env.TEMPLATES_GROUPING_REPORT||path.join(dir,'results.json'),JSON.stringify({date:new Date().toISOString(),results,errors},null,2));console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);}
