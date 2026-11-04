import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {waterfallHTML} from '../tests/svg-waterfall-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.5-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.6-20261030');
const qa=path.join(root,'qa/waterfall-precision-v0.3.6'),reportFile=path.resolve(root,process.env.REGRESSION_REPORT||'qa/latest/all-results.json');
const all=JSON.parse(await fs.readFile(reportFile,'utf8')),waterfalls=all.suites.filter(s=>s.name.startsWith('svg-waterfall-'));
if(all.failedSuites||!all.suites.every(s=>s.pass)||waterfalls.length!==2||waterfalls.some(s=>s.cases.length!==22||!s.report.salesIncluded))throw Error('Full regression and both 22-case waterfall suites with the real report must pass');
const cleanupNotes=all.suites.filter(s=>s.report?.cleanup?.forcedExit).map(s=>({suite:s.name,cleanup:s.report.cleanup}));
const cleanupText=cleanupNotes.length?`自动化收尾记录：${cleanupNotes.map(n=>n.suite).join('、')}组功能检查已通过，但测试浏览器收尾超过时限，由测试脚本退出。完整报告保留 cleanup timeout 与 forcedExit 标记；这不计为功能断言失败，也不表示自动化收尾全程无异常。`:'自动化测试没有记录限时强制退出。';
const examples=await fs.readdir(path.join(previous,'示例文件'));
if(examples.length!==17||examples.some(name=>!/^\d{2}-.*\.html$/.test(name)))throw Error('Previous example inventory changed');
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
const file=path.join(root,'HTML Studio.html');await fs.copyFile(file,path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of examples)await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
await fs.writeFile(path.join(folder,'示例文件/18-小数精度瀑布图.html'),waterfallHTML({gradient:true,subtotal:true,values:[200.12,80.234,-30.156,50.007],titleDecimals:3,totalDecimals:1}));
await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.3.6 本地测试版

用电脑端 Chrome / Edge 打开同目录“HTML Studio.html”，无需 Node.js 或服务器。必要字体内置；其他模板字体可后台下载并缓存，页面原有外部资源仍需可用。

本次修复：SVG 瀑布图画面标签与提示小数位不同，不再被误判为无法保留样式编辑。例如显示 303.8、内部提示为 303.84，核对后可采用精确值参与计算。

双击柱子或选中图表后点击“编辑图表数据”，确认识别结果再绑定。面板显示计算值，画面和提示各自保留原小数位；修改增量后，后续柱子、连接线、小计和终值同步变化。

示例 18 使用单独构造的小数数据，含渐变色和中途小计；可验证改值、撤回、重做、保存重开、预览与导出。旧的页面排序、表格合计、其他图表和模板功能仍保留。

只联动本图。独立的页面主标题、说明卡片、其他图表或台账不会自动改写。真实数据冲突、缺失数据或无法可靠识别的图仍会说明限制，由你决定是否转换。

保存工程便于继续编辑；导出 HTML 可独立打开。请重新打开新版编辑器后使用，旧编辑器窗口不会自动升级。
`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.3.6 测试反馈

系统 / 浏览器版本：
文件、页码和图表：
画面标签、提示文字及面板数值是否一致（允许正常四舍五入）：
修改了哪根柱子，修改前后数值：
柱高、连接线、小计和终值是否正确联动：
填色/渐变、描边、字体、标签格式是否保留：
真实数值冲突时是否提示而非误绑定：
撤回/重做、保存重开、预览、导出是否一致：
是否卡顿及复现步骤：
截图/录屏：
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.3.6

原因：旧识别器要求标签与提示数值几乎完全相等，误拒绝正常的小数舍入。新规则按每个来源自身的小数位核对，优先读取明确数据属性或精确提示；柱形、累计、基线和连接线仍须通过几何校验，真实冲突不会直接绑定。

新绑定保留标签与提示各自的小数格式，面板显示计算值。十进制累计避免浮点尾数；旧 v3 瀑布图绑定仍兼容。此能力针对通用结构，不按某份报告的标题、页码或数值特判。

验证：macOS Chrome，file:// 与本机 HTTP；完整回归 ${all.passed} 项功能检查通过，${all.failedSuites} 个失败套件。瀑布图专项各 22 项，合计 44 项，覆盖真实双击、横纵向、渐变、多精度、舍入小计、真实冲突拒绝、历史、工程、预览、独立导出、再导入及真实报告第 8/19 页。

真实第 19 页测试副本：303.84→323.84 后终值 110.1→130.1，再将 -170→-180 后终值 120.1。原有填色、描边、虚线、字体和小数位保留，原报告文件哈希不变。

${cleanupText}

范围：只修改图表内的数据与图形。主标题、独立说明卡片、其他图表及原始台账不会自动同步；任意脚本、复杂路径、负累计或缺少关键数据的图仍可能需要确认转换。未验证 Windows/Safari 实机。

包内仅有编辑器、说明、许可和 18 份公开/构造示例，不含用户报告、截图、草稿、QA 工程或导出副本。
`);
execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]);a=pathlib.Path(str(p)+'.zip');assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==24
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const archive=folder+'.zip',bytes=await fs.readFile(file),zip=await fs.readFile(archive),hash=b=>createHash('sha256').update(b).digest('hex');
if(!bytes.equals(await fs.readFile(path.join(folder,'HTML Studio.html'))))throw Error('Packaged editor differs from tested standalone');
await fs.copyFile(reportFile,path.join(qa,'full-regression-results.json'));
const summary={version:'0.3.6',date:new Date().toISOString(),checks:all.passed,failedSuites:all.failedSuites,waterfallChecks:waterfalls.reduce((n,s)=>n+s.cases.length,0),automationCleanupNotes:cleanupNotes,standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:24,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
