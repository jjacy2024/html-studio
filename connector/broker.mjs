import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {createMcpServer,tools,validate,failure,CONNECTOR_VERSION} from './mcp.mjs';
import {installCodex,codexConfigStatus} from './setup-codex.mjs';

const secret=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cleanName=s=>String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'').slice(0,160)||'编辑副本';
async function bodyJSON(req,max=1048576) {let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>max)throw Error('请求过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
function send(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}

export async function createBroker({root,stateDir,port=43876,exportDir,requestTimeout=45000,codexConfigFile}) {
  await fs.mkdir(stateDir,{recursive:true,mode:0o700});
  const settingsFile=path.join(stateDir,'settings.json');let settings;
  try{settings=JSON.parse(await fs.readFile(settingsFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('连接器设置不可读，请检查 '+settingsFile);settings={httpToken:secret()};await fs.writeFile(settingsFile,JSON.stringify(settings),{mode:0o600,flag:'wx'});}
  if(!/^[\w-]{43}$/.test(settings.httpToken))throw Error('连接凭据无效');
  const controlToken=secret(),instanceId=randomUUID(),pairings=new Map(),sessions=new Map(),receipts=new Map(),transports=new Set();
  let origin,closed=false;const stateFile=path.join(stateDir,'connection.json');
  const editorHTML=await fs.readFile(path.join(root,'HTML Studio.html'));
  const stdioSetup=()=>({command:process.execPath,args:[path.join(root,'connector','connector.cjs'),'mcp','--state-dir',stateDir]});
  const state=()=>({version:CONNECTOR_VERSION,instanceId,origin,port:Number(new URL(origin).port),pid:process.pid,controlToken,root,exportDir});
  const pairURL=()=>{for(const [k,p] of pairings)if(p.expires<Date.now())pairings.delete(k);const token=secret();pairings.set(token,{expires:Date.now()+600000});return origin+'/#hs-connect='+token;};
  const summary=s=>({sessionId:s.id,connected:s.socket?.readyState===WebSocket.OPEN,authorized:!!s.authorized,...(s.authorized?{name:s.state?.name,context:s.state}:{})});
  const emit=(s,m)=>{if(s.socket?.readyState===WebSocket.OPEN)s.socket.send(JSON.stringify(m));};
  function trimReceipts(){for(const [k,r] of receipts)if(r.done&&Date.now()-r.at>1800000)receipts.delete(k);while(receipts.size>=300){const key=[...receipts].find(([,r])=>r.done)?.[0];if(!key)break;receipts.delete(key);}}
  function failPending(s,reason){if(s.pending){emit(s,{type:'cancel',requestId:s.pending.id});s.pending.finish(failure('OUTCOME_UNKNOWN',reason,{operationId:s.pending.operationId}));}}
  async function saveCopy(artifact){
    if(typeof artifact?.content!=='string'||!['application/json','text/html;charset=utf-8'].includes(artifact.mimeType))throw Error('编辑器返回的副本无效');
    await fs.mkdir(exportDir,{recursive:true});const filename=cleanName(artifact.filename),ext=path.extname(filename),stem=filename.slice(0,filename.length-ext.length);
    for(let i=0;i<10000;i++){
      const finalName=i?`${stem} (${i})${ext}`:filename,file=path.join(exportDir,finalName);let handle;
      try{handle=await fs.open(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')continue;throw e;}
      try{await handle.writeFile(artifact.content);await handle.sync();}catch(e){await handle.close();await fs.unlink(file).catch(()=>{});throw e;}await handle.close();
      return {path:file,filename:finalName,bytes:Buffer.byteLength(artifact.content),sha256:createHash('sha256').update(artifact.content).digest('hex'),warnings:artifact.warnings||[]};
    }throw Error('同名副本过多，请整理导出文件夹');
  }
  async function call({name,args={},client='MCP 客户端'},signal) {
    const tool=tools.find(t=>t.name===name);if(!tool)return failure('UNKNOWN_TOOL','未知工具');
    try{validate(args,tool.inputSchema);}catch(e){return failure('INVALID_ARGUMENT',e.message);}
    if(name==='studio_sessions')return {ok:true,result:[...sessions.values()].filter(s=>s.socket?.readyState===WebSocket.OPEN).map(summary),connectorVersion:CONNECTOR_VERSION};
    const s=sessions.get(args.sessionId);if(!s)return failure('SESSION_NOT_FOUND','请先打开编辑器并调用 studio_sessions');
    if(!s.authorized)return failure('NOT_AUTHORIZED','请在编辑器“连接 AI”中允许访问当前工程');
    if(s.socket?.readyState!==WebSocket.OPEN)return failure('EDITOR_DISCONNECTED','编辑器已断开，请重新连接并授权');
    const key=s.id+':'+args.operationId;
    if(name==='studio_operation_status') {const r=receipts.get(key);return r&&r.grant===s.grant?{ok:true,result:{operationId:args.operationId,state:!r.done?'running':r.result?.error?.code==='OUTCOME_UNKNOWN'?'unknown':'completed',...(r.done?{response:r.result}:{})}}:failure('RECEIPT_NOT_FOUND','未找到当前授权内的回执，可能已过期、重新授权或连接器重启；重新读取文档核对后再决定是否重试');}
    const {sessionId,operationId,expected,...params}=args,request={command:tool.command,params,...(expected?{expected}:{})},fingerprint=JSON.stringify(request);
    if(tool.write&&receipts.has(key)){const r=receipts.get(key);if(r.grant!==s.grant)return failure('AUTHORIZATION_CHANGED','此 operationId 属于之前的授权，请重新读取当前工程');return r.fingerprint===fingerprint?await r.promise:failure('OPERATION_ID_CONFLICT','同一 operationId 不可用于不同请求');}
    if(s.pending)return failure('BUSY','本工程还有一个操作正在执行，请等待完成');
    if(signal?.aborted)return failure('CANCELLED','请求已取消');
    const grant=s.grant,requestId=randomUUID();trimReceipts();
    let resolve;const promise=new Promise(r=>resolve=r),receipt={at:Date.now(),grant,fingerprint,promise,done:false,result:null};if(tool.write)receipts.set(key,receipt);
    const finish=result=>{if(s.pending?.id!==requestId)return;clearTimeout(s.pending.timer);signal?.removeEventListener('abort',cancel);s.pending=null;receipt.done=true;receipt.result=result;resolve(result);};
    const cancel=()=>{emit(s,{type:'cancel',requestId});finish(failure('OUTCOME_UNKNOWN','请求被取消；先查询回执并重新读取文档，勿直接重放',{operationId}));};
    const timer=setTimeout(()=>{emit(s,{type:'cancel',requestId});finish(failure('OUTCOME_UNKNOWN','编辑器响应超时；先查询回执并重新读取文档，勿直接重放',{operationId}));},requestTimeout);
    s.pending={id:requestId,operationId,timer,finish,grant,save:name==='studio_save_copy'};
    signal?.addEventListener('abort',cancel,{once:true});
    emit(s,{type:'command',requestId,request,grant,client:String(client).slice(0,100)});
    return promise;
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const host=new URL(origin).host;if(req.headers.host!==host){send(res,403,{error:'Host not allowed'});return;}
      const url=new URL(req.url,origin),sameOrigin=req.headers.origin===origin;
      if(req.headers.origin&&!sameOrigin){send(res,403,{error:'Origin not allowed'});return;}
      res.setHeader('Referrer-Policy','no-referrer');
      const auth=req.headers.authorization;
      if(url.pathname==='/mcp'){
        if(!equal(auth,'Bearer '+settings.httpToken)){send(res,401,{error:'需要连接配置中的 Authorization'});return;}
        if(!['POST','GET','DELETE'].includes(req.method)){send(res,405,{error:'Method not allowed'});return;}
        const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true}),mcp=createMcpServer(call);transports.add(transport);
        res.once('close',()=>{transports.delete(transport);transport.close().catch(()=>{});mcp.close().catch(()=>{});});
        await mcp.connect(transport);await transport.handleRequest(req,res,req.method==='POST'?await bodyJSON(req):undefined);return;
      }
      if(url.pathname==='/api/pair'&&req.method==='POST'){
        if(!sameOrigin){send(res,403,{error:'Pair from editor only'});return;}
        const {token}=await bodyJSON(req,1000),pair=pairings.get(token);pairings.delete(token);
        if(!pair||pair.expires<Date.now()){send(res,401,{error:'启动链接已过期，请重新双击启动器'});return;}
        if(sessions.size>=64){for(const [id,s] of sessions)if(!s.socket||s.socket.readyState!==WebSocket.OPEN)sessions.delete(id);}
        if(sessions.size>=64){send(res,429,{error:'打开的编辑器窗口过多'});return;}
        const s={id:randomUUID(),browserToken:secret(),authorized:false,grant:null,state:null};sessions.set(s.id,s);send(res,200,{sessionId:s.id,browserToken:s.browserToken});return;
      }
      if(url.pathname==='/api/setup'&&req.method==='POST'){
        const s=[...sessions.values()].find(s=>equal(auth,'Bearer '+s.browserToken));if(!s||!sameOrigin){send(res,401,{error:'请从启动器重新打开编辑器'});return;}
        send(res,200,{version:CONNECTOR_VERSION,...stdioSetup(),url:origin+'/mcp',headers:{Authorization:'Bearer '+settings.httpToken},settingsFile,exportDir,codex:await codexConfigStatus(stdioSetup(),codexConfigFile)});return;
      }
      if(url.pathname==='/api/setup/codex'&&req.method==='POST'){
        const s=[...sessions.values()].find(s=>equal(auth,'Bearer '+s.browserToken));if(!s||!sameOrigin||s.socket?.readyState!==WebSocket.OPEN){send(res,401,{error:'请从启动器重新打开编辑器'});return;}
        const input=await bodyJSON(req,1000);if(input.confirm!==true||Object.keys(input).some(k=>k!=='confirm')){send(res,400,{error:'请点击一键配置按钮；不接受自定义配置路径或命令'});return;}
        send(res,200,await installCodex(stdioSetup(),codexConfigFile));return;
      }
      if(url.pathname.startsWith('/api/')){
        if(!equal(auth,'Bearer '+controlToken)){send(res,401,{error:'Unauthorized'});return;}
        if(url.pathname==='/api/health'&&req.method==='GET'){send(res,200,{ok:true,instanceId,root});return;}
        if(url.pathname==='/api/open'&&req.method==='POST'){send(res,200,{url:pairURL()});return;}
        if(url.pathname==='/api/call'&&req.method==='POST'){const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});send(res,200,await call(await bodyJSON(req),controller.signal));return;}
        send(res,404,{error:'Not found'});return;
      }
      if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff'});res.end(editorHTML);return;}
      send(res,404,{error:'Not found'});
    }catch(e){if(!res.headersSent)send(res,400,{error:String(e.message).slice(0,300)});else res.end();}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:100*1024*1024,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/bridge'||req.headers.origin!==origin||req.headers.host!==new URL(origin).host){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',socket=>{
    let s,alive=true;const authTimeout=setTimeout(()=>socket.close(1008,'Authentication required'),3000);
    socket.on('pong',()=>alive=true);const heartbeat=setInterval(()=>{if(!alive)return socket.terminate();alive=false;socket.ping();},30000);
    socket.on('error',()=>{});
    socket.on('message',async data=>{
      try{
        const m=JSON.parse(data.toString());
        if(!s){s=sessions.get(m.sessionId);if(m.type!=='hello'||!s||!equal(m.token,s.browserToken)){s=null;socket.close(1008,'Unauthorized');return;}
          if(s.socket&&s.socket!==socket){failPending(s,'编辑器连接已被替换');s.socket.close(1000,'Replaced');}
          s.authorized=false;s.grant=null;s.socket=socket;clearTimeout(authTimeout);emit(s,{type:'connected',sessionId:s.id,version:CONNECTOR_VERSION});return;}
        if(s.socket!==socket)return;
        if(m.type==='status'){
          const authorized=m.authorized===true&&typeof m.grant==='string'&&m.grant.length<=100&&m.state?.token&&m.state.isHome===false;
          if((!authorized||s.grant!==m.grant)&&s.pending)failPending(s,'当前工程授权或文档已变化');
          s.authorized=authorized;s.grant=authorized?m.grant:null;s.state=authorized?m.state:null;return;
        }
        if(m.type==='result'&&s.pending?.id===m.requestId){
          const pending=s.pending;let result=m.response;
          if(!s.authorized||pending.grant!==s.grant){pending.finish(failure('NOT_AUTHORIZED','授权已撤回'));return;}
          if(typeof result?.ok!=='boolean'){pending.finish(failure('INVALID_RESPONSE','编辑器返回无效响应'));return;}
          if(result.ok&&pending.save){try{result={...result,result:await saveCopy(result.result)};}catch(e){result=failure('SAVE_FAILED','副本未保存：'+e.message);}}
          pending.finish({...result,...(pending.operationId?{operationId:pending.operationId}:{})});
        }
      }catch{socket.close(1008,'Invalid message');}
    });
    socket.on('close',()=>{clearTimeout(authTimeout);clearInterval(heartbeat);if(s?.socket===socket){s.authorized=false;s.grant=null;s.state=null;failPending(s,'编辑器窗口已关闭或连接中断');}});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;
  await fs.writeFile(stateFile,JSON.stringify(state()),{mode:0o600});await fs.chmod(stateFile,0o600).catch(()=>{});
  return {origin,state:state(),pairURL,call,async close(){if(closed)return;closed=true;for(const s of sessions.values()){failPending(s,'连接器正在关闭');s.socket?.terminate();}for(const t of transports)await t.close().catch(()=>{});wss.close();server.closeAllConnections();await new Promise(r=>server.close(r));try{const saved=JSON.parse(await fs.readFile(stateFile));if(saved.instanceId===instanceId)await fs.unlink(stateFile);}catch{};}};
}
