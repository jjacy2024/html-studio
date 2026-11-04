import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chartSVG} from '../tests/svg-chart-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.8-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.9-20261030');
const qa=path.join(root,'qa/svg-category-colors-v0.2.9');
const report=JSON.parse(await fs.readFile(path.join(qa,'file-results.json'),'utf8'));
const render=JSON.parse(await fs.readFile(path.join(qa,'render-verification.json'),'utf8'));
if(report.results.length!==32||report.results.some(r=>!r.pass)||report.errors.length||!report.salesIncluded||render.version!=='0.2.9'||!render.stylesPreserved||!render.fontsPreserved)throw Error('SVG category color validation must pass');
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
await fs.copyFile(path.join(root,'HTML Studio.html'),path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of ['01-静态页面与动效.html','02-三页演示稿.html','03-表格公式与关联图表.html','04-SVG柱状图原样式数据编辑.html'])await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
await fs.writeFile(path.join(folder,'示例文件/05-彩色单系列条形图.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>彩色单系列条形图示例</title><style>body{margin:40px;background:#fffdf5;font:16px Arial,sans-serif}svg{display:block;max-width:100%;height:auto;background:white;border:2px solid black;padding:20px;box-sizing:content-box}h1{font-size:28px}</style><h1>每个分类使用不同颜色</h1><p>人工示例：导入 HTML Studio 后双击柱形，确认绑定，再修改数值。各柱填色和描边保留。</p>${chartSVG({horizontal:true,categoryColors:true})}</html>`);
const intro=(await fs.readFile(path.join(previous,'01-开始使用.txt'),'utf8')).replaceAll('v0.2.8','v0.2.9').replaceAll('本版调整：','模板弹窗：');
await fs.writeFile(path.join(folder,'01-开始使用.txt'),intro+'\n本版修复：单系列 SVG 柱状图或条形图中，每个分类使用不同颜色时，也能优先保留样式编辑数据。可用“示例文件/05-彩色单系列条形图.html”测试。\n');
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.2.9 测试反馈

系统/浏览器及版本：
使用的 HTML、页码和图表：
操作步骤：
预期和实际结果：
编辑、预览、导出是否一致：
能否撤回、是否卡顿：
截图/录屏：

本次重点：单系列各分类不同颜色的 SVG 柱状图/条形图，双击柱子或右侧“编辑图表数据…”可以保留原样式建立绑定；编辑后柱长/高度与数值同步变化；填色、描边保留，撤回、预览及导出正常。
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.2.9 · 修复单系列按分类配色的图表识别

旧规则把“同一系列颜色一致”也用于单系列图表，导致每个分类使用不同颜色时误判为无法保留样式。本版只对多系列继续检查颜色对应，单系列按位置、数值、线性刻度和共同零基线绑定。横向和纵向均适用，修改数值时保留每根柱子的独立颜色与描边。

验证：macOS Chrome 本地单文件图表专项 32 项通过，无未捕获脚本错误。包括用户销售复盘原文件第 4、5 页、真实双击、识别确认、彩色横向/纵向图表、量程扩展、撤回/重做、预览/导出和多系列颜色歧义保护。另对第 5 页的原稿与导出渲染逐项比较字体、填色与描边，保温杯从 840 改为 900 后条长同步变化。原稿文件哈希保持不变。未重跑全部编辑器专项，未验证 Windows 实机或 Safari。

适用范围：带数字标签、线性刻度、共同零基线的普通非负数矩形 SVG 柱状图/条形图。任意 Canvas、路径柱形、堆叠、瀑布、负数、复杂变换和脚本图表尚不能通用地原样编辑。右侧占比、页面合计、独立说明和台账不会随本图自动重算。

包内仅含编辑器、说明、许可与 5 份人工示例，不含用户原始报告、QA 导出、截图或草稿。必要字体内置，其他模板字体继续后台下载缓存。
`);
execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]);a=pathlib.Path(str(p)+'.zip');assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==11
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const file=path.join(root,'HTML Studio.html'),archive=folder+'.zip',bytes=await fs.readFile(file),zip=await fs.readFile(archive),hash=b=>createHash('sha256').update(b).digest('hex');
const summary={version:'0.2.9',date:new Date().toISOString(),chartChecks:report.results.length,failed:0,render,standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:11,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
