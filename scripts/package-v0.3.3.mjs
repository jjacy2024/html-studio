import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {bubbleHTML} from '../tests/svg-bubble-fixtures.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.2-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.3-20261030');
const qa=path.join(root,'qa/svg-bubble-v0.3.3');
const reportFile=path.join(root,'qa/latest/all-results.json');
const all=JSON.parse(await fs.readFile(reportFile,'utf8'));
const bubble=all.suites.filter(s=>s.name.startsWith('svg-bubble-'));
if(all.failedSuites||!all.suites.every(s=>s.pass)||bubble.length!==2||bubble.some(s=>!s.pass||s.cases.length!==17||!s.report.salesIncluded))throw Error('Full regression with both bubble suites and the real report must pass before packaging');
const examples=await fs.readdir(path.join(previous,'示例文件'));
if(examples.length!==12||examples.some(name=>!/^\d{2}-.*\.html$/.test(name)))throw Error('Previous example inventory changed; inspect before packaging');
await fs.mkdir(folder);
await fs.mkdir(path.join(folder,'示例文件'));
const file=path.join(root,'HTML Studio.html');
await fs.copyFile(file,path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of examples)await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
await fs.writeFile(path.join(folder,'示例文件/13-SVG气泡图.html'),bubbleHTML());
await fs.writeFile(path.join(folder,'示例文件/14-SVG渐变气泡图.html'),bubbleHTML({gradient:true,order:['size','y','x']}));

await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.3.3 本地测试版

用电脑端 Chrome / Edge 打开同目录“HTML Studio.html”。无需 Node.js 或服务器。必要字体内置；其他模板字体可后台下载并缓存，页面原有外部资源仍需可用。

新增 SVG 气泡图原样编辑：导入示例 13 / 14，双击气泡或标签，也可选中图表后点“编辑图表数据…”。核对 X / Y / 面积的字段名称、单位和数值后确认绑定。修改 X / Y 改变位置，修改面积数值改变气泡大小；数值翻倍时面积翻倍，半径扩大为根号二。

沿用原坐标范围、零线和背景分区；越界输入提示且不应用。百分比直接输入 10 表示 10%，不需要 %。保留填色、渐变、描边、字体与原提示；有引线的标签保持原位置，引线随气泡移动；无引线的标签按原偏移移动。

图表外独立表格、标题、占比和说明不会自动联动，请另行修改。保存工程便于继续编辑；导出 HTML 可独立打开。无法可靠保留样式时会先说明，由你决定是否转换。
`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.3.3 测试反馈

系统 / 浏览器版本：
文件、页码及图表：
复现步骤：
预期与实际：
识别的名称、X、Y、面积数值及单位是否正确：
坐标位置、气泡面积和引线是否同步：
配色、渐变、描边、字体和背景分区是否保留：
越界、无效输入是否明确提示且保留原图：
关闭、Escape、撤回/重做是否正常：
编辑、保存重开、预览和导出是否一致：
是否卡顿，截图/录屏：
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.3.3

新增 SVG 气泡图原样编辑：读取 title、aria-label 或 data-x / data-y / data-size 的三项数值，与双线性坐标轴、圆形位置及面积比例核对。按整图一致关系确定字段对应，不依赖固定模板、分类或字段顺序；支持正负坐标、零面积、相等 X/Y 和原提示四舍五入。

修改后更新气泡位置、面积、标签引线和提示信息，保留填色、渐变、描边、字体与原数值格式。原坐标轴、零线、背景分区及有引线标签的排布保留；无引线标签随气泡平移。不自动处理气泡遮挡或标签重叠。

这版沿用原坐标范围，面板底部显示范围；超范围输入不应用。面积非负、数值不超过 1 万亿，半径不超过绘图区短边的一半。不增删数据点，不自动识别对数轴、椭圆/路径气泡、半径正比而非面积正比、内部变换、数据缺失/冲突或复杂标签关系。外部脚本若重新绘图，需核对预览。

只修改当前图表；独立表格、标题、占比、卡片和业务台账仍需另行编辑。原有柱状图、堆叠图、瀑布图、HTML/CSS 和 Chart.js 柱状图编辑继续保留。

验证：macOS Chrome，本地单文件和 HTTP 两种方式；完整回归 ${all.passed} 项检查通过，${all.failedSuites} 个失败套件。新增气泡图专项每种方式 17 项，含真实双击、取消保护、位置/面积/引线、正负与零值、原样式与渐变、字段顺序、三类数据来源、无效输入、撤回重做、保存重开、预览导出、复制与锁定、损坏绑定和小窗口。

实际销售报告第 9 页的 6 个气泡均识别成功。将升降桌增长率改为 50%、利润率由 -8.9% 改为 5%、净销售由 520 改为 1,040 后，位置与面积同步变化，面积翻倍，引线同步更新；原背景、配色、描边、字体及独立表格保留。原报告文件未修改。未验证 Windows 实机或 Safari。

包内只有编辑器、说明、许可和 14 份人工示例；不包含用户报告、QA 导出、截图或草稿。
`);

execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]);a=pathlib.Path(str(p)+'.zip');assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==20
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const archive=folder+'.zip',bytes=await fs.readFile(file),zip=await fs.readFile(archive);
const hash=b=>createHash('sha256').update(b).digest('hex');
if(!bytes.equals(await fs.readFile(path.join(folder,'HTML Studio.html'))))throw Error('Packaged editor differs from tested standalone');
await fs.copyFile(reportFile,path.join(qa,'full-regression-results.json'));
const summary={version:'0.3.3',date:new Date().toISOString(),checks:all.passed,failedSuites:all.failedSuites,bubbleChecks:bubble.reduce((n,s)=>n+s.cases.length,0),standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:20,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
