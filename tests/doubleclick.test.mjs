import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {acknowledgeCompatibility} from './compatibility-support.mjs';

const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1512,height:982},acceptDownloads:true});
const page=await context.newPage(),results=[],errors=[];
page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
const output=process.env.DOUBLECLICK_REPORT||'qa/doubleclick-results.json';
await fs.mkdir('qa/doubleclick-v0.1.6',{recursive:true});
const base=process.env.TEST_URL||pathToFileURL(path.resolve(process.env.EDITOR_FILE||'HTML Studio.html')).href;
const fixture='<style>body{margin:0}p{position:absolute;left:100px;top:100px;margin:0;font:32px Arial;width:400px;height:60px}a{position:absolute;left:100px;top:250px;font:28px Arial}svg{position:absolute;left:100px;top:380px}</style><p id="text">Alpha beta gamma</p><a href="https://example.test/next"><strong id="nested">Nested text</strong></a><svg id="shape" width="100" height="80"><rect width="100" height="80" fill="#8758ef"/></svg>';
const locator=selector=>page.frameLocator('#edit-frame').locator(selector).first();
async function doubleClickCanvas(selector){
  const el=locator(selector);await el.scrollIntoViewIfNeeded();const box=await el.boundingBox();
  // A visible frame locator can still sit beneath the editor's floating tools.
  // Scroll the real canvas so this is a click on the content, not the toolbar.
  await page.locator('#canvas-scroll').evaluate((pane,b)=>{const r=pane.getBoundingClientRect();pane.scrollTop+=b.y+b.height/2-r.y-r.height/2;pane.scrollLeft+=b.x+b.width/2-r.x-r.width/2},box);
  await el.dblclick();
}
async function reset(){await page.evaluate(async html=>{await htmlStudio.newDocument(html,'双击测试');htmlStudio.zoomTo(1)},fixture)}
async function editing(selector){
  const actual=await locator(selector).getAttribute('contenteditable');
  if(actual!=='true'){
    await page.screenshot({path:'qa/doubleclick-v0.1.6/failure.png'});
    const state=await page.evaluate(()=>({trace:window.doubleclickTrace,selection:htmlStudio.nodes.map(n=>n.outerHTML.slice(0,250)),editing:!!htmlStudio.finishText}));
    await fs.writeFile('qa/doubleclick-v0.1.6/failure.json',JSON.stringify({selector,...state},null,2));
  }
  assert.equal(actual,'true',selector);assert.equal(await page.evaluate(()=>!!htmlStudio.finishText),true);
}
async function test(name,fn){const t=Date.now();try{await fn();results.push({name,pass:true,ms:Date.now()-t});console.log('PASS',name)}catch(e){results.push({name,pass:false,error:e.message});console.error('FAIL',name,e.message);process.exitCode=1;throw e}}
try{
  await page.goto(base);await page.evaluate(()=>htmlStudio.ready);
  await test('D01 未选中文字可真实双击进入编辑，写入并撤回重做',async()=>{
    await reset();await locator('#text').dblclick();await editing('#text');
    assert.equal(await page.evaluate(()=>htmlStudio.historyIndex),0);
    await page.keyboard.insertText('中文修改成功');await page.keyboard.press('Escape');
    assert.equal(await locator('#text').textContent(),'中文修改成功');assert.equal(await page.evaluate(()=>htmlStudio.historyIndex),1);
    await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await locator('#text').textContent(),'Alpha beta gamma');
    await page.locator('#redo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await locator('#text').textContent(),'中文修改成功');
  });
  await test('D02 已选中文字双击仍可进入编辑',async()=>{
    await reset();await locator('#text').click();assert.equal(await page.evaluate(()=>!!htmlStudio.finishText),false);
    await locator('#text').dblclick();await editing('#text');
  });
  await test('D03 链接内部文字双击不触发链接导航',async()=>{
    await reset();await locator('#nested').dblclick();await editing('#nested');
    assert.equal(await locator('a').getAttribute('href'),'https://example.test/next');await page.keyboard.insertText('链接文字');await page.keyboard.press('Escape');
    assert.equal(await locator('#nested').textContent(),'链接文字');
  });
  await test('D04 文本编辑中再次双击保留浏览器的单词选择',async()=>{
    await reset();await locator('#text').dblclick();await editing('#text');
    const r=await locator('#text').evaluate(el=>{const r=el.ownerDocument.createRange();r.setStart(el.firstChild,6);r.setEnd(el.firstChild,10);return r.getBoundingClientRect().toJSON()});
    const f=await page.locator('#edit-frame').boundingBox();await page.mouse.dblclick(f.x+r.x+r.width/2,f.y+r.y+r.height/2);
    assert.equal(await page.evaluate(()=>htmlStudio.doc.getSelection().toString()),'beta');
  });
  await test('D05 锁定文字不能通过双击或回车进入编辑',async()=>{
    await reset();await page.evaluate(()=>{htmlStudio.doc.querySelector('#text').dataset.hsLocked='true'});
    await locator('#text').dblclick();assert.equal(await page.evaluate(()=>!!htmlStudio.finishText),false);
    await page.keyboard.press('Meta+Enter');assert.equal(await page.evaluate(()=>!!htmlStudio.finishText),false);
  });
  await test('D06 拖动离开文字区域仍跟随，松开后停止且仅新增一次历史',async()=>{
    await reset();const box=await locator('#text').boundingBox();await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();
    await page.mouse.move(box.x+160,box.y+180,{steps:6});await page.mouse.up();
    const state=await page.evaluate(()=>({t:htmlStudio.translation(htmlStudio.doc.querySelector('#text')),history:htmlStudio.historyIndex,tracking:!!htmlStudio.endTracking,editing:!!htmlStudio.finishText}));
    assert.deepEqual(state,{t:{x:140,y:160},history:1,tracking:false,editing:false});
    await page.mouse.move(box.x+200,box.y+210);assert.deepEqual(await page.evaluate(()=>htmlStudio.translation(htmlStudio.doc.querySelector('#text'))),state.t);
  });
  await test('D07 非文字图形双击不会进入文本编辑',async()=>{
    await reset();await locator('#shape').dblclick();assert.equal(await page.evaluate(()=>!!htmlStudio.finishText),false);assert.equal(await locator('#shape').getAttribute('contenteditable'),null);
  });
  await test('D08 双击编辑后首次点击属性面板正常生效',async()=>{
    await reset();await locator('#text').dblclick();await page.keyboard.insertText('新的标题');
    const field=page.locator('[data-prop="fontSize"]');await field.click();assert.equal(await field.evaluate(el=>el===document.activeElement),true);
    await field.fill('44');await field.press('Tab');assert.equal(await page.evaluate(()=>htmlStudio.style(htmlStudio.doc.querySelector('#text')).fontSize),'44px');
  });
  await test('D09 回车与 Command/Ctrl+回车入口继续可用',async()=>{
    for(const key of ['Enter','Meta+Enter','Control+Enter']){await reset();await locator('#text').click();await page.keyboard.press(key);await editing('#text');await page.keyboard.press('Escape')}
  });
  if(process.env.MERCHANT_FILE){
    const source=path.resolve(process.env.MERCHANT_FILE),original=await fs.readFile(source),hash=createHash('sha256').update(original).digest('hex');
    await page.evaluate(()=>htmlStudio.dirty=false);await page.locator('#file-input').setInputFiles(source);
    await page.waitForFunction(name=>htmlStudio.name===name&&!htmlStudio.loading,path.basename(source,'.html'));await acknowledgeCompatibility(page);
    for(const zoom of [.5,.8,1])await test(`D10 商家页三个指标标签在 ${zoom*100}% 缩放下均可双击编辑`,async()=>{
      await page.evaluate(z=>htmlStudio.zoomTo(z),zoom);
      for(let i=1;i<=3;i++){
        const selector=`.inc-trend-tabs label:nth-child(${i}) span`,el=locator(selector),text=await el.textContent();
        const checked=await page.evaluate(()=>[...htmlStudio.doc.querySelectorAll('[name="incTrendMetric"]')].map(n=>n.checked));
        await page.evaluate(()=>{window.doubleclickTrace=[];for(const type of ['pointerdown','pointerup','click','dblclick','blur'])htmlStudio.doc.addEventListener(type,e=>doubleclickTrace.push({type,target:e.target.localName,text:e.target.textContent?.slice(0,40),x:e.clientX,y:e.clientY,editing:!!htmlStudio.finishText}),true)});
        await doubleClickCanvas(selector);await editing(selector);await page.keyboard.insertText('已修改 '+i);await page.keyboard.press('Escape');
        assert.equal(await el.textContent(),'已修改 '+i);assert.deepEqual(await page.evaluate(()=>[...htmlStudio.doc.querySelectorAll('[name="incTrendMetric"]')].map(n=>n.checked)),checked);
        await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await el.textContent(),text);
      }
    });
    await test('D11 商家标签编辑导出保持文字、表单结构和原脚本，原件不变',async()=>{
      const selector='.inc-trend-tabs label:nth-child(2) span';await doubleClickCanvas(selector);await editing(selector);await page.keyboard.insertText('支付金额（测试）');await page.keyboard.press('Escape');
      const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-button').click()]);const file=path.resolve('qa/doubleclick-v0.1.6/merchant-edited.html');await download.saveAs(file);const html=await fs.readFile(file,'utf8');
      const state=await page.evaluate(({html,original})=>{const parse=s=>new DOMParser().parseFromString(s,'text/html'),a=parse(html),b=parse(original);return{text:a.querySelector('.inc-trend-tabs label:nth-child(2) span').textContent,radios:a.querySelectorAll('[name="incTrendMetric"]').length,originalRadios:b.querySelectorAll('[name="incTrendMetric"]').length,scripts:[...a.scripts].map(s=>s.textContent).join('')===[...b.scripts].map(s=>s.textContent).join(''),hasMarkers:!!a.querySelector('[contenteditable],[data-hs-editing]')}},{html,original:original.toString()});
      assert.equal(state.text,'支付金额（测试）');assert.equal(state.radios,state.originalRadios);assert.ok(state.scripts);assert.equal(state.hasMarkers,false);assert.equal(createHash('sha256').update(await fs.readFile(source)).digest('hex'),hash);
    });
  }
  assert.deepEqual(errors,[]);
}catch{process.exitCode=1}
finally{
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify({date:new Date().toISOString(),browser:await browser.version(),editor:base,merchantIncluded:!!process.env.MERCHANT_FILE,results,errors,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length},null,2));await browser.close();
}
