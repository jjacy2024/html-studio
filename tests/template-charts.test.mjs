import {chromium} from 'playwright';
import {templateLibrary} from '../dist/templates.js';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir='qa/template-charts';await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1512,height:982}}),results=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
await page.goto(process.env.TEST_URL||'http://127.0.0.1:4389');await page.waitForFunction(()=>window.htmlStudio?.doc&&!htmlStudio.loading);await page.evaluate(()=>htmlStudio.ready);
try{for(const t of templateLibrary.filter(t=>!process.env.TEMPLATE_FILTER||process.env.TEMPLATE_FILTER.split(',').includes(t.slug))){
  await page.evaluate(s=>htmlStudio.createFromTemplate(s),t.slug);
  const count=await page.evaluate(()=>htmlStudio.doc.querySelectorAll('[data-studio-template-chart]').length);
  if(!count)results.push({slug:t.slug,kind:'inventory',charts:0,pass:true});
  for(let i=0;i<count;i++){
    const label=t.slug+'/'+i;try{
      const before=await page.evaluate(i=>{const e=htmlStudio,n=e.doc.querySelectorAll('[data-studio-template-chart]')[i],p=e.pages.pages.findIndex(p=>p.contains(n));e.switchPage(p);e.select([e.id(n)]);e.openChartDataEditor();return{m:JSON.parse(n.getAttribute('data-studio-template-chart')),style:[...n.querySelectorAll('*')].filter(n=>n.hasAttribute('data-studio-tc-key')).map(n=>[n.getAttribute('class'),n.getAttribute('stroke-width'),n.getAttribute('rx')]),page:p};},i);
      assert.equal(await page.locator('#dialog').getAttribute('data-kind'),'template-chart-data');
      const value=before.m.items[0].value*0.7+1;
      await page.locator('[data-template-value="0"]').fill(String(value));await page.locator('[data-template-value="0"]').press('Tab');
      await page.locator('.chart-paints summary').click();const color=page.locator('[data-chart-paint-hex="0"]');await color.fill('#1357ab');await color.press('Tab');
      await page.waitForFunction(({i})=>JSON.parse(htmlStudio.doc.querySelectorAll('[data-studio-template-chart]')[i].getAttribute('data-studio-template-chart')).items[0].color==='#1357ab',{i});
      await page.locator('#dialog-close').click();
      const after=await page.evaluate(i=>{const n=htmlStudio.doc.querySelectorAll('[data-studio-template-chart]')[i];return{m:JSON.parse(n.getAttribute('data-studio-template-chart')),style:[...n.querySelectorAll('*')].filter(n=>n.hasAttribute('data-studio-tc-key')).map(n=>[n.getAttribute('class'),n.getAttribute('stroke-width'),n.getAttribute('rx')]),html:n.outerHTML};},i);
      assert.equal(after.m.items[0].value,value);assert.equal(after.m.items[0].color,'#1357ab');
      if(before.m.kind!=='pixel-bar')assert.deepEqual(after.style,before.style);
      await page.evaluate(()=>htmlStudio.undo());assert.equal(await page.evaluate(i=>JSON.parse(htmlStudio.doc.querySelectorAll('[data-studio-template-chart]')[i].getAttribute('data-studio-template-chart')).items[0].color,i),undefined);
      await page.evaluate(()=>htmlStudio.redo());
      await page.evaluate(()=>htmlStudio.togglePreview(true));
      const frame=page.frameLocator('#preview-frame');await frame.locator('[data-studio-template-chart]').nth(i).waitFor({state:'attached'});await page.waitForTimeout(1800);
      const preview=await frame.locator('[data-studio-template-chart]').nth(i).evaluate(n=>({m:JSON.parse(n.getAttribute('data-studio-template-chart')),bounds:{w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height,top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom,viewport:innerHeight,visible:(()=>{for(let p=n;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}return true;})()},nodes:[...n.querySelectorAll('[data-studio-tc-key]')].map(n=>({key:n.getAttribute('data-studio-tc-key'),height:n.getAttribute('height'),y:n.getAttribute('y'),d:n.getAttribute('d'),points:n.getAttribute('points'),dash:n.getAttribute('stroke-dasharray'),text:n.children.length?null:n.textContent,style:n.style.cssText}))}));
      assert.deepEqual(preview.m,after.m);assert.ok(preview.bounds.visible&&preview.bounds.w>0&&preview.bounds.h>0&&preview.bounds.bottom>0&&preview.bounds.top<preview.bounds.viewport,label+' visible');
      await page.evaluate(()=>htmlStudio.togglePreview(false));
      const edit=await page.evaluate(i=>[...htmlStudio.doc.querySelectorAll('[data-studio-template-chart]')[i].querySelectorAll('[data-studio-tc-key]')].map(n=>({key:n.getAttribute('data-studio-tc-key'),height:n.getAttribute('height'),y:n.getAttribute('y'),d:n.getAttribute('d'),points:n.getAttribute('points'),dash:n.getAttribute('stroke-dasharray'),text:n.children.length?null:n.textContent,style:n.style.cssText})),i);
      assert.deepEqual(preview.nodes,edit,label+' edit/preview final geometry');
      results.push({slug:t.slug,index:i,kind:before.m.kind,items:before.m.items.length,relative:before.m.relative,pass:true});console.log('PASS',label,before.m.kind);
      if(['editorial-tri-tone','scatterbrain','soft-editorial','cobalt-grid','daisy-days'].includes(t.slug))await page.screenshot({path:`${dir}/${t.slug}-${i}.png`});
    }catch(e){results.push({slug:t.slug,index:i,pass:false,error:e.stack});console.error('FAIL',label,e.message);await page.screenshot({path:`${dir}/failure-${t.slug}-${i}.png`});await page.evaluate(()=>{document.querySelector('#dialog').close();if(htmlStudio.preview)htmlStudio.togglePreview(false)});}
  }
  const roundtrip=await page.evaluate(async()=>{const {cleanDocument}=await import('/document.js');const {readTemplateChart}=await import('/template-charts-core.js');const html=await htmlStudio.portableHTML(cleanDocument(htmlStudio.doc,{exporting:true}),{missingFonts:'online'}),doc=new DOMParser().parseFromString(html,'text/html');return{models:[...doc.querySelectorAll('[data-studio-template-chart]')].map(readTemplateChart),runtime:!!doc.querySelector('[data-studio-template-motion-runtime]'),html};});
  assert.equal(roundtrip.models.length,count);if(count)assert.ok(roundtrip.runtime);await fs.writeFile(`${dir}/${t.slug}.html`,roundtrip.html);
 }
}finally{await fs.writeFile(`${dir}/results.json`,JSON.stringify({results,errors},null,2));await browser.close();if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;console.log('TOTAL',results.length,'FAIL',results.filter(r=>!r.pass).length,'ERRORS',errors);}
