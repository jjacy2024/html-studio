import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {Client} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../connector/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import {createBroker} from '../connector/broker.mjs';
import {editorOperationSchema} from '../dist/operations.js';
import {generalEditingHTML} from './general-editing-fixture.mjs';
import {chartHTML} from './svg-chart-fixtures.mjs';

const dir=path.resolve(process.env.GENERAL_QA_DIR||'qa/general-editing-v0.5.0/mcp');await fs.mkdir(dir,{recursive:true});
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'html-studio-general-')),stateDir=path.join(temporary,'state'),exportDir=path.join(temporary,'exports');
const broker=await createBroker({root:process.cwd(),stateDir,exportDir,port:0});
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1512,height:982}}),page=await context.newPage();
const client=new Client({name:'通用编辑 MCP 回归',version:'0.5.0'}),transport=new StdioClientTransport({command:process.execPath,args:['connector/connector.cjs','mcp','--state-dir',stateDir],stderr:'pipe'});
const results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
let sessionId,token;
const raw=async(command,params={},options={})=>{const spec=editorOperationSchema().commands[command],name=command.includes('.')?'studio_'+command.replaceAll('.','_'):command;
 const args={...(name==='studio_sessions'?{}:{sessionId}),...params,...(spec?.write?{expected:token,operationId:randomUUID()}:{}),...options};
 const r=(await client.callTool({name,arguments:args},undefined,{timeout:60000})).structuredContent;if(r.context?.token)token=r.context.token;return r;};
const ok=async(...args)=>{const r=await raw(...args);assert(r.ok,JSON.stringify(r));return r.result;};
const fail=async(command,params,code,options)=>{const r=await raw(command,params,options);assert.equal(r.ok,false,JSON.stringify(r));assert.equal(r.error.code,code,JSON.stringify(r));return r;};
const id=selector=>page.evaluate(s=>htmlStudio.id(htmlStudio.doc.querySelector(s)),selector);
const ids=async(...selectors)=>Promise.all(selectors.map(id));
const read=async selector=>(await ok('elements.read',{ids:[await id(selector)]}))[0];
const state=()=>page.evaluate(()=>({html:htmlStudio.doc.body.outerHTML,history:htmlStudio.historyIndex,revision:htmlStudio.revision,selection:[...htmlStudio.selection],page:htmlStudio.pages.index}));
const style=(selector,key)=>page.evaluate(({selector,key})=>htmlStudio.style(htmlStudio.doc.querySelector(selector))[key],{selector,key});
const wait=async fn=>{const until=Date.now()+10000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('Wait timed out');};
const load=async(html=generalEditingHTML())=>{
 await page.evaluate(async html=>{document.querySelector('#dialog').close();await htmlStudio.newDocument(html,'通用编辑回归');},html);
 await page.locator('#agent-connect').click();await page.locator('#agent-allow').click();
 await wait(async()=>{const sessions=await ok('studio_sessions');const s=sessions.find(s=>s.authorized);if(s){sessionId=s.sessionId;token=s.context.token;return true;}});
};
const test=async(name,work)=>{try{await work();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});console.error('FAIL',name,e);await page.screenshot({path:path.join(dir,'failure.png')});throw e;}};
try{
 await client.connect(transport);await page.goto(broker.pairURL());await page.waitForFunction(()=>window.htmlStudioAPI&&!htmlStudio.loading);await page.evaluate(()=>htmlStudio.ready);
 await test('31 个 MCP 工具可发现，浏览器/连接器 schema 一致，空工程拒绝访问',async()=>{
  const list=(await client.listTools()).tools;assert.equal(list.length,31);for(const name of ['text','style','geometry','layout','create','group','ungroup'])assert(list.some(t=>t.name==='studio_elements_'+name));
  assert.deepEqual(await page.evaluate(()=>htmlStudioAPI.describe()),editorOperationSchema());assert.deepEqual(JSON.parse(await fs.readFile('connector/command-schema.json','utf8')),editorOperationSchema());
  const sessions=await ok('studio_sessions');sessionId=sessions[0].sessionId;await fail('elements.list',{},'NOT_AUTHORIZED');
 });
 await load();
 await test('MCP 适应容器内容：保留子元素尺寸；布局变化先确认并可单步撤回',async()=>{
  await load('<div id="fit" style="position:absolute;left:50px;top:50px;width:500px;height:300px;padding:20px;display:flex;gap:28px"><div style="width:40%;height:60px;flex:none">一</div><div style="width:70px;height:80px;flex:none">二</div></div>');
  const target=await id('#fit'),before=await state(),rects=await page.evaluate(()=>[...htmlStudio.doc.querySelector('#fit').children].map(n=>htmlStudio.rect(n)));
  await fail('elements.geometry',{ids:[target],geometry:{fitContent:true}},'CONFIRMATION_REQUIRED');assert.deepEqual(await state(),before);
  await ok('elements.geometry',{ids:[target],geometry:{fitContent:true},acceptLayoutChange:true});assert.equal((await state()).history,before.history+1);
  const after=await page.evaluate(()=>[...htmlStudio.doc.querySelector('#fit').children].map(n=>htmlStudio.rect(n)));for(let i=0;i<after.length;i++)for(const key of ['width','height','x','y'])assert(Math.abs(after[i][key]-rects[i][key])<1);
  assert.equal(await style('#fit','padding'),'0px');await ok('history.undo');assert.equal(await style('#fit','display'),'flex');assert.equal(await style('#fit','width'),'500px');
  await load();
 });
 await test('图层搜索、详情和片段可读，选中后左侧列表联动',async()=>{
  const before=await state(),list=await ok('elements.list',{query:'测试标题',tag:'h1'});assert.equal(list.total,1);const detail=await read('#rich');assert.equal(detail.runs.length,4);assert.equal(detail.runs[1].parentTag,'span');assert(detail.capabilities.text);assert.equal((await state()).html,before.html);
  await ok('elements.select',{ids:[list.items[0].id]});assert.deepEqual((await state()).selection,[list.items[0].id]);
 });
 await test('多片段富文本按片段修改保留标签颜色和链接；纯文本拒绝 HTML 执行',async()=>{
  const [rich,single,title]=await ids('#rich','#single','#styled'),before=await state();await fail('elements.text',{edits:[{id:title,text:'不应写入'},{id:rich,text:'会丢格式'}]},'RICH_TEXT_RUNS_REQUIRED');assert.deepEqual(await state(),before);
  await ok('elements.text',{edits:[{id:rich,runs:[{index:1,text:'新红字'},{index:3,text:'新链接'}]},{id:single,text:'唯一新内容'},{id:title,text:'<img src=x onerror=alert(1)>'}]});
  assert.equal(await page.evaluate(()=>htmlStudio.doc.querySelector('#single b').textContent),'唯一新内容');assert.equal(await style('#rich span','color'),'rgb(255, 0, 0)');assert.equal(await page.evaluate(()=>htmlStudio.doc.querySelector('#rich a').getAttribute('href')),'#free');assert.equal(await page.evaluate(()=>htmlStudio.doc.querySelector('#styled').children.length),0);
  assert.equal((await state()).history,before.history+1);await ok('history.undo');assert.equal((await read('#styled')).text,'测试标题');await ok('history.redo');assert((await read('#rich')).text.includes('新红字'));
 });
 await test('文字、填色渐变、描边、阴影和透明度批量生效，包括外来 !important',async()=>{
  const targets=await ids('#styled','#single');await ok('elements.style',{ids:targets,styles:{fontFamily:'Georgia, serif',fontSize:36,fontWeight:'700',fontStyle:'italic',color:'#123456',lineHeight:44,letterSpacing:2,textAlign:'center',textDecoration:'underline',background:'linear-gradient(90deg, #fff, #f0f)',stroke:'#336699',strokeWidth:2,strokeStyle:'dashed',radius:8,opacity:72,boxShadow:'2px 4px 8px rgba(0,0,0,.2)',rotate:3}});
  const s=(await read('#styled')).styles;assert.equal(s.fontSize,'36px');assert.equal(s.color,'rgb(18, 52, 86)');assert.equal(s.lineHeight,'44px');assert.equal(s.opacity,'0.72');assert.match(s.backgroundImage,/linear-gradient/);assert.equal(s.borderStyle,'dashed');assert.notEqual(s.boxShadow,'none');assert.equal(s.rotate,'3deg');assert.equal(await style('#single','fontStyle'),'italic');
  const before=await state();for(const styles of [{color:'not-a-color'},{background:'url(https://example.com/a)'},{color:'var(--x)'},{opacity:101},{position:'fixed'},{}])await fail('elements.style',{ids:targets,styles},'INVALID_ARGUMENT');assert.deepEqual(await state(),before);
  await ok('elements.style',{ids:targets,styles:{lineHeight:0,opacity:0}});assert.equal(await style('#styled','lineHeight'),'0px');assert.equal(await style('#styled','opacity'),'0');
 });
 await test('在 Flex 中新增/复制元素保持 gap 28 与顶对齐，不强加自由偏移',async()=>{
  await load();const parentId=await id('#flow');const created=await ok('elements.create',{parentId,kind:'text',name:'新增卡片',text:'四',width:150,height:70,styles:{fill:'#fff0cc',fontSize:24}});const copy=await ok('elements.duplicate',{ids:[await id('#card1')]});
  const positions=await page.evaluate(()=>[...htmlStudio.doc.querySelector('#flow').children].map(n=>{const r=htmlStudio.rect(n);return {x:r.x,y:r.y,width:r.width}}));for(let i=1;i<positions.length;i++){assert(Math.abs(positions[i].y-positions[0].y)<.1);assert(Math.abs(positions[i].x-positions[i-1].x-positions[i-1].width-28)<.1);}assert.equal(created.ids.length,1);assert.equal(copy.ids.length,1);assert.notEqual(copy.ids[0],await id('#card1'));
 });
 await test('全部基础形状创建与尺寸/描边；流式布局不接受 x/y',async()=>{
  const parentId=await id('#free');for(const kind of ['frame','rect','ellipse','line','triangle','star']){const r=await ok('elements.create',{parentId,kind,position:'absolute',x:30,y:20,width:80,height:60,styles:{fill:'#ab55ee',stroke:'#111111',strokeWidth:3,opacity:90}});const detail=(await ok('elements.read',{ids:r.ids}))[0];assert.equal(Math.round(detail.bounds.width),80);assert.equal(Math.round(detail.bounds.height),60);assert.equal(detail.styles.opacity,'0.9');}
  await fail('elements.create',{parentId,kind:'text',x:30},'INVALID_ARGUMENT');
 });
 await test('移动、尺寸、对齐和等间距分布可撤回；响应式元素禁止隐式移动',async()=>{
  await load();const targets=await ids('#a','#b','#c');await ok('elements.geometry',{ids:targets,geometry:{width:80,height:40}});await ok('elements.align',{ids:targets,alignment:'top'});let data=await ok('elements.read',{ids:targets});assert(data.every(n=>Math.abs(n.bounds.y-data[0].bounds.y)<.1));
  await ok('elements.align',{ids:targets,alignment:'distributeX'});data=await ok('elements.read',{ids:targets});assert(Math.abs((data[1].bounds.x-data[0].bounds.x)-(data[2].bounds.x-data[1].bounds.x))<.1);
  const h=(await state()).history;await ok('elements.geometry',{ids:targets,geometry:{x:50,y:300}});data=await ok('elements.read',{ids:targets});assert(Math.abs(Math.min(...data.map(n=>n.bounds.x))-50)<.1);assert(Math.abs(Math.min(...data.map(n=>n.bounds.y))-300)<.1);assert.equal((await state()).history,h+1);await ok('history.undo');
  const before=await state();await fail('elements.geometry',{ids:[await id('#card1')],geometry:{x:20}},'LAYOUT_CONVERSION_REQUIRED');await fail('elements.align',{ids:targets.slice(0,2),alignment:'distributeX'},'INVALID_ARGUMENT');assert.deepEqual(await state(),before);
 });
 await test('Flex/Grid 通用排版、自由布局确认及位置保持，!important 不阻挡转换',async()=>{
  await load();const flow=await id('#flow'),children=await ids('#card1','#card2','#card3');await ok('elements.layout',{id:flow,layout:{mode:'grid',columns:3,gap:20,padding:16,align:'center',justify:'space-between'}});assert.equal(await style('#flow','display'),'grid');assert.equal(await style('#flow','gap'),'20px');
  const before=await state(),rects=(await ok('elements.read',{ids:children})).map(x=>x.bounds);await fail('elements.layout',{id:flow,layout:{mode:'free'}},'CONFIRMATION_REQUIRED');assert.deepEqual(await state(),before);
  await ok('elements.layout',{id:flow,layout:{mode:'free'},acceptLayoutChange:true});const after=await ok('elements.read',{ids:children});for(let i=0;i<after.length;i++){assert.equal(after[i].layout.position,'absolute');for(const k of ['x','y','width','height'])assert(Math.abs(after[i].bounds[k]-rects[i][k])<1,`${i} ${k}`);}
  await ok('elements.layout',{id:flow,layout:{mode:'flex',direction:'column',gap:12,wrap:'wrap'}});assert.equal(await style('#card1','position'),'relative');assert.equal(await style('#flow','flexDirection'),'column');
 });
 await test('组合/解绑保留祖先 CSS、位置、文字格式，并只创建一个撤回步骤',async()=>{
  await load();const targets=await ids('#a','#b'),before=await ok('elements.read',{ids:targets}),h=(await state()).history;const group=await ok('elements.group',{ids:targets,name:'组合测试'});assert.equal(group.ids.length,1);assert.equal((await state()).history,h+1);
  for(const n of await ok('elements.read',{ids:targets})){const prior=before.find(b=>b.id===n.id);assert.equal(n.styles.color,prior.styles.color);for(const k of ['x','y','width','height'])assert(Math.abs(n.bounds[k]-prior.bounds[k])<1);}
  const ungroup=await ok('elements.ungroup',{ids:group.ids});assert.equal(ungroup.ids.length,2);assert.equal((await read('#a')).styles.color,before[0].styles.color);await ok('history.undo');assert((await ok('elements.read',{ids:group.ids}))[0].name.includes('组合测试'));await ok('history.redo');
 });
 await test('拆散普通容器必须确认样式/响应式变化；确认后正确拆散',async()=>{
  await load();await ok('elements.metadata',{ids:[await id('#locked-child')],locked:false});const flow=await id('#flow'),before=await state();await fail('elements.ungroup',{ids:[flow]},'CONFIRMATION_REQUIRED');assert.deepEqual(await state(),before);assert.equal(await page.locator('#dialog').isVisible(),false);
  await ok('elements.ungroup',{ids:[flow],acceptLayoutChange:true});assert.equal(await page.evaluate(()=>htmlStudio.doc.querySelector('#flow')),null);assert.equal(await style('#card1 b','color'),'rgb(190, 20, 40)');
 });
 await test('图层重命名、锁定/解锁、显隐、重排与删除；批量顺序稳定',async()=>{
  await load();const targets=await ids('#a','#b');await ok('elements.metadata',{ids:targets,name:'测试图层',locked:true});await fail('elements.style',{ids:targets,styles:{color:'red'}},'LOCKED');await ok('elements.metadata',{ids:targets,locked:false});await ok('elements.metadata',{ids:targets,hidden:true});assert.equal(await style('#a','visibility'),'hidden');await ok('elements.metadata',{ids:targets,hidden:false});
  await ok('elements.reorder',{ids:[...targets].reverse(),order:'front'});assert.deepEqual(await page.evaluate(()=>[...htmlStudio.doc.querySelector('#free').children].map(n=>n.id)),['c','a','b']);await ok('elements.reorder',{ids:targets,order:'back'});assert.deepEqual(await page.evaluate(()=>[...htmlStudio.doc.querySelector('#free').children].map(n=>n.id)),['a','b','c']);
  await ok('elements.delete',{ids:targets});assert.equal(await page.evaluate(()=>!!htmlStudio.doc.querySelector('#a')),false);await ok('history.undo');assert.equal((await read('#a')).name,'测试图层');
 });
 await test('整页、锁定后代、表格数据、重复/祖先目标和越界片段拒绝，整批不写',async()=>{
  await load();const before=await state(),title=await id('#styled');await fail('elements.text',{edits:[{id:title,text:'不写入'},{id:await id('#rich'),runs:[{index:99,text:'越界'}]}]},'INVALID_ARGUMENT');
  await fail('elements.text',{edits:[{id:await id('#data td'),text:'200'}]},'DATA_TARGET');await fail('elements.delete',{ids:[await id('#locked-parent')]},'LOCKED');await fail('elements.geometry',{ids:[await id('body')],geometry:{x:20}},'PROTECTED_PAGE');
  await fail('elements.style',{ids:[title,title],styles:{color:'red'}},'INVALID_ARGUMENT');await fail('elements.style',{ids:await ids('#flow','#card1'),styles:{color:'red'}},'INVALID_ARGUMENT');assert.deepEqual(await state(),before);
 });
 await test('写操作中途异常回滚 DOM、选择、历史和修订，后续请求可继续',async()=>{
  const targets=await ids('#a','#b'),before=await state();await page.evaluate(()=>{const original=htmlStudio.setStyle;htmlStudio.__qaStyle=original;let n=0;htmlStudio.setStyle=function(...args){original.apply(this,args);if(++n===2)throw Error('injected mutation failure');};});
  try{await fail('elements.style',{ids:targets,styles:{color:'green'}},'OPERATION_FAILED');}finally{await page.evaluate(()=>{htmlStudio.setStyle=htmlStudio.__qaStyle;delete htmlStudio.__qaStyle;});}
  assert.deepEqual(await state(),before);await ok('elements.style',{ids:targets,styles:{color:'green'}});
 });
 await test('文字接口拒绝藏在行内容器中的脚本/样式与复杂结构',async()=>{
  await load('<p id="complex"><span>标题<script>window.keepScript=true</script><style>.x{color:red}</style></span></p><div id="free"></div>');const target=await id('#complex'),before=await state();
  const r=(await ok('elements.read',{ids:[target]}))[0];assert.equal(r.capabilities.text,false);assert.equal(r.runs,undefined);await fail('elements.text',{edits:[{id:target,runs:[{index:1,text:'window.changed=true'}]}]},'UNSUPPORTED');assert.deepEqual(await state(),before);
 });
 await test('MCP 去重与过期令牌，不重复创建/覆盖人工编辑',async()=>{
  const parentId=await id('#free'),expected=token,operationId=randomUUID(),params={parentId,kind:'text',text:'只新增一次'};const first=await ok('elements.create',params,{expected,operationId});assert.deepEqual(await ok('elements.create',params,{expected,operationId}),first);await fail('elements.create',params,'STALE_DOCUMENT',{expected,operationId:randomUUID()});
 });
 await test('编辑—预览—HTML/工程副本—重开一致',async()=>{
  await load();await ok('elements.text',{edits:[{id:await id('#styled'),text:'MCP 修改后的标题'}]});await ok('elements.style',{ids:[await id('#styled')],styles:{fontSize:42,color:'#123456'}});await ok('elements.layout',{id:await id('#flow'),layout:{mode:'grid',columns:2,gap:24}});
  await ok('preview.start');const preview=page.frameLocator('#preview-frame');assert.equal(await preview.locator('#styled').textContent(),'MCP 修改后的标题');assert.equal(await preview.locator('#styled').evaluate(n=>getComputedStyle(n).fontSize),'42px');assert.equal(await preview.locator('#flow').evaluate(n=>getComputedStyle(n).display),'grid');await page.screenshot({path:path.join(dir,'preview.png')});await ok('preview.stop');
  const save=async format=>ok('studio_save_copy',{format,name:'通用编辑验证',expected:token,operationId:randomUUID()});const html=await save('html'),project=await save('project');const contents=await fs.readFile(html.path,'utf8');assert(!contents.includes('data-hs-id'));assert(contents.includes('MCP 修改后的标题'));await fs.copyFile(html.path,path.join(dir,'export.html'));
  const exported=await context.newPage(),address=broker.origin+'/qa-export';await context.route(address,r=>r.fulfill({body:contents,contentType:'text/html'}));await exported.goto(address);assert.equal(await exported.locator('#styled').evaluate(n=>getComputedStyle(n).color),'rgb(18, 52, 86)');assert.equal(await exported.locator('#flow').evaluate(n=>getComputedStyle(n).gap),'24px');await exported.close();
  const data=JSON.parse(await fs.readFile(project.path,'utf8'));await load(data.html);assert.equal((await read('#styled')).text,'MCP 修改后的标题');assert.equal(await style('#flow','display'),'grid');
 });
 await test('多页工程回滚后页面导航仍有效，非当前页禁止修改',async()=>{
  await load(chartHTML({slides:true}));const pages=await ok('pages.list'),first=await ok('elements.list',{tag:'h2'}),target=first.items[0]?.id||pages[0].id;await ok('pages.select',{pageId:pages[1].id});await fail('elements.read',{ids:[target]},'PAGE_NOT_ACTIVE');await ok('pages.select',{pageId:pages[0].id});
  const before=await state();await page.evaluate(()=>{const commit=htmlStudio.commit;htmlStudio.__qaCommit=commit;htmlStudio.commit=function(...args){commit.apply(this,args);throw Error('injected commit failure');};});
  try{await fail('elements.create',{parentId:pages[0].id,kind:'text',text:'回滚'},'OPERATION_FAILED');}finally{await page.evaluate(()=>{htmlStudio.commit=htmlStudio.__qaCommit;delete htmlStudio.__qaCommit;});}
  assert.deepEqual(await state(),before);assert.equal((await ok('pages.list')).length,2);await ok('pages.select',{pageId:pages[1].id});await ok('preview.start');assert.equal((await ok('preview.status')).status.state,'ready');await ok('preview.stop');
 });
 if(process.env.SALES_FILE)await test('已授权真实 26 页报告上通用编辑、图表编辑与预览可连续使用',async()=>{
  const deck=await fs.readFile(process.env.SALES_FILE,'utf8');await load(deck);const pages=await ok('pages.list');assert.equal(pages.length,26);await ok('pages.select',{pageId:pages[3].id});const titles=await ok('elements.list',{tag:'h2'});assert(titles.total);const detail=(await ok('elements.read',{ids:[titles.items[0].id]}))[0];
  const start=Date.now();await ok('elements.text',{edits:[{id:detail.id,runs:[{index:0,text:'销售数据复盘 · MCP'}]}]});await ok('elements.style',{ids:[detail.id],styles:{color:'#234567',fontSize:38}});const elapsedMs=Date.now()-start;assert(elapsedMs<10000);results.push({name:'真实报告两次通用修改耗时',pass:true,elapsedMs});
  const charts=await ok('charts.list'),chart=charts.find(c=>c.renderer==='svg');const detected=await ok('charts.read',{id:chart.id});await ok('charts.bind',{id:chart.id,acceptDetected:true,detectionId:detected.detectionId});await ok('charts.update',{id:chart.id,cells:[{row:0,column:0,value:1800}]});await ok('preview.start');assert.match(await page.frameLocator('#preview-frame').locator('.slide').nth(3).textContent(),/销售数据复盘/);await ok('preview.stop');
 });
 await test('浏览器无未捕获异常，接口无残留弹窗',async()=>{assert.deepEqual(errors,[]);assert.equal(await page.locator('#dialog').isVisible(),false);});
}catch{process.exitCode=1;}finally{
 await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),version:'0.5.0',results,errors},null,2));await client.close();await browser.close();await broker.close();await fs.rm(temporary,{recursive:true,force:true});
}
