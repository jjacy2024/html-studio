import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reorderFixture} from '../tests/page-reorder-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.4-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.5-20261030');
const qa=path.join(root,'qa/page-reorder-v0.3.5'),reportFile=path.resolve(root,process.env.REGRESSION_REPORT||'qa/latest/all-results.json');
const all=JSON.parse(await fs.readFile(reportFile,'utf8')),orderSuites=all.suites.filter(s=>s.name.startsWith('page-reorder-'));
if(all.failedSuites||!all.suites.every(s=>s.pass)||orderSuites.length!==2||orderSuites.some(s=>s.cases.length!==14||!s.report.salesIncluded))throw Error('Full regression and both 14-case reorder suites with the real report must pass');
const examples=await fs.readdir(path.join(previous,'示例文件'));
if(examples.length!==16||examples.some(name=>!/^\d{2}-.*\.html$/.test(name)))throw Error('Previous example inventory changed');
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
const file=path.join(root,'HTML Studio.html');await fs.copyFile(file,path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of examples)await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
await fs.writeFile(path.join(folder,'示例文件/17-页面拖拽排序.html'),reorderFixture(20));
await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.3.5 本地测试版

用电脑端 Chrome / Edge 打开同目录“HTML Studio.html”，无需 Node.js 或服务器。必要字体内置；其他模板字体可后台下载并缓存，页面原有外部资源仍需可用。

页面排序：导入演示 HTML，点击左侧“管理页面”，拖动每页左侧手柄到紫色落点后松开。停在列表顶部/底部会自动滚动。Esc 或在列表外松开可取消。也可聚焦手柄，按 Alt + 上/下方向键排序。

每次拖动一页，勾选仍用于批量复制/删除。排序保留当前编辑页和勾选项，支持撤回/重做，保存工程和导出 HTML 均保留新顺序。示例 17 有 20 页，可测试长列表排序及翻页。

页面内手写的页码、目录文字、固定跳转索引或独立讲稿不会自动重写，请预览核对。锁定的页面需要解锁后才能拖动。

前版表格样式保留与自动合计仍可在示例 15/16 验证。保存工程便于继续编辑；导出 HTML 可独立打开。旧版已丢失的样式需要撤回或重新导入原文件恢复。
`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.3.5 测试反馈

系统 / 浏览器版本：
文件及总页数：
拖动哪页、移到何处：
紫色落点是否清楚，列表边缘是否自动滚动：
当前页、勾选项、页面内容是否正确保留：
Esc 取消、原位松开、锁定页面是否正常：
排序后新增、复制、删除是否正常：
撤回/重做、保存重开、预览翻页、导出是否一致：
原稿中固定页码、目录、讲稿是否需要手动核对：
卡顿或其他问题及复现步骤：
截图/录屏：
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.3.5

新增：管理演示页面弹窗支持拖动单页排序、紫色插入线、边缘自动滚动、当前页标记、Alt+方向键、取消拖动。移动原始页面节点，保留内容、ID、样式、勾选项和当前页。一次有效移动对应一次撤回。

保护：原位和越界放下不改变文档；锁定页面、锁定容器、单页、过期弹窗和文档切换受到保护。关闭弹窗解除指针捕获和监听。文件仍为本地独立版本。

范围：改变 HTML 页节点顺序。按 DOM 顺序读取的原生播放跟随新顺序；手写页码、正文目录、复杂位置选择器、脚本固定索引和独立讲稿数组不会自动重写，需预览核对。勾选不表示批量拖动。

验证：macOS Chrome，本地 file:// 与本机 HTTP 两种入口，完整回归 ${all.passed} 项检查通过，${all.failedSuites} 个失败套件。新增页序专项两种入口各 14 项，包含实际鼠标拖动、触控事件、边缘滚动、键盘、历史、保存/导出及真实 26 页销售报告。真实报告原生翻页和动态目录采用新页序；原文件哈希保持不变。没有验证 Windows/Safari 或触屏实机。

自动化收尾记录：字体组 40 项功能检查全部通过，测试浏览器关闭超过 10 秒，由测试脚本限时退出。完整报告保留 cleanup timeout 与 forcedExit 标记；这项测试进程收尾问题不计为功能断言失败，也不能据此声称测试收尾全程无异常。

此前表格样式与合计、图表数据编辑、模板、字体、视频、图层和基本编辑能力仍保留。

包内仅有编辑器、说明、许可和 17 份公开/构造示例，不包含用户报告、草稿、QA 导出或截图。
`);
execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]);a=pathlib.Path(str(p)+'.zip');assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==23
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const archive=folder+'.zip',bytes=await fs.readFile(file),zip=await fs.readFile(archive),hash=b=>createHash('sha256').update(b).digest('hex');
if(!bytes.equals(await fs.readFile(path.join(folder,'HTML Studio.html'))))throw Error('Packaged editor differs from tested standalone');
await fs.copyFile(reportFile,path.join(qa,'full-regression-results.json'));
const summary={version:'0.3.5',date:new Date().toISOString(),checks:all.passed,failedSuites:all.failedSuites,pageOrderChecks:orderSuites.reduce((n,s)=>n+s.cases.length,0),standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:23,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
