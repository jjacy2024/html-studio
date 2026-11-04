import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const qa='qa/fit-content',results=[],errors=[];await fs.mkdir(qa,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1512,height:982},acceptDownloads:true}),page=await context.newPage();
await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
const load=html=>page.evaluate(html=>htmlStudio.newDocument('<style>body{margin:0}.box{box-sizing:border-box}.item{box-sizing:border-box;background:#abebc8}</style>'+html,'适应尺寸测试'),html);
const select=selector=>page.evaluate(selector=>htmlStudio.select([...htmlStudio.doc.querySelectorAll(selector)].map(n=>htmlStudio.id(n))),selector);
const read=selector=>page.evaluate(selector=>[...htmlStudio.doc.querySelectorAll(selector)].map(n=>{const s=htmlStudio.style(n);return {id:n.id,rect:htmlStudio.rect(n),width:parseFloat(s.width),height:parseFloat(s.height),padding:s.padding,display:s.display,text:n.textContent,color:s.color,position:s.position,gap:s.gap};}),selector);
const state=()=>page.evaluate(()=>({html:htmlStudio.doc.body.innerHTML,history:htmlStudio.historyIndex,revision:htmlStudio.revision,selection:[...htmlStudio.selection]}));
const command=(params={})=>page.evaluate(params=>htmlStudioAPI.execute({command:'elements.geometry',params:{ids:htmlStudio.selection,geometry:{fitContent:true},...params},expected:htmlStudioAPI.getState().token}),params);
const fit=()=>page.locator('[data-action="fit-content"]').click();
const close=()=>page.locator('#dialog-close').click();
const confirm=()=>page.locator('#dialog-actions .primary-button').click();
const near=(a,b,message='')=>assert(Math.abs(a-b)<.7,`${message}: ${a} / ${b}`);
function sameRelative(before,after){for(let i=0;i<before.length;i++){for(const key of ['width','height'])near(before[i].rect[key],after[i].rect[key],key);near(before[i].rect.x-before[0].rect.x,after[i].rect.x-after[0].rect.x,'relative x');near(before[i].rect.y-before[0].rect.y,after[i].rect.y-after[0].rect.y,'relative y');assert.equal(before[i].text,after[i].text);}}
async function tight(selector,children){const [root]=await read(selector),items=await read(children);const b=await page.evaluate(selector=>{const s=htmlStudio.style(htmlStudio.doc.querySelector(selector));return ['Left','Top','Right','Bottom'].map(p=>parseFloat(s['border'+p+'Width'])||0)},selector);near(Math.min(...items.map(n=>n.rect.x)),root.rect.x+b[0]);near(Math.min(...items.map(n=>n.rect.y)),root.rect.y+b[1]);near(Math.max(...items.map(n=>n.rect.right)),root.rect.right-b[2]);near(Math.max(...items.map(n=>n.rect.bottom)),root.rect.bottom-b[3]);}
const free='<div id="parent" class="box" data-hs-group="true" style="position:absolute;left:150px;top:100px;width:600px;height:350px;border:3px solid #111;padding:30px"><div id="a" class="item" style="position:absolute;left:40px;top:50px;width:100px;height:60px">一</div><div id="b" class="item" style="position:absolute;left:190px;top:140px;width:140px;height:70px">二</div></div>';
async function test(name,work){const start=Date.now();try{await work();results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name)}catch(e){results.push({name,pass:false,error:e.stack});throw e;}}
try{
await page.goto(process.env.TEST_URL||pathToFileURL(path.resolve('HTML Studio.html')).href);await page.evaluate(()=>htmlStudio.ready);
await test('F01 自由组合去四边空白与 padding，保留子元素尺寸/画布位置和边框',async()=>{
  await load(free);await select('#parent');const before=await read('#a,#b');await fit();assert.equal(await page.locator('#dialog').isVisible(),false);const [root]=await read('#parent');near(root.width,296);near(root.height,166);assert.equal(root.padding,'0px');const after=await read('#a,#b');sameRelative(before,after);for(let i=0;i<before.length;i++){near(before[i].rect.x,after[i].rect.x);near(before[i].rect.y,after[i].rect.y);}await tight('#parent','#a,#b');assert.equal((await state()).history,1);
});
await test('F02 单步撤回/重做完整恢复；再次贴合不新增历史',async()=>{
  const fitted=await state();await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);near((await read('#parent'))[0].width,600);await page.locator('#redo').click();await page.waitForFunction(()=>!htmlStudio.loading);near((await read('#parent'))[0].width,296);await select('#parent');await fit();assert.equal((await state()).history,fitted.history);
});
await test('F03 负坐标子元素、图片/SVG 和隐藏元素均正确计算',async()=>{
  await load('<div id="parent" style="position:absolute;left:200px;top:100px;width:500px;height:400px"><img id="a" style="position:absolute;left:-30px;top:-20px;width:120px;height:80px" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"><svg id="b" style="position:absolute;left:170px;top:100px" width="80" height="90"><rect width="80" height="90" fill="red"/></svg><div style="display:none;width:4000px;height:4000px"></div></div>');await select('#parent');assert((await command()).ok);await tight('#parent','#a,#b');near((await read('#parent'))[0].width,280);near((await read('#parent'))[0].height,210);
});
await test('F04 普通流式容器保留相邻元素间距与尺寸',async()=>{
  await load('<div id="parent" class="box" style="padding:24px;border:2px solid;width:600px;height:380px"><div id="a" class="item" style="width:160px;height:40px;margin-bottom:18px">上</div><div id="b" class="item" style="width:240px;height:60px">下</div></div>');await select('#parent');const before=await read('#a,#b');assert((await command()).ok);sameRelative(before,await read('#a,#b'));await tight('#parent','#a,#b');near((await read('#parent'))[0].width,244);
});
await test('F05 Flex 水平/垂直、居中与反向排列：保留 gap 和 Flex',async()=>{
  for(const direction of ['row','column','row-reverse','column-reverse']){
    await load(`<div id="parent" class="box" style="display:flex;flex-direction:${direction};gap:28px;align-items:center;justify-content:center;padding:24px;width:650px;height:420px"><div id="a" class="item" style="flex:none;width:120px;height:60px">A</div><div id="b" class="item" style="flex:none;width:160px;height:90px">B</div></div>`);await select('#parent');const before=await read('#a,#b'),r=await command();assert(r.ok,JSON.stringify(r));sameRelative(before,await read('#a,#b'));await tight('#parent','#a,#b');assert.equal((await read('#parent'))[0].display,'flex');assert.equal((await read('#parent'))[0].gap,'28px');
  }
});
await test('F06 固定轨道 Grid 保留网格与 gap',async()=>{
  await load('<div id="parent" class="box" style="display:grid;grid-template-columns:100px 140px;grid-template-rows:60px 60px;gap:20px;padding:30px;width:600px;height:400px;justify-content:center;align-content:center"><div id="a" class="item"></div><div id="b" class="item"></div><div id="c" class="item"></div><div id="d" class="item"></div></div>');await select('#parent');const before=await read('.item');const r=await command();assert(r.ok,JSON.stringify(r));sameRelative(before,await read('.item'));await tight('#parent','.item');assert.equal((await read('#parent'))[0].display,'grid');
});
await test('F07 百分比尺寸不能静默缩小；取消无变更，确认后保留排布',async()=>{
  await load('<div id="parent" class="box" style="position:absolute;left:90px;top:90px;width:500px;height:300px;padding:20px;display:flex;gap:20px;align-items:start"><div id="a" class="item" style="flex:none;width:40%;height:80px">百分比</div><div id="b" class="item" style="flex:none;width:60px;height:100px">B</div></div>');await select('#parent');const before=await state(),children=await read('.item');await fit();await page.locator('#dialog[open]').waitFor();assert.deepEqual(await state(),before);await close();assert.deepEqual(await state(),before);
  const rejected=await command();assert.equal(rejected.ok,false);assert.equal(rejected.error.code,'CONFIRMATION_REQUIRED');assert.deepEqual(await state(),before);await fit();await confirm();assert.equal(await page.locator('#dialog').isVisible(),false);sameRelative(children,await read('.item'));await tight('#parent','.item');assert.equal((await read('#parent'))[0].display,'block');assert.equal((await state()).history,before.history+1);
});
await test('F08 多选容器一次处理一次撤回；一个失败时整批不写',async()=>{
  await load(free+'<div id="other" class="box" style="position:absolute;left:800px;top:100px;width:400px;height:300px;padding:30px;display:flex"><div class="item" style="width:80px;height:50px;flex:none">C</div></div>');await select('#parent,#other');assert((await command()).ok);assert.equal((await state()).history,1);near((await read('#other'))[0].width,80);await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);near((await read('#parent'))[0].width,600);near((await read('#other'))[0].width,400);
  await page.evaluate(()=>htmlStudio.doc.querySelector('#other .item').style.width='50%');await select('#parent,#other');const before=await state();const rejected=await command();assert.equal(rejected.ok,false);assert.deepEqual(await state(),before);
});
await test('F09 旋转/缩放父级与容器本身：按局部宽高贴合',async()=>{
  await load('<div style="position:absolute;left:120px;top:100px;transform:rotate(12deg) scale(.8);transform-origin:0 0">'+free.replace('left:150px;top:100px;','left:20px;top:20px;transform:rotate(-5deg);')+'</div>');await select('#parent');const before=await read('#a,#b'),r=await command();assert(r.ok,JSON.stringify(r));const after=await read('#a,#b');sameRelative(before,after);for(let i=0;i<before.length;i++){near(before[i].rect.x,after[i].rect.x);near(before[i].rect.y,after[i].rect.y);}near((await read('#parent'))[0].width,296);near((await read('#parent'))[0].height,166);
});
await test('F10 嵌套溢出元素进入边界计算',async()=>{
  await load('<div id="parent" style="position:relative;width:700px;height:500px;padding:30px"><div id="a" class="item" style="position:relative;width:200px;height:100px"><div id="b" style="position:absolute;left:180px;top:70px;width:80px;height:60px;background:red"></div></div></div>');await select('#parent');assert((await command()).ok);await tight('#parent','#a,#b');near((await read('#parent'))[0].width,260);near((await read('#parent'))[0].height,130);
});
await test('F11 空/锁定/伪元素/整页/参数错误均不部分写入',async()=>{
  for(const html of ['<div id="parent" style="width:300px;height:200px"></div>',free.replace('id="a"','id="a" data-hs-locked="true"'),'<style>#parent:before{content:"";position:absolute;width:20px;height:20px}</style>'+free]){await load(html);await select('#parent');const before=await state(),r=await command();assert(!r.ok);assert.deepEqual(await state(),before);}
  await load(free);await select('#parent');const before=await state();for(const geometry of [{fitContent:false},{fitContent:true,width:10}]){const r=await command({geometry});assert.equal(r.error.code,'INVALID_ARGUMENT');}assert.deepEqual(await state(),before);
});
await test('F12 !important / min-max / flex-grow 约束不覆盖目标尺寸',async()=>{
  await load('<style>#parent{width:600px!important;height:350px!important;padding:30px!important;min-width:600px;min-height:350px}</style>'+free);await select('#parent');assert((await command()).ok);await tight('#parent','#a,#b');near((await read('#parent'))[0].width,296);
});
await test('F13 预览、导出与重开保持贴合尺寸和子元素',async()=>{
  const before=await read('#parent,#a,#b');await page.locator('#preview-button').click();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');near(await page.frameLocator('#preview-frame').locator('#parent').evaluate(n=>n.getBoundingClientRect().width),296);await page.locator('#preview-button').click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-button').click()]);const file=path.join(qa,'fit-export.html');await download.saveAs(file);const exported=await context.newPage();await exported.goto(pathToFileURL(path.resolve(file)).href);near(await exported.locator('#parent').evaluate(n=>n.getBoundingClientRect().width),296);await exported.close();await load(await fs.readFile(file,'utf8'));sameRelative(before,await read('#parent,#a,#b'));
});
await test('F14 裁剪内容只计算裁剪框，隐藏内容不错误增大容器',async()=>{
  await load('<div id="parent" style="width:600px;height:400px;padding:20px"><div id="a" class="item" style="position:relative;width:160px;height:80px;overflow:hidden"><div style="position:absolute;width:900px;height:600px"></div></div><div style="visibility:hidden;position:absolute;width:2000px;height:2000px"></div></div>');await select('#parent');const r=await command();assert(r.ok,JSON.stringify(r));near((await read('#parent'))[0].width,160);near((await read('#parent'))[0].height,80);assert.equal(await page.evaluate(()=>htmlStudio.style(htmlStudio.doc.querySelector('#a')).overflow),'hidden');
});
await test('F15 Flex 多行与自动轨道 Grid：需要确认后保留每个子元素原始排布',async()=>{
  for(const display of ['flex','grid']){
    await load(`<div id="parent" style="display:${display};flex-wrap:wrap;grid-template-columns:100px 100px;gap:20px;padding:30px;width:250px;height:350px">${[1,2,3,4].map(i=>`<div class="item" style="flex:none;width:100px;height:60px">${i}</div>`).join('')}</div>`);await select('#parent');const before=await read('.item'),saved=await state();let r=await command();if(!r.ok){assert.equal(r.error.code,'CONFIRMATION_REQUIRED');assert.deepEqual(await state(),saved);r=await command({acceptLayoutChange:true});}assert(r.ok,JSON.stringify(r));sameRelative(before,await read('.item'));await tight('#parent','.item');
  }
});
await test('F16 直接文字与行内富文本容器按行框计算，不破坏文字格式',async()=>{
  for(const text of ['一段文字','文字 <strong>加粗</strong>']){await load(`<div id="parent" style="width:600px;height:200px;padding:20px;font:24px/32px Arial">${text}</div>`);await select('#parent');const r=await command();assert(r.ok,JSON.stringify(r));near((await read('#parent'))[0].height,32);assert.equal((await read('#parent'))[0].padding,'0px');if(text.includes('strong'))assert.equal(await page.evaluate(()=>htmlStudio.doc.querySelector('#parent strong').textContent),'加粗');}
});
if(process.env.DECK_FILE)await test('F17 真实报告第19页：图表卡片及三张指标卡适应后内容、间距与预览正常',async()=>{
  const html=await fs.readFile(process.env.DECK_FILE,'utf8');await page.evaluate(async html=>{await htmlStudio.newDocument(html,'真实报告容器验证');htmlStudio.pages.show(18);htmlStudio.zoomTo(.45)},html);
  const ids=await page.evaluate(()=>[...htmlStudio.pageRoot.querySelectorAll('.nb-card')].map(n=>htmlStudio.id(n)));assert.equal(ids.length,4);
  for(const id of ids){await page.evaluate(id=>htmlStudio.select([id]),id);const before=await page.evaluate(id=>[...htmlStudio.get(id).children].map(n=>({rect:htmlStudio.rect(n),text:n.textContent})),id);let r=await command();if(!r.ok){assert.equal(r.error.code,'CONFIRMATION_REQUIRED',JSON.stringify(r));r=await command({acceptLayoutChange:true});}assert(r.ok,JSON.stringify(r));const after=await page.evaluate(id=>[...htmlStudio.get(id).children].map(n=>({rect:htmlStudio.rect(n),text:n.textContent})),id);sameRelative(before,after);}
  await page.screenshot({path:path.join(qa,'real-report-fit.png')});await page.locator('#preview-button').click();await page.waitForFunction(()=>htmlStudio.previewStatus?.state==='ready');assert(await page.frameLocator('#preview-frame').locator('.slide').nth(18).isVisible());await page.locator('#preview-button').click();
});
assert.deepEqual(errors,[]);
}catch(e){console.error(e);process.exitCode=1;}finally{await fs.writeFile(path.join(qa,'results.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),results,errors},null,2));await browser.close();}
