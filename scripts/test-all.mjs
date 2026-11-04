import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const dir=path.resolve('qa/latest');await fs.mkdir(dir,{recursive:true});
const suites=[],env={...process.env};
for(const key of ['TEST_URL','EDITOR_FILE','PERF_BASELINE','PERF_CASE','PERF_REPORT','STABILITY_CASE','STABILITY_REPORT','MERCHANT_REPORT','VIEWPORT_REPORT','WEB_CASE','WEB_REPORT','COMPATIBILITY_REPORT','DOUBLECLICK_REPORT','AUTHORING_REPORT'])delete env[key];
let server;
async function run(name,args,extra={}) {
  const started=Date.now(),chunks=[];
  console.log(`\n[${name}]`);
  const child=spawn(process.execPath,args,{env:{...env,...extra},stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{chunks.push(data);process.stdout.write(data);});
  const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??signal));});
  clearTimeout(timer);await fs.writeFile(path.join(dir,name+'.log'),Buffer.concat(chunks));
  return {code,ms:Date.now()-started};
}
async function suite(name,file,report,extra={}){
  await fs.rm(report,{force:true});
  const runResult=await run(name,[file],extra);
  let data=null;try{data=JSON.parse(await fs.readFile(report,'utf8'));await fs.copyFile(report,path.join(dir,name+'.json'));}catch{}
  const cases=(data?.results||[]).map(r=>typeof r==='string'?{name:r,pass:true}:r);
  const pass=runResult.code===0&&!!data&&!cases.some(r=>r.pass===false);
  suites.push({name,pass,...runResult,cases,report:data});
}
try{
  const check=await run('syntax',['--check','dist/app.js']);
  if(check.code!==0)throw Error('Syntax check failed');
  for(const file of ['dist/preview-runtime.js','dist/preview-session.js','dist/assets.js','dist/document.js','dist/pages.js','dist/compatibility.js','dist/demo.js','dist/icons.js','dist/page-order.js','dist/page-thumbnails.js','dist/data-paste.js','dist/authoring.js','dist/table-editing.js','dist/data-tools.js','dist/templates.js','dist/template-font-data.js','dist/template-fonts.js','dist/font-cache.js','dist/font-ui.js','dist/template-covers.js','dist/grouping.js','dist/svg-chart.js','dist/svg-waterfall.js','dist/svg-bubble.js','dist/html-bars.js','dist/html-share.js','dist/canvas-charts.js']){
    const r=await run('syntax-'+path.basename(file),['--check',file]);if(r.code!==0)throw Error('Syntax check failed: '+file);
  }
  if((await run('build',['scripts/build-standalone.mjs'])).code!==0)throw Error('Standalone build failed');
  server=spawn(process.execPath,['server.mjs','0'],{env:{...env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Test server did not start')),5000);
    server.stdout.on('data',data=>{const m=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});
    server.once('error',reject);server.once('exit',()=>reject(Error('Test server exited')));
  });
  await suite('editor','tests/editor.test.mjs','qa/test-results.json',{TEST_URL:url});
  await suite('standalone','tests/standalone.test.mjs','qa/standalone-results.json');
  await suite('compatibility-file','tests/compatibility.test.mjs','qa/compatibility-results.json');
  await suite('compatibility-http','tests/compatibility.test.mjs','qa/compatibility-results.json',{TEST_URL:url});
  await suite('doubleclick-file','tests/doubleclick.test.mjs','qa/doubleclick-results.json');
  await suite('doubleclick-http','tests/doubleclick.test.mjs','qa/doubleclick-results.json',{TEST_URL:url});
  await suite('authoring-file','tests/authoring.test.mjs','qa/authoring-results.json');
  await suite('authoring-http','tests/authoring.test.mjs','qa/authoring-results.json',{TEST_URL:url});
  await suite('clone-layout-file','tests/clone-layout.test.mjs','qa/clone-layout-results.json');
  await suite('clone-layout-http','tests/clone-layout.test.mjs','qa/clone-layout-results.json',{TEST_URL:url});
  await suite('page-reorder-file','tests/page-reorder.test.mjs','qa/page-reorder-results.json');
  await suite('page-reorder-http','tests/page-reorder.test.mjs','qa/page-reorder-results.json',{TEST_URL:url});
  for (const [name,file,report] of [['data-paste','tests/data-paste.test.mjs','qa/data-paste-results.json'],['page-thumbnails','tests/page-thumbnails.test.mjs','qa/page-thumbnails-results.json']]) {
    await suite(name+'-file',file,report);
    await suite(name+'-http',file,report,{TEST_URL:url});
  }
  await suite('preview-file','tests/preview.test.mjs','qa/preview-results.json');
  await suite('preview-http','tests/preview.test.mjs','qa/preview-results.json',{TEST_URL:url});
  await suite('preview-native-file','tests/preview-native.test.mjs','qa/preview-native-20261031/file/results.json');
  await suite('preview-native-http','tests/preview-native.test.mjs','qa/preview-native-20261031/http/results.json',{TEST_URL:url});
  await suite('preview-diagnostics-file','tests/preview-diagnostics.test.mjs','qa/preview-diagnostics/file/results.json',{DIAGNOSTICS_REPORT_DIR:'qa/preview-diagnostics/file'});
  await suite('preview-diagnostics-http','tests/preview-diagnostics.test.mjs','qa/preview-diagnostics/http/results.json',{TEST_URL:url,DIAGNOSTICS_REPORT_DIR:'qa/preview-diagnostics/http'});
  await suite('preview-session-file','tests/preview-session.test.mjs','qa/preview-session/file/results.json',{PREVIEW_SESSION_REPORT_DIR:'qa/preview-session/file'});
  await suite('preview-session-http','tests/preview-session.test.mjs','qa/preview-session/http/results.json',{TEST_URL:url,PREVIEW_SESSION_REPORT_DIR:'qa/preview-session/http'});
  if(env.SALES_FILE){
    await suite('preview-workflow-file','tests/preview-workflow.test.mjs','qa/preview-v0.3.7/workflow-file/results.json');
    await suite('preview-workflow-http','tests/preview-workflow.test.mjs','qa/preview-v0.3.7/workflow-http/results.json',{TEST_URL:url});
  }
  if(env.PREVIEW_PROJECT){
    await suite('preview-project-file','tests/preview-project.test.mjs','qa/preview-project-20261031/file/results.json',{HEADED:''});
    await suite('preview-project-http','tests/preview-project.test.mjs','qa/preview-project-20261031/http/results.json',{TEST_URL:url,HEADED:''});
  }
  await suite('table-editing-file','tests/table-editing.test.mjs','qa/table-editing-results.json');
  await suite('table-editing-http','tests/table-editing.test.mjs','qa/table-editing-results.json',{TEST_URL:url});
  await suite('svg-charts-file','tests/svg-charts.test.mjs','qa/svg-charts-results.json');
  await suite('svg-charts-http','tests/svg-charts.test.mjs','qa/svg-charts-results.json',{TEST_URL:url});
  await suite('svg-stacked-file','tests/svg-stacked.test.mjs','qa/svg-stacked-results.json');
  await suite('svg-stacked-http','tests/svg-stacked.test.mjs','qa/svg-stacked-results.json',{TEST_URL:url});
  await suite('svg-bubble-file','tests/svg-bubble.test.mjs','qa/svg-bubble-results.json');
  await suite('svg-bubble-http','tests/svg-bubble.test.mjs','qa/svg-bubble-results.json',{TEST_URL:url});
  await suite('svg-waterfall-file','tests/svg-waterfall.test.mjs','qa/svg-waterfall-results.json');
  await suite('svg-waterfall-http','tests/svg-waterfall.test.mjs','qa/svg-waterfall-results.json',{TEST_URL:url});
  await suite('html-share-file','tests/html-share.test.mjs','qa/html-share-results.json');
  await suite('html-share-http','tests/html-share.test.mjs','qa/html-share-results.json',{TEST_URL:url});
  await suite('non-svg-charts-file','tests/non-svg-charts.test.mjs','qa/non-svg-charts-results.json');
  await suite('non-svg-charts-http','tests/non-svg-charts.test.mjs','qa/non-svg-charts-results.json',{TEST_URL:url});
  await suite('templates-grouping','tests/templates-grouping.test.mjs','qa/templates-grouping-v0.2.3/results.json');
  await suite('font-loading','tests/font-loading.test.mjs','qa/font-loading-v0.2.2/results.json');
  await suite('template-fonts','tests/template-fonts.test.mjs','qa/template-fonts-v0.2.2/results.json');
  await suite('layers','tests/layer-reveal.test.mjs','qa/layer-reveal-results.json');
  await suite('viewport','tests/viewport.test.mjs','qa/viewport-results.json');
  await suite('pages','tests/pages.test.mjs','qa/pages-results.json');
  await suite('fonts','tests/fonts.test.mjs','qa/fonts-results.json');
  await suite('stability-file','tests/stability.test.mjs','qa/stability-results.json');
  await suite('stability-http','tests/stability.test.mjs','qa/stability-results.json',{TEST_URL:url});
  await suite('performance','tests/performance.test.mjs','qa/performance-results.json');
  if(env.MERCHANT_FILE)await suite('merchant','tests/merchant.test.mjs','qa/merchant-results.json');
}catch(e){suites.push({name:'Runner',pass:false,error:e.message,cases:[]});console.error(e);}
finally{
  if(server){server.kill('SIGTERM');await new Promise(resolve=>{if(server.exitCode!==null)resolve();else{server.once('exit',resolve);setTimeout(resolve,2000).unref();}});}
  const result={date:new Date().toISOString(),platform:`${os.platform()} ${os.release()} ${os.arch()}`,deckIncluded:!!env.DECK_FILE,suites,passed:suites.flatMap(s=>s.cases).filter(c=>c.pass).length,failedSuites:suites.filter(s=>!s.pass).length};
  await fs.writeFile(path.join(dir,'all-results.json'),JSON.stringify(result,null,2));
  console.log(`\n${result.passed} passed checks; ${result.failedSuites} failed suites. Reports: ${dir}`);
  if(result.failedSuites)process.exitCode=1;
}
