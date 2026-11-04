import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { templateLibrary } from '../dist/templates.js';
import { bundledFontSummary, bundledFontStylesheets, bundledFontFiles, bundledFontSources } from '../dist/template-font-data.js';
import { replaceTemplateFontLinks, localizeTemplateFonts, onlineTemplateFonts, templateFontIds } from '../dist/template-fonts.js';

const root=process.cwd(), dir=path.resolve('qa/template-fonts-v0.2.2'); await fs.mkdir(dir,{recursive:true});
const manifest=JSON.parse(await fs.readFile('dist/vendor/fonts/manifest.json','utf8'));
const results=[], errors=[], network=[], exportedFonts=new Set();
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1480,height:1000},acceptDownloads:true});
context.on('request',request=>{if(/^https?:/.test(request.url()))network.push(request.url());});
const downloadRecords = new Map(manifest.fonts.map(r=>[r.url,r]));
const fetched = new Set();let inFlight=0,maxConcurrent=0;
await context.route('https://fonts.gstatic.com/**', async route => {
  inFlight++;maxConcurrent=Math.max(maxConcurrent,inFlight);
  const record=downloadRecords.get(route.request().url());
  assert.ok(record, 'Unknown font source'); fetched.add(record.sha256);
  await route.fulfill({status:200,contentType:'font/woff2',headers:{'Access-Control-Allow-Origin':'*'},body:await fs.readFile(path.join('dist/vendor/fonts',record.file))});
  inFlight--;
});
const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
const test=async(name,run)=>{const start=Date.now();try{const evidence=await run();results.push({name,pass:true,ms:Date.now()-start,...evidence});console.log('PASS',name);}catch(error){results.push({name,pass:false,error:error.stack});console.error('FAIL',name,error.message);throw error;}};
async function fontState(doc) {
  const faces=[...doc.fonts];
  await Promise.all(faces.map(face=>face.load()));
  await doc.fonts.ready;
  return {count:faces.length,families:[...new Set(faces.map(f=>f.family.replace(/^["']|["']$/g,'')))].sort(),failed:faces.filter(f=>f.status!=='loaded').map(f=>f.family)};
}
const fontFunction=fontState.toString();
const expectedFamilies=slug=>[...new Set(manifest.templates[slug].flatMap(url=>bundledFontStylesheets[url].families))].sort();
async function exportFile(filename) {
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-button').click()]);
  const dest=path.join(dir,filename);await download.saveAs(dest);return dest;
}
try {
  await page.goto(pathToFileURL(path.resolve('HTML Studio.html')).href);
  await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await page.evaluate(()=>htmlStudio.ready);
  await test('F01 Lightweight bundle has 3 core families, verified source records and all 50 licenses',async()=>{
    assert.equal(bundledFontSummary.families.length,50);assert.equal(manifest.licenses.length,50);
    assert.deepEqual(bundledFontSummary.embeddedFamilies,['Inter','JetBrains Mono','Space Grotesk']);
    assert.equal(Object.keys(bundledFontFiles).length,28);
    assert.ok((await fs.stat('HTML Studio.html')).size < 10000000);
    for(const record of manifest.fonts){
      const bytes=bundledFontFiles[record.sha256]?Buffer.from(bundledFontFiles[record.sha256],'base64'):await fs.readFile(path.join('dist/vendor/fonts',record.file));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
      assert.equal(bundledFontSources[record.sha256].bytes,bytes.length);
    }
    const url=Object.keys(bundledFontStylesheets)[0];
    const script=`<script>const template='<link rel="stylesheet" href="${url}">';</script>`;
    assert.equal(replaceTemplateFontLinks(script),script);
    const id=Object.keys(bundledFontSources)[0];
    const sourceScript=`<script>const css='@font-face{src:url("studio-font:${id}")}';</script>`;
    assert.equal(localizeTemplateFonts(sourceScript,{}),sourceScript);assert.equal(onlineTemplateFonts(sourceScript),sourceScript);assert.deepEqual(templateFontIds(sourceScript),[]);
    const unknown='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unknown+Font">';
    assert.equal(replaceTemplateFontLinks(unknown),unknown);
  });
  await test('H01 Background queue downloads 592 verified files with at most two concurrent requests; pause and resume work',async()=>{
    await page.locator('#font-status').click();await page.locator('#font-pause').click();
    assert.match(await page.locator('#font-library-state').textContent(),/已暂停/);
    await page.locator('#font-resume').click();
    await page.waitForFunction(()=>document.querySelector('#font-library-state')?.textContent.includes('620 / 620'),{},{timeout:60000});
    assert.equal(fetched.size,592);assert.ok(maxConcurrent<=2);
    await page.locator('#dialog-close').click();
    return {downloaded:fetched.size,maxConcurrent,source:'Deterministic HTTP fixtures using original verified font bytes'};
  });
  await test('H02 Reload offline restores persistent font cache without new downloads',async()=>{
    await context.setOffline(true);await context.unroute('https://fonts.gstatic.com/**');network.length=0;
    await page.reload();await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);
    await page.locator('#font-status').click();await page.waitForFunction(()=>document.querySelector('#font-library-state')?.textContent.includes('620 / 620'));
    await page.locator('#dialog-close').click();assert.deepEqual(network,[]);
  });
  for(const item of templateLibrary) await test(`F02 ${item.slug}: cached edit, template preview and exported fonts load without network`,async()=>{
    const expected=expectedFamilies(item.slug);
    await page.evaluate(slug=>htmlStudio.createFromTemplate(slug),item.slug);
    const editing=await page.evaluate(async source=>{const check=eval('('+source+')');return check(htmlStudio.doc);},fontFunction);
    assert.deepEqual(editing.families,expected);assert.deepEqual(editing.failed,[]);
    const history=await page.evaluate(()=>({length:htmlStudio.history[0].html.length,base64:htmlStudio.history[0].html.includes('data:font/woff2;base64,')}));
    assert.equal(history.base64,false);
    const assetsBefore=await page.evaluate(()=>htmlStudio.assets.entries.size);
    await page.locator('#new-button').click();await page.locator(`[data-template="${item.slug}"]`).click();
    // Opening the dialog first loads its default template. Selecting another
    // prepares assets asynchronously, so existing slides can belong to that
    // default document. Wait for the selected document, not just any slide.
    const expectedTitle=await page.evaluate(html=>new DOMParser().parseFromString(html,'text/html').title,item.html);
    const previewDocument=await (await page.locator('#template-preview').elementHandle()).contentFrame();
    await previewDocument.waitForFunction(title=>document.title===title&&document.readyState==='complete',expectedTitle);
    const frame=page.frameLocator('#template-preview');await frame.locator('.slide,deck-stage').first().waitFor({state:'attached'});
    const preview=await frame.locator('body').evaluate(async(_,source)=>{const check=eval('('+source+')');return check(document);},fontFunction);
    assert.deepEqual(preview.families,expected);assert.deepEqual(preview.failed,[]);
    if(item.slug==='blue-professional'){await page.waitForTimeout(900);await page.screenshot({path:path.join(dir,'offline-template-preview.png')});}
    await page.locator('#dialog-close').click();assert.equal(await page.evaluate(()=>htmlStudio.assets.entries.size),assetsBefore);
    const dest=await exportFile(item.slug+'.html'),html=await fs.readFile(dest,'utf8');
    assert.ok(!html.includes('studio-font:'));assert.ok(!/blob:[a-zA-Z0-9:/._-]+/.test(html));
    for(const m of html.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g))exportedFonts.add(createHash('sha256').update(Buffer.from(m[1],'base64')).digest('hex'));
    const exported=await context.newPage();exported.on('pageerror',e=>errors.push(e.message));
    await exported.goto(pathToFileURL(dest).href);
    const portable=await exported.evaluate(async source=>{const check=eval('('+source+')');return check(document);},fontFunction);
    assert.deepEqual(portable.families,expected);assert.deepEqual(portable.failed,[]);await exported.close();
    return {families:expected,fontFaces:editing.count,historyBytes:history.length,exportBytes:Buffer.byteLength(html)};
  });
  await test('F03 Chinese and Japanese text is rendered by actual custom fonts, not a system fallback',async()=>{
    const cases=[['signal','Noto Sans SC','离线字体测试数据分析汇报'],['signal','Noto Serif SC','独立文档保存导出中文'],['sakura-chroma','Noto Sans JP','日本語フォント東京大阪']];
    const client=await context.newCDPSession(page);await client.send('DOM.enable');await client.send('CSS.enable');const proof=[];
    for(const [slug,family,text] of cases){
      await page.evaluate(slug=>htmlStudio.createFromTemplate(slug),slug);
      await page.evaluate(async({family,text})=>{const d=htmlStudio.doc,p=d.createElement('div');p.id='offline-font-probe';p.textContent=text;p.style.cssText=`position:fixed;left:10px;top:10px;font-family:"${family}";font-size:28px;font-weight:500;z-index:999999;background:white;color:black`;d.body.append(p);await d.fonts.load(`500 28px "${family}"`,text);await d.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));htmlStudio.select([]);},{family,text});
      const tree=await client.send('DOM.getDocument',{depth:-1,pierce:true});
      const find=node=>{if(node.attributes?.some((value,i)=>value==='id'&&node.attributes[i+1]==='offline-font-probe'))return node;for(const child of [...(node.children||[]),...(node.shadowRoots||[]),...(node.contentDocument?[node.contentDocument]:[])]){const result=find(child);if(result)return result;}};
      const node=find(tree.root);assert.ok(node);const data=await client.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});
      assert.ok(data.fonts.some(f=>f.isCustomFont&&f.glyphCount>0));assert.ok(data.fonts.every(f=>f.isCustomFont));proof.push({family,fonts:data.fonts});
    }
    await client.detach();return{proof};
  });
  await test('F04 Older original template imports are localized; project reopen, undo and normal preview retain fonts',async()=>{
    await page.evaluate(()=>htmlStudio.dirty=false);
    await page.locator('#file-input').setInputFiles(path.resolve('../downloads/beautiful-html-templates-34/templates/blue-professional/template.html'));
    await page.waitForFunction(()=>!htmlStudio.loading&&htmlStudio.name==='template');
    await page.waitForFunction(()=>htmlStudio.compatibility!==null);if(await page.locator('#dialog[open]').count())await page.locator('#dialog-close').click();
    const name=await page.evaluate(async()=>{await htmlStudio.doc.fonts.ready;const el=htmlStudio.pageRoot.querySelector('h1');htmlStudio.select([htmlStudio.id(el)]);htmlStudio.property('fontFamily','Inter');return el.textContent;});assert.ok(name);
    await page.locator('#undo').click();await page.waitForFunction(()=>!htmlStudio.loading);await page.locator('#redo').click();await page.waitForFunction(()=>!htmlStudio.loading);
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#save-button').click()]);const dest=path.join(dir,'offline-fonts.htmlstudio');await download.saveAs(dest);
    const saved=JSON.parse(await fs.readFile(dest,'utf8'));assert.ok(saved.html.includes('data:font/woff2;base64,'));
    await page.evaluate(saved=>htmlStudio.load(saved),saved);
    await page.locator('#preview-button').click();const frame=page.frameLocator('#preview-frame');await frame.locator('.slide').first().waitFor({state:'attached'});
    const state=await frame.locator('body').evaluate(async(_,source)=>eval('('+source+')')(document),fontFunction);assert.deepEqual(state.families,expectedFamilies('blue-professional'));assert.deepEqual(state.failed,[]);await page.locator('#exit-preview').click();
  });
  await test('F05 All downloaded font files round-trip into portable exports with no external requests or runtime errors',async()=>{
    assert.equal(exportedFonts.size,620);assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
    return {fontFiles:exportedFonts.size,externalRequests:network.length};
  });
}catch{process.exitCode=1;await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});}
finally{
  // Chromium can finish all font assertions but leave a context-close promise
  // pending while disposing downloaded artifacts. Keep the evidence and bound
  // teardown separately; a failed assertion must still exit nonzero.
  const cleanup={};
  const writeReport=()=>fs.writeFile(path.join(dir,'results.json'),JSON.stringify({date:new Date().toISOString(),results,errors,network,cleanup},null,2));
  await writeReport();
  const closeBounded=async(name,close)=>{
    let timer;
    try{await Promise.race([close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cleanup timeout after 10 seconds')),10000);})]);cleanup[name]='closed';}
    catch(error){cleanup[name]=error.message;console.warn(`Cleanup ${name}: ${error.message}`);}
    finally{clearTimeout(timer);}
  };
  await closeBounded('context',()=>context.close());
  await closeBounded('browser',()=>browser.close());
  cleanup.forcedExit=Object.values(cleanup).some(value=>value!=='closed');
  await writeReport();console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);
  if(cleanup.forcedExit)process.exit(process.exitCode||0);
}
