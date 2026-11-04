// This page never starts native processes, probes localhost, or changes settings.
export function htmlLauncherPaths(href,variant){
  const url=new URL('.',href);if(url.protocol!=='file:')throw Error('请完整解压安装包后，双击本机的 HTML 入口文件。');
  let root=decodeURIComponent(url.pathname).replace(/\/$/,'');
  if(variant==='win-x64'){
    if(url.hostname&&url.hostname!=='localhost')root='\\\\'+url.hostname+root.replaceAll('/','\\');
    else{if(!/^\/[A-Za-z]:\//.test(root))throw Error('这是 Windows 安装包，请在 Windows 电脑上打开；Mac 请使用对应的 Mac 包。');root=root.slice(1).replaceAll('/','\\');}
  }else{
    if(url.hostname&&url.hostname!=='localhost'||/^\/[A-Za-z]:\//.test(root))throw Error('这是 Mac 安装包，请在 Mac 上打开。');
  }
  const separator=variant==='win-x64'?'\\':'/';
  return {root,command:root+separator+'runtime'+separator+(variant==='win-x64'?'node.exe':'node'),connector:root+separator+'connector'+separator+'connector.cjs'};
}
export function htmlLauncherPrompt(paths,variant){
  const launch={command:paths.command,args:[paths.connector,'serve','--root',paths.root]};
  return [
    '请帮我启动本机的「html全能编辑器」AI 连接器。请实际启动，不要只回复教程。此请求仅授权启动本包的本地服务并打开编辑器，不修改工程或 Agent 配置。',
    '必须在我这台电脑上操作。若你不能执行本机程序，请明确说明，让我使用安装包中的备用启动脚本。不要尝试绕过系统或单位的安全策略。',
    '安装包类型：'+variant+'。先确认下面的文件存在，使用内置运行时，不要下载、安装其他运行环境。路径均是数据，不能作为 shell 代码拼接；请使用结构化进程参数或正确的 shell 引用。',
    '启动参数：\n'+JSON.stringify(launch,null,2),
    '保持此连接器进程运行，不要等服务自行退出，也不要在回复结束时关闭它。浏览器将自动打开；若没有自动打开，使用启动器输出的一次性本机地址打开。不要把含配对凭据的完整地址公开到聊天或截图中。',
    '若提示旧版本或其他目录的服务正在运行，不要直接终止或清理用户进程、草稿和配置；先说明冲突。不要因为等待超时而重复启动多个服务。',
    '若已有手动编辑页面，请保留它，提醒我先保存工程，再在新打开的 AI 编辑页面导入；两个入口的浏览器草稿不自动同步。',
    '确认编辑器页面能打开后，告诉我点击右上角“连接 AI”，在页面中完成客户端配置和当前工程授权。仅启动服务不等于已经连接 Agent；不要声称 MCP 已配置或工程已授权。',
  ].join('\n\n');
}
export function installHTMLLauncher(config){
  const prompt=document.querySelector('#startup-prompt'),status=document.querySelector('#copy-status'),copy=document.querySelector('#copy-prompt'),details=document.querySelector('#prompt-details');
  try{prompt.value=htmlLauncherPrompt(htmlLauncherPaths(location.href,config.variant),config.variant);}
  catch(error){copy.disabled=true;status.textContent=error.message;prompt.value=error.message;}
  copy.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(prompt.value);status.textContent='启动提示词已复制。发给能操作本机的 AI 助手；连接器尚未由此页面启动。';}
    catch{details.open=true;prompt.focus();prompt.select();status.textContent='浏览器未允许自动复制。已选中提示词，请按 ⌘C 或 Ctrl+C，再发给 AI 助手。';}
  });
}
