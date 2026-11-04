import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1512,height:982}}),results=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const html='<!doctype html><style>body{margin:0;font:20px sans-serif}#bottom{position:absolute;left:100px;top:5600px;width:200px;height:80px;background:#ddd}#deep{position:absolute;left:100px;top:100px;width:200px;height:60px}</style><p>Top</p><p id="bottom">Long page target</p>'+ '<div>'.repeat(24)+'<p id="deep">Deep tree target</p>'+'</div>'.repeat(24);
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS',name)}catch(e){results.push({name,pass:false,error:e.message});console.error('FAIL',name,e.message)}}
async function point(selector){return page.evaluate(selector=>{const e=htmlStudio,el=e.doc.querySelector(selector),r=el.getBoundingClientRect(),f=document.querySelector('#edit-frame').getBoundingClientRect(),z=f.width/e.doc.defaultView.innerWidth;return{x:f.x+(r.x+r.width/2)*z,y:f.y+(r.y+r.height/2)*z}},selector)}
try{
 await page.goto(pathToFileURL(path.resolve(process.env.EDITOR_FILE||'HTML Studio.html')).href);await page.evaluate(()=>htmlStudio.ready);
 await page.evaluate(async html=>{await htmlStudio.load({html,width:1080,height:6000,name:'Viewport regression'});htmlStudio.pushHistory('fixture')},html);
 for(const width of [1512,1280]){
  await page.setViewportSize({width,height:982});
  await test(`Long canvas stays scrollable at ${width}px across 50%, 100%, 200% zoom`,async()=>{
   for(const zoom of [.5,1,2]){
    await page.evaluate(zoom=>htmlStudio.zoomTo(zoom),zoom);
    const initial=await page.locator('#canvas-scroll').evaluate(el=>{el.scrollTop=0;return{client:el.clientHeight,total:el.scrollHeight,bottom:el.getBoundingClientRect().bottom,viewport:innerHeight}});
    assert.ok(initial.client<initial.total&&initial.bottom<=initial.viewport,'Canvas expanded beyond the workspace');
    await page.locator('#canvas-scroll').hover();await page.mouse.wheel(0,400);await page.waitForTimeout(100);
    assert.ok(await page.locator('#canvas-scroll').evaluate(el=>el.scrollTop>0),'Mouse wheel failed to scroll');
    const p=await point('#bottom');await page.locator('#canvas-scroll').evaluate((el,p)=>{const r=el.getBoundingClientRect();el.scrollTop+=p.y-r.y-r.height/2;el.scrollLeft+=p.x-r.x-r.width/2},p);
    const visible=await point('#bottom');await page.mouse.click(visible.x,visible.y);
    assert.ok(await page.evaluate(()=>htmlStudio.nodes[0]?.id==='bottom'),'Bottom element cannot be selected');
   }
  });
  await test(`Deep layer name can be read, clicked and auto-revealed at ${width}px`,async()=>{
   await page.evaluate(()=>{htmlStudio.zoomTo(.5);document.querySelector('#canvas-scroll').scrollTop=0;document.querySelector('#canvas-scroll').scrollLeft=0});
   const p=await point('#deep');await page.mouse.click(p.x,p.y);
   const id=await page.evaluate(()=>htmlStudio.id(htmlStudio.doc.querySelector('#deep')));
   const row=page.locator(`.layer-row[data-id="${id}"]`),name=row.locator('.layer-text');
   const state=await name.evaluate(el=>{const p=document.querySelector('#layers-pane'),r=el.getBoundingClientRect(),b=p.getBoundingClientRect();return{width:r.width,visible:r.left>=b.left&&r.right<=b.right,scroll:p.scrollLeft}});
   assert.ok(state.width>=60&&state.visible&&state.scroll>0,JSON.stringify(state));
   await page.evaluate(()=>htmlStudio.select([]));await name.click();assert.ok(await page.evaluate(id=>htmlStudio.selection.includes(id),id));
   await row.locator('[data-layer-action="lock"]').click();assert.ok(await page.evaluate(()=>htmlStudio.doc.querySelector('#deep').dataset.hsLocked));
   await row.locator('[data-layer-action="lock"]').click();
   await page.locator('#layers-pane').evaluate(pane=>pane.scrollTop=0);
   const search=await page.locator('.layer-search').evaluate(el=>{const r=el.getBoundingClientRect(),p=document.querySelector('#layers-pane').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right});
   assert.ok(search,'Layer search moved offscreen with the deep tree');
  });
 }
 await test('No browser errors or outer-page scrolling',async()=>{assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),true)});
 await page.screenshot({path:'qa/viewport.png'});
}finally{await fs.writeFile(process.env.VIEWPORT_REPORT||'qa/viewport-results.json',JSON.stringify({results,errors},null,2));await browser.close();if(results.some(r=>!r.pass))process.exitCode=1}
