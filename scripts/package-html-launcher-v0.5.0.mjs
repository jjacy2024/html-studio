import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chartHTML} from '../tests/svg-chart-fixtures.mjs';

const version='0.5.0',root=process.cwd(),qa=path.join(root,'qa/html-launcher-v'+version),packages=[];
await fs.mkdir(qa,{recursive:true});
const editor=await fs.readFile('HTML Studio.html'),connector=await fs.readFile('connector/connector.cjs');
if(!editor.includes(Buffer.from('<span class="version-tag">'+version+'</span>')))throw Error('Build the current standalone editor first');
const source=await fs.readFile('launcher/html/launcher.html','utf8'),script=(await fs.readFile('launcher/html/launcher.js','utf8')).replace(/^export\s+/gm,''),icon='data:image/svg+xml;base64,'+(await fs.readFile('dist/favicon.svg')).toString('base64');
const previous='releases/html全能编辑器-MCP-v0.4.1-mac-Apple芯片',hash=b=>createHash('sha256').update(b).digest('hex');
const css='body{max-width:860px;margin:40px auto;padding:0 24px 60px;font:16px/1.8 system-ui,sans-serif;background:#faf9fe;color:#302b42}a{color:#6749bf}li{margin:10px 0}h2{margin-top:30px}.note{padding:16px;background:#eee9f8;border-radius:10px}code{overflow-wrap:anywhere}';
for(const [variant,suffix,platform] of [['darwin-arm64','Mac-Apple芯片','Mac · Apple 芯片'],['darwin-x64','Mac-Intel芯片','Mac · Intel 芯片'],['win-x64','Windows-x64','Windows · x64']]){
  const name='html全能编辑器-v'+version+'-HTML入口-'+suffix,dir=path.join(root,'releases',name),windows=variant==='win-x64',launcher=windows?'启用 AI 连接.cmd':'启用 AI 连接.command',entry='启动 html全能编辑器.html';
  await fs.mkdir(path.join(dir,'runtime'),{recursive:true});await fs.mkdir(path.join(dir,'connector'),{recursive:true});
  const code=script+'\ninstallHTMLLauncher('+JSON.stringify({variant})+');';
  const html=source.replaceAll('__VERSION__',version).replaceAll('__PLATFORM__',platform).replaceAll('__SCRIPT_NAME__',launcher).replace('__FAVICON__',icon).replace('/*__LAUNCHER_SCRIPT__*/',()=>code.replace(/<\/script/gi,'<\\/script'));
  await fs.writeFile(path.join(dir,entry),html);await fs.writeFile(path.join(dir,'HTML Studio.html'),editor);await fs.writeFile(path.join(dir,'connector/connector.cjs'),connector);
  const binary=windows?'node.exe':'node',runtime=path.join(dir,'runtime',binary),staging=runtime+'.new';await fs.copyFile(path.join(root,'qa/mcp-v0.4.0/runtimes',variant,binary),staging);await fs.chmod(staging,0o755);await fs.rename(staging,runtime);await fs.copyFile(path.join(root,'qa/mcp-v0.4.0/runtimes',variant,'LICENSE'),path.join(dir,'runtime/LICENSE'));
  const launch=windows?'@echo off\r\nchcp 65001 >nul\r\nsetlocal\r\n"%~dp0runtime\\node.exe" "%~dp0connector\\connector.cjs" serve --root "%~dp0." %*\r\nif errorlevel 1 pause\r\n':'#!/bin/zsh\nTASK_EDITOR_DIR="${0:a:h}"\nexec "$TASK_EDITOR_DIR/runtime/node" "$TASK_EDITOR_DIR/connector/connector.cjs" serve --root "$TASK_EDITOR_DIR" "$@"\n';
  await fs.writeFile(path.join(dir,launcher),launch,{mode:0o755});
  for(const file of ['04-编辑器第三方许可.txt','05-字体许可.txt','06-连接器第三方许可.txt'])await fs.copyFile(path.join(previous,file),path.join(dir,file));
  await fs.writeFile(path.join(dir,'示例-图表编辑.html'),chartHTML({slides:true}));
  await fs.writeFile(path.join(dir,'使用说明.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HTML 入口版使用说明</title><style>${css}</style><h1>html全能编辑器 · HTML 入口版</h1><p>v${version} · ${platform} · 本包不包含 .app</p><h2>双击 HTML 即可使用</h2><ol><li>完整解压，把整个文件夹放到固定位置。</li><li>双击「${entry}」，点击“打开编辑器”。也可以直接双击同目录的「HTML Studio.html」。</li><li>导入 HTML / .htmlstudio 工程或从模板新建，按需编辑、保存工程与导出。</li></ol><p>手动编辑使用与 v0.5.0 应用包完全相同的编辑器，不需要启动连接器。模板中尚未缓存的可选字体等外部资源仍可能需要网络。</p><h2>需要 AI 编辑时</h2><ol><li>在 HTML 入口点击“复制启动提示词”，发给能操作本机的 Agent。提示词会根据当前文件夹位置生成，不包含连接密钥。</li><li>Agent 启动本地连接器后，会打开一个新的浏览器编辑页面。如果 Agent 不能运行本机程序，请在文件夹中双击「${launcher}」并保持启动窗口运行。</li><li>在新页面导入工程，点击“连接 AI”，沿用现有的一键配置或连接提示词流程，并授权当前工程。配置完成不等于已经收到 Agent 请求。</li><li>回到 Agent 的新对话，或刷新 MCP 工具列表，先让它读取工程确认连接，再发送编辑请求。共有 31 个工具。</li></ol><p class="note">纯 HTML 受浏览器限制，不能直接执行本地 Node 或启动 MCP。HTML 入口不会绕过系统安全策略。若电脑连本地运行环境也不允许执行，可使用手动编辑模式；MCP 需要获得设备策略允许。</p><h2>保存、升级与退出</h2><ul><li>直接编辑与 AI 编辑的草稿按浏览器地址隔离，不自动同步；切换前保存工程，再导入另一入口。</li><li>仅移动或发送 HTML 入口会丢失相邻资源，请分享完整压缩包。只需手动编辑时，可单独打开「HTML Studio.html」。</li><li>移动安装文件夹或升级后，重新复制启动提示词，并在编辑器“连接 AI”中更新客户端路径。</li><li>已有旧版服务时，不会自动停止旧版。先保存工程并退出旧版启动器，再启动新包。</li><li>手动编辑关闭浏览器页即可。通过脚本启动的 AI 服务在终端按 Ctrl+C 退出；由 Agent 启动的服务可让该 Agent 停止。仅关闭浏览器页不一定停止后台服务。</li><li>Windows 与 Mac 使用各自的运行环境，不能混用安装包。Mac Apple 芯片与 Intel 包分别提供。</li></ul><h2>验证范围</h2><p>编辑器核心沿用 v0.5.0；本入口另测文件路径、离线打开、提示词复制与失败回退、移动目录、备用脚本和 MCP 连接。具体结果见同目录的入口测试报告。Windows 未进行实机运行。</p><p><a href="${encodeURI(entry)}">返回 HTML 入口</a> · <a href="编辑器回归报告.html">v0.5.0 编辑器回归报告</a></p></html>`);
  await fs.copyFile('docs/通用编辑MCP-回归报告-v0.5.0.html',path.join(dir,'编辑器回归报告.html'));
  await fs.writeFile(path.join(dir,'先读我.txt'),`html全能编辑器 v${version} · HTML 入口版\n\n完整解压后，双击“${entry}”。\n手动编辑：点击“打开编辑器”，无需运行 .app 或连接器。\nAI 编辑：复制启动提示词给本机 Agent；也可双击“${launcher}”。\n浏览器中的 HTML 无法自行启动本机程序；如果本地程序也受设备策略限制，只能使用手动编辑模式。\n切换入口前先保存工程，两种地址下的草稿不自动同步。\n请分享整个安装包，不要只分享入口 HTML。详情见“使用说明.html”。\n`);
  const files={};for(const file of [entry,'HTML Studio.html','connector/connector.cjs','runtime/'+binary,launcher,'使用说明.html'])files[file]=hash(await fs.readFile(path.join(dir,file)));
  packages.push({variant,name,dir,entry,launcher,files});
}
async function saveManifest(){await fs.writeFile(path.join(qa,'packages.json'),JSON.stringify({date:new Date().toISOString(),version,packages},null,2));}
await saveManifest();console.log(JSON.stringify(packages.map(({variant,dir})=>({variant,dir})),null,2));
if(process.argv.includes('--zip')){
  for(const p of packages){await fs.copyFile('docs/HTML入口-回归报告-v0.5.0.html',path.join(p.dir,'入口测试报告.html'));
    execFileSync('python3',['-c',`from pathlib import Path\nimport sys,zipfile\np=Path(sys.argv[1]);target=p.with_name(p.name+'.zip')\nwith zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:\n for f in sorted(p.rglob('*')):\n  if f.is_file(): z.write(f,f.relative_to(p.parent))\nwith zipfile.ZipFile(target) as z:\n assert z.testzip() is None\n assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()\n assert not any('.app/' in n or n.endswith(('.htmlstudio','settings.json','connection.json')) for n in z.namelist())`,p.dir]);
    const bytes=await fs.readFile(p.dir+'.zip');Object.assign(p,{archive:p.dir+'.zip',archiveBytes:bytes.length,sha256:hash(bytes),crcVerified:true});
  }await saveManifest();console.log('HTML-entry archives verified.');
}
