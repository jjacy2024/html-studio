import { acknowledgeCompatibility } from "./compatibility-support.mjs";
import fs from 'node:fs/promises';import path from 'node:path';
export async function importSample(page,sample){
 if(sample.folder){await page.locator('#folder-input').setInputFiles(sample.folder)}
 else if(sample.id==='private-deck'){
  const file=path.resolve(sample.file),root=path.dirname(file),source=await fs.readFile(file,'utf8');
  const references=[...new Set([...source.matchAll(/(?:src|href|poster|data-motion-src)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)].map(m=>m[1]||m[2]).filter(x=>x&&!x.includes('${')&&!/^(?:[a-z]+:|\/\/|#)/i.test(x)))];
  const files=[file];for(const ref of references){const f=path.resolve(root,decodeURIComponent(ref.split(/[?#]/)[0]));try{if((await fs.stat(f)).isFile())files.push(f)}catch{}}
  const unique=[...new Set(files)],relative=unique.map(f=>'deck/'+path.relative(root,f).split(path.sep).join('/'));
  await page.evaluate(()=>{const i=document.createElement('input');i.id='static-resource-input';i.type='file';i.multiple=true;i.hidden=true;document.body.append(i)});await page.locator('#static-resource-input').setInputFiles(unique);
  await page.evaluate(async relative=>{const files=[...document.querySelector('#static-resource-input').files];files.forEach((f,i)=>Object.defineProperty(f,'webkitRelativePath',{value:relative[i]}));await htmlStudio.importFiles(files)},relative);
  if(unique.filter(f=>/\.html?$/i.test(f)).length>1)await page.locator('[data-entry]').filter({hasText:'deck/'+path.basename(file)}).click();
 }else await page.locator('#file-input').setInputFiles(sample.file);
 await page.waitForFunction(name=>htmlStudio.name===name&&!htmlStudio.loading,sample.folder?'index':path.basename(sample.file).replace(/\.html?$/i,''),{timeout:45000});
 await acknowledgeCompatibility(page);
}
