import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {Client} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const qa=process.env.MAC_QA_DIR||'qa/mac-app-v0.5.0',packages=JSON.parse(await fs.readFile(qa+'/packages.json','utf8')).packages;
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'htmlstudio-app-')),results=[];
let browser;const owned=new Set();
const wait=async fn=>{const until=Date.now()+20000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,60));}throw Error('Condition timed out');};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const read=async file=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}};
const events=async file=>{try{return (await fs.readFile(file,'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}catch{return [];}};
const run=async(name,work)=>{try{await work();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});throw e;}};
const argsFor=(state,file)=>['--state-dir',state,'--port','0','--no-open','--diagnostic-no-alerts','--diagnostic-events',file];
async function launch(pkg,tag,extra=[]){
 const state=path.join(temp,tag+' 中文状态'),file=path.join(temp,tag+'.jsonl');
 const command=pkg.variant==='darwin-x64'?'/usr/bin/arch':pkg.executable,args=pkg.variant==='darwin-x64'?['-x86_64',pkg.executable,...argsFor(state,file),...extra]:[...argsFor(state,file),...extra];
 const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:'/usr/bin:/bin'}});owned.add(child);child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
 await wait(async()=>{const list=await events(file);if(list.some(x=>x.event==='error'))throw Error(JSON.stringify(list));return list.some(x=>x.event==='ready');});
 const connection=await read(path.join(state,'connection.json'));assert(connection);return {child,state,file,connection};
}
async function stop(child,signal='SIGTERM'){
 if(child.exitCode===null&&child.signalCode===null){child.kill(signal);await wait(()=>child.exitCode!==null||child.signalCode!==null);}owned.delete(child);
}
async function startExternal(pkg,root,state){
 const child=spawn(path.join(pkg.root,'runtime/node'),[path.join(pkg.root,'connector/connector.cjs'),'serve','--root',root,'--state-dir',state,'--port','0','--no-open','--app-host'],{stdio:['ignore','pipe','pipe']});owned.add(child);child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});await wait(async()=>!!await read(path.join(state,'connection.json')));return child;
}
try{
await run('两种 Mac 包：原生通用启动器、独立图标、内置资源和完整性签名',async()=>{
 for(const p of packages){const info=JSON.parse(execFileSync('plutil',['-convert','json','-o','-',path.join(p.app,'Contents/Info.plist')],{encoding:'utf8'}));assert.equal(info.CFBundlePackageType,'APPL');assert.equal(info.CFBundleIconFile,'AppIcon');assert.equal(info.LSMinimumSystemVersion,'13.5');const archs=execFileSync('lipo',['-archs',p.executable],{encoding:'utf8'});assert(archs.includes('arm64')&&archs.includes('x86_64'));const icon=await fs.readFile(path.join(p.app,'Contents/Resources/AppIcon.icns'));assert.equal(icon.subarray(0,4).toString(),'icns');assert(icon.length>10000);execFileSync('codesign',['--verify','--deep','--strict',p.app]);assert.deepEqual((await fs.readdir(p.dir)).sort(),['html全能编辑器.app','使用说明.txt','示例-图表编辑.html'].sort());}
});
browser=await chromium.launch({channel:'chrome',headless:true});
for(const pkg of packages){
 const state=await launch(pkg,pkg.variant,['--diagnostic-reopen','--export-dir',path.join(temp,pkg.variant+' exports')]);let context,client;
 try{
 await run(pkg.variant+'：应用直接启动和重复打开共用同一连接器，没有终端进程',async()=>{
  await wait(async()=>(await events(state.file)).filter(x=>x.event==='ready').length===2);const list=(await events(state.file)).filter(x=>x.event==='ready');assert.equal(list[0].ownsServer,true);assert.equal(list[1].ownsServer,false);assert(alive(state.connection.pid));assert.equal((await read(path.join(state.state,'connection.json'))).pid,state.connection.pid);assert.equal(state.connection.root,pkg.root);
  const tree=execFileSync('ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8'}).split('\n').map(s=>s.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);const children=tree.filter(x=>Number(x[2])===state.child.pid);assert(children.some(x=>Number(x[1])===state.connection.pid));assert(!children.some(x=>/Terminal|zsh|bash/.test(x[3])));
 });
 await run(pkg.variant+'：应用内 MCP 路径、31 工具、图表编辑、预览和保存副本',async()=>{
  const opened=await (await fetch(state.connection.origin+'/api/open',{method:'POST',headers:{Authorization:'Bearer '+state.connection.controlToken}})).json();
  context=await browser.newContext({viewport:{width:1280,height:900}});await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(opened.url);await page.waitForFunction(()=>window.htmlStudioAPI&&!htmlStudio.loading);
  await page.evaluate(html=>htmlStudio.newDocument(html,'Mac 应用验证'),await fs.readFile(path.join(pkg.dir,'示例-图表编辑.html'),'utf8'));await page.locator('#agent-connect').click();await page.locator('#agent-config').waitFor({state:'attached'});const config=await page.locator('#agent-config').inputValue();assert(config.includes(pkg.root));assert(config.includes('.app/Contents/Resources/Editor/runtime/node'));await page.locator('#agent-allow').click();
  client=new Client({name:'Mac 应用回归',version:'0.5.0'});await client.connect(new StdioClientTransport({command:path.join(pkg.root,'runtime/node'),args:[path.join(pkg.root,'connector/connector.cjs'),'mcp','--state-dir',state.state],stderr:'pipe'}));assert.equal((await client.listTools()).tools.length,31);
  const call=async(name,args={})=>{const r=(await client.callTool({name,arguments:args})).structuredContent;assert(r.ok,JSON.stringify(r));return r;};let session;await wait(async()=>{session=(await call('studio_sessions')).result.find(s=>s.authorized);return !!session;});const sessionId=session.sessionId,list=await call('studio_charts_list',{sessionId}),id=list.result.find(c=>c.renderer==='svg').id;
  let r=await call('studio_elements_list',{sessionId,tag:'h1'});const heading=r.result.items[0];assert(heading);r=await call('studio_elements_read',{sessionId,ids:[heading.id]});r=await call('studio_elements_text',{sessionId,edits:[{id:heading.id,runs:[{index:0,text:'MCP general editing'}]}],expected:r.context.token,operationId:randomUUID()});r=await call('studio_elements_style',{sessionId,ids:[heading.id],styles:{color:'#234567',fontSize:34},expected:r.context.token,operationId:randomUUID()});r=await call('studio_elements_read',{sessionId,ids:[heading.id]});assert.equal(r.result[0].styles.fontSize,'34px');assert(r.result[0].text.includes('MCP general editing'));r=await call('studio_charts_read',{sessionId,id});r=await call('studio_charts_bind',{sessionId,id,acceptDetected:true,detectionId:r.result.detectionId,expected:r.context.token,operationId:randomUUID()});r=await call('studio_charts_update',{sessionId,id,cells:[{row:0,column:0,value:1740}],expected:r.context.token,operationId:randomUUID()});r=await call('studio_preview_start',{sessionId,expected:r.context.token,operationId:randomUUID()});assert.equal(r.result.status.state,'ready');r=await call('studio_preview_stop',{sessionId,expected:r.context.token,operationId:randomUUID()});r=await call('studio_save_copy',{sessionId,format:'project',name:'Mac 应用测试副本',expected:r.context.token,operationId:randomUUID()});assert(JSON.parse(await fs.readFile(r.result.path,'utf8')).html.includes('1740'));assert.deepEqual(errors,[]);
 });
 }finally{await client?.close();await context?.close();}
 await run(pkg.variant+'：退出应用停止自有连接器并清理状态',async()=>{await stop(state.child);await wait(()=>!alive(state.connection.pid));assert.equal(await read(path.join(state.state,'connection.json')),null);});
}
const arm=packages[0];
await run('应用复用外部启动的同目录连接器，退出不误关其他进程',async()=>{
 const state=path.join(temp,'reuse-state'),file=path.join(temp,'reuse.jsonl'),external=await startExternal(arm,arm.root,state),prior=await read(path.join(state,'connection.json'));
 const child=spawn(arm.executable,argsFor(state,file),{stdio:'ignore'});owned.add(child);await wait(async()=>(await events(file)).some(x=>x.event==='ready'));assert.equal((await events(file)).find(x=>x.event==='ready').ownsServer,false);await stop(child);assert(alive(prior.pid));const health=await fetch(prior.origin+'/api/health',{headers:{Authorization:'Bearer '+prior.controlToken}});assert.equal(health.status,200);await stop(external);
});
await run('旧版或其他目录正在运行时明确提示，不关闭或覆盖原服务',async()=>{
 const state=path.join(temp,'conflict-state'),file=path.join(temp,'conflict.jsonl'),external=await startExternal(arm,process.cwd(),state),prior=await read(path.join(state,'connection.json'));
 const child=spawn(arm.executable,argsFor(state,file),{stdio:'ignore'});owned.add(child);await wait(async()=>(await events(file)).some(x=>x.event==='error'));assert.match((await events(file)).find(x=>x.event==='error').message,/先保存工程/);await wait(()=>child.exitCode!==null||child.signalCode!==null);assert(alive(prior.pid));assert.equal((await read(path.join(state,'connection.json'))).instanceId,prior.instanceId);owned.delete(child);await stop(external);
});
await run('应用被强制结束时，自有连接器检测父进程退出并自动清理',async()=>{
 const state=await launch(arm,'crash');await stop(state.child,'SIGKILL');await wait(()=>!alive(state.connection.pid));assert.equal(await read(path.join(state.state,'connection.json')),null);
});
await run('Finder 的 LaunchServices 启动路径可运行，重复打开触发原应用',async()=>{
 const state=path.join(temp,'launchservices-state'),file=path.join(temp,'launchservices.jsonl');execFileSync('open',['-n',arm.app,'--args',...argsFor(state,file)]);
 await wait(async()=>(await events(file)).some(x=>x.event==='ready'));const original=(await events(file)).find(x=>x.event==='launched'),connection=await read(path.join(state,'connection.json'));
 try{execFileSync('open',[arm.app]);await wait(async()=>(await events(file)).filter(x=>x.event==='ready').length>=2);assert.equal((await read(path.join(state,'connection.json'))).pid,connection.pid);}finally{if(alive(original.pid))process.kill(original.pid,'SIGTERM');await wait(()=>!alive(original.pid));await wait(()=>!alive(connection.pid));}
});
}catch(e){process.exitCode=1;console.error(e);}finally{
 await browser?.close();for(const child of owned){try{await stop(child);}catch{child.kill('SIGKILL');}}
 await fs.writeFile(qa+'/results.json',JSON.stringify({date:new Date().toISOString(),version:'0.5.0',results},null,2));await fs.rm(temp,{recursive:true,force:true});
}
