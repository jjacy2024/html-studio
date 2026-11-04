// Optional local MCP bridge. Standalone file editing works without a connector.
import {agentConnectionPrompt} from './agent-setup.js';
export function installAgentBridge(editor,api,{modal,closeModal,toast}) {
  const button=document.querySelector('#agent-connect'),storageKey='html-studio-bridge-v1';
  const bridgeEscape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let credential=null,socket=null,connected=false,grant=null,grantEpoch=null,pending=null,setup=null,lastStatus='',reconnecting=false,setupError='',events=[],installBusy=false,lastAgent='',preferredClient='codex',feedback='';
  const local=location.protocol==='http:'&&location.hostname==='127.0.0.1';
  const isGranted=()=>!!grant&&grantEpoch===editor.documentEpoch&&!editor.isHome;
  const record=(name,status)=>{events.unshift({time:new Date().toLocaleTimeString('zh-CN',{hour12:false}),name,status});events=events.slice(0,12);renderStatus();};
  const send=message=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
  function sync(){
    if(grant&&grantEpoch!==editor.documentEpoch)revoke('已切换工程，请重新授权');
    if(!connected)return;const data={type:'status',authorized:isGranted(),grant:isGranted()?grant:null,state:isGranted()?api.getState():null},json=JSON.stringify(data);
    if(json!==lastStatus){send(data);lastStatus=json;}
  }
  function renderStatus(){
    const authorized=isGranted();button.textContent=pending?'AI 执行中':authorized?'AI 已授权':'连接 AI';button.classList.toggle('agent-connected',authorized);button.title=authorized?'已允许配置的 Agent 访问当前工程，点击管理或断开':'连接本机 Agent';
    const status=document.querySelector('#agent-live-status');if(status)status.textContent=setupError||(!connected?'尚未连接本地启动器':authorized?`已授权当前工程：${editor.name}`:'连接器已就绪，尚未授权工程');
    const allow=document.querySelector('#agent-allow');if(allow)allow.disabled=!connected||editor.isHome||editor.loading;
    const revokeButton=document.querySelector('#agent-revoke');if(revokeButton)revokeButton.disabled=!authorized;
    const permission=document.querySelector('#agent-permission-status');if(permission)permission.textContent=authorized?'当前工程已授权':editor.isHome?'请先导入工程':'当前工程待授权';
    const received=document.querySelector('#agent-received-status');if(received)received.textContent=lastAgent?'已收到 Agent 请求':'等待 Agent 验证连接';
    const install=document.querySelector('#agent-install');if(install){install.disabled=installBusy||!connected;install.textContent=installBusy?'正在配置…':editor.isHome?'一键配置 Codex':'一键配置 Codex 并授权';}
    const copy=document.querySelector('#agent-copy-prompt');if(copy){copy.disabled=installBusy||!connected;copy.textContent=editor.isHome?'复制连接提示词':'复制连接提示词并授权';}
    const client=document.querySelector('#agent-client');if(client)client.disabled=installBusy;
    const next=document.querySelector('#agent-next-step');if(next)next.textContent=feedback;
    const log=document.querySelector('#agent-log');if(log)log.replaceChildren(...events.map(e=>{const item=document.createElement('li');item.textContent=`${e.time} · ${e.name} · ${e.status}`;return item;}));
  }
  function revoke(reason){const was=!!grant;grant=null;grantEpoch=null;lastAgent='';pending?.controller.abort();lastStatus='';sync();if(was&&reason){feedback=reason+'。再次操作前请授权当前工程。';record(reason,'授权已收回');}renderStatus();}
  window.addEventListener('html-studio-document-change',()=>revoke('已切换工程，请重新授权'));
  const configText=client=>{
    if(!setup)return '';
    const entry={command:setup.command,args:setup.args};
    if(client==='codex')return '[mcp_servers.html_studio]\ncommand = '+JSON.stringify(entry.command)+'\nargs = '+JSON.stringify(entry.args)+'\nstartup_timeout_sec = 15\ntool_timeout_sec = 60\n';
    if(client==='doubao')return '服务器类型：HTTP / Streamable HTTP\n服务器名称：html全能编辑器\n服务器地址：'+setup.url+'\n自定义 Header 名称：Authorization\n自定义 Header 值：'+setup.headers.Authorization;
    return JSON.stringify({mcpServers:{html_studio:{type:'stdio',...entry}}},null,2);
  };
  function fillConfig(){
    const select=document.querySelector('#agent-client'),text=document.querySelector('#agent-config'),help=document.querySelector('#agent-client-help');if(!select||!text)return;
    text.value=configText(select.value);
    preferredClient=select.value;
    help.textContent=({codex:setup.codex?.configured?'已检测到此版本的 Codex 配置。授权工程后，回到 Codex 验证连接即可。':'点击一键配置会自动备份并合并 Codex 设置，保留其他服务；也可以把连接提示词发给 Codex。',workbuddy:'复制提示词，发给电脑上的 WorkBuddy，让它帮助配置并检查连接。',qwen:'复制提示词，发给电脑上的千问办公，让它帮助配置并检查连接。',doubao:'复制提示词，发给豆包工作。本机执行环境及自定义连接器的支持情况取决于客户端版本。'})[select.value];
    document.querySelector('#agent-install').hidden=select.value!=='codex';
    document.querySelector('#agent-prompt').value=agentConnectionPrompt(select.value,setup);
    renderStatus();
  }
  function grantAccess(){
    if(!connected||editor.isHome||editor.loading)return false;
    if(!isGranted()){grant=crypto.randomUUID();grantEpoch=editor.documentEpoch;lastStatus='';sync();record('允许访问当前工程','已授权');}
    renderStatus();return true;
  }
  async function copyField(field,details){
    try{await navigator.clipboard.writeText(field.value);return true;}
    catch{if(details)details.open=true;field.focus();field.select();toast('浏览器未允许自动复制，请按 ⌘/Ctrl+C 复制已选中的内容');return false;}
  }
  async function show(){
    if(credential&&connected){try{const response=await fetch('/api/setup',{method:'POST',headers:{Authorization:'Bearer '+credential.browserToken}});if(!response.ok)throw Error('请重新双击启动器打开编辑器');setup=await response.json();setupError='';}catch(e){setup=null;setupError=e.message;}}
    const body=modal('连接你的 AI 助手',`<div class="agent-connection"><p id="agent-live-status" role="status"></p>${!setup?'<p>打开「html全能编辑器」应用或安装包内的启动器，即可启用 AI 连接。</p><p>若当前窗口有未保存内容，请先保存工程，再在启动器打开的窗口导入。</p>':`<div class="agent-progress"><span>本地启动器已就绪</span><span id="agent-permission-status"></span><span id="agent-received-status"></span></div><label class="agent-client-label">你的 AI 助手 <select id="agent-client"><option value="codex">Codex</option><option value="workbuddy">WorkBuddy</option><option value="qwen">千问办公</option><option value="doubao">豆包工作</option></select></label><p id="agent-client-help"></p><div class="agent-quick-actions"><button id="agent-install" class="primary-button"></button><button id="agent-copy-prompt" class="text-button"></button></div><p class="source-note">打开工程后，以上按钮会同时允许 AI 访问当前工程。配置通常只需一次；升级或移动安装包后可再次点击更新。</p><p id="agent-next-step" class="agent-next-step" role="status" aria-live="polite"></p><p class="agent-reload-help">完成配置后，回到 Agent 新建对话验证；工具未出现时重新加载 MCP 或重启 Agent。</p><details id="agent-prompt-details" class="agent-details"><summary>查看连接提示词</summary><textarea id="agent-prompt" class="agent-config agent-prompt" readonly aria-label="连接提示词" spellcheck="false"></textarea></details><details id="agent-advanced" class="agent-details"><summary>高级设置 · 手动配置</summary><textarea id="agent-config" class="agent-config" readonly aria-label="Agent 连接配置" spellcheck="false"></textarea><button id="agent-copy" class="text-button">复制原始配置</button><p class="source-note">已有配置时只合并 html_studio 项。HTTP 配置含本机凭据，请勿公开或随安装包分享。副本保存到：${bridgeEscape(setup.exportDir)}。</p></details>`}<div class="agent-permission"><p>AI 可读取并编辑当前工程的文字、样式、布局、图层和图表/表格数据，切换页面、撤回重做、预览并保存副本。改变响应式布局或拆散容器时，会要求先确认影响。</p><p class="source-note">换工程、刷新或断线后会收回授权。使用云端模型时，Agent 读取的内容可能发送给模型服务。</p><button id="agent-allow" class="text-button">允许访问当前工程</button><button id="agent-revoke" class="text-button">收回授权</button></div><details class="agent-activity"><summary>最近操作</summary><ul id="agent-log"></ul></details></div>`,[{label:'关闭',run:closeModal}]);
    document.querySelector('#dialog').dataset.kind='agent';
    body.querySelector('#agent-allow').onclick=()=>{if(grantAccess()){closeModal();toast('已授权当前工程，可以回到 Agent 发送请求');}};
    body.querySelector('#agent-revoke').onclick=()=>revoke('用户收回授权');
    if(setup){
      body.querySelector('#agent-client').value=preferredClient;
      body.querySelector('#agent-client').onchange=()=>{feedback='';fillConfig();};
      body.querySelector('#agent-copy').onclick=async()=>{if(await copyField(body.querySelector('#agent-config'),body.querySelector('#agent-advanced')))toast('已复制原始配置');};
      body.querySelector('#agent-copy-prompt').onclick=async()=>{
        const epoch=editor.documentEpoch;
        if(await copyField(body.querySelector('#agent-prompt'),body.querySelector('#agent-prompt-details'))){const allowed=epoch===editor.documentEpoch&&grantAccess();feedback='提示词已复制'+(allowed?'，当前工程已授权':'')+'。发给所选 Agent，让它完成配置并验证连接。';renderStatus();toast('连接提示词已复制');}
        else{feedback='未自动复制。请按 ⌘/Ctrl+C 复制已选中的提示词；工程未授权时，点击下方「允许访问当前工程」。';renderStatus();}
      };
      body.querySelector('#agent-install').onclick=async()=>{
        if(installBusy)return;const epoch=editor.documentEpoch;installBusy=true;feedback='正在备份并配置 Codex…';renderStatus();
        try{const response=await fetch('/api/setup/codex',{method:'POST',headers:{Authorization:'Bearer '+credential.browserToken,'Content-Type':'application/json'},body:JSON.stringify({confirm:true})});const result=await response.json();if(!response.ok)throw Error(result.error||'配置失败，请使用连接提示词');setup.codex=result;const allowed=epoch===editor.documentEpoch&&grantAccess();feedback=(result.changed?'Codex 配置已完成':'Codex 配置已就绪')+(allowed?'，当前工程已授权。':'。请导入工程并授权。')+'回到 Codex 新建对话验证；工具未出现时重启 Codex。';if(result.backupPath)record('备份 Codex 配置',result.backupPath);record('一键配置 Codex','配置已就绪，等待 Agent 验证');}
        catch(e){feedback=e.message;record('一键配置 Codex','未完成');}
        finally{installBusy=false;fillConfig();}
      };
      fillConfig();
    }
    renderStatus();
  }
  async function connect(){
    if(!local||!credential||reconnecting||socket?.readyState===WebSocket.CONNECTING||socket?.readyState===WebSocket.OPEN)return;
    reconnecting=true;const ws=new WebSocket(location.origin.replace('http:','ws:')+'/bridge');socket=ws;
    ws.onopen=()=>send({type:'hello',sessionId:credential.sessionId,token:credential.browserToken});
    ws.onmessage=async event=>{
      if(socket!==ws)return;let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.type==='connected'){connected=true;reconnecting=false;lastStatus='';sync();renderStatus();return;}
      if(message.type==='cancel'){if(pending?.id===message.requestId)pending.controller.abort();return;}
      if(message.type!=='command')return;
      const responseError=(code,text)=>({ok:false,error:{code,message:text}});
      if(!isGranted()||message.grant!==grant){send({type:'result',requestId:message.requestId,response:responseError('NOT_AUTHORIZED','当前工程未授权')});return;}
      if(pending){send({type:'result',requestId:message.requestId,response:responseError('BUSY','上一操作未完成')});return;}
      lastAgent=message.client||'Agent';
      const controller=new AbortController(),ownGrant=grant,id=message.requestId;
      pending={id,controller};record(`${message.client} · ${message.request.command}`,'执行中');
      let response;try{response=await api.execute(message.request,{signal:controller.signal});}catch(e){response=responseError('OPERATION_FAILED',e.message);}
      if(controller.signal.aborted||grant!==ownGrant)response=responseError('CANCELLED','操作已中止；已完成的编辑仍可撤回，请重新读取确认');
      pending=null;sync();send({type:'result',requestId:id,response});record(message.request.command,response.ok?'已完成':response.error?.message||'未完成');
    };
    ws.onclose=event=>{if(socket!==ws)return;connected=false;reconnecting=false;revoke('本地连接已断开');if(event.code===1008){credential=null;try{sessionStorage.removeItem(storageKey);}catch{}setupError='连接已过期，请重新双击启动器';}renderStatus();};
    ws.onerror=()=>{};
  }
  async function boot(){
    if(!local)return;
    const hash=new URLSearchParams(location.hash.slice(1)),token=hash.get('hs-connect');
    if(token){hash.delete('hs-connect');history.replaceState(null,'',location.pathname+location.search+(hash.size?'#'+hash:''));try{const response=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const result=await response.json();if(!response.ok)throw Error(result.error);credential=result;sessionStorage.setItem(storageKey,JSON.stringify(credential));}catch(e){setupError=e.message;}}
    else try{credential=JSON.parse(sessionStorage.getItem(storageKey));}catch{}
    if(credential)connect();renderStatus();
  }
  button.onclick=show;
  setInterval(()=>{sync();renderStatus();if(!connected)connect();},1000);
  window.addEventListener('pagehide',()=>{revoke();socket?.close();});boot();
}
