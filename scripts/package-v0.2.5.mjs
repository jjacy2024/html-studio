import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.4-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.5-20261030');
const qa=path.join(root,'qa/svg-charts-v0.2.5');
const report=JSON.parse(await fs.readFile(path.join(root,'qa/latest/all-results.json'),'utf8'));
if(report.failedSuites||['svg-charts-file','svg-charts-http'].some(name=>!report.suites.find(s=>s.name===name&&s.cases.length===28&&s.pass)))throw Error('Current full regression and new unified-entry cases must pass');
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
await fs.copyFile(path.join(root,'HTML Studio.html'),path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of ['01-静态页面与动效.html','02-三页演示稿.html','03-表格公式与关联图表.html','04-SVG柱状图原样式数据编辑.html'])await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
let intro=(await fs.readFile(path.join(previous,'01-开始使用.txt'),'utf8')).replaceAll('v0.2.4','v0.2.5').replace('本次新增：导入 SVG 柱状图，直接改数据并保持原样式','图表数据统一入口：优先保留原样式').replace('“识别柱状图数据 · 保留样式”','“编辑图表数据…”').replace('会保留原图，可使用原有“转换为数据图表”入口重建。','会先说明无法保留原样式；选择“继续编辑（转换样式）”后才转换，取消则保持原图不变。');
intro+='\n本版操作：右侧只有一个“编辑图表数据…”入口。能保留原样式时优先保留；不能可靠保留时先说明影响，用户明确选择继续后才转换并打开数据面板，不再显示两个按钮。选中包含单个 SVG 的图表外层容器也优先保留样式。旧绑定损坏时先尝试重新识别。\n';
await fs.writeFile(path.join(folder,'01-开始使用.txt'),intro);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.2.5 测试反馈

系统/浏览器及版本：
使用的 HTML：
操作步骤：
预期和实际结果：
编辑、预览、导出是否一致：
能否撤回、是否卡顿：
截图/录屏：

重点：右侧只有一个“编辑图表数据…”按钮；可识别图表保留样式；不可保留时明确提示；取消、关闭、Esc 不修改；继续后能编辑，转换可撤回；图表外层容器和旧绑定修复。
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.2.5 · 图表数据统一入口

1. 合并为“编辑图表数据…”一个入口，自动优先保留原样式。
2. 无法保留时，弹窗说明原样式、动画、交互不能转入，并提示重新输入数据或绑定已有表格。选择“继续编辑（转换样式）”后才转换并直接打开数据编辑；取消、关闭和 Esc 不修改原图。
3. 选中包含单个 SVG 的图表外层容器时优先编辑内部 SVG；数据绑定损坏时先尝试重新识别并保留样式。转换可撤回/重做，过期确认不会修改新文档或锁定图层。

验证：macOS Chrome 完整回归 ${report.passed} 项通过，0 个失败测试组，其中 SVG/统一入口专项在单文件与 HTTP 下各 28 项。包含真实报告、原样式编辑、取消不修改、明确确认转换、数据修改、撤回、导出/重开和 34 模板等既有功能。

范围：保留样式编辑仍主要支持带数字标签、线性刻度与共同零基线的普通/分组 SVG 矩形柱状图。其他表格、标题比例和业务台账不会自动联动。Windows 实机、Safari 未验证；既有旋转半透明嵌套 iframe 预览差异不在本次修复范围。

包内只有编辑器、说明、许可和 4 份人工示例，没有私人 HTML、截图、QA 导出或草稿。必要字体内置，其他模板字体继续后台下载缓存。
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
const summary={version:'0.2.5',date:new Date().toISOString(),passed:report.passed,failedSuites:report.failedSuites,standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:10,crcVerified:true,editorMatchesStandalone:true}};
await fs.copyFile(path.join(root,'qa/latest/all-results.json'),path.join(qa,'full-regression-results.json'));await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
