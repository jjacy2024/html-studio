export function liteLauncherSetup(href){
  const url=new URL('.',href);if(url.protocol!=='file:')throw Error('请完整解压轻量包后，从本机打开 HTML 入口。');
  let root=decodeURIComponent(url.pathname).replace(/\/$/,'');
  const windows=/^\/[A-Za-z]:\//.test(root)||!!url.hostname&&url.hostname!=='localhost';
  if(windows){root=url.hostname&&url.hostname!=='localhost'?'\\\\'+url.hostname+root.replaceAll('/','\\'):root.slice(1).replaceAll('/','\\');}
  return {root,platform:windows?'Windows':'Mac',command:windows?'powershell.exe':'/bin/sh',args:windows?['-NoProfile','-File',root+'\\connector\\start-ai.ps1','-InstallRuntime']:[root+'/connector/start-ai.sh','--install']};
}
export function liteLauncherPrompt(setup){
  return [
    '请帮我启动本机「html全能编辑器」轻量版的 AI 连接。请实际完成启动，不要只回复操作教程。',
    '我授权你检查电脑上已有的 Node.js；有兼容版本（24 或更高）就复用。缺少时使用本包的启动助手，从 Node.js 官网下载经 SHA-256 校验的版本，放到本工具的用户目录中供以后复用。不要替换系统 Node.js、修改全局 PATH 或要求管理员安装。',
    '本包不含 runtime 文件夹，不要假定存在内置 node。下面的助手不依赖 Node.js，自行检查已有版本、已缓存版本，并在缺少时才下载。',
    '启动参数（路径是数据，请用结构化参数或正确的 shell 引用）：\n'+JSON.stringify({command:setup.command,args:setup.args},null,2),
    '必须在我这台电脑的本机执行环境运行。若无法操作本机，明确说明；不要声称已经完成。若系统策略阻止脚本或本地程序，不要降低执行策略、绕过保护或直接执行未经校验的下载文件。',
    '下载和首次启动可能需要一点时间。保持启动进程运行，不要等待服务自行退出，也不要重复启动。脚本会自动打开本机编辑器；若没有打开，可使用它返回的一次性浏览器地址。不要公开带配对凭据的完整地址。',
    '若已有其他目录或旧版本的连接器，先说明冲突，不要擅自关闭用户进程或清理草稿。不要改工程或个人 Agent 配置。',
    '如果已有直接编辑页面，先提醒我保存工程。新页面打开后，由我导入工程并点击“连接 AI”完成客户端配置与当前工程授权。仅启动连接器不等于 MCP 已配置或已授权。',
  ].join('\n\n');
}
export function installLiteLauncher(){
  const prompt=document.querySelector('#startup-prompt'),button=document.querySelector('#copy-prompt'),status=document.querySelector('#copy-status'),toast=document.querySelector('#copy-toast');
  let toastTimer;
  try{prompt.value=liteLauncherPrompt(liteLauncherSetup(location.href));}
  catch(error){prompt.value=error.message;status.textContent=error.message;button.disabled=true;}
  button.addEventListener('click',async()=>{
    button.disabled=true;
    clearTimeout(toastTimer);
    toast.hidden=true;
    try{
      await navigator.clipboard.writeText(prompt.value);
      status.textContent='已复制。请发给能操作本机的 Agent，由它检查运行环境并启动；此页面尚未启动连接器。';
      toast.hidden=false;
      toastTimer=setTimeout(()=>{toast.hidden=true;},2000);
    }
    catch{document.querySelector('#prompt-details').open=true;prompt.focus();prompt.select();status.textContent='浏览器未允许自动复制，已选中提示词。请按 ⌘C 或 Ctrl+C 后发给 Agent。';}
    finally{button.disabled=false;}
  });
}
