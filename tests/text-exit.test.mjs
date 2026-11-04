import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const qa=process.env.TEXT_EXIT_QA||'qa/text-exit',results=[],errors=[];
await fs.mkdir(qa,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:1512,height:982},acceptDownloads:true}),page=await context.newPage();
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
const base=process.env.TEST_URL||pathToFileURL(path.resolve(process.env.EDITOR_FILE||'HTML Studio.html')).href;
const fixture='<style>body{margin:0;min-height:700px;background:white}.card{position:absolute;left:100px;top:100px;width:540px;height:180px;background:#ffe17b;border:4px solid black;padding:28px;box-sizing:border-box}h3{margin:0;font:700 32px Arial;line-height:39px}p{font:20px Arial;margin:16px 0}</style><div class="card"><h3 id="text">−170.0万元</h3><p id="next">投放370 → 540，费用增长45.9%。</p></div>';
const target=()=>page.frameLocator('#edit-frame').locator('#text');
const reset=()=>page.evaluate(async html=>{await htmlStudio.newDocument(html,'退出文字编辑测试');htmlStudio.zoomTo(.8)},fixture);
async function outsideCanvas(){const b=await page.locator('#canvas-scroll').boundingBox();await page.mouse.click(b.x+12,b.y+12);}
async function outsideText(){const b=await target().boundingBox();await page.mouse.click(b.x+b.width/2,b.y-12);}
async function assertExited(){
  const state=await page.evaluate(()=>({editing:!!htmlStudio.finishText,markers:htmlStudio.doc.querySelectorAll('[data-hs-editing],[contenteditable="true"]').length,ranges:htmlStudio.doc.getSelection().rangeCount,focusedEditable:htmlStudio.doc.activeElement.isContentEditable}));
  assert.deepEqual(state,{editing:false,markers:0,ranges:0,focusedEditable:false});
}
async function run(name,work){const start=Date.now();try{await work();results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name)}catch(e){results.push({name,pass:false,error:e.stack});throw e;}}
try{
await page.goto(base);await page.evaluate(()=>htmlStudio.ready);
await run('T01 点击文字框外的卡片空白：退出编辑并清除文字选区，不新增无效历史',async()=>{
  await reset();await target().dblclick();assert.equal(await page.evaluate(()=>htmlStudio.doc.getSelection().toString()),'−170.0万元');await outsideText();await assertExited();
  assert.equal(await page.evaluate(()=>htmlStudio.nodes[0]?.className),'card');assert.equal(await page.evaluate(()=>htmlStudio.historyIndex),0);
  await page.keyboard.insertText('不应写入');assert.equal(await target().textContent(),'−170.0万元');
});
await run('T02 页面空白和画布外空白：结束编辑并取消图层选中',async()=>{
  for(const area of ['page','workspace']){await reset();await target().dblclick();if(area==='workspace')await outsideCanvas();else{const f=await page.locator('#edit-frame').boundingBox();await page.mouse.click(f.x+650,f.y+350)}await assertExited();assert.equal(await page.evaluate(()=>htmlStudio.selection.length),0);}
});
await run('T03 输入后点击框外：内容保留、单次历史、撤回和重做正确',async()=>{
  await reset();await target().dblclick();await page.keyboard.insertText('−180.0万元');await outsideText();await assertExited();assert.equal(await target().textContent(),'−180.0万元');assert.equal(await page.evaluate(()=>htmlStudio.historyIndex),1);
  await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await target().textContent(),'−170.0万元');await page.locator('#redo').click();await page.waitForFunction(()=>!htmlStudio.loading);assert.equal(await target().textContent(),'−180.0万元');
});
await run('T04 Escape 结束编辑不残留文字选区；Enter 可重新编辑',async()=>{
  await reset();await target().dblclick();await page.keyboard.press('Escape');await assertExited();assert.equal(await page.evaluate(()=>htmlStudio.nodes[0]?.id),'text');await page.keyboard.press('Enter');assert.equal(await target().getAttribute('contenteditable'),'true');await outsideCanvas();await assertExited();
});
await run('T05 点击属性输入框：退出文字编辑且第一次点击仍能输入字号',async()=>{
  await reset();await target().dblclick();await page.keyboard.insertText('修改后标题');const field=page.locator('[data-prop="fontSize"]');await field.click();await assertExited();assert(await field.evaluate(n=>n===document.activeElement));await field.fill('44');await field.press('Tab');assert.equal(await target().evaluate(n=>getComputedStyle(n).fontSize),'44px');assert.equal(await target().textContent(),'修改后标题');
});
await run('T06 文字框内点击仍能放置光标，重复进入退出不残留状态',async()=>{
  await reset();for(let i=0;i<4;i++){await target().dblclick();const b=await target().boundingBox();await page.mouse.click(b.x+12,b.y+b.height/2);assert.equal(await target().getAttribute('contenteditable'),'true');assert.equal(await page.evaluate(()=>htmlStudio.doc.getSelection().rangeCount),1);await outsideText();await assertExited();}assert.equal(await page.evaluate(()=>htmlStudio.historyIndex),0);
});
await run('T07 编辑—退出—预览—导出：文字一致且无编辑标记',async()=>{
  await reset();await target().dblclick();await page.keyboard.insertText('保存的修改');await outsideCanvas();await assertExited();await page.locator('#preview-button').click();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');assert.equal(await page.frameLocator('#preview-frame').locator('#text').textContent(),'保存的修改');assert(await page.frameLocator('#preview-frame').locator('#text').evaluate(n=>n.getBoundingClientRect().height>0));await page.locator('#preview-button').click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-button').click()]);await download.saveAs(path.join(qa,'text-edited.html'));const html=await fs.readFile(path.join(qa,'text-edited.html'),'utf8');assert(html.includes('保存的修改'));assert(!/contenteditable|data-hs-editing/.test(html));
});
if(process.env.DECK_FILE){
  const source=await fs.readFile(process.env.DECK_FILE),digest=createHash('sha256').update(source).digest('hex');
  for(const zoom of [.5,.8,1])await run(`T08 实际报告第19页 ${zoom*100}% 缩放：点击黄色卡片空白与画布外，文字选区清除`,async()=>{
    await page.evaluate(async({html,zoom})=>{await htmlStudio.newDocument(html,'实际报告退出编辑验证');htmlStudio.pages.show(18);htmlStudio.zoomTo(zoom)}, {html:source.toString(),zoom});
    const text=page.frameLocator('#edit-frame').locator('h3').filter({hasText:'−170.0万元'});await text.scrollIntoViewIfNeeded();const b=await text.boundingBox();await page.locator('#canvas-scroll').evaluate((pane,b)=>{const r=pane.getBoundingClientRect();pane.scrollTop+=b.y+b.height/2-r.y-r.height/2;pane.scrollLeft+=b.x+b.width/2-r.x-r.width/2},b);
    for(const area of ['card','workspace']){await text.dblclick();assert.equal(await text.getAttribute('contenteditable'),'true');if(area==='card'){const r=await text.boundingBox();await page.mouse.click(r.x+r.width/2,r.y-10*zoom)}else await outsideCanvas();await assertExited();assert.equal(await text.textContent(),'−170.0万元');}
    if(zoom===.5)await page.screenshot({path:path.join(qa,'real-after.png')});assert.equal(createHash('sha256').update(await fs.readFile(process.env.DECK_FILE)).digest('hex'),digest);
  });
}
assert.deepEqual(errors,[]);
}catch(e){console.error(e);process.exitCode=1;}finally{await fs.writeFile(path.join(qa,'results.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),editor:base,deckIncluded:!!process.env.DECK_FILE,results,errors},null,2));await browser.close();}
