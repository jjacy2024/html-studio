import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parse} from '../connector/node_modules/smol-toml/dist/index.js';
import {chromium} from 'playwright';
import {mergeCodexConfig,installCodex,codexConfigStatus} from '../connector/setup-codex.mjs';
import {agentConnectionPrompt} from '../dist/agent-setup.js';
import {createBroker} from '../connector/broker.mjs';
import {chartHTML} from './svg-chart-fixtures.mjs';

const qa=process.env.MCP_QA_DIR||'qa/mcp-v0.4.1/setup';await fs.mkdir(qa,{recursive:true});
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'hs-simple-connect-')),root=process.cwd(),stateDir=path.join(temp,'状态 空格'),file=path.join(temp,'Codex 配置','config.toml');
const setup={command:process.execPath,args:[path.join(root,'connector/connector.cjs'),'mcp','--state-dir',stateDir],url:'http://127.0.0.1:12345/mcp',headers:{Authorization:'Bearer do-not-copy-secret'},settingsFile:path.join(stateDir,'settings.json')};
const old='command = "/old/node"\nargs = ["/old/connector/connector.cjs", "mcp"]\n';
const results=[];let browser,broker;
const test=async(name,fn)=>{try{await fn();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});throw e;}};
try{
await test('新配置、Windows 路径、中文空格与 shell 字符均按数据合并',()=>{
 for(const command of [setup.command,'C:\\Program Files\\编辑器\\node.exe','/tmp/test $(echo secret) `test`/node']){
  const s={...setup,command},t=mergeCodexConfig('',s);assert.equal(parse(t).mcp_servers.html_studio.command,command);assert.equal(mergeCodexConfig(t,s),t);
 }
});
await test('升级同名服务保留模型、其他 MCP、注释和本服务额外限制',()=>{
 const source='# 用户设置\nmodel = "user-model"\n\n[mcp_servers.other]\ncommand = "another" # keep me\n\n[mcp_servers.html_studio]\n'+old+'disabled_tools = ["studio_save_copy"]\nenabled = false\n\n[mcp_servers.html_studio.tools.studio_charts_update]\napproval_mode = "prompt"\n\n[projects."/a b"]\ntrust_level = "trusted"\n';
 const t=mergeCodexConfig(source,setup),d=parse(t);assert(t.startsWith(source.slice(0,source.indexOf('[mcp_servers.html_studio]'))));assert(t.includes('[projects."/a b"]\ntrust_level = "trusted"\n'));assert.equal(d.model,'user-model');assert.deepEqual(d.mcp_servers.html_studio.disabled_tools,['studio_save_copy']);assert.equal(d.mcp_servers.html_studio.tools.studio_charts_update.approval_mode,'prompt');assert.equal(d.mcp_servers.html_studio.enabled,true);
});
await test('带引号的表名、CRLF、多行数组可升级',()=>{
 const t=mergeCodexConfig('[mcp_servers."html_studio"]\r\ncommand = "/old/node"\r\nargs = [\r\n"/old/connector.cjs",\r\n"mcp",\r\n]\r\n[mcp_servers.other]\r\ncommand = "unchanged"\r\n',setup);assert.equal(parse(t).mcp_servers.html_studio.command,setup.command);assert(t.includes('[mcp_servers.other]\r\ncommand = "unchanged"\r\n'));
});
await test('无效 TOML、同名其他服务、内联配置和多行字符串歧义均不覆盖',()=>{
 for(const source of ['secret = "do-not-print\n','[mcp_servers.html_studio]\ncommand = "unrelated"\n','mcp_servers = {html_studio = {command="old", args=["/old/connector.cjs","mcp"]}}\n',"notes = '''\n[mcp_servers.html_studio]\nnot = 'a real table'\n'''\n"]){assert.throws(()=>mergeCodexConfig(source,setup));}
 try{mergeCodexConfig('secret = "do-not-print\n',setup);}catch(e){assert(!e.message.includes('do-not-print'));}
});
await test('磁盘安装自动备份且可重复，检测不会写文件',async()=>{
 assert.equal((await codexConfigStatus(setup,file)).configured,false);await assert.rejects(fs.stat(file));await fs.mkdir(path.dirname(file),{recursive:true});const source='# preserve this\nmodel="existing"\n';await fs.writeFile(file,source);
 const r=await installCodex(setup,file);assert(r.changed);assert.equal(await fs.readFile(r.backupPath,'utf8'),source);assert.equal((await fs.stat(r.backupPath)).mode&0o777,0o600);assert((await codexConfigStatus(setup,file)).configured);
 const before=await fs.readdir(path.dirname(file));assert.equal((await installCodex(setup,file)).changed,false);assert.deepEqual(await fs.readdir(path.dirname(file)),before);assert.equal(parse(await fs.readFile(file,'utf8')).model,'existing');
});
await test('并发锁、符号链接与解析错误时原文件保持不变',async()=>{
 await fs.writeFile(file+'.html-studio-setup.lock','');await assert.rejects(installCodex(setup,file),/正在进行/);await fs.unlink(file+'.html-studio-setup.lock');
 const link=path.join(temp,'link.toml');await fs.symlink(file,link);await assert.rejects(installCodex(setup,link),/普通文件/);
 const bad=path.join(temp,'bad.toml');await fs.writeFile(bad,'invalid = [');await assert.rejects(installCodex(setup,bad));assert.equal(await fs.readFile(bad,'utf8'),'invalid = [');
});
await test('四客户端提示词带正确路径、验证步骤且不包含 HTTP 凭据',()=>{
 for(const name of ['codex','workbuddy','qwen','doubao']){const p=agentConnectionPrompt(name,setup);assert(p.includes('studio_sessions'));assert(p.includes('不要改工程内容'));assert(p.includes('备份'));assert(!p.includes('do-not-copy-secret'));assert(p.includes(JSON.stringify(setup.args[0])));if(name==='codex')assert(p.includes('setup-codex'));}
});
broker=await createBroker({root,stateDir,exportDir:path.join(temp,'exports'),port:0,codexConfigFile:file});
browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
await page.addInitScript(()=>{window.copiedPrompt='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.failClipboard)throw Error('Denied');window.copiedPrompt=text;}}});});
await page.goto(broker.pairURL());await page.waitForFunction(()=>window.htmlStudioAPI&&!htmlStudio.loading);await page.locator('#agent-connect').click();await page.locator('#agent-install').waitFor();
await test('空工作台一键配置，不授权空工程；高级配置默认隐藏',async()=>{
 assert(await page.locator('#agent-config').isHidden());assert.equal(await page.locator('#agent-install').textContent(),'一键配置 Codex');await page.locator('#agent-install').click();await page.waitForFunction(()=>document.querySelector('#agent-next-step').textContent.includes('配置已'));
 assert((await broker.call({name:'studio_sessions',args:{}})).result.every(s=>!s.authorized));assert((await fs.readFile(file,'utf8')).includes('existing'));assert.equal(await page.locator('#agent-received-status').textContent(),'等待 Agent 验证连接');
});
await test('配置入口要求来源、浏览器凭据和明确按钮动作，不接受外部路径',async()=>{
 const credential=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('html-studio-bridge-v1'))),headers={Origin:broker.origin,Authorization:'Bearer '+credential.browserToken,'Content-Type':'application/json'};
 assert.equal((await fetch(broker.origin+'/api/setup/codex',{method:'POST',body:'{}'})).status,401);
 assert.equal((await fetch(broker.origin+'/api/setup/codex',{method:'POST',headers:{...headers,Origin:'https://other.example'},body:'{"confirm":true}'})).status,403);
 for(const body of [{},{confirm:true,file:'/tmp/arbitrary'}])assert.equal((await fetch(broker.origin+'/api/setup/codex',{method:'POST',headers,body:JSON.stringify(body)})).status,400);
});
await test('工程一键授权，重复点击无额外备份且不虚报 Agent 已连接',async()=>{
 await page.locator('#dialog-close').click();await page.evaluate(html=>htmlStudio.newDocument(html,'快捷连接测试工程'),chartHTML({slides:true}));await page.locator('#agent-connect').click();await page.locator('#agent-install').click();await page.waitForFunction(()=>document.querySelector('#agent-next-step').textContent.includes('当前工程已授权'));
 const before=await fs.readdir(path.dirname(file));await page.locator('#agent-install').click();await page.waitForFunction(()=>!document.querySelector('#agent-install').disabled);assert.deepEqual(await fs.readdir(path.dirname(file)),before);
 const session=(await broker.call({name:'studio_sessions',args:{}})).result.find(s=>s.authorized);assert(session);assert.equal(await page.locator('#agent-received-status').textContent(),'等待 Agent 验证连接');await page.screenshot({path:path.join(qa,'codex-quick-connect.png')});
 await page.locator('#dialog-close').click();const r=await broker.call({name:'studio_document_read',args:{sessionId:session.sessionId},client:'验证 Agent'});assert(r.ok);await page.locator('#agent-connect').click();assert.equal(await page.locator('#agent-received-status').textContent(),'已收到 Agent 请求');
});
await test('WorkBuddy、千问、豆包显示提示词入口；复制成功后授权',async()=>{
 for(const name of ['workbuddy','qwen','doubao']){
  await page.locator('#agent-revoke').click();await page.locator('#agent-client').selectOption(name);assert(await page.locator('#agent-install').isHidden());await page.locator('#agent-copy-prompt').click();await page.waitForFunction(()=>document.querySelector('#agent-next-step').textContent.includes('提示词已复制'));
  const copied=await page.evaluate(()=>window.copiedPrompt);assert(copied.includes('studio_sessions'));assert(copied.includes('不要改工程内容'));assert((await broker.call({name:'studio_sessions',args:{}})).result.some(s=>s.authorized));
 }
 await page.screenshot({path:path.join(qa,'prompt-quick-connect.png')});
});
await test('剪贴板失败时展开并选中文本，不误报成功或自动授权',async()=>{
 await page.locator('#agent-revoke').click();await page.locator('#agent-client').selectOption('workbuddy');await page.evaluate(()=>window.failClipboard=true);await page.locator('#agent-copy-prompt').click();assert(await page.locator('#agent-prompt').isVisible());assert(await page.locator('#agent-prompt').evaluate(n=>n.selectionEnd===n.value.length));assert(!(await broker.call({name:'studio_sessions',args:{}})).result.some(s=>s.authorized));assert.match(await page.locator('#agent-next-step').textContent(),/未自动复制/);await page.evaluate(()=>window.failClipboard=false);
});
await test('配置冲突在页面明确显示，保留原配置且不授予工程访问',async()=>{
 const bad='[mcp_servers.html_studio]\ncommand="unrelated"\n';await fs.writeFile(file,bad);await page.locator('#agent-client').selectOption('codex');await page.locator('#agent-install').click();await page.waitForFunction(()=>document.querySelector('#agent-next-step').textContent.includes('未覆盖'));assert.equal(await fs.readFile(file,'utf8'),bad);assert(!(await broker.call({name:'studio_sessions',args:{}})).result.some(s=>s.authorized));
});
await test('快捷面板在笔记本尺寸可用且无未捕获异常',async()=>{
 await page.locator('#agent-prompt-details').evaluate(n=>n.open=false);for(const [width,height] of [[1280,800],[1512,982]]){await page.setViewportSize({width,height});const r=await page.locator('#dialog').boundingBox();assert(r.x>=0&&r.y>=0&&r.x+r.width<=width&&r.y+r.height<=height);assert(await page.locator('#agent-install').isVisible());}assert.deepEqual(errors,[]);
});
}catch(e){process.exitCode=1;console.error(e);}finally{await fs.writeFile(path.join(qa,'results.json'),JSON.stringify({date:new Date().toISOString(),results},null,2));await browser?.close();await broker?.close();await fs.rm(temp,{recursive:true,force:true});}
