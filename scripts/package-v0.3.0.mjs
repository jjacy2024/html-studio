import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {htmlBarsHTML,canvasHTML} from '../tests/non-svg-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.9-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.0-20261030');
const report=JSON.parse(await fs.readFile(path.join(root,'qa/latest/all-results.json'),'utf8'));
if(report.failedSuites||!report.suites.filter(s=>s.name.startsWith('non-svg-charts-')).every(s=>s.pass)||report.suites.filter(s=>s.name.startsWith('non-svg-charts-')).length!==2)throw Error('Full regression including both non-SVG modes must pass');
if(createHash('sha256').update(await fs.readFile(path.join(root,'HTML Studio.html'))).digest('hex')!==report.verifiedStandaloneSha256)throw Error('Standalone changed since final chart verification');
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
await fs.copyFile(path.join(root,'HTML Studio.html'),path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of await fs.readdir(path.join(previous,'示例文件')))await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
await fs.writeFile(path.join(folder,'示例文件/06-HTML渐变条形图.html'),htmlBarsHTML());
await fs.writeFile(path.join(folder,'示例文件/07-HTML纵向动画柱形.html'),htmlBarsHTML({vertical:true,animated:true}));
await fs.writeFile(path.join(folder,'示例文件/08-ChartJS渐变分组柱形.html'),canvasHTML());
await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.3.0 本地测试版\n\n用电脑端 Chrome / Edge 打开同目录的“HTML Studio.html”。无需安装 Node.js，无需启动服务器。\n\n导入自己的 HTML，或从模板新建。必要字体已内置；其他模板字体可后台下载并缓存。网页本身的外部资源仍需可用。\n\n本次重点：选中图表，使用右侧“编辑图表数据…”；也可双击柱子。首次确认绑定后修改数值，检查原渐变、描边、圆角与阴影。无法保留样式时会先询问是否转换。可用示例 06、07、08 测试 HTML/CSS 与 Chart.js 图表。\n\nCanvas 绑定前可能空白；选中其外框后进入编辑数据。绑定成功后显示图表。保存工程便于继续编辑；导出 HTML 可独立打开。\n\n旧版本与旧文件均未覆盖。包内没有私人报告或测试截图。\n`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.3.0 测试反馈\n\n系统和浏览器版本：\n使用的 HTML、页码及图表：\n复现步骤：\n预期与实际：\n是否可双击进入、能否识别正确分类和数值：\n渐变、颜色、描边、圆角是否保留：\n编辑、预览、保存重开、导出是否一致：\n撤回/重做是否正常，有无卡顿：\n截图或录屏：\n`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.3.0\n\nHTML/CSS：普通单系列、非负数、带分类及数字标签、共同零基线且比例一致的横条/纵柱。保留渐变等原样式，只改数字及尺寸。当前不支持增删外来图表分类，也不自动重算独立说明/其他指标。\n\nCanvas：全局 Chart.js 3/4 普通柱状图，固定分类/系列、线性数值轴与数字数组。通过原配置重绘，覆盖分组、横向、负数、库原生堆叠。支持简单 CanvasGradient；不包含任意自定义 Canvas、模块私有图表、Chart.js 2、混合或动态数据图。不能保留时先说明并确认转换。\n\n编辑态不执行原脚本，图表识别/更新在隔离预览副本中完成。导出保留源 Canvas 尺寸、原脚本与数据覆盖运行时，仍依赖原脚本/资源成功加载。\n\n验证：macOS Chrome，本地单文件与本地 HTTP 两种运行方式，${report.passed} 项自动化检查通过，${report.failedSuites} 个失败套件；覆盖原有 SVG、文字双击、模板与分组、字体、分页、稳定性和新增图表测试。实际 HTML/CSS 模板 5 种、Chart.js 模板 3 种；包含延迟初始化、编辑/预览/导出、导出后再次编辑。人工渐变 Chart.js 样例的编辑缓存与导出 Canvas PNG 完全一致。未验证 Windows 实机或 Safari，不代表任意 HTML 均可自动适配。\n\n仅包含编辑器、说明、许可及 8 份人工示例；不包含用户原报告、QA 导出、截图或草稿。\n`);
execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]);a=pathlib.Path(str(p)+'.zip');assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==14
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const file=path.join(root,'HTML Studio.html'),archive=folder+'.zip',bytes=await fs.readFile(file),zip=await fs.readFile(archive),hash=b=>createHash('sha256').update(b).digest('hex');
const summary={version:'0.3.0',date:new Date().toISOString(),passed:report.passed,failedSuites:report.failedSuites,standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:14,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(root,'qa/non-svg-charts-v0.3.0/release-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
