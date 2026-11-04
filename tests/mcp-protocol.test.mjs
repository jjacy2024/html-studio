import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {WebSocket} from '../connector/node_modules/ws/wrapper.mjs';
import {createBroker} from '../connector/broker.mjs';
const dir=process.env.MCP_QA_DIR||'qa/mcp-v0.4.1/protocol';await fs.mkdir(dir,{recursive:true});const temp=await fs.mkdtemp(path.join(os.tmpdir(),'hs-protocol-'));
const broker=await createBroker({root:process.cwd(),stateDir:temp,port:0,exportDir:path.join(temp,'exports'),requestTimeout:200}),results=[];
const test=async(name,run)=>{try{await run();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.stack});throw e;}};
let ws,credential,grant=randomUUID(),commands=[],state={name:'仅授权时可见',isHome:false,loading:false,token:{documentId:'mock-document',revision:1}};
const awaitMessage=(type)=>new Promise(resolve=>{const handler=data=>{const m=JSON.parse(data);if(m.type===type){ws.off('message',handler);resolve(m);}};ws.on('message',handler);});
const call=(name,args,signal)=>broker.call({name,args,client:'协议回归'},signal);
const write=(operationId=randomUUID())=>({sessionId:credential.sessionId,id:'chart',cells:[{row:0,column:0,value:10}],expected:state.token,operationId});
async function status(authorized=true){ws.send(JSON.stringify({type:'status',authorized,grant,state}));await new Promise(resolve=>{const wait=()=>{call('studio_sessions',{}).then(r=>{const current=r.result.find(s=>s.sessionId===credential.sessionId);if(current?.authorized===authorized)resolve();else setTimeout(wait,5);});};wait();});}
try{
await test('一次性配对须同源；无效浏览器凭据关闭连接',async()=>{
 const url=broker.pairURL(),token=new URL(url).hash.split('=')[1];assert.equal((await fetch(broker.origin+'/api/pair',{method:'POST',body:JSON.stringify({token})})).status,403);
 credential=await (await fetch(broker.origin+'/api/pair',{method:'POST',headers:{Origin:broker.origin},body:JSON.stringify({token})})).json();
 const bad=new WebSocket(broker.origin.replace('http:','ws:')+'/bridge',{origin:broker.origin});await new Promise(r=>bad.once('open',r));bad.send(JSON.stringify({type:'hello',sessionId:credential.sessionId,token:'invalid'}));assert.equal(await new Promise(r=>bad.once('close',r)),1008);
 ws=new WebSocket(broker.origin.replace('http:','ws:')+'/bridge',{origin:broker.origin});await new Promise(r=>ws.once('open',r));const pending=awaitMessage('connected');ws.send(JSON.stringify({type:'hello',sessionId:credential.sessionId,token:credential.browserToken}));await pending;ws.on('message',data=>{const m=JSON.parse(data);if(m.type==='command')commands.push(m);});
 await status();
});
await test('相同写请求并发去重，不同请求返回 BUSY',async()=>{
 const args=write(),next=awaitMessage('command'),a=call('studio_charts_update',args),message=await next,b=call('studio_charts_update',args);assert.equal((await call('studio_charts_update',write())).error.code,'BUSY');
 ws.send(JSON.stringify({type:'result',requestId:message.requestId,response:{ok:true,result:{applied:10}}}));assert.deepEqual(await a,await b);assert.equal(commands.length,1);
});
await test('超时记录 unknown，携带同一 operationId 重试不会重复执行',async()=>{
 const args=write(),before=commands.length,response=await call('studio_charts_update',args);assert.equal(response.error.code,'OUTCOME_UNKNOWN');assert.equal((await call('studio_operation_status',{sessionId:credential.sessionId,operationId:args.operationId})).result.state,'unknown');assert.deepEqual(await call('studio_charts_update',args),response);assert.equal(commands.length,before+1);
});
await test('客户端取消会通知浏览器，不自动重试写请求',async()=>{
 const controller=new AbortController(),next=awaitMessage('command'),request=call('studio_charts_update',write(),controller.signal);const command=await next,cancel=awaitMessage('cancel');controller.abort();assert.equal((await request).error.code,'OUTCOME_UNKNOWN');assert.equal((await cancel).requestId,command.requestId);
});
await test('撤销授权不泄露工程信息或旧授权操作回执',async()=>{
 const args=write(),next=awaitMessage('command'),request=call('studio_charts_update',args);await next;await status(false);assert.equal((await request).error.code,'OUTCOME_UNKNOWN');const s=(await call('studio_sessions',{})).result[0];assert(!s.name&&!s.context);assert.equal((await call('studio_operation_status',{sessionId:credential.sessionId,operationId:args.operationId})).error.code,'NOT_AUTHORIZED');grant=randomUUID();await status();assert.equal((await call('studio_charts_update',args)).error.code,'AUTHORIZATION_CHANGED');assert.equal((await call('studio_operation_status',{sessionId:credential.sessionId,operationId:args.operationId})).error.code,'RECEIPT_NOT_FOUND');
});
await test('不合法副本不写入磁盘；只允许受支持的格式',async()=>{
 const args={sessionId:credential.sessionId,format:'project',expected:state.token,operationId:randomUUID()},next=awaitMessage('command'),request=call('studio_save_copy',args),message=await next;ws.send(JSON.stringify({type:'result',requestId:message.requestId,response:{ok:true,result:{filename:'x.exe',mimeType:'application/octet-stream',content:'x'}}}));assert.equal((await request).error.code,'SAVE_FAILED');assert.equal((await call('studio_save_copy',{...args,format:'exe'})).error.code,'INVALID_ARGUMENT');await assert.rejects(fs.stat(path.join(temp,'exports')));
});
await test('非法消息导致断开并终止待处理操作',async()=>{
 const next=awaitMessage('command'),pending=call('studio_charts_update',write());await next;const closed=new Promise(r=>ws.once('close',r));ws.send('{');assert.equal(await closed,1008);assert.equal((await pending).error.code,'OUTCOME_UNKNOWN');assert.equal((await call('studio_sessions',{})).result.length,0);
});
await test('连接器退出清理临时连接记录，保留本机 HTTP 配置凭据',async()=>{await broker.close();await assert.rejects(fs.stat(path.join(temp,'connection.json')));assert.equal((await fs.stat(path.join(temp,'settings.json'))).mode&0o777,0o600);});
}catch(e){process.exitCode=1;console.error(e);}finally{ws?.terminate();await broker.close();await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({date:new Date().toISOString(),results},null,2));await fs.rm(temp,{recursive:true,force:true});}
