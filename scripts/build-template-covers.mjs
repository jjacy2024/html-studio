import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {templateLibrary} from '../dist/templates.js';
import {onlineTemplateFonts} from '../dist/template-fonts.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'qa/template-covers-v0.2.3');await fs.mkdir(dir,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(root,'dist/vendor/fonts/manifest.json'),'utf8'));
const fontSources=new Map(manifest.fonts.map(record=>[record.url,record]));
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:0.375,reducedMotion:'reduce'});
await context.route('**/*',async route=>{
  const record=fontSources.get(route.request().url());
  if(record)return route.fulfill({status:200,contentType:'font/woff2',headers:{'Access-Control-Allow-Origin':'*'},body:await fs.readFile(path.join(root,'dist/vendor/fonts',record.file))});
  return route.abort();
});
const covers={},results=[];
try{
  for(const item of templateLibrary){
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent(onlineTemplateFonts(item.html),{waitUntil:'load'});
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.fonts].map(f=>f.load()));});
    await page.addStyleTag({content:'*,*::before,*::after{animation-delay:0s!important;animation-duration:0.001s!important;transition:none!important}'});
    await page.waitForTimeout(160);
    const evidence=await page.evaluate(()=>{
      const slides=[...document.querySelectorAll('.slide,deck-stage > section')];
      const first=slides[0];if(!first)throw Error('Cover not found');
      const r=first.getBoundingClientRect(),s=getComputedStyle(first);
      if(s.display==='none'||s.visibility==='hidden'||r.right<=0||r.left>=1280||r.bottom<=0||r.top>=720)throw Error('First slide is not visible');
      return {title:first.textContent.trim().slice(0,100),slideCount:slides.length,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
    });
    const bytes=await page.screenshot({type:'jpeg',quality:78,path:path.join(dir,item.slug+'.jpg')});
    covers[item.slug]='data:image/jpeg;base64,'+bytes.toString('base64');
    results.push({slug:item.slug,...evidence,bytes:bytes.length,sourceSHA256:createHash('sha256').update(item.html).digest('hex'),errors});
    console.log(item.slug,bytes.length);await page.close();
  }
}finally{await browser.close();}
if(results.length!==34||results.some(r=>r.errors.length))throw Error('Cover generation incomplete');
await fs.writeFile(path.join(root,'dist/template-covers.js'),'// Generated first-slide previews; no runtime documents or font downloads needed.\nexport const templateCovers = '+JSON.stringify(covers)+';\n');
await fs.writeFile(path.join(dir,'build-report.json'),JSON.stringify({date:new Date().toISOString(),width:480,height:270,results},null,2));
console.log('Total thumbnail bytes',results.reduce((sum,r)=>sum+r.bytes,0));
