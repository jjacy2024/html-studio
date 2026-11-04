import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chartHTML} from '../tests/svg-chart-fixtures.mjs';
const root=process.cwd(),releaseRoot=path.join(root,'releases'),runtimeRoot=path.join(root,'qa/mcp-v0.4.0/runtimes'),packages=[];
await fs.mkdir(releaseRoot,{recursive:true});
const hash=data=>createHash('sha256').update(data).digest('hex');
const editor=await fs.readFile('HTML Studio.html'),connector=await fs.readFile('connector/connector.cjs');
if(!editor.includes(Buffer.from('<span class="version-tag">0.4.0</span>')))throw Error('Incorrect editor version');
const previous='releases/html全能编辑器-v0.3.16-20261103';
async function licenseFiles(dir){const out=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isDirectory()&&!entry.name.startsWith('.'))out.push(...await licenseFiles(path.join(dir,entry.name)));else if(entry.isFile()&&/^licen[cs]e(?:[.\-_]|$)/i.test(entry.name))out.push(path.join(dir,entry.name));}return out;}
let licenses='html全能编辑器 MCP 连接器第三方许可\n\nNode.js 的许可见 runtime/LICENSE。以下为构建依赖的许可（包含部分仅用于构建的依赖）。\n';
for(const f of await licenseFiles('connector/node_modules'))licenses+='\n\n'+f+'\n'+await fs.readFile(f,'utf8');
for(const [variant,suffix] of [['darwin-arm64','mac-Apple芯片'],['darwin-x64','mac-Intel芯片'],['win-x64','Windows-x64']]){
 const name='html全能编辑器-MCP-v0.4.0-'+suffix,dir=path.join(releaseRoot,name);await fs.mkdir(path.join(dir,'runtime'),{recursive:true});await fs.mkdir(path.join(dir,'connector'),{recursive:true});
 await fs.writeFile(path.join(dir,'HTML Studio.html'),editor);await fs.writeFile(path.join(dir,'connector/connector.cjs'),connector);
 const binary=variant.startsWith('win')?'node.exe':'node';await fs.copyFile(path.join(runtimeRoot,variant,binary),path.join(dir,'runtime',binary));if(binary==='node')await fs.chmod(path.join(dir,'runtime',binary),0o755);await fs.copyFile(path.join(runtimeRoot,variant,'LICENSE'),path.join(dir,'runtime/LICENSE'));
 const launcher=variant.startsWith('win')?'启动 html全能编辑器.cmd':'启动 html全能编辑器.command';
 await fs.writeFile(path.join(dir,launcher),variant.startsWith('win')?'@echo off\r\nchcp 65001 >nul\r\nsetlocal\r\n"%~dp0runtime\\node.exe" "%~dp0connector\\connector.cjs" serve %*\r\nif errorlevel 1 pause\r\n':'#!/bin/zsh\nTASK_EDITOR_DIR="${0:A:h}"\nexec "$TASK_EDITOR_DIR/runtime/node" "$TASK_EDITOR_DIR/connector/connector.cjs" serve "$@"\n',{mode:0o755});
 await fs.copyFile('docs/MCP连接使用指南-v0.4.0.html',path.join(dir,'02-Agent连接指南.html'));
 await fs.writeFile(path.join(dir,'示例-图表编辑.html'),chartHTML({slides:true}));
 await fs.copyFile(path.join(previous,'03-第三方许可.txt'),path.join(dir,'04-编辑器第三方许可.txt'));
 await fs.copyFile(path.join(previous,'04-字体许可.txt'),path.join(dir,'05-字体许可.txt'));
 await fs.writeFile(path.join(dir,'06-连接器第三方许可.txt'),licenses);
 await fs.writeFile(path.join(dir,'01-开始使用.txt'),`html全能编辑器 v0.4.0 · MCP 本地连接版\n\n1. 将整个文件夹解压到固定位置，双击“${launcher}”。无需另外安装 Node.js；保持启动窗口打开。\n2. 浏览器打开后，点击右上角“连接 AI”，选择 Codex / WorkBuddy / 千问办公 / 豆包工作，按引导添加配置。\n3. 导入 HTML 或 .htmlstudio 工程，点击“连接 AI → 允许访问当前工程”。初次测试可以导入本包的“示例-图表编辑.html”。\n4. 回到 Agent 的新对话中说：“请使用 html_studio MCP，列出当前已授权的工程和图表，先不要修改。”\n5. 然后尝试：“把实际系列的 6 月数据改为 1900，保持样式，打开预览。”\n6. 保存副本默认到电脑的“下载 / html全能编辑器导出”，同名文件会增加序号，不会覆盖原文件。\n\n本版支持图表/表格数据及预览保存，文字与布局的 Agent 编辑将在下一阶段提供。\n直接双击 HTML Studio.html 仍可手动编辑，但不会连接 Agent。旧窗口草稿与启动器网页草稿分开保存，请先保存工程再迁移。\n\n关闭启动窗口会断开连接；切换工程、刷新或断线后需要重新授权。移动安装文件夹后需要重新复制命令配置。\n配置含本机凭据，请不要将生成的连接配置发给别人；分享本安装包即可，每个人会生成自己的凭据。\n\n更多说明：打开“02-Agent连接指南.html”。\n验证边界：标准 STDIO/HTTP MCP 与 Chrome 已测试；Codex 配置经 CLI 解析验证，未自动修改个人配置；WorkBuddy、千问办公、豆包工作尚未逐一运行完整客户端任务。Windows 包未在 Windows 实机验证。\n`);
 const manifest={};for(const file of ['HTML Studio.html','connector/connector.cjs','runtime/'+binary,launcher,'02-Agent连接指南.html','示例-图表编辑.html'])manifest[file]=hash(await fs.readFile(path.join(dir,file)));
 packages.push({variant,name,dir,launcher,files:manifest});
}
await fs.writeFile('qa/mcp-v0.4.0/packages.json',JSON.stringify({date:new Date().toISOString(),packages},null,2));
console.log(JSON.stringify(packages.map(({variant,dir})=>({variant,dir})),null,2));
if(process.argv.includes('--zip')){
 for(const p of packages){const report=path.join(root,'docs/MCP连接回归报告-v0.4.0.html');await fs.copyFile(report,path.join(p.dir,'03-回归测试报告.html'));
  execFileSync('python3',['-c',`from pathlib import Path\nimport sys,zipfile\np=Path(sys.argv[1]);target=p.with_name(p.name+'.zip')\nwith zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for f in sorted(p.rglob('*')):\n  if f.is_file(): z.write(f,f.relative_to(p.parent))\nwith zipfile.ZipFile(target) as z:\n assert z.testzip() is None\n assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()\n assert not any(x.endswith(('.htmlstudio','settings.json','connection.json')) for x in z.namelist())`,p.dir]);
  const archive=await fs.readFile(p.dir+'.zip');p.archive=p.dir+'.zip';p.archiveBytes=archive.length;p.archiveSHA256=hash(archive);p.crcVerified=true;
 }
 await fs.writeFile('qa/mcp-v0.4.0/packages.json',JSON.stringify({date:new Date().toISOString(),packages},null,2));console.log('All ZIP archives verified.');
}
