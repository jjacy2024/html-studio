import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chartHTML} from '../tests/svg-chart-fixtures.mjs';

const version='0.5.0',root=process.cwd(),qa=path.join(root,'qa/lite-v'+version);
const name='html全能编辑器-v'+version+'-轻量版',dir=path.join(root,'releases',name),entry='启动 html全能编辑器.html';
const hash=b=>createHash('sha256').update(b).digest('hex');
const editor=await fs.readFile('HTML Studio.html'),connector=await fs.readFile('connector/connector.cjs');
if(!editor.includes(Buffer.from('<span class="version-tag">'+version+'</span>')))throw Error('Build v'+version+' first');
const icon='data:image/svg+xml;base64,'+(await fs.readFile('dist/favicon.svg')).toString('base64');
const script=(await fs.readFile('launcher/lite/launcher.js','utf8')).replace(/^export\s+/gm,'')+'\ninstallLiteLauncher();';
const html=(await fs.readFile('launcher/lite/launcher.html','utf8')).replaceAll('__VERSION__',version).replaceAll('__PLATFORM__','Mac / Windows · 轻量版').replace('__FAVICON__',icon).replace('/*__LAUNCHER_SCRIPT__*/',()=>script.replace(/<\/script/gi,'<\\/script'));
await fs.mkdir(path.join(dir,'connector'),{recursive:true});await fs.mkdir(qa,{recursive:true});
const files={};
async function write(file,contents,mode=0o644){const b=Buffer.from(contents);await fs.writeFile(path.join(dir,file),b);await fs.chmod(path.join(dir,file),mode);files[file]={sha256:hash(b),bytes:b.length};}
async function copy(file,source){await write(file,await fs.readFile(source));}
await write(entry,html);await write('HTML Studio.html',editor);await write('connector/connector.cjs',connector);
await copy('LICENSE.txt','LICENSE');
await write('connector/start-ai.sh',await fs.readFile('launcher/lite/start-ai.sh'),0o755);
// Windows PowerShell 5.1 requires a BOM to decode Chinese strings reliably.
await write('connector/start-ai.ps1','\ufeff'+(await fs.readFile('launcher/lite/start-ai.ps1','utf8')).replace(/^\ufeff/,''));
await write('启用 AI 连接.command','#!/bin/sh\nTASK_EDITOR_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd)\n/bin/sh "$TASK_EDITOR_DIR/connector/start-ai.sh" "$@"\nTASK_EXIT=$?\nif [ "$TASK_EXIT" -ne 0 ] && [ -t 0 ]; then printf "\\n请查看上方提示。按回车关闭。"; read -r TASK_REPLY; fi\nexit "$TASK_EXIT"\n',0o755);
await write('启用 AI 连接.cmd','@echo off\r\nchcp 65001 >nul\r\nsetlocal DisableDelayedExpansion\r\npowershell.exe -NoProfile -File "%~dp0connector\\start-ai.ps1" %*\r\nset "TASK_EXIT=%ERRORLEVEL%"\r\nif not "%TASK_EXIT%"=="0" pause\r\nexit /b %TASK_EXIT%\r\n');
const previous='licenses';
for(const file of ['04-编辑器第三方许可.txt','05-字体许可.txt','06-连接器第三方许可.txt'])await copy(file,path.join(previous,file));
await write('示例-图表编辑.html',chartHTML({slides:true}));
await copy('编辑器回归报告.html','docs/通用编辑MCP-回归报告-v0.5.0.html');
await write('先读我.txt',`html全能编辑器 v${version} · 轻量版（Mac / Windows 通用）\n\n免费个人非商业使用；未经作者书面授权，禁止商业使用。完整条款见 LICENSE.txt；第三方组件按原有许可证使用。\n\n完整解压，双击「${entry}」。\n手动编辑：直接打开，不需要 Node.js。\nAI 编辑：复制入口里的提示词给能操作本机的 Agent。已有 Node.js 24+ 则复用，缺少时才从官网校验下载。\n本包没有 runtime、.app，也不需要管理员安装或修改系统 Node。\n首次下载需要联网；下载保存在用户目录，以后复用，不进入分享包。\n在新打开的编辑器中点「连接 AI」，完成客户端配置及当前工程授权。\n切换入口前先保存工程，浏览器草稿不自动同步。\nMac 备用入口：启用 AI 连接.command；Windows：启用 AI 连接.cmd。备用入口不自动下载缺少的环境。\n分享整个 ZIP 即可，详见「使用说明.html」。\n`);
const css='body{max-width:860px;margin:40px auto;padding:0 24px 60px;font:16px/1.8 system-ui,sans-serif;background:#faf9fe;color:#302b42}a{color:#6749bf}li{margin:10px 0}h2{margin-top:30px}.note{padding:16px;background:#eee9f8;border-radius:10px}code{overflow-wrap:anywhere}';
await write('使用说明.html',`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>轻量版使用说明</title><style>${css}</style><h1>html全能编辑器 · 轻量版</h1><p>v${version} · Mac / Windows 共用 · 不含 Node.js 运行环境和 .app</p>
<p class="note"><strong>免费个人非商业使用。</strong>未经作者书面授权，禁止用于企业经营、付费项目、收费服务或转售等商业用途。第三方组件仍遵循各自许可证。详见 <a href="LICENSE.txt">完整使用许可</a>。</p>
<h2>直接编辑</h2><ol><li>完整解压，把整个文件夹放到固定位置。</li><li>双击「${entry}」，点击“打开编辑器”；也可直接打开「HTML Studio.html」。推荐 Chrome 或 Edge。</li><li>导入 HTML / .htmlstudio 工程，或从模板新建，进行编辑、预览与导出。</li></ol><p>手动编辑不需要 Node.js。模板中的可选字体及原文件外链资源仍可能需要联网。</p>
<h2>首次使用 AI</h2><ol><li>入口中点击“复制 AI 启动提示词”，发给能操作本机的 Agent。</li><li>启动助手先检查已有 Node.js 24 或更高版本，再检查工具已下载的运行环境；都没有时，才从 nodejs.org 下载对应系统与芯片的 Node.js v24.22.2 并校验 SHA-256。启动时会显示进度。</li><li>在新打开的浏览器编辑器里导入工程，点击“连接 AI”，完成客户端配置与当前工程授权。启动连接器本身不等于 MCP 配置或授权已经完成。</li><li>回到 Agent 刷新工具列表或新建对话，先读取工程确认连接，再提出编辑请求。保留全部 31 项 MCP 工具。</li></ol>
<p class="note">首次缺少运行环境时需要联网，下载约 38–55 MB。私有运行环境安装后占约 100–130 MB 本机磁盘，但不进入分享包。已有兼容 Node.js 时不会下载；手动编辑始终无需下载运行环境。</p>
<h2>下载保存在哪里</h2><ul><li>Mac：<code>~/Library/Application Support/html-studio/runtime/</code></li><li>Windows：<code>%LOCALAPPDATA%\\html-studio\\runtime\\</code></li><li>不同版本的编辑器可复用这里的运行环境，不覆盖系统 Node.js，不修改全局 PATH，不要求管理员权限。</li><li>只下载官网固定版本，通过校验后才运行；同时保留 Node.js 的 LICENSE。网络失败或校验失败会停止，不使用未校验文件。</li></ul>
<h2>后续启动与备用入口</h2><p>可继续使用同一提示词，也可双击 Mac 的「启用 AI 连接.command」或 Windows 的「启用 AI 连接.cmd」。备用入口会复用已有环境；缺少环境时只提示，不静默下载。由 Agent 启动的进程需保持运行；终端启动可按 Ctrl+C 退出。仅关闭浏览器页不一定停止服务。</p><p>如需自行明确允许首次安装：Mac 使用 <code>/bin/sh connector/start-ai.sh --install</code>；Windows 使用 <code>powershell.exe -NoProfile -File connector\\start-ai.ps1 -InstallRuntime</code>（在解压目录执行）。设备策略若限制本地程序或脚本，应联系管理员；本包不会更改 PowerShell 执行策略或绕过限制。</p>
<h2>保存、升级与分享</h2><ul><li>直接编辑与 AI 编辑的浏览器草稿按地址隔离，切换前保存工程，再导入新页面。</li><li>发送完整轻量 ZIP 即可；Mac（Apple / Intel）与 Windows（x64 / ARM64）共用一份包，启动时选择对应运行环境。</li><li>移动文件夹或升级后重新复制提示词，并在“连接 AI”更新客户端路径。</li><li>已有其他目录或旧版服务时会提示冲突，不自动关闭；先保存工程并退出旧服务，再启动新包。</li></ul>
<h2>验证范围</h2><p>编辑器基于 v0.5.0，包含复制反馈、文字编辑退出修复及容器适应内容尺寸功能；核心改动另做相关专项回归。轻量包验证覆盖已有环境复用、按需下载与缓存、失败清理、离线手动编辑及实际 MCP 读写。Windows 仅做脚本与参数静态检查，尚未 Windows 实机验证。</p><p><a href="${encodeURI(entry)}">返回入口</a> · <a href="轻量版测试报告.html">本版测试报告</a> · <a href="编辑器回归报告.html">v0.5.0 初始核心回归报告</a></p></html>`);
if(process.argv.includes('--zip'))await copy('轻量版测试报告.html','docs/轻量版-回归报告-v0.5.0.html');
const manifest={date:new Date().toISOString(),version,name,dir,entry,files,unpackedBytes:Object.values(files).reduce((n,v)=>n+v.bytes,0)};
// Only these explicitly generated files enter the archive. Never sweep downloads, caches or user data.
if(process.argv.includes('--zip')){
  const report=JSON.parse(await fs.readFile(path.join(qa,'results.json'),'utf8'));
  if(report.results.length!==16||report.results.some(r=>!r.pass))throw Error('All 16 lite regression groups must pass before release');
  for(const [f,digest] of Object.entries(report.testedFiles))if(files[f]?.sha256!==digest)throw Error('Changed after tests: '+f);
  execFileSync('python3',['-c',`from pathlib import Path\nimport sys,json,zipfile,hashlib\np=Path(sys.argv[1]); names=json.loads(sys.argv[2]); target=p.with_name(p.name+'.zip')\nwith zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for f in names: z.write(p/f,p.name+'/'+f)\nwith zipfile.ZipFile(target) as z:\n assert z.testzip() is None\n assert len(z.namelist())==len(names)\n for f in names: assert z.read(p.name+'/'+f)==(p/f).read_bytes()\n assert not any('/runtime/' in n or n.endswith(('.app','.exe','.htmlstudio','settings.json','connection.json')) for n in z.namelist())`,dir,JSON.stringify(Object.keys(files))]);
  const bytes=await fs.readFile(dir+'.zip');Object.assign(manifest,{archive:dir+'.zip',archiveBytes:bytes.length,sha256:hash(bytes),crcVerified:true});
}
await fs.writeFile(path.join(qa,'package.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({dir,archive:manifest.archive,unpackedBytes:manifest.unpackedBytes,archiveBytes:manifest.archiveBytes},null,2));
