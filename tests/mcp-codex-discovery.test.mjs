// Exercise Codex's actual MCP loader without creating a chat or starting a model turn.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const qa=process.env.MCP_QA_ROOT||'qa/mac-app-v0.5.0',packages=JSON.parse(await fs.readFile(qa+'/packages.json','utf8')).packages,pkg=packages.find(p=>p.variant==='darwin-arm64'),packageRoot=pkg.root||pkg.dir;
const setting='mcp_servers={html_studio_mcp_qa={command='+JSON.stringify(path.join(packageRoot,'runtime/node'))+',args='+JSON.stringify([path.join(packageRoot,'connector/connector.cjs'),'mcp'])+',startup_timeout_sec=15}}';
const child=spawn('codex',['-c',setting,'app-server','--stdio'],{stdio:['pipe','pipe','pipe']}),pending=new Map();let buffer='',next=0,stderr='';
child.stderr.on('data',data=>stderr+=data.toString());
child.stdout.on('data',data=>{buffer+=data.toString();let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let m;try{m=JSON.parse(line);}catch{continue;}if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}});
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Codex MCP discovery timed out'));},40000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
const result={date:new Date().toISOString(),personalConfigurationModified:false,modelTaskExecuted:false,results:[]};
try{
 await request('initialize',{clientInfo:{name:'html_studio_mcp_test',title:'HTML Studio MCP test',version:'0.5.0'}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const data=await request('mcpServerStatus/list',{serverName:'html_studio_mcp_qa',detail:'toolsAndAuthOnly',limit:100});const server=data.data?.find(s=>s.name==='html_studio_mcp_qa');assert(server,'MCP server not found');const count=Object.keys(server.tools||{}).length;assert.equal(count,31);assert(Object.values(server.tools).some(t=>t.name==='studio_charts_update'));result.results.push({name:'Codex 原生 MCP 加载器完成初始化并发现打包版 31 个工具（无模型对话）',pass:true});console.log('PASS Codex native MCP discovery: 31 tools');
}catch(e){process.exitCode=1;result.results.push({name:'Codex MCP discovery',pass:false,error:e.message});console.error(e.message);}
finally{for(const p of pending.values())clearTimeout(p.timer);pending.clear();child.stdin.end();const done=new Promise(r=>child.once('exit',r));await Promise.race([done,new Promise(r=>setTimeout(r,1500))]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await fs.writeFile(qa+'/codex-discovery.json',JSON.stringify(result,null,2));}
