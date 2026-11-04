import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {waterfallHTML} from '../tests/svg-waterfall-fixtures.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.1-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.2-20261030');
const qa=path.join(root,'qa/svg-waterfall-v0.3.2');
const reportFile=path.join(root,'qa/latest/all-results.json');
const all=JSON.parse(await fs.readFile(reportFile,'utf8'));
const waterfall=all.suites.filter(s=>s.name.startsWith('svg-waterfall-'));
if(all.failedSuites||!all.suites.every(s=>s.pass)||waterfall.length!==2||waterfall.some(s=>!s.pass||s.cases.length!==16||!s.report.salesIncluded)) {
  throw Error('Full regression with both waterfall suites and the real report must pass before packaging');
}
const examples=await fs.readdir(path.join(previous,'示例文件'));
if(examples.length!==10||examples.some(name=>!/^\d{2}-.*\.html$/.test(name)))throw Error('Previous example inventory changed; inspect before packaging');
await fs.mkdir(folder);
await fs.mkdir(path.join(folder,'示例文件'));
const file=path.join(root,'HTML Studio.html');
await fs.copyFile(file,path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of examples)await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
await fs.writeFile(path.join(folder,'示例文件/11-SVG纵向瀑布图.html'),waterfallHTML());
await fs.writeFile(path.join(folder,'示例文件/12-SVG横向渐变瀑布图与小计.html'),waterfallHTML({horizontal:true,subtotal:true,gradient:true}));

await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.3.2 本地测试版

用电脑端 Chrome / Edge 打开同目录“HTML Studio.html”。无需 Node.js 或服务器。必要字体内置；其他模板字体可后台下载并缓存，页面原有外部资源仍需可用。

新增 SVG 瀑布图原样编辑：导入示例 11 / 12，双击柱子或选中图表后点“编辑图表数据…”。核对分类、起始值、增量和合计后确认绑定。修改起始值或正负增量时，后续柱子、连接线与终值同步变化；中途小计和终值自动计算，不可直接输入。

保留原图配色、渐变、描边、字体和数值格式；正负变号且原图配色含义明确时，沿用对应正负配色。图表外独立标题、占比、指标卡和台账不会自动联动。

保存工程便于继续编辑；导出 HTML 可独立打开。超出支持范围会先说明并询问是否转换，不会自动替换原图。
`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.3.2 测试反馈

系统 / 浏览器版本：
文件、页码及图表：
复现步骤：
预期与实际：
识别到的分类、起始值、增量和合计是否正确：
后续柱子、连接线、数值标签、小计及终值是否同步：
配色、渐变、描边、字体是否保留：
正负变号时的配色是否符合预期：
关闭、Escape、撤回/重做是否正常：
编辑、保存重开、预览和导出是否一致：
是否卡顿，截图/录屏：
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.3.2

新增 SVG 瀑布图（增量桥）原样编辑。按矩形、基线、分类、每条连接线与明确数值识别，支持纵向/横向、正负增量、中途小计、零增量及零起点，不依赖固定模板或分类名称。数值可来自原标签、title、aria-label 或 data-value；多个来源与几何交叉校验，不仅凭像素猜测数据。

修改同步更新后续柱形、连接线、现有数值标签及提示，小计和终值自动求和。超出原范围时统一缩放；存在受支持的线性刻度时同步更新。原 SVG 节点、填色、渐变、描边、字体及数值格式保留。正负变号仅在原图正负配色明确时沿用对应填充；含义不明则保留原色并提示。

起始值和每一步累计值须在 0 至 1 万亿之间；不增删分类。不自动处理累计穿过零线、复杂路径/内部变换、非线性坐标、缺失连接线或数据冲突。无法可靠保留样式时仍先说明并确认转换。外部脚本重新绘制 SVG 的页面需核对预览结果。

只修改当前图表；独立标题、指标卡、占比、说明、表格及原始台账不会自动联动。例如图表中升降桌从 -50 改为 -80 后，页面独立卡片中的“-50万元”仍需手动编辑。

验证：macOS Chrome，本地单文件和 HTTP 两种方式；完整回归 ${all.passed} 项检查通过，${all.failedSuites} 个失败套件。新增瀑布图专项每种方式 16 项，含实际鼠标双击、取消保护、累计几何和连接线、只读合计、渐变和变号、量程扩展、错误输入、撤回重做、保存重开、预览导出、复制隔离、受限结构拒绝和小窗口布局。实际销售报告第 8 页的 8 根柱子识别成功，升降桌 -50 改为 -80 后终值 3,860 改为 3,830，原文件未修改。未验证 Windows 实机或 Safari。

包内只有编辑器、说明、许可和 12 份人工示例；不包含用户报告、QA 导出、截图或草稿。前 10 份示例继续覆盖原有功能。
`);

execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]);a=pathlib.Path(str(p)+'.zip');assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==18
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const archive=folder+'.zip',bytes=await fs.readFile(file),zip=await fs.readFile(archive);
const hash=b=>createHash('sha256').update(b).digest('hex');
const packaged=await fs.readFile(path.join(folder,'HTML Studio.html'));
if(!bytes.equals(packaged))throw Error('Packaged editor differs from tested standalone');
await fs.copyFile(reportFile,path.join(qa,'full-regression-results.json'));
const summary={version:'0.3.2',date:new Date().toISOString(),checks:all.passed,failedSuites:all.failedSuites,waterfallChecks:waterfall.reduce((n,s)=>n+s.cases.length,0),standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:18,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
