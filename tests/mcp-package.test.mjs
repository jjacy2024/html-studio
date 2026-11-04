import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {Client} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const packages=JSON.parse(await fs.readFile('qa/mcp-v0.4.1/packages.json','utf8')).packages,dir='qa/mcp-v0.4.1/package-tests',results=[];await fs.mkdir(dir,{recursive:true});
const wait=async fn=>{const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out');};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
for(const item of packages.filter(p=>p.variant.startsWith('darwin'))){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'hs-package-')),stateDir=path.join(temp,'state'),exportDir=path.join(temp,'exports'),launcher=path.join(item.dir,item.launcher),args=[launcher,'--no-open','--port','0','--state-dir',stateDir,'--export-dir',exportDir];
 const child=spawn('/bin/zsh',args,{env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'},stdio:['ignore','pipe','pipe']}),logs=[];child.stdout.on('data',b=>logs.push(b.toString()));child.stderr.on('data',b=>logs.push(b.toString()));let client,context;
 try{
  await wait(async()=>{try{await fs.access(path.join(stateDir,'connection.json'));return true;}catch{return false;}});const state=JSON.parse(await fs.readFile(path.join(stateDir,'connection.json')));const url=logs.join('').match(/http:\/\/127\.0\.0\.1:\d+\/#hs-connect=[\w-]+/)?.[0];assert(url);
  const again=execFileSync('/bin/zsh',args,{env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'},encoding:'utf8'});assert(again.includes('已使用正在运行的连接器'));assert.equal(JSON.parse(await fs.readFile(path.join(stateDir,'connection.json'))).pid,state.pid);
  client=new Client({name:'打包验证',version:'1'});const transport=new StdioClientTransport({command:path.join(item.dir,'runtime/node'),args:[path.join(item.dir,'connector/connector.cjs'),'mcp','--state-dir',stateDir],env:{PATH:'/usr/bin:/bin'},stderr:'pipe'});await client.connect(transport);assert.equal((await client.listTools()).tools.length,17);
  context=await browser.newContext({viewport:{width:1280,height:900}});await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());const page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>window.htmlStudioAPI&&!htmlStudio.loading);const html=await fs.readFile(path.join(item.dir,'示例-图表编辑.html'),'utf8');await page.evaluate(html=>htmlStudio.newDocument(html,'安装包验证'),html);await page.locator('#agent-connect').click();await page.locator('#agent-config').waitFor({state:'attached'});const config=await page.locator('#agent-config').inputValue();assert(config.includes(path.join(item.dir,'runtime/node')));await page.locator('#agent-allow').click();
  const call=async(name,args={})=>{const response=await client.callTool({name,arguments:args});const data=response.structuredContent;assert(data.ok,JSON.stringify(data));return data;};let session;
  await wait(async()=>{session=(await call('studio_sessions')).result.find(s=>s.authorized);return !!session;});const listing=await call('studio_charts_list',{sessionId:session.sessionId}),id=listing.result.find(c=>c.renderer==='svg').id;
  let r=await call('studio_charts_read',{sessionId:session.sessionId,id});r=await call('studio_charts_bind',{sessionId:session.sessionId,id,acceptDetected:true,detectionId:r.result.detectionId,expected:r.context.token,operationId:randomUUID()});r=await call('studio_charts_update',{sessionId:session.sessionId,id,cells:[{row:0,column:0,value:1700}],expected:r.context.token,operationId:randomUUID()});r=await call('studio_save_copy',{sessionId:session.sessionId,format:'project',name:'安装包副本',expected:r.context.token,operationId:randomUUID()});assert(JSON.parse(await fs.readFile(r.result.path,'utf8')).html.includes('1700'));
  results.push({name:item.variant+'：无系统 Node 的启动器、重复启动复用、内置运行时 STDIO、图表编辑及副本落盘',pass:true});console.log('PASS',item.variant);
 }finally{await client?.close().catch(()=>{});await context?.close();const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([exited,new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await fs.rm(temp,{recursive:true,force:true});}
}
const win=packages.find(p=>p.variant==='win-x64'),binary=await fs.readFile(path.join(win.dir,'runtime/node.exe'));assert.equal(binary.subarray(0,2).toString(),'MZ');const pe=binary.readUInt32LE(0x3c);assert.equal(binary.readUInt16LE(pe+4),0x8664);const launcher=await fs.readFile(path.join(win.dir,win.launcher),'utf8');assert(launcher.includes('"%~dp0runtime\\node.exe"'));assert((await fs.stat(path.join(win.dir,'connector/connector.cjs'))).size>0);results.push({name:'Windows x64：官方运行时校验、PE 架构、启动脚本路径及文件完整性（未执行 Windows 实机测试）',pass:true});console.log('PASS Windows package static validation');
}catch(e){process.exitCode=1;results.push({name:'package verification',pass:false,error:e.stack});console.error(e);}finally{await browser.close();await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({date:new Date().toISOString(),results},null,2));}
