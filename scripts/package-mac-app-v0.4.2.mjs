import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chartHTML} from '../tests/svg-chart-fixtures.mjs';

const root=process.cwd(),qa=path.join(root,'qa/mac-app-v0.4.2'),build=path.join(qa,'build');
await fs.mkdir(build,{recursive:true});
const run=(command,args)=>execFileSync(command,args,{stdio:'pipe'});
const sdk=run('xcrun',['--show-sdk-path']).toString().trim(),iconset=path.join(build,'AppIcon.iconset');await fs.mkdir(iconset,{recursive:true});
run('xcrun',['swiftc','launcher/mac/DrawIcon.swift','-o',path.join(build,'draw-icon')]);
run(path.join(build,'draw-icon'),[path.join(build,'app-icon-1024.png')]);
for(const [size,scale] of [[16,1],[16,2],[32,1],[32,2],[128,1],[128,2],[256,1],[256,2],[512,1],[512,2]])run('sips',['-z',String(size*scale),String(size*scale),path.join(build,'app-icon-1024.png'),'--out',path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)]);
run('iconutil',['-c','icns',iconset,'-o',path.join(build,'AppIcon.icns')]);
for(const arch of ['arm64','x86_64'])run('xcrun',['swiftc','-swift-version','5','-O','-sdk',sdk,'-target',arch+'-apple-macos13.5','launcher/mac/Launcher.swift','-o',path.join(build,'HTMLStudioLauncher-'+arch)]);
run('lipo',['-create',path.join(build,'HTMLStudioLauncher-arm64'),path.join(build,'HTMLStudioLauncher-x86_64'),'-output',path.join(build,'HTMLStudioLauncher')]);

const editor=await fs.readFile('HTML Studio.html'),connector=await fs.readFile('connector/connector.cjs');
if(!editor.includes(Buffer.from('<span class="version-tag">0.4.2</span>')))throw Error('Rebuild the v0.4.2 editor first');
const previous=path.join(root,'releases/html全能编辑器-MCP-v0.4.1-mac-Apple芯片'),packages=[];
const hash=data=>createHash('sha256').update(data).digest('hex');
const readme=`html全能编辑器 v0.4.2 · Mac 应用版\n\n1. 完整解压后，将「html全能编辑器.app」拖到“应用程序”文件夹（或你选定的固定位置）。\n2. 双击紫色 H 应用图标，编辑器会在默认浏览器中打开。不再需要终端窗口，也不需要单独安装 Node.js。建议使用 Chrome 或 Edge。\n3. 导入工程后，点击“连接 AI”。Codex 使用“一键配置 Codex 并授权”；其他 Agent 可以复制连接提示词。\n4. Dock 中的应用图标和菜单栏图标都会保持运行。再次点开应用会重新打开编辑器；菜单还可以打开使用指南与导出文件夹。\n5. 退出时从应用菜单选择“退出 html全能编辑器”（⌘Q）。这会停止本应用的 AI 连接，浏览器窗口不会被关闭。\n\n从旧版升级：先保存旧窗口中的工程，退出旧版应用或关闭旧版 .command 启动窗口，再启动新版应用。已有浏览器草稿仍保存在原本机地址下，不会由安装包主动清除。更换端口或浏览器会使用不同的草稿空间；建议通过工程文件迁移。\n\n应用应先放到固定位置，再使用“连接 AI”。移动应用或升级后，再点击一键配置或发送新连接提示词，更新 Agent 中的路径。\n\n系统要求：macOS 13.5 及以上。此包没有 Apple Developer ID 签名或公证；如 macOS 提示开发者无法验证，请在确认文件来源后使用系统“隐私与安全性”中的“仍要打开”流程。无需关闭系统安全功能。\n\n示例文件可直接导入编辑器。详细说明在应用菜单的“使用指南”中。\n`;
for(const [variant,suffix] of [['darwin-arm64','Mac-Apple芯片'],['darwin-x64','Mac-Intel芯片']]){
 const name='html全能编辑器-v0.4.2-'+suffix,dir=path.join(root,'releases',name),app=path.join(dir,'html全能编辑器.app'),contents=path.join(app,'Contents'),resources=path.join(contents,'Resources'),editorRoot=path.join(resources,'Editor');
 await fs.mkdir(path.join(contents,'MacOS'),{recursive:true});await fs.mkdir(path.join(editorRoot,'connector'),{recursive:true});await fs.mkdir(path.join(editorRoot,'runtime'),{recursive:true});
 await fs.copyFile(path.join(build,'HTMLStudioLauncher'),path.join(contents,'MacOS/HTMLStudioLauncher'));await fs.chmod(path.join(contents,'MacOS/HTMLStudioLauncher'),0o755);
 await fs.copyFile(path.join(build,'AppIcon.icns'),path.join(resources,'AppIcon.icns'));
 const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>html全能编辑器</string><key>CFBundleDisplayName</key><string>html全能编辑器</string><key>CFBundleIdentifier</key><string>local.htmlstudio.editor</string><key>CFBundleVersion</key><string>0.4.2</string><key>CFBundleShortVersionString</key><string>0.4.2</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>HTMLStudioLauncher</string><key>CFBundleIconFile</key><string>AppIcon</string><key>LSMinimumSystemVersion</key><string>13.5</string><key>NSHighResolutionCapable</key><true/><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>`;
 await fs.writeFile(path.join(contents,'Info.plist'),plist);await fs.writeFile(path.join(contents,'PkgInfo'),'APPL????');
 await fs.writeFile(path.join(editorRoot,'HTML Studio.html'),editor);await fs.writeFile(path.join(editorRoot,'connector/connector.cjs'),connector);
 for(const file of ['node','LICENSE'])await fs.copyFile(path.join(root,'qa/mcp-v0.4.0/runtimes',variant,file),path.join(editorRoot,'runtime',file));await fs.chmod(path.join(editorRoot,'runtime/node'),0o755);
 await fs.copyFile('docs/Mac应用启动器使用指南-v0.4.2.html',path.join(editorRoot,'02-Agent连接指南.html'));
 try{await fs.copyFile('docs/Mac应用启动器回归报告-v0.4.2.html',path.join(editorRoot,'03-应用启动器回归报告.html'));}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const file of ['04-编辑器第三方许可.txt','05-字体许可.txt','06-连接器第三方许可.txt'])await fs.copyFile(path.join(previous,file),path.join(editorRoot,file));
 await fs.writeFile(path.join(dir,'使用说明.txt'),readme);await fs.writeFile(path.join(dir,'示例-图表编辑.html'),chartHTML({slides:true}));
 run('plutil',['-lint',path.join(contents,'Info.plist')]);
 // Local ad-hoc integrity signature, not Developer ID signing/notarization.
 run('codesign',['--force','--sign','-','--timestamp=none',app]);run('codesign',['--verify','--deep','--strict',app]);
 const files={};for(const file of ['Contents/MacOS/HTMLStudioLauncher','Contents/Info.plist','Contents/Resources/AppIcon.icns','Contents/Resources/Editor/HTML Studio.html','Contents/Resources/Editor/connector/connector.cjs','Contents/Resources/Editor/runtime/node'])files[file]=hash(await fs.readFile(path.join(app,file)));
 packages.push({variant,name,dir,app,root:editorRoot,executable:path.join(contents,'MacOS/HTMLStudioLauncher'),files});
}
await fs.writeFile(path.join(qa,'packages.json'),JSON.stringify({date:new Date().toISOString(),packages},null,2));console.log(JSON.stringify(packages.map(({variant,app})=>({variant,app})),null,2));
if(process.argv.includes('--zip')){
 for(const p of packages){
  run('ditto',['-c','-k','--sequesterRsrc','--keepParent',p.dir,p.dir+'.zip']);
  run('python3',['-c',`import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n assert not any(n.endswith(('connection.json','settings.json','.htmlstudio')) for n in z.namelist())`,p.dir+'.zip']);
  const archive=await fs.readFile(p.dir+'.zip');Object.assign(p,{archive:p.dir+'.zip',archiveBytes:archive.length,sha256:hash(archive),crcVerified:true});
 }
 await fs.writeFile(path.join(qa,'packages.json'),JSON.stringify({date:new Date().toISOString(),packages},null,2));console.log('Mac application archives verified.');
}
