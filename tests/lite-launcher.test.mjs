import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {Client} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import {liteLauncherSetup,liteLauncherPrompt} from '../launcher/lite/launcher.js';

const exec=promisify(execFile),qa='qa/lite-v0.5.0',pkg=JSON.parse(await fs.readFile(qa+'/package.json','utf8'));
const results=[],errors=[],temp=await fs.mkdtemp(path.join(os.tmpdir(),'html-lite-'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const exists=p=>fs.stat(p).then(()=>true).catch(()=>false);
const wait=async(fn,timeout=45000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await fn())return;await new Promise(r=>setTimeout(r,60));}throw Error('Condition timed out');};
const run=async(name,work)=>{const start=Date.now();try{await work();results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack,ms:Date.now()-start});console.error('FAIL',name,e);throw e;}};
const moved=path.join(temp,'同事的编辑器 \' $literal `value` # % 目录'),cache=path.join(temp,'共享运行环境 缓存');
let browser,context,page,downloadedNode,systemNode,downloadBytes=0;
const bootstrap=(args,opts={})=>exec('/bin/sh',[path.join(moved,'connector/start-ai.sh'),...args],{encoding:'utf8',timeout:420000,maxBuffer:1024*1024,...opts});
async function reject(args,code,pattern){try{await bootstrap(args);assert.fail('Expected bootstrap failure');}catch(e){assert.equal(e.code,code);assert.match(e.stderr,pattern);}}
async function cleanCache(dir){const items=await fs.readdir(dir).catch(()=>[]);assert(!items.some(n=>n.startsWith('.download')||n.endsWith('.install-lock')),items.join(','));}
try{
await run('发布白名单无 runtime / app / 私人配置；编辑器与连接器和当前构建字节一致',async()=>{
  for(const [f,info] of Object.entries(pkg.files)){assert(!/(^|\/)runtime\/|\.app\/|node\.exe$|\.htmlstudio$|connection\.json$|settings\.json$/.test(f));assert.equal(hash(await fs.readFile(path.join(pkg.dir,f))),info.sha256);}
  for(const f of ['HTML Studio.html','connector/connector.cjs'])assert((await fs.readFile(path.join(pkg.dir,f))).equals(await fs.readFile(f)));
  assert(pkg.unpackedBytes<11_000_000);await exec('/bin/sh',['-n',path.join(pkg.dir,'connector/start-ai.sh')]);
  await fs.cp(pkg.dir,moved,{recursive:true});
});
await run('移动包后生成中文、空格、特殊字符及 Windows / UNC 路径，提示词无内置 Node 假设',async()=>{
  const setup=liteLauncherSetup(pathToFileURL(path.join(moved,pkg.entry)).href);assert.equal(setup.root,moved);assert.equal(setup.command,'/bin/sh');assert.deepEqual(setup.args,[moved+'/connector/start-ai.sh','--install']);
  const prompt=liteLauncherPrompt(setup),argv=JSON.parse(prompt.split('）：\n')[1].split('\n\n')[0]);assert.deepEqual(argv,{command:setup.command,args:setup.args});assert.match(prompt,/24 或更高/);assert.match(prompt,/不要改工程或个人 Agent 配置/);assert(!prompt.includes('Bearer'));
  const win=liteLauncherSetup('file:///D:/Users/%E4%B8%AD%E6%96%87%20files/%23%20%25/start.html');assert.equal(win.root,'D:\\Users\\中文 files\\# %');assert.deepEqual(win.args,['-NoProfile','-File',win.root+'\\connector\\start-ai.ps1','-InstallRuntime']);
  assert.equal(liteLauncherSetup('file://server/share/Editor/start.html').root,'\\\\server\\share\\Editor');assert.throws(()=>liteLauncherSetup('https://example.com/start.html'),/解压/);
});
await run('已有兼容 Node 时复用真实路径，不创建缓存或下载',async()=>{
  const result=JSON.parse((await bootstrap(['--install','--check','--cache-dir',cache])).stdout);assert.equal(result.source,'system');assert(Number(result.version.slice(1).split('.')[0])>=24);assert.equal(await exists(cache),false);systemNode=result.node;
  const selected=JSON.parse((await bootstrap(['--node',systemNode,'--check','--cache-dir',cache])).stdout);assert.equal(selected.source,'selected');assert.equal(selected.node,systemNode);
});
await run('未允许安装时退出并解释；显式旧 Node / 非绝对缓存路径拒绝',async()=>{
  await reject(['--no-system-node','--check','--cache-dir',cache],2,/未找到兼容/);assert.equal(await exists(cache),false);
  const old=path.join(temp,'旧node');await fs.writeFile(old,'#!/bin/sh\nexit 0\n',{mode:0o755});await reject(['--node',old,'--check'],1,/低于 24/);
  await reject(['--cache-dir','relative','--check'],1,/绝对路径/);
});
await run('错误 SHA 拒绝执行，失败后暂存和锁完整清理',async()=>{
  const bad=path.join(temp,'错误包.tar.gz'),badCache=path.join(temp,'坏下载缓存');await fs.writeFile(bad,'corrupted download');
  await reject(['--no-system-node','--install','--check','--cache-dir',badCache,'--archive',bad],1,/SHA-256/);await cleanCache(badCache);assert.deepEqual(await fs.readdir(badCache),[]);
});
await run('并发安装锁拒绝第二次安装，保留原安装任务的锁',async()=>{
  const base=path.join(temp,'正在安装'),lock=path.join(base,'node-v24.22.2-darwin-'+os.arch()+'.install-lock');await fs.mkdir(lock,{recursive:true});
  await reject(['--no-system-node','--install','--check','--cache-dir',base],1,/正在安装/);assert(await exists(lock));
});
await run('首次实际从 nodejs.org 下载、校验、安装并运行，缓存不写入分享目录',async()=>{
  const start=Date.now();const result=await bootstrap(['--no-system-node','--install','--check','--cache-dir',cache]);const checked=JSON.parse(result.stdout);
  assert.equal(checked.source,'downloaded');assert.equal(checked.version,'v24.22.2');downloadedNode=checked.node;assert(checked.node.startsWith((await fs.realpath(cache))+'/'));assert(await exists(path.join(path.dirname(checked.node),'LICENSE')));await cleanCache(cache);
  const installed=await fs.readFile(checked.node),official=await fs.readFile('qa/mcp-v0.4.0/runtimes/darwin-'+os.arch()+'/node');assert(installed.equals(official));downloadBytes=installed.length;
  await fs.writeFile(qa+'/download.json',JSON.stringify({source:'https://nodejs.org/dist/v24.22.2/',version:checked.version,bytes:installed.length,sha256:hash(installed),elapsedMs:Date.now()-start,privateTemporaryDirectory:true},null,2));
});
await run('第二次使用已下载缓存；即使提供不存在的安装包也不重新安装',async()=>{
  const checked=JSON.parse((await bootstrap(['--no-system-node','--check','--cache-dir',cache,'--archive',path.join(temp,'不存在')])).stdout);assert.equal(checked.source,'cached');assert.equal(checked.node,downloadedNode);
  const check=JSON.parse((await exec(downloadedNode,[path.join(moved,'connector/connector.cjs'),'self-check'],{encoding:'utf8'})).stdout);assert.equal(check.tools.length??check.tools,31);
});
await run('损坏的私有缓存可用校验后的官方离线包恢复，保留原损坏副本',async()=>{
  const base=path.join(temp,'需要修复'),target=path.join(base,'node-v24.22.2-darwin-'+os.arch());await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'node'),'broken',{mode:0o755});
  const checked=JSON.parse((await bootstrap(['--no-system-node','--install','--check','--cache-dir',base,'--archive',path.resolve('qa/mcp-v0.4.0/runtimes/node-v24.22.2-darwin-'+os.arch()+'.tar.gz')])).stdout);
  assert.equal(checked.source,'downloaded');assert.equal(checked.version,'v24.22.2');assert((await fs.readdir(base)).some(n=>n.includes('.invalid-')));await cleanCache(base);
});
await run('Mac Intel 分支：架构选择、官方归档校验、Rosetta 运行实际 x64 Node',async()=>{
  const bin=path.join(temp,'intel-test-bin');await fs.mkdir(bin);await fs.writeFile(path.join(bin,'uname'),'#!/bin/sh\ncase "$1" in -s) echo Darwin ;; -m) echo x86_64 ;; *) /usr/bin/uname "$@" ;; esac\n',{mode:0o755});
  const checked=JSON.parse((await bootstrap(['--no-system-node','--install','--check','--cache-dir',path.join(temp,'intel-cache'),'--archive',path.resolve('qa/mcp-v0.4.0/runtimes/node-v24.22.2-darwin-x64.tar.gz')],{env:{...process.env,PATH:bin+':/usr/bin:/bin'}})).stdout);
  assert.equal(checked.source,'downloaded');assert(checked.node.includes('darwin-x64'));assert.equal((await exec(checked.node,['-p','process.arch'],{encoding:'utf8'})).stdout.trim(),'x64');
});
browser=await chromium.launch({channel:'chrome',headless:true});context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});await context.setOffline(true);page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await run('轻量 HTML 入口离线打开与响应式布局；复制成功及失败回退',async()=>{
  await page.goto(pathToFileURL(path.join(moved,pkg.entry)).href);assert.equal(await page.title(),'html全能编辑器 · 轻量版');const prompt=await page.locator('#startup-prompt').inputValue();assert(prompt.includes(moved));assert(!prompt.includes(pkg.dir));
  for(const width of [390,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.screenshot({path:qa+'/lite-entry.png',fullPage:true});
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copied=value;}}}));await page.locator('#copy-prompt').click();assert.equal(await page.evaluate(()=>window.__copied),prompt);assert.match(await page.locator('#copy-status').textContent(),/尚未启动/);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}}));await page.locator('#copy-prompt').click();assert(await page.locator('#prompt-details').getAttribute('open')!==null);assert(await page.locator('#startup-prompt').evaluate(n=>n.selectionStart===0&&n.selectionEnd===n.value.length));
});
await run('直接点击入口：无服务、离线导入编辑、可见预览及导出',async()=>{
  await page.locator('#open-editor').click();await page.waitForFunction(()=>window.htmlStudioAPI&&!htmlStudio.loading);await page.evaluate(()=>htmlStudio.ready);
  await page.evaluate(()=>htmlStudio.newDocument('<h1 id="test">轻量包离线编辑</h1>','轻量包测试'));
  const result=await page.evaluate(()=>{const id=htmlStudio.id(htmlStudio.doc.querySelector('h1'));return htmlStudioAPI.execute({command:'elements.text',params:{edits:[{id,text:'轻量包编辑成功'}]},expected:htmlStudioAPI.getState().token});});assert(result.ok);
  const preview=await page.evaluate(()=>htmlStudioAPI.execute({command:'preview.start',params:{},expected:htmlStudioAPI.getState().token}));assert(preview.ok);assert.equal(await page.frameLocator('#preview-frame').locator('#test').textContent(),'轻量包编辑成功');assert(await page.frameLocator('#preview-frame').locator('#test').evaluate(n=>n.getBoundingClientRect().height>0));
  await page.evaluate(()=>htmlStudioAPI.execute({command:'preview.stop',params:{},expected:htmlStudioAPI.getState().token}));const download=page.waitForEvent('download');await page.locator('#export-button').click();const d=await download;await d.saveAs(qa+'/manual-export.html');assert((await fs.readFile(qa+'/manual-export.html','utf8')).includes('轻量包编辑成功'));
});
await context.close();context=null;
for(const source of ['system','downloaded'])await run(source+' 环境实际启动：重复启动复用、31 项 MCP、文字样式编辑—预览—保存',async()=>{
  const stateDir=path.join(temp,source+'-state'),exportDir=path.join(temp,source+'-exports');
  const prefix=source==='system'?['--node',systemNode]:['--no-system-node','--cache-dir',cache];
  const args=[...prefix,'--','--no-open','--port','0','--state-dir',stateDir,'--export-dir',exportDir];
  const child=spawn('/bin/sh',[path.join(moved,'connector/start-ai.sh'),...args],{stdio:['ignore','pipe','pipe']}),log=[];child.stdout.on('data',b=>log.push(b.toString()));child.stderr.on('data',b=>log.push(b.toString()));let client,c;
  try{
    await wait(async()=>{if(child.exitCode!==null||child.signalCode!==null)throw Error('Launcher exited: '+child.exitCode+' '+child.signalCode);return exists(path.join(stateDir,'connection.json'));});const state=JSON.parse(await fs.readFile(path.join(stateDir,'connection.json'),'utf8'));assert.equal(state.root,await fs.realpath(moved));
    const again=await bootstrap(args);assert.match(again.stdout,/已使用正在运行/);assert.equal(JSON.parse(await fs.readFile(path.join(stateDir,'connection.json'),'utf8')).pid,state.pid);
    await wait(()=>/http:\/\/127\.0\.0\.1:\d+\/#hs-connect=[\w-]+/.test(log.join('')));const url=log.join('').match(/http:\/\/127\.0\.0\.1:\d+\/#hs-connect=[\w-]+/)[0];
    c=await browser.newContext();await c.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.waitForFunction(()=>window.htmlStudioAPI&&!htmlStudio.loading);await p.evaluate(()=>htmlStudio.newDocument('<h1 id="ai-test">AI 接入</h1>','轻量包MCP测试'));
    await p.locator('#agent-connect').click();await p.locator('#agent-allow').click();const node=source==='system'?systemNode:downloadedNode;client=new Client({name:'轻量包验证',version:'0.5.0'});await client.connect(new StdioClientTransport({command:node,args:[path.join(moved,'connector/connector.cjs'),'mcp','--state-dir',stateDir],stderr:'pipe'}));assert.equal((await client.listTools()).tools.length,31);
    const call=async(name,args={})=>{const r=(await client.callTool({name,arguments:args})).structuredContent;assert(r.ok,JSON.stringify(r));return r;};let session;await wait(async()=>{session=(await call('studio_sessions')).result.find(s=>s.authorized);return !!session;});const sessionId=session.sessionId;
    let r=await call('studio_elements_list',{sessionId,tag:'h1'}),id=r.result.items[0].id;r=await call('studio_elements_text',{sessionId,edits:[{id,text:'轻量版 AI 编辑成功'}],expected:r.context.token,operationId:randomUUID()});r=await call('studio_elements_style',{sessionId,ids:[id],styles:{fontSize:36,color:'#663399'},expected:r.context.token,operationId:randomUUID()});r=await call('studio_preview_start',{sessionId,expected:r.context.token,operationId:randomUUID()});assert.equal(r.result.status.state,'ready');assert.equal(await p.frameLocator('#preview-frame').locator('#ai-test').textContent(),'轻量版 AI 编辑成功');assert(await p.frameLocator('#preview-frame').locator('#ai-test').evaluate(n=>n.getBoundingClientRect().height>0));
    r=await call('studio_preview_stop',{sessionId,expected:r.context.token,operationId:randomUUID()});r=await call('studio_save_copy',{sessionId,format:'project',name:'轻量包测试副本',expected:r.context.token,operationId:randomUUID()});assert((await fs.readFile(r.result.path,'utf8')).includes('轻量版 AI 编辑成功'));
  }finally{await client?.close().catch(()=>{});await c?.close();if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await wait(()=>child.exitCode!==null||child.signalCode!==null);}assert.equal(await exists(path.join(stateDir,'connection.json')),false);}
});
await run('Windows x64 / ARM64：参数、官方 SHA、UTF-8 BOM、无策略绕过（仅静态）',async()=>{
  const bytes=await fs.readFile(path.join(pkg.dir,'connector/start-ai.ps1'));assert.equal(bytes.subarray(0,3).toString('hex'),'efbbbf');const ps=bytes.toString('utf8'),cmd=await fs.readFile(path.join(pkg.dir,'启用 AI 连接.cmd'),'utf8');
  assert(ps.includes("'AMD64'"));assert(ps.includes("'ARM64'"));assert(ps.includes('[IO.FileMode]::CreateNew'));assert(ps.includes('Get-FileHash'));assert(ps.includes("'Stop'"));assert(ps.includes('finally'));assert(!/ExecutionPolicy|Bypass/i.test(cmd+ps));assert(cmd.includes('-NoProfile -File "%~dp0connector\\start-ai.ps1"'));
  const sums=await fs.readFile('qa/mcp-v0.4.0/runtimes/SHASUMS256.txt','utf8');for(const variant of ['win-x64','win-arm64'])assert(ps.includes(sums.split('\n').find(s=>s.endsWith('node-v24.22.2-'+variant+'.zip')).split(/\s+/)[0]));
});
await run('无浏览器未捕获异常；测试后发布目录无运行环境或用户状态',async()=>{
  assert.deepEqual(errors,[]);assert.equal(await exists(path.join(pkg.dir,'runtime')),false);assert.equal(await exists(path.join(moved,'runtime')),false);
  for(const [f,info] of Object.entries(pkg.files))assert.equal(hash(await fs.readFile(path.join(pkg.dir,f))),info.sha256);
});
}catch{process.exitCode=1;}finally{
  await context?.close();const browserVersion=browser?.version();await browser?.close();
  await fs.writeFile(qa+'/results.json',JSON.stringify({date:new Date().toISOString(),browser:browserVersion,results,errors,downloadBytes,testedFiles:Object.fromEntries(Object.entries(pkg.files).map(([f,v])=>[f,v.sha256])),limitations:['Windows 仅静态检查，未实机运行','Mac Intel 归档在 Apple 芯片机器以 Rosetta 执行，未在 Intel 实机运行','此套件验证轻量包与 MCP 连接流程；核心改动另做相关专项回归，未重复全部历史测试']},null,2));
  await fs.rm(temp,{recursive:true,force:true});
}
