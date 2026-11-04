import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {Client} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import {htmlLauncherPaths,htmlLauncherPrompt} from '../launcher/html/launcher.js';

const qa=process.env.HTML_LAUNCHER_QA||'qa/html-launcher-v0.5.0',manifest=JSON.parse(await fs.readFile(qa+'/packages.json','utf8')),results=[],errors=[];
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'html-entry-')),browser=await chromium.launch({channel:'chrome',headless:true}),relocated=new Map();
const hash=b=>createHash('sha256').update(b).digest('hex'),wait=async(fn,timeout=15000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('Condition timed out');};
const run=async(name,work)=>{try{await work();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);throw e;}};
let context,page;
try{
await run('路径生成兼容中文、空格、引号及 shell 字符；Windows 驱动器和 UNC 路径正确',async()=>{
  const root='/Users/测试目录/引号\' $cash `touch fake` ; # %文件夹',p=htmlLauncherPaths(pathToFileURL(root+'/启动.html').href,'darwin-arm64');assert.equal(p.root,root);assert.equal(p.command,root+'/runtime/node');
  const win=htmlLauncherPaths('file:///D:/Users/%E4%B8%AD%E6%96%87%20files/%23%20%25/start.html','win-x64');assert.equal(win.root,'D:\\Users\\中文 files\\# %');assert.equal(win.command,'D:\\Users\\中文 files\\# %\\runtime\\node.exe');
  const unc=htmlLauncherPaths('file://server/share/Editor/start.html','win-x64');assert.equal(unc.root,'\\\\server\\share\\Editor');
  assert.throws(()=>htmlLauncherPaths('https://example.com/start.html','darwin-arm64'),/本机/);assert.throws(()=>htmlLauncherPaths('file:///Users/me/start.html','win-x64'),/Windows/);
  const prompt=htmlLauncherPrompt(p,'darwin-arm64');const section=prompt.split('启动参数：\n')[1].split('\n\n')[0];const args=JSON.parse(section);assert.equal(args.command,p.command);assert.deepEqual(args.args,[p.connector,'serve','--root',p.root]);assert(!prompt.includes('Bearer'));assert.match(prompt,/不修改工程或 Agent 配置/);
});
await run('三个包均不含 .app，编辑器与连接器和已验证 v0.5.0 字节一致',async()=>{
  async function list(dir){let out=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,entry.name);out.push(f);if(entry.isDirectory())out.push(...await list(f));}return out;}
  for(const p of manifest.packages){const names=await list(p.dir);assert(!names.some(n=>n.endsWith('.app')||n.endsWith('settings.json')||n.endsWith('connection.json')||n.endsWith('.htmlstudio')));assert((await fs.readFile(p.dir+'/HTML Studio.html')).equals(await fs.readFile('HTML Studio.html')));assert((await fs.readFile(p.dir+'/connector/connector.cjs')).equals(await fs.readFile('connector/connector.cjs')));for(const [f,digest] of Object.entries(p.files))assert.equal(hash(await fs.readFile(path.join(p.dir,f))),digest);}
});
const item=manifest.packages[0];context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});await context.setOffline(true);page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await run('file:// 离线双击入口可用，桌面/手机宽度无横向溢出',async()=>{
  await page.goto(pathToFileURL(path.join(item.dir,item.entry)).href);assert.equal(await page.title(),'html全能编辑器 · HTML 入口');assert((await page.locator('#startup-prompt').inputValue()).includes(item.dir));assert.equal(await page.locator('#copy-prompt').isEnabled(),true);
  for(const width of [390,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.locator('#open-editor').isVisible());}
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:qa+'/html-entry.png',fullPage:true});
});
await run('提示词复制成功与权限失败回退均正确，不虚报服务已启动',async()=>{
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copied=value;}}}));await page.locator('#copy-prompt').click();assert.match(await page.locator('#copy-status').textContent(),/尚未.*启动/);assert.equal(await page.evaluate(()=>window.__copied),await page.locator('#startup-prompt').inputValue());
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}}));await page.locator('#copy-prompt').click();assert(await page.locator('#prompt-details').getAttribute('open')!==null);assert.match(await page.locator('#copy-status').textContent(),/已选中/);assert(await page.locator('#startup-prompt').evaluate(n=>n.selectionEnd===n.value.length&&n.selectionStart===0));
});
await run('实际点击 HTML 链接，离线导入—通用编辑—预览—导出可用',async()=>{
  await page.locator('#open-editor').click();await page.waitForFunction(()=>window.htmlStudioAPI&&!htmlStudio.loading);await page.evaluate(()=>htmlStudio.ready);
  await page.evaluate(()=>htmlStudio.newDocument('<h1 id="test">HTML 入口测试</h1><p>离线打开</p>','HTML入口验证'));
  const result=await page.evaluate(async()=>{const id=htmlStudio.id(htmlStudio.doc.querySelector('h1'));return htmlStudioAPI.execute({command:'elements.text',params:{edits:[{id,text:'HTML 入口编辑成功'}]},expected:htmlStudioAPI.getState().token});});assert(result.ok);
  await page.locator('#agent-connect').click();assert.match(await page.locator('#dialog').textContent(),/启动器/);assert.equal(await page.locator('#agent-allow').isEnabled(),false);await page.locator('#dialog-close').click();
  const preview=await page.evaluate(()=>htmlStudioAPI.execute({command:'preview.start',params:{},expected:htmlStudioAPI.getState().token}));assert(preview.ok);assert.equal(await page.frameLocator('#preview-frame').locator('#test').textContent(),'HTML 入口编辑成功');await page.evaluate(()=>htmlStudioAPI.execute({command:'preview.stop',params:{},expected:htmlStudioAPI.getState().token}));
  const download=page.waitForEvent('download');await page.locator('#export-button').click();const d=await download;const file=qa+'/entry-export.html';await d.saveAs(file);assert((await fs.readFile(file,'utf8')).includes('HTML 入口编辑成功'));
});
await context.close();context=null;
await run('整个包移动到含中文、空格及特殊字符的目录后，提示词使用新路径',async()=>{
  const moved=path.join(temp,'同事电脑 $test `literal` # % 新目录');await fs.cp(item.dir,moved,{recursive:true});relocated.set(item.variant,moved);
  const c=await browser.newContext(),p=await c.newPage();try{await p.goto(pathToFileURL(path.join(moved,item.entry)).href);const prompt=await p.locator('#startup-prompt').inputValue();assert(prompt.includes(moved));assert(!prompt.includes(item.dir));assert.equal(htmlLauncherPaths(p.url(),item.variant).root,moved);}finally{await c.close();}
});
for(const original of manifest.packages.filter(p=>p.variant.startsWith('darwin')))await run(original.variant+' 无 .app：备用脚本/提示词等效启动、重复启动复用、31 工具与编辑保存',async()=>{
  const pkg={...original,dir:relocated.get(original.variant)||original.dir};
  const stateDir=path.join(temp,pkg.variant+'-state'),exportDir=path.join(temp,pkg.variant+'-exports');
  const paths=htmlLauncherPaths(pathToFileURL(path.join(pkg.dir,pkg.entry)).href,pkg.variant),parsed=JSON.parse(htmlLauncherPrompt(paths,pkg.variant).split('启动参数：\n')[1].split('\n\n')[0]);
  const extra=['--no-open','--port','0','--state-dir',stateDir,'--export-dir',exportDir];
  // Native ARM tests the fallback file. Rosetta x64 tests the actual copied prompt argv.
  const command=pkg.variant==='darwin-arm64'?'/bin/zsh':parsed.command,args=pkg.variant==='darwin-arm64'?[path.join(pkg.dir,pkg.launcher),...extra]:[...parsed.args,...extra];
  const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:'/usr/bin:/bin'}}),log=[];child.stdout.on('data',b=>log.push(b.toString()));child.stderr.on('data',b=>log.push(b.toString()));let client,c;
  try{
    await wait(async()=>{if(child.exitCode!==null||child.signalCode!==null)throw Error('Launcher exited: '+child.exitCode+' '+child.signalCode);return fs.stat(path.join(stateDir,'connection.json')).then(()=>true).catch(()=>false);},45000);const state=JSON.parse(await fs.readFile(path.join(stateDir,'connection.json'),'utf8'));assert.equal(state.root,pkg.dir);
    const again=execFileSync(paths.command,[...parsed.args,...extra],{encoding:'utf8',env:{...process.env,PATH:'/usr/bin:/bin'}});assert.match(again,/已使用正在运行/);assert.equal(JSON.parse(await fs.readFile(path.join(stateDir,'connection.json'),'utf8')).pid,state.pid);
    await wait(()=>/http:\/\/127\.0\.0\.1:\d+\/#hs-connect=[\w-]+/.test(log.join('')));const url=log.join('').match(/http:\/\/127\.0\.0\.1:\d+\/#hs-connect=[\w-]+/)[0];
    c=await browser.newContext();await c.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.waitForFunction(()=>window.htmlStudioAPI&&!htmlStudio.loading);await p.evaluate(()=>htmlStudio.newDocument('<h1>AI 接入</h1>','HTML入口MCP测试'));
    await p.locator('#agent-connect').click();await p.locator('#agent-allow').click();client=new Client({name:'HTML入口验证',version:'0.5.0'});await client.connect(new StdioClientTransport({command:paths.command,args:[paths.connector,'mcp','--state-dir',stateDir],env:{PATH:'/usr/bin:/bin'},stderr:'pipe'}));assert.equal((await client.listTools()).tools.length,31);
    const call=async(name,args={})=>{const r=(await client.callTool({name,arguments:args})).structuredContent;assert(r.ok,JSON.stringify(r));return r;};let session;await wait(async()=>{session=(await call('studio_sessions')).result.find(s=>s.authorized);return !!session;});const sessionId=session.sessionId;
    let r=await call('studio_elements_list',{sessionId,tag:'h1'}),id=r.result.items[0].id;r=await call('studio_elements_text',{sessionId,edits:[{id,text:'无 app 的 AI 编辑成功'}],expected:r.context.token,operationId:randomUUID()});r=await call('studio_elements_style',{sessionId,ids:[id],styles:{fontSize:36,color:'#663399'},expected:r.context.token,operationId:randomUUID()});r=await call('studio_preview_start',{sessionId,expected:r.context.token,operationId:randomUUID()});assert.equal(r.result.status.state,'ready');r=await call('studio_preview_stop',{sessionId,expected:r.context.token,operationId:randomUUID()});r=await call('studio_save_copy',{sessionId,format:'project',name:'入口测试副本',expected:r.context.token,operationId:randomUUID()});assert((await fs.readFile(r.result.path,'utf8')).includes('无 app 的 AI 编辑成功'));
  }finally{await client?.close().catch(()=>{});await c?.close();if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await wait(()=>child.exitCode!==null||child.signalCode!==null);}assert.equal(await fs.stat(path.join(stateDir,'connection.json')).then(()=>true).catch(()=>false),false);}
});
await run('Windows 包运行时与脚本静态检查（未实机运行）',async()=>{
  const p=manifest.packages.find(p=>p.variant==='win-x64'),bytes=await fs.readFile(path.join(p.dir,'runtime/node.exe'));assert.equal(bytes.subarray(0,2).toString(),'MZ');assert.equal(bytes.readUInt16LE(bytes.readUInt32LE(0x3c)+4),0x8664);const source=await fs.readFile(path.join(p.dir,p.launcher),'utf8');assert(source.includes('"%~dp0runtime\\node.exe"'));assert(source.includes('serve --root "%~dp0."'));assert((await fs.readFile(path.join(p.dir,p.entry),'utf8')).includes('"variant":"win-x64"'));
});
await run('无未捕获浏览器异常',async()=>assert.deepEqual(errors,[]));
}catch{process.exitCode=1;}finally{await context?.close();await browser.close();await fs.writeFile(qa+'/results.json',JSON.stringify({date:new Date().toISOString(),browser:browser.version(),results,errors},null,2));await fs.rm(temp,{recursive:true,force:true});}
