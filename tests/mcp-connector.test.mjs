import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {Client} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import {StreamableHTTPClientTransport} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import {WebSocket} from '../connector/node_modules/ws/wrapper.mjs';
import {createBroker} from '../connector/broker.mjs';
import {chartHTML} from './svg-chart-fixtures.mjs';
import {canvasHTML,htmlBarsHTML} from './non-svg-fixtures.mjs';

const root=process.cwd(),dir=path.resolve(process.env.MCP_QA_DIR||'qa/mcp-v0.4.1/integration');await fs.mkdir(dir,{recursive:true});
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'html-studio-mcp-')),stateDir=path.join(temporary,'中文状态 folder'),exportDir=path.join(temporary,'导出 copies');
const broker=await createBroker({root,stateDir,exportDir,port:0}),browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1512,height:982}}),page=await context.newPage(),results=[],errors=[];
page.setDefaultTimeout(15000);context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
const stdio=new StdioClientTransport({command:process.execPath,args:[path.join(root,'connector/connector.cjs'),'mcp','--state-dir',stateDir],stderr:'pipe'}),client=new Client({name:'MCP 回归客户端',version:'1.0'});let httpClient,token,sessionId,chartId,setup,otherPage;
const stderr=[];stdio.stderr?.on('data',d=>stderr.push(d.toString()));
const run=async(name,work)=>{try{await work();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);throw e;}};
const raw=async(name,args={},which=client)=>{const r=await which.callTool({name,arguments:args},undefined,{timeout:60000});const value=r.structuredContent||JSON.parse(r.content[0].text);if(value.context?.token)token=value.context.token;return value;};
const ok=async(name,args={},which)=>{const r=await raw(name,args,which);assert.equal(r.ok,true,JSON.stringify(r));return r;};
const fail=async(name,args,code)=>{const r=await raw(name,args);assert.equal(r.ok,false);assert.equal(r.error.code,code,JSON.stringify(r));return r;};
const write=(name,args={},which)=>ok(name,{sessionId,expected:token,operationId:randomUUID(),...args},which);
async function waitFor(fn){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Condition timed out');}
async function load(html,target=page){await target.evaluate(async html=>{document.querySelector('#dialog').close();await htmlStudio.newDocument(html,'MCP 测试工程');},html);}
async function authorize(target=page){await target.locator('#agent-connect').click();await target.locator('#agent-allow').click();await waitFor(async()=>{const list=(await ok('studio_sessions')).result;const match=list.find(s=>s.authorized&&(target===page?(!sessionId||s.sessionId===sessionId):s.sessionId!==sessionId));if(match&&target===page){sessionId=match.sessionId;token=match.context.token;}return !!match;});}
async function readChart(renderer='svg'){const list=await ok('studio_charts_list',{sessionId});const chart=list.result.find(c=>c.renderer===renderer);assert(chart,'Missing '+renderer);chartId=chart.id;return ok('studio_charts_read',{sessionId,id:chartId});}
async function bindChart(renderer='svg'){const r=await readChart(renderer);if(!r.result.bound)await write('studio_charts_bind',{id:chartId,acceptDetected:true,detectionId:r.result.detectionId});return r;}
try{
await run('标准 MCP STDIO 初始化、31 项工具及 JSON Schema 可发现',async()=>{await client.connect(stdio);const {tools}=await client.listTools();assert.equal(tools.length,31);assert(tools.find(t=>t.name==='studio_charts_update').inputSchema.required.includes('operationId'));assert.match(client.getInstructions(),/不可信/);assert.deepEqual((await ok('studio_sessions')).result,[]);});
await run('连接器拒绝无认证、外部 Origin、错误 Host 和文件路径探测',async()=>{
 assert.equal((await fetch(broker.origin+'/api/health')).status,401);assert.equal((await fetch(broker.origin+'/mcp',{method:'POST',body:'{}'})).status,401);
 assert.equal((await fetch(broker.origin+'/',{headers:{Origin:'https://untrusted.example'}})).status,403);
 assert.equal((await fetch(broker.origin+'/../connector/broker.mjs')).status,404);
 const status=await new Promise(resolve=>http.get(broker.origin+'/',{headers:{host:'untrusted.example'}},r=>{r.resume();resolve(r.statusCode);}));assert.equal(status,403);
 const rejected=await new Promise(resolve=>{const ws=new WebSocket(broker.origin.replace('http:','ws:')+'/bridge',{origin:'https://untrusted.example'});ws.on('unexpected-response',(_req,r)=>{resolve(r.statusCode);r.resume();});ws.on('error',()=>{});});assert.equal(rejected,403);
});
await run('一次性启动链接配对、清除地址凭据，未授权工程不可读取',async()=>{
 const url=broker.pairURL();await page.goto(url);await page.waitForFunction(()=>window.htmlStudioAPI&&!htmlStudio.loading);await waitFor(async()=>(await ok('studio_sessions')).result.length===1);
 assert(!page.url().includes('hs-connect'));const s=(await ok('studio_sessions')).result[0];sessionId=s.sessionId;assert.equal(s.authorized,false);assert(!s.name);await fail('studio_document_read',{sessionId},'NOT_AUTHORIZED');
 const pair=await fetch(broker.origin+'/api/pair',{method:'POST',headers:{Origin:broker.origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(url).hash.split('=')[1]})});assert.equal(pair.status,401);
});
await run('四个目标 Agent 的配置面板、路径和授权入口可用',async()=>{
 await page.locator('#agent-connect').click();await page.locator('#agent-config').waitFor({state:'attached'});assert(await page.locator('#agent-allow').isDisabled());
 const cred=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('html-studio-bridge-v1')));setup=await (await fetch(broker.origin+'/api/setup',{method:'POST',headers:{Origin:broker.origin,Authorization:'Bearer '+cred.browserToken}})).json();assert.equal(setup.command,process.execPath);assert.equal(setup.exportDir,exportDir);
 for(const clientName of ['codex','workbuddy','qwen','doubao']){await page.locator('#agent-client').selectOption(clientName);const config=await page.locator('#agent-config').inputValue();assert(config.includes(clientName==='doubao'?'/mcp':'connector.cjs'));if(['workbuddy','qwen'].includes(clientName)){const parsed=JSON.parse(config);assert.equal(parsed.mcpServers.html_studio.args.at(-1),stateDir);}}
 await page.screenshot({path:path.join(dir,'connection-dialog.png')});await page.locator('#dialog-close').click();
});
await run('当前工程授权后，MCP 可读取页面、图层和图表；非法参数明确拒绝',async()=>{
 await load(chartHTML({slides:true}));await authorize();const pages=(await ok('studio_pages_list',{sessionId})).result;assert.equal(pages.length,2);assert((await ok('studio_elements_list',{sessionId,limit:5})).result.items.length===5);const r=await readChart();assert.equal(r.result.values[0][0],1100);assert(r.result.detectionId);await fail('studio_document_read',{sessionId,unknown:true},'INVALID_ARGUMENT');
});
await run('原样绑定、批量改数值、过期修订保护和写操作去重',async()=>{
 const read=await readChart();await write('studio_charts_bind',{id:chartId,acceptDetected:true,detectionId:read.result.detectionId});const expected=token,id=randomUUID(),request={sessionId,id:chartId,cells:[{row:0,column:0,value:1500}],expected,operationId:id};
 const result=await ok('studio_charts_update',request);assert.equal(result.result.values[0][0],1500);const history=await page.evaluate(()=>htmlStudio.history.length);assert.deepEqual(await ok('studio_charts_update',request),result);assert.equal(await page.evaluate(()=>htmlStudio.history.length),history);
 await fail('studio_charts_update',{...request,cells:[{row:0,column:0,value:1700}]},'OPERATION_ID_CONFLICT');const receipt=await ok('studio_operation_status',{sessionId,operationId:id});assert.equal(receipt.result.state,'completed');assert.equal(receipt.result.response.result.values[0][0],1500);
 await fail('studio_charts_update',{...request,operationId:randomUUID()},'STALE_DOCUMENT');await ok('studio_document_read',{sessionId});
});
await run('MCP 行列操作、撤回重做保留授权，手动撤回后旧令牌失效',async()=>{
 await write('studio_charts_structure',{id:chartId,axis:'row',operation:'add',index:1,name:'新增月'});await write('studio_history_undo');await write('studio_history_redo');let r=await ok('studio_charts_read',{sessionId,id:chartId});assert(r.result.rows.includes('新增月'));const old=token;await page.evaluate(()=>htmlStudio.undo());await fail('studio_charts_update',{sessionId,id:chartId,cells:[{row:0,column:0,value:1400}],expected:old,operationId:randomUUID()},'STALE_DOCUMENT');assert((await ok('studio_sessions')).result[0].authorized);await ok('studio_document_read',{sessionId});
});
await run('本地 Streamable HTTP 标准握手、工具发现与读取',async()=>{
 httpClient=new Client({name:'HTTP 回归客户端',version:'1.0'});await httpClient.connect(new StreamableHTTPClientTransport(new URL(setup.url),{requestInit:{headers:setup.headers}}));assert.equal((await httpClient.listTools()).tools.length,31);assert.equal((await ok('studio_charts_read',{sessionId,id:chartId},httpClient)).result.values[0][0],1500);
});
await run('预览等待实际内容，HTML/工程副本落盘且同名不覆盖',async()=>{
 await write('studio_preview_start');const status=await ok('studio_preview_status',{sessionId});assert.equal(status.result.status.state,'ready');assert(await page.frameLocator('#preview-frame').locator('body').isVisible());await write('studio_preview_stop');
 const saved=await write('studio_save_copy',{format:'project',name:'MCP 修改副本'}),again=await write('studio_save_copy',{format:'project',name:'MCP 修改副本'});assert.notEqual(saved.result.path,again.result.path);const project=JSON.parse(await fs.readFile(saved.result.path,'utf8'));assert(project.html.includes('1500'));assert.equal(project.name,'MCP 修改副本');
 const html=await write('studio_save_copy',{format:'html',name:'../尝试路径'});assert.equal(path.dirname(html.result.path),exportDir);const text=await fs.readFile(html.result.path,'utf8');assert(!text.includes('htmlStudioAPI'));assert(!JSON.stringify(html).includes('<!doctype'));assert(text.includes('1,500'));assert.equal(await page.evaluate(()=>htmlStudio.name),'MCP 测试工程');await fs.copyFile(saved.result.path,path.join(dir,'验证副本.htmlstudio'));
});
await run('多人/多窗口时显式 sessionId 路由，不改其他工程',async()=>{
 otherPage=await context.newPage();await otherPage.goto(broker.pairURL());await otherPage.waitForFunction(()=>window.htmlStudioAPI&&!htmlStudio.loading);await load(chartHTML(),otherPage);await authorize(otherPage);await ok('studio_document_read',{sessionId});await write('studio_charts_update',{id:chartId,cells:[{row:0,column:0,value:1600}]});assert.equal(await otherPage.evaluate(()=>htmlStudio.doc.querySelector('[data-studio-svg-chart]')),null);await otherPage.close();otherPage=null;
});
await run('收回授权后所有工程数据请求被拒绝，重新授权可继续',async()=>{
 await page.locator('#agent-connect').click();await page.locator('#agent-revoke').click();await waitFor(async()=>(await ok('studio_sessions')).result.every(s=>!s.authorized));await fail('studio_pages_list',{sessionId},'NOT_AUTHORIZED');await page.locator('#agent-allow').click();await waitFor(async()=>(await ok('studio_sessions')).result.some(s=>s.authorized));await ok('studio_document_read',{sessionId});
});
await run('换工程立即撤销授权；旧 token 无法作用于新文件',async()=>{
 const old=token;await load(htmlBarsHTML());await fail('studio_document_read',{sessionId},'NOT_AUTHORIZED');await authorize();await fail('studio_charts_update',{sessionId,id:chartId,cells:[{row:0,column:0,value:1}],expected:old,operationId:randomUUID()},'STALE_DOCUMENT');await bindChart('html');await write('studio_charts_update',{id:chartId,cells:[{row:0,column:0,value:35}]});assert.equal((await ok('studio_charts_read',{sessionId,id:chartId})).result.values[0][0],35);
});
await run('异步 Chart.js 操作中撤销授权，取消结果不覆盖文档',async()=>{
 await load(canvasHTML());await authorize();await bindChart('chartjs');const before=await page.evaluate(id=>htmlStudio.get(id).getAttribute('data-studio-chartjs'),chartId);
 await page.evaluate(()=>{const observer=new MutationObserver(()=>{if(!document.querySelector('iframe[data-chart-probe]'))return;observer.disconnect();document.querySelector('#agent-connect').click();document.querySelector('#agent-revoke').click();});observer.observe(document.body,{childList:true});});
 const result=await raw('studio_charts_update',{sessionId,id:chartId,cells:[{row:0,column:0,value:99}],expected:token,operationId:randomUUID()});assert.equal(result.ok,false);await waitFor(async()=>await page.locator('iframe[data-chart-probe]').count()===0);assert.equal(await page.evaluate(id=>htmlStudio.get(id).getAttribute('data-studio-chartjs'),chartId),before);await page.locator('#dialog-close').click();
});
await run('真实多页动效报告：MCP 修改、预览、保存副本及重开一致',async()=>{
 const deck=await fs.readFile('../outputs/blockframe-q2-review/杭州栖物电商_2026Q2销售复盘_BlockFrame_图表动效版.html','utf8');await load(deck);await authorize();const pages=(await ok('studio_pages_list',{sessionId})).result;await write('studio_pages_select',{pageId:pages[3].id});await bindChart();await write('studio_charts_update',{id:chartId,cells:[{row:0,column:0,value:1800}]});await write('studio_preview_start');await page.frameLocator('#preview-frame').locator('.slide').nth(3).evaluate(async()=>{while(qiwuChartMotion.state!=='complete')await new Promise(r=>requestAnimationFrame(r));});assert.match(await page.frameLocator('#preview-frame').locator('.slide').nth(3).textContent(),/1,800/);await page.screenshot({path:path.join(dir,'real-report-preview.png')});await write('studio_preview_stop');const result=await write('studio_save_copy',{format:'project',name:'真实报告-MCP副本',missingFonts:'online'});const project=JSON.parse(await fs.readFile(result.result.path,'utf8'));await page.evaluate(p=>htmlStudio.load(p),project);await authorize();const read=await readChart();assert.equal(read.result.values[0][0],1800);
});
await run('刷新与断线收回授权；顶栏 1280/1512px 不重叠',async()=>{
 for(const width of [1280,1512]){await page.setViewportSize({width,height:982});const rects=await page.locator('.topbar > *, .top-actions').evaluateAll(nodes=>nodes.filter(n=>getComputedStyle(n).display!=='none').map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right}}));assert(rects.every(r=>r.right<=width+1));const doc=await page.locator('#document-name').boundingBox(),actions=await page.locator('.top-actions').boundingBox();assert(doc.x+doc.width<=actions.x);}
 await page.reload();await page.waitForFunction(()=>window.htmlStudioAPI&&!htmlStudio.loading);await waitFor(async()=>(await ok('studio_sessions')).result.every(s=>!s.authorized));await fail('studio_document_read',{sessionId},'NOT_AUTHORIZED');assert.equal(await page.evaluate(()=>htmlStudio.isHome),true);
});
await run('工具失败不输出凭据，浏览器与 STDIO 无未捕获异常',async()=>{assert.deepEqual(errors,[]);assert(!stderr.join('').includes('Bearer'));assert.equal((await fs.stat(path.join(stateDir,'connection.json'))).mode&0o777,0o600);});
}catch{process.exitCode=1;try{await page.screenshot({path:path.join(dir,'failure.png')});}catch{}}
finally{await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({date:new Date().toISOString(),version:JSON.parse(await fs.readFile('package.json','utf8')).version,browser:browser.version(),results,errors},null,2));await httpClient?.close().catch(()=>{});await client.close().catch(()=>{});await browser.close();await broker.close();await fs.rm(temporary,{recursive:true,force:true});}
