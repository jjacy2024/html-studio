import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chartHTML} from '../tests/svg-chart-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.3-20261029');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.4-20261030');
const qa=path.join(root,'qa/svg-charts-v0.2.4');
const report=JSON.parse(await fs.readFile(path.join(root,'qa/latest/all-results.json'),'utf8'));
if(report.failedSuites||['svg-charts-file','svg-charts-http'].some(name=>!report.suites.find(s=>s.name===name&&s.cases.length>=21&&s.pass)))throw Error('Current complete regression including SVG chart suites must pass');
await fs.mkdir(folder); // Preserve previous releases; never overwrite.
await fs.mkdir(path.join(folder,'示例文件'));
await fs.copyFile(path.join(root,'HTML Studio.html'),path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of ['01-静态页面与动效.html','02-三页演示稿.html','03-表格公式与关联图表.html'])await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
await fs.writeFile(path.join(folder,'示例文件/04-SVG柱状图原样式数据编辑.html'),chartHTML());
await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.2.4 本地测试版 · 2026-10-30

请先保存旧版编辑器中的工程。解压后用电脑端 Chrome 打开“HTML Studio.html”。无需安装、Node.js 或服务器；文件在本地处理。

本次新增：导入 SVG 柱状图，直接改数据并保持原样式
1. 导入“示例文件/04-SVG柱状图原样式数据编辑.html”，或自己的 HTML。
2. 双击一根柱子（或数值标签），核对识别的月份/系列/数值后点击“绑定并编辑数据”。也可先选中整图，在右侧点击“识别柱状图数据 · 保留样式”。
3. 修改对应数据格，柱长和数字标签立即更新；超过原量程会扩展刻度并统一缩放全部柱形。
4. 点“完成”返回画布。可以撤回/重做、预览、保存工程、导出 HTML。导出的 SVG 直接显示修改结果，重新导入仍可继续编辑数据。

边界
- 本轮支持带数字标签和线性刻度、零基线、非负数的普通/分组 SVG 矩形柱状图，包括横向条形图。分类、系列数量暂时不能增删。
- 本图以外的表格、标题比例、其他图表和业务台账不自动联动。请按需要单独核对这些内容。
- 堆叠、瀑布、负数、路径柱形、Canvas、复杂变换或无法可靠识别的图表会保留原图，可使用原有“转换为数据图表”入口重建。

其他功能入口
- 顶部“从模板新建”：34 个模板，可看封面、预览、翻页后创建。
- 导入 HTML 或 .htmlstudio 工程。左侧图层联动定位；双击普通文字可直接编辑。
- 左侧“插入”：文字/图形/视频、表格和内置柱状/折线/饼图。普通表格支持基础公式与关联图表。
- 多页文件左侧“管理页面”：任意位置新增、批量复制/删除。
- 右侧图层区或右键“解除组合 / 拆散容器”；复杂布局转换前会说明影响，可撤回。

字体与离线
编辑器内置 Inter、Space Grotesk、JetBrains Mono。其他模板字体首次使用会后台下载，当前文档优先；下载前先用系统替代字体。可在画布上方的字体按钮查看进度、暂停和重试。成功后缓存在当前浏览器，清理浏览器数据或换浏览器可能需要重下。
下载访问 fonts.gstatic.com，不上传用户 HTML。工程和导出会携带文档所需的已下载字体；缺少字体时可取消、重试，或明确选择保留在线链接继续。含中文/日文字体或视频的导出文件仍可能较大。

“保存工程”下载 .htmlstudio；“导出 HTML”下载可直接展示的网页。自动草稿不能替代文件备份。建议先保存工作再导入新文件。
`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.2.4 测试反馈

系统/浏览器版本：
使用的模板或 HTML：
复现步骤：
预期结果：
实际结果（能否撤回、是否卡顿）：
编辑/预览/导出分别有什么问题：
截图或录屏（如方便）：

本轮重点：双击柱子后定位数据；确认识别是否正确；修改数值/零值/超过原刻度；颜色描边是否保留；撤回重做；导出重开；复制图表/页面后分别改数。
`);
const extraCount=report.suites.filter(s=>s.name.startsWith('svg-charts-')).reduce((n,s)=>n+s.cases.length,0);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.2.4 · SVG 图表数据编辑

新增：直接识别结构清晰的 SVG 柱状图，确认后绑定数值，编辑时同步更新柱长、数字标签和刻度，保留原 SVG 的样式和分类。双击柱形或数字可进入对应数据格；支持数据编辑撤回/重做、工程保存、HTML 导出和复制后的独立编辑。

另修复：幻灯片脚本在隔离预览中使用 history.pushState / replaceState 更新 #页码时误用编辑器地址。仅将片段地址解析到预览自身，仍保留浏览器跨源与父窗口隔离，不改原脚本或导出内容。

验证：macOS Chrome 完整回归 ${report.passed} 项通过，0 个失败测试组。其中本次 SVG 专项单文件与 HTTP 共 ${extraCount} 项，含真实销售复盘文件的第 4 页、真实鼠标双击、图表数值映射、预览翻页及独立导出。也包含既有述职稿、merchant 文件与 34 个模板的回归。原始私人 HTML 未修改。字体组首次在测试浏览器关闭阶段超时，调整测试脚本的上下文清理后独立复跑 40 项通过；本地完整报告保留了两次记录。

这不代表任意 HTML、任意图表或所有脚本都能兼容；Windows 实机和 Safari 未验证。之前已知的旋转半透明嵌套 iframe 预览差异不在此次修复范围。超长数字/很多系列时请核对标签是否重叠。其他表格、标题比例和业务台账不会自动跟随本图数据变化。

分发包只含编辑器、说明、第三方许可、字体许可和 4 份人工示例；不含用户私人文件、QA 导出、截图或草稿。继续使用必要字体内置、其他字体后台下载缓存的方案。
`);
const archive=folder+'.zip';
execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]); a=pathlib.Path(str(p)+'.zip')
assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file(): z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==10
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const bytes=await fs.readFile(path.join(root,'HTML Studio.html')),archiveBytes=await fs.readFile(archive),sha=b=>createHash('sha256').update(b).digest('hex');
const summary={version:'0.2.4',date:new Date().toISOString(),environment:'macOS Chrome',passed:report.passed,svgChecks:extraCount,failedSuites:report.failedSuites,standalone:{path:path.join(root,'HTML Studio.html'),bytes:bytes.length,sha256:sha(bytes)},archive:{path:archive,bytes:archiveBytes.length,sha256:sha(archiveBytes),files:10,crcVerified:true,editorMatchesStandalone:true}};
await fs.copyFile(path.join(root,'qa/latest/all-results.json'),path.join(qa,'full-regression-results.json'));
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
