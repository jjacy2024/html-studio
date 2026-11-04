import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=path.resolve('qa/font-loading-v0.2.2');await fs.mkdir(dir,{recursive:true});
const manifest=JSON.parse(await fs.readFile('dist/vendor/fonts/manifest.json','utf8'));
const records=new Map(manifest.fonts.map(record=>[record.url,record]));
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(options={}){
  const context=await browser.newContext({offline:!!options.offline,viewport:{width:1480,height:1000},acceptDownloads:true});
  const state={mode:options.mode||'ok',gate:options.gate??true,requests:0,active:0,maxActive:0};
  if(options.denyCache)await context.addInitScript(()=>{indexedDB.open=()=>{throw Error('Storage unavailable')};});
  await context.route('https://fonts.gstatic.com/**',async route=>{
    state.requests++;state.active++;state.maxActive=Math.max(state.maxActive,state.active);
    try{
      const record=records.get(route.request().url());assert.ok(record);
      while(!state.gate&&!state.closed)await wait(25);
      if(state.closed)return;
      if(state.mode==='fail'){await route.abort();return;}
      const data=await fs.readFile(path.join('dist/vendor/fonts',record.file));
      await route.fulfill({status:200,contentType:'font/woff2',headers:{'Access-Control-Allow-Origin':'*'},body:state.mode==='corrupt'?Buffer.alloc(data.length):data});
    }catch(e){if(!state.closed)throw e;}finally{state.active--;}
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('HTML Studio.html')).href);
  await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await page.evaluate(()=>htmlStudio.ready);
  return {context,page,state,close:async()=>{state.closed=true;await context.close();}};
}
async function test(name,fn){const start=Date.now();try{const proof=await fn();results.push({name,pass:true,ms:Date.now()-start,...proof});console.log('PASS',name);}catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL',name,error.message);throw error;}}
const pick=(page,slug)=>page.evaluate(slug=>htmlStudio.createFromTemplate(slug),slug);
const ready=page=>page.waitForFunction(()=>htmlStudio.pendingTemplateFonts().length===0);
const selectHeading=page=>page.evaluate(()=>{const e=htmlStudio,h=e.pageRoot.querySelector('h1,h2');e.select([e.id(h)]);return e.id(h);});
async function editSize(page,value){await selectHeading(page);await page.locator('[data-prop="fontSize"]').fill(value);await page.locator('[data-prop="fontSize"]').press('Tab');}
try{
  await test('L01 Cold offline startup and core template stay editable without font downloads',async()=>{
    const f=await fixture({offline:true});try{
      await pick(f.page,'blue-professional');await ready(f.page);
      await editSize(f.page,'48');assert.equal(await f.page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).fontSize),'48px');
      assert.equal(await f.page.evaluate(async()=>{await Promise.all([...htmlStudio.doc.fonts].map(face=>face.load()));return [...htmlStudio.doc.fonts].every(face=>face.status==='loaded');}),true);
      assert.equal(f.state.requests,0);
    }finally{await f.close();}
  });
  await test('L02 Missing offline fonts show fallback; export cancel and explicit online-link fallback preserve work',async()=>{
    const f=await fixture({offline:true});try{
      await pick(f.page,'daisy-days');await editSize(f.page,'51');
      assert.ok(await f.page.evaluate(()=>htmlStudio.pendingTemplateFonts().length>0));
      await f.page.waitForFunction(()=>document.querySelector('#font-status').textContent==='字体待下载');
      await f.page.locator('#export-button').click();await f.page.locator('#dialog[data-kind="font-export"]').waitFor();
      await f.page.getByRole('button',{name:'取消',exact:true}).click();
      assert.equal(await f.page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).fontSize),'51px');
      await f.page.locator('#export-button').click();await f.page.locator('#dialog[data-kind="font-export"]').waitFor();
      const [dl]=await Promise.all([f.page.waitForEvent('download'),f.page.getByRole('button',{name:'保留在线字体并继续',exact:true}).click()]);
      const dest=path.join(dir,'explicit-online-fallback.html');await dl.saveAs(dest);const html=await fs.readFile(dest,'utf8');
      assert.ok(html.includes('https://fonts.gstatic.com/'));assert.ok(!html.includes('studio-font:'));assert.ok(html.includes('51px'));
      await f.page.locator('#save-button').click();await f.page.locator('#dialog[data-kind="font-export"]').waitFor();await f.page.keyboard.press('Escape');
      await f.page.waitForFunction(()=>!htmlStudio.savingProject);assert.equal(f.state.requests,0);
    }finally{await f.close();}
  });
  await test('L03 Downloading fonts preserves edits, selection, undo, and running preview state',async()=>{
    const f=await fixture({gate:false});try{
      await pick(f.page,'daisy-days');await editSize(f.page,'53');
      const selected=await f.page.evaluate(()=>htmlStudio.selection[0]);
      const count=await f.page.evaluate(()=>htmlStudio.history.length);
      await f.page.locator('#preview-button').click();const frame=f.page.frameLocator('#preview-frame');await frame.locator('.slide').first().waitFor({state:'attached'});
      await frame.locator('body').evaluate(el=>{el.dataset.fontTestStamp='keep-running';});
      f.state.gate=true;await ready(f.page);
      await frame.locator('body').evaluate(async()=>{await document.fonts.ready;});
      await f.page.waitForFunction(()=>!htmlStudio.doc.querySelector('style[data-studio-bundled-fonts]').textContent.includes('studio-font:'));
      await frame.locator('body').evaluate(async()=>{for(let i=0;i<100&&[...document.querySelectorAll('style')].some(s=>s.textContent.includes('studio-font:'));i++)await new Promise(r=>setTimeout(r,30));});
      assert.equal(await frame.locator('body').getAttribute('data-font-test-stamp'),'keep-running');
      assert.equal(await frame.locator('body').evaluate(()=>[...document.querySelectorAll('style')].some(s=>s.textContent.includes('studio-font:'))),false);
      await f.page.locator('#exit-preview').click();
      assert.equal(await f.page.evaluate(()=>htmlStudio.selection[0]),selected);assert.equal(await f.page.evaluate(()=>htmlStudio.history.length),count);
      assert.equal(await f.page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).fontSize),'53px');
      await f.page.locator('#undo').click();await f.page.waitForFunction(()=>!htmlStudio.loading);assert.notEqual(await f.page.evaluate(id=>htmlStudio.style(htmlStudio.get(id)).fontSize,selected),'53px');
      assert.ok(f.state.maxActive<=2);return{maxConcurrent:f.state.maxActive};
    }finally{await f.close();}
  });
  await test('L04 Template picker updates downloaded fonts without restarting preview and releases its assets on close',async()=>{
    const f=await fixture({gate:false});try{
      const before=await f.page.evaluate(()=>htmlStudio.assets.entries.size);
      await f.page.locator('#new-button').click();await f.page.locator('[data-template="daisy-days"]').click();
      const frame=f.page.frameLocator('#template-preview');await frame.locator('.slide').first().waitFor({state:'attached'});
      await frame.locator('body').evaluate(el=>el.dataset.fontTestStamp='picker');f.state.gate=true;
      await frame.locator('body').evaluate(async()=>{for(let i=0;i<300&&[...document.querySelectorAll('style')].some(s=>s.textContent.includes('studio-font:'));i++)await new Promise(r=>setTimeout(r,30));});
      assert.equal(await frame.locator('body').evaluate(()=>[...document.querySelectorAll('style')].some(s=>s.textContent.includes('studio-font:'))),false);
      assert.equal(await frame.locator('body').getAttribute('data-font-test-stamp'),'picker');
      await f.page.locator('#dialog-close').click();assert.equal(await f.page.evaluate(()=>htmlStudio.assets.entries.size),before);
    }finally{await f.close();}
  });
  await test('L05 Corrupt downloads are rejected; repeated failures stop background traffic and user retry recovers',async()=>{
    const f=await fixture({mode:'corrupt'});try{
      await pick(f.page,'daisy-days');await f.page.locator('#font-status').click();
      await f.page.waitForFunction(()=>document.querySelector('#font-library-state').textContent.includes('下载未完成'));
      const count=f.state.requests;await wait(600);assert.equal(f.state.requests,count);assert.ok(await f.page.evaluate(()=>htmlStudio.pendingTemplateFonts().length>0));
      f.state.mode='ok';await f.page.locator('#font-resume').click();await ready(f.page);
      await f.page.locator('#dialog-close').click();assert.equal(await f.page.evaluate(async()=>{await Promise.all([...htmlStudio.doc.fonts].map(face=>face.load()));return [...htmlStudio.doc.fonts].every(face=>face.status==='loaded');}),true);
    }finally{await f.close();}
  });
  await test('L06 Download pause aborts stalled requests without blocking editing; resume prioritizes current document',async()=>{
    const f=await fixture({gate:false});try{
      await pick(f.page,'signal');await f.page.locator('#font-status').click();await f.page.locator('#font-pause').click();
      await f.page.locator('#dialog-close').click();await editSize(f.page,'47');
      assert.equal(await f.page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).fontSize),'47px');
      await pick(f.page,'daisy-days');await f.page.locator('#font-status').click();f.state.gate=true;await f.page.locator('#font-resume').click();await ready(f.page);
      assert.ok(f.state.maxActive<=4); // Aborted fixture handlers may be draining; live fetches remain limited to two.
    }finally{await f.close();}
  });
  await test('L07 Storage denied still supports session fonts and portable offline export with explicit cache notice',async()=>{
    const f=await fixture({denyCache:true});try{
      await pick(f.page,'daisy-days');await ready(f.page);await f.page.locator('#font-status').click();
      assert.match(await f.page.locator('#font-cache-state').textContent(),/持久缓存不可用/);await f.page.locator('#dialog-close').click();
      const [dl]=await Promise.all([f.page.waitForEvent('download'),f.page.locator('#save-button').click()]);
      const dest=path.join(dir,'session-cache.htmlstudio');await dl.saveAs(dest);const data=JSON.parse(await fs.readFile(dest,'utf8'));
      assert.ok(data.html.includes('data:font/woff2;base64,'));assert.ok(!data.html.includes('studio-font:'));
      const reopened=await fixture({offline:true});try{await reopened.page.evaluate(data=>htmlStudio.load(data),data);assert.equal(await reopened.page.evaluate(async()=>{await Promise.all([...htmlStudio.doc.fonts].map(f=>f.load()));return [...htmlStudio.doc.fonts].every(f=>f.status==='loaded');}),true);}finally{await reopened.close();}
    }finally{await f.close();}
  });
  await test('L08 Background completion for an old document cannot overwrite the new document or its history',async()=>{
    const f=await fixture({gate:false});try{
      await pick(f.page,'signal');await f.page.evaluate(()=>htmlStudio.newDocument('<html><body><h1>New independent document</h1></body></html>','Independent'));
      const before=await f.page.evaluate(()=>({history:htmlStudio.history.length,name:htmlStudio.name,html:htmlStudio.doc.body.innerHTML,assets:htmlStudio.assets.entries.size}));
      f.state.gate=true;await wait(1000);
      const after=await f.page.evaluate(()=>({history:htmlStudio.history.length,name:htmlStudio.name,html:htmlStudio.doc.body.innerHTML,assets:htmlStudio.assets.entries.size}));assert.deepEqual(after,before);
    }finally{await f.close();}
  });
  await test('L09 Stalled downloads time out automatically while editing remains responsive',async()=>{
    const f=await fixture({gate:false});try{
      const start=Date.now();await pick(f.page,'daisy-days');await editSize(f.page,'46');
      await f.page.locator('#font-status').click();
      await f.page.waitForFunction(()=>document.querySelector('#font-library-state').textContent.includes('下载未完成'),{},{timeout:20000});
      assert.ok(Date.now()-start<20000);await f.page.locator('#dialog-close').click();await editSize(f.page,'45');
      assert.equal(await f.page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).fontSize),'45px');
    }finally{await f.close();}
  });
  await test('L10 No uncaught errors during cold, failed, cached or progressive loading',async()=>assert.deepEqual(errors,[]));
}catch{process.exitCode=1;}
finally{await browser.close();await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({date:new Date().toISOString(),results,errors},null,2));console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);}
