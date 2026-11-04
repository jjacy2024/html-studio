import { acknowledgeCompatibility } from "./compatibility-support.mjs";
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const baseline = process.env.PERF_BASELINE === '1';
const base = process.env.TEST_URL || pathToFileURL(path.resolve(process.env.EDITOR_FILE || 'HTML Studio.html')).href;
const reportPath = process.env.PERF_REPORT || 'qa/performance-results.json';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [], cleanup = {};
async function closeBounded(name,close) {
  let timer;try{await Promise.race([close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cleanup timeout after 10 seconds')),10000);})]);cleanup[name]='closed';}
  catch(error){cleanup[name]=error.message;console.warn(name+': '+error.message);}
  finally{clearTimeout(timer);}
}
const stats = (values) => {
  const sorted = [...values].sort((a,b) => a-b);
  return { count: sorted.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], max: sorted.at(-1) };
};
async function test(name, fn) {
  if(process.env.PERF_CASE && !name.startsWith(process.env.PERF_CASE))return;
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [], result = { name, pass: false };
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  // Offline behaviour must be deterministic; external Google Fonts is not part of the benchmark.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.abort());
  let timer;
  try {
    await Promise.race([(async () => {
      await page.goto(base); await page.waitForFunction(() => window.htmlStudio?.doc && !htmlStudio.loading);
      await page.evaluate(() => htmlStudio.ready);
      await fn(page, result);
      assert.deepEqual(errors, []);
      result.pass = true;
    })(), new Promise((_, reject) => timer = setTimeout(() => reject(Error('Performance case exceeded 120 seconds')), 120000))]);
    console.log('PASS', name);
  } catch (e) {
    result.error = e.message; process.exitCode = 1; console.error('FAIL', name, e.message.split('\n')[0]);
  } finally { clearTimeout(timer); results.push(result); await closeBounded(name,()=>context.close()); }
}
try {
  await test('P01 12 MiB resource: repeated edits and undo storage', async (page, result) => {
    result.metrics = await page.evaluate(async () => {
      const e = htmlStudio;
      const data = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"></svg>' + ' '.repeat(12 * 1024 * 1024));
      const start = performance.now();
      await e.newDocument('<h1>Resource stress</h1><img src="' + data + '">', 'Resource stress');
      const loadMs = performance.now() - start;
      e.select([e.id(e.doc.querySelector('h1'))]);
      const edits = [];
      for (let i=0; i<8; i++) { const t = performance.now(); e.property('fontSize', String(31+i)); edits.push(performance.now()-t); await new Promise(r => setTimeout(r, 10)); }
      return { loadMs, edits, historyStates: e.history.length, historyChars: e.history.reduce((n,h) => n+h.html.length, 0), assetBytes: e.assets ? [...e.assets.entries.values()].reduce((n,a) => n+a.blob.size,0) : null };
    });
    result.metrics.editTiming = stats(result.metrics.edits);
    if (!baseline) { assert.equal(result.metrics.historyStates,9); assert.ok(result.metrics.historyChars < 1000000); }
  });
  await test('P02 3000-layer page: multi-selection, 20 edits, render responsiveness', async (page, result) => {
    result.metrics = await page.evaluate(async () => {
      const e = htmlStudio;
      const html = '<style>p{position:absolute;margin:0;font-size:12px}</style>' + Array.from({length:3000},(_,i) => `<p style="left:${i%50*20}px;top:${Math.floor(i/50)*14}px">${i}</p>`).join('');
      const start = performance.now(); await e.newDocument(html,'Dense page'); const loadMs = performance.now()-start;
      e.select([...e.doc.querySelectorAll('p')].slice(0,25).map(el=>e.id(el)));
      const edits=[];
      for(let i=0;i<20;i++) { const t=performance.now();e.property('opacity',String(60+i));edits.push(performance.now()-t);await new Promise(r=>requestAnimationFrame(r)); }
      return { loadMs, layers:e.doc.querySelectorAll('[data-hs-id]').length, edits, selected:e.nodes.length };
    });
    result.metrics.editTiming=stats(result.metrics.edits);
    assert.equal(result.metrics.selected,25);
    assert.ok(result.metrics.editTiming.max<1500,'An edit blocked the main thread for >1.5s');
    assert.ok(result.metrics.loadMs<10000,'Dense page load exceeded 10s');
  });
  await test('P03 100 edits, 20 history reloads, 20 preview cycles stay bounded', async (page,result) => {
    result.metrics=await page.evaluate(async()=>{
      const e=htmlStudio;
      await e.newDocument('<h1>Cycles</h1><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZ2h0PSIxMiI+PC9zdmc+">');
      e.select([e.id(e.doc.querySelector('h1'))]);
      const start=performance.now();
      for(let i=0;i<100;i++){e.property('fontSize',String(20+i));if(i%10===0)await new Promise(r=>setTimeout(r,0));}
      for(let i=0;i<10;i++)await e.undo();
      for(let i=0;i<10;i++)await e.redo();
      for(let i=0;i<20;i++){e.togglePreview(true);await new Promise(r=>setTimeout(r,25));e.togglePreview(false);}
      return { totalMs:performance.now()-start, states:e.history.length, chars:e.history.reduce((n,h)=>n+h.html.length,0), assets:e.assets?.entries.size, size:e.style(e.nodes[0]).fontSize, editing:!e.preview&&!e.loading };
    });
    assert.equal(result.metrics.size,'119px');assert.equal(result.metrics.states,60);assert.ok(result.metrics.editing);
    if(!baseline)assert.equal(result.metrics.assets,1);
  });
  if(process.env.DECK_FILE) await test('P04 Real 31-page deck with local resources: every page, export and draft recovery', async(page,result)=>{
    const deckPath=path.resolve(process.env.DECK_FILE),root=path.dirname(deckPath),source=await fs.readFile(deckPath,'utf8');
    const references=[...new Set([...source.matchAll(/(?:src|href|poster|data-motion-src)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)].map(m=>m[1]||m[2]).filter(x=>x&&!x.includes('${')&&!/^(?:[a-z]+:|\/\/|#)/i.test(x)))];
    const files=[deckPath],missing=[];
    for(const ref of references){const full=path.resolve(root,decodeURIComponent(ref.split(/[?#]/)[0]));try{if((await fs.stat(full)).isFile())files.push(full);}catch{missing.push(ref);}}
    const unique=[...new Set(files)],relative=unique.map(f=>'deck/'+path.relative(root,f).split(path.sep).join('/'));
    result.resources={files:unique.length-1,bytes:(await Promise.all(unique.slice(1).map(async f=>(await fs.stat(f)).size))).reduce((a,b)=>a+b,0),missing};
    await page.evaluate(()=>{const input=document.createElement('input');input.id='qa-resources';input.type='file';input.multiple=true;input.hidden=true;document.body.append(input);});
    await page.locator('#qa-resources').setInputFiles(unique);
    const importStart=Date.now();
    await page.evaluate(async relative=>{
      const files=[...document.querySelector('#qa-resources').files];files.forEach((f,i)=>Object.defineProperty(f,'webkitRelativePath',{value:relative[i]}));
      await htmlStudio.importFiles(files);
    },relative);
    if(unique.filter(f=>/\.html?$/i.test(f)).length>1)await page.locator('[data-entry]').filter({hasText:'deck/'+path.basename(deckPath)}).click();
    await page.waitForFunction(name=>htmlStudio.name===name&&!htmlStudio.loading,path.basename(deckPath,'.html'),{timeout:45000});
    await acknowledgeCompatibility(page);
    result.metrics={importMs:Date.now()-importStart,pages:[],warnings:await page.evaluate(()=>htmlStudio.warnings)};
    assert.equal(await page.evaluate(()=>htmlStudio.pages.pages.length),31);
    for(let i=0;i<31;i++){
      const measurement=await page.evaluate(index=>{
        const e=htmlStudio,t=performance.now();e.switchPage(index);const switchMs=performance.now()-t;
        const title=e.pageRoot.querySelector('h1,h2,h3,p,span');const s=performance.now();e.select([e.id(title)]);const selectMs=performance.now()-s;
        const p=performance.now();e.property('fontSize','37');const editMs=performance.now()-p;
        return {page:index+1,switchMs,selectMs,editMs,size:e.style(title).fontSize};
      },i);
      assert.equal(measurement.size,'37px');result.metrics.pages.push(measurement);
      await page.waitForTimeout(10);
    }
    result.metrics.switchTiming=stats(result.metrics.pages.map(p=>p.switchMs));
    result.metrics.editTiming=stats(result.metrics.pages.map(p=>p.editMs));
    result.metrics.history=await page.evaluate(()=>({states:htmlStudio.history.length,chars:htmlStudio.history.reduce((n,h)=>n+h.html.length,0),assetCount:htmlStudio.assets?.entries.size}));
    assert.ok(result.metrics.editTiming.max<1500);
    await page.waitForFunction(()=>document.querySelector('#save-indicator').textContent.includes('已存'),null,{timeout:30000});
    if(!baseline){
      result.metrics.previewPages=[];
      const videoPages=await page.evaluate(()=>htmlStudio.pages.pages.map((el,i)=>el.querySelector('video')?i:-1).filter(i=>i>=0));
      assert.ok(videoPages.length>0,'The real-deck fixture must contain a video page');
      for(const index of [...new Set([...videoPages,24,30])]) {
        const start=Date.now();await page.evaluate(index=>{htmlStudio.switchPage(index);htmlStudio.togglePreview(true);},index);
        const frame=page.frameLocator('#preview-frame');
        await frame.locator('.slide.active').waitFor({state:'visible'});
        await frame.locator('html').evaluate((el,index)=>new Promise((resolve,reject)=>{
          const started=performance.now();const check=()=>{
            if(window.deck?.current===index)return resolve();
            if(performance.now()-started>8000)return reject(Error('Preview page did not settle: '+JSON.stringify({current:window.deck?.current,error:window.deckInitError,ready:document.readyState})));
            setTimeout(check,20);
          };check();
        }),index);
        const assets=await frame.locator('.slide.active').evaluate(async slide=>{
          const images=[...slide.querySelectorAll('img')].filter(el=>el.src.startsWith('blob:'));
          await Promise.all(images.map(el=>el.decode()));
          const videos=[...slide.querySelectorAll('video')];
          await Promise.all(videos.map(el=>el.readyState>=1?Promise.resolve():new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(Error('Video metadata timeout')),8000);
            el.addEventListener('loadedmetadata',()=>{clearTimeout(timer);resolve();},{once:true});
            el.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Video resource failed'));},{once:true});
          })));
          return {images:images.length,videos:videos.length};
        });
        if(videoPages.includes(index))assert.ok(assets.videos>0,'Expected video resources on the sampled page');
        result.metrics.previewPages.push({page:index+1,ms:Date.now()-start,...assets});
        await page.evaluate(()=>htmlStudio.togglePreview(false));
      }
      const saveStart=Date.now();
      const [download]=await Promise.all([page.waitForEvent('download',{timeout:45000}),page.locator('#export-button').click()]);
      const exported=path.resolve('qa/audit-20261028/real-deck-export.html');await download.saveAs(exported);
      result.metrics.exportMs=Date.now()-saveStart;result.metrics.exportBytes=(await fs.stat(exported)).size;
      const text=await fs.readFile(exported,'utf8');assert.ok(!text.includes('blob:'));assert.ok(text.includes('data:video/'));assert.ok(text.includes('data:image/'));
      const snapshot=await page.evaluate(()=>({pages:htmlStudio.pages.pages.length,index:htmlStudio.pages.index,imgs:[...htmlStudio.doc.images].filter(i=>i.src.startsWith('blob:')).length}));
      await page.reload();await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await page.evaluate(()=>htmlStudio.ready);
      const restored=await page.evaluate(()=>({pages:htmlStudio.pages.pages.length,index:htmlStudio.pages.index,imgs:[...htmlStudio.doc.images].filter(i=>i.src.startsWith('blob:')).length}));assert.deepEqual(restored,snapshot);
      await page.screenshot({path:'qa/audit-20261028/real-deck-page31.png'});
    }
  });
} finally {
  await fs.mkdir(path.dirname(reportPath),{recursive:true});
  const version=await browser.version(),writeReport=()=>fs.writeFile(reportPath,JSON.stringify({date:new Date().toISOString(),browser:version,baseline,results,cleanup,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length},null,2));
  await writeReport();await closeBounded('browser',()=>browser.close());cleanup.forcedExit=Object.values(cleanup).some(value=>value!=='closed');await writeReport();if(cleanup.forcedExit)process.exit(process.exitCode||0);
}
