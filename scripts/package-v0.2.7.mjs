import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.6-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.7-20261030');
const qa=path.join(root,'qa/template-overlay-v0.2.7');
const report=JSON.parse(await fs.readFile(path.join(qa,'authoring-results.json'),'utf8'));
const ui=JSON.parse(await fs.readFile(path.join(qa,'ui-verification.json'),'utf8'));
const checks=['transparentBackground','insidePreview','iframeHover','iframeExit','clickIframe','previousNextRestart','fadeAfterMouseClick','keyboardFocus','narrowLayout','reducedMotion','dialogReopen'];
if(report.results.length!==45||report.results.some(r=>!r.pass)||report.errors.length||ui.version!=='0.2.7'||checks.some(k=>!ui[k])||ui.opacityOutside!==0.12||ui.opacityInside!==1||ui.errors.length)throw Error('Template overlay validation must pass');
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
await fs.copyFile(path.join(root,'HTML Studio.html'),path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of ['01-静态页面与动效.html','02-三页演示稿.html','03-表格公式与关联图表.html','04-SVG柱状图原样式数据编辑.html'])await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
const intro=(await fs.readFile(path.join(previous,'01-开始使用.txt'),'utf8')).replaceAll('v0.2.6','v0.2.7').replaceAll('本版操作：','图表操作：').replaceAll('本版调整：','图层操作：');
await fs.writeFile(path.join(folder,'01-开始使用.txt'),intro+'\n本版调整：模板预览的上一页、下一页、重新播放和页数移到画面内左下角，以透明背景悬浮。鼠标移入整个预览区时清晰显示，移出后淡至 12% 不透明度；键盘聚焦时保持清晰。\n');
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.2.7 测试反馈

系统/浏览器及版本：
使用的模板或 HTML：
操作步骤：
预期和实际结果：
编辑、预览、导出是否一致：
能否撤回、是否卡顿：
截图/录屏：

本次重点：模板预览中的悬浮操作，鼠标移入/移出和点击后的淡化，上一页/下一页/重新播放，浅色与深色模板的清晰度，以及窄窗口中的按钮位置。
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.2.7 · 模板预览悬浮操作

上一页、下一页、重新播放和页数从预览下方移至画面内左下角。控件和按钮背景透明，鼠标移入整个预览区域时不透明度为 100%，移出后为 12%，过渡为 180 毫秒。点击按钮后移出同样淡化；键盘聚焦时清晰显示；触屏设备保持显示；减少动态效果设置取消过渡动画。

补充了沙箱预览内部的鼠标状态同步，修复直接移入预览时浏览器未传递外层悬停的问题；关闭弹窗会清理相关监听。模板切换、翻页和重播继续使用原有流程。

验证：macOS Chrome 的模板与内容创建回归 45 项通过，包含 34 个模板、页面管理、表格公式、关联图表和视频流程。另使用实际鼠标验证透明背景、控件位于预览内、移入/移出及再次进入、点击预览、翻页/重播、点击按钮后移出淡化、键盘聚焦、1000 像素宽窗口、减少动态效果和重开弹窗；检查深浅模板截图，无未捕获脚本错误。本次未重跑全部编辑器专项，Windows 实机与 Safari 未验证。

包内仅有编辑器、说明、许可及 4 份人工示例，没有私人 HTML、QA 导出、截图或草稿。必要字体内置，其他模板字体继续后台下载缓存。此前图层集中到左侧及图表优先保留样式的流程保持不变。
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
const summary={version:'0.2.7',date:new Date().toISOString(),authoringChecks:report.results.length,failed:0,ui,standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:10,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
