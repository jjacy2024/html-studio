import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.7-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.8-20261030');
const qa=path.join(root,'qa/template-fit-v0.2.8');
const read=name=>fs.readFile(path.join(qa,name),'utf8').then(JSON.parse);
const report=await read('authoring-results.json'),ui=await read('ui-verification.json'),overlay=await read('overlay-verification.json');
if(report.results.length!==45||report.results.some(r=>!r.pass)||report.errors.length||ui.version!=='0.2.8'||ui.templateViewportChecks!==272||ui.errors.length||!ui.independentListScroll||!ui.search||!ui.previousNextRestart||!ui.dialogReopen||overlay.version!=='0.2.8'||overlay.errors.length||overlay.opacityOutside!==0.12||overlay.opacityInside!==1||!overlay.fadeAfterMouseClick||!overlay.keyboardFocus)throw Error('Template dialog validation must pass');
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
await fs.copyFile(path.join(root,'HTML Studio.html'),path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of ['01-静态页面与动效.html','02-三页演示稿.html','03-表格公式与关联图表.html','04-SVG柱状图原样式数据编辑.html'])await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
const intro=(await fs.readFile(path.join(previous,'01-开始使用.txt'),'utf8')).replaceAll('v0.2.7','v0.2.8').replaceAll('本版调整：','预览操作：');
await fs.writeFile(path.join(folder,'01-开始使用.txt'),intro+'\n本版调整：模板选择弹窗不再整体滚动；只有左侧模板列表独立滚动。右侧预览随窗口剩余空间等比缩放，底部取消、保存和新建按钮始终可见。\n');
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.2.8 测试反馈

系统/浏览器及版本：
窗口尺寸、浏览器缩放比例：
使用的模板或 HTML：
操作步骤：
预期和实际结果：
编辑、预览、导出是否一致：
能否撤回、是否卡顿：
截图/录屏：

本次重点：缩小窗口高度后，模板弹窗无整体滚动条，预览完整，说明与底部按钮可见；左侧列表独立滚动、搜索可用；悬浮按钮仍可翻页、重播与自动淡化。
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.2.8 · 模板弹窗适配窗口高度

模板弹窗按照窗口高度分配空间，取消整体滚动。只有左侧模板列表独立滚动，标题、搜索框和底部操作始终可见。右侧预览按照可用宽高以 16:9 等比缩放；模板说明和字体提示完整保留，较低窗口收紧间距。预览内透明悬浮操作保持原有功能。

验证环境：macOS Chrome。34 个模板逐一在 1161×705、1280×720、1366×768、1440×900、1920×1080、1000×600、800×600、720×540 共 8 种窗口尺寸下检查，共 272 次模板布局检查通过：整体无溢出、预览等比且未裁切、说明完整、底部按钮可见。另检查搜索、空结果、列表独立滚动、翻页/重播、重开弹窗及鼠标/键盘悬浮控件。模板与内容创建回归 45 项通过，无未捕获脚本错误。本次未重跑全部编辑器专项，未验证 Windows 实机与 Safari。

包内仅有编辑器、说明、许可及 4 份人工示例，没有私人 HTML、QA 导出、截图或草稿。必要字体内置，其他模板字体继续后台下载缓存。
`);
execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]);a=pathlib.Path(str(p)+'.zip');assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==10
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const file=path.join(root,'HTML Studio.html'),archive=folder+'.zip',bytes=await fs.readFile(file),zip=await fs.readFile(archive),hash=b=>createHash('sha256').update(b).digest('hex');
const summary={version:'0.2.8',date:new Date().toISOString(),authoringChecks:report.results.length,templateViewportChecks:ui.templateViewportChecks,failed:0,standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:10,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
