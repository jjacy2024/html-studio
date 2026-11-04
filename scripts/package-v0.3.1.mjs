import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {stackedHTML} from '../tests/svg-stacked-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.0-20261030'),folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.1-20261030'),qa=path.join(root,'qa/svg-stacked-v0.3.1');
const all=JSON.parse(await fs.readFile(path.join(root,'qa/latest/all-results.json'),'utf8'));
if(all.failedSuites||all.suites.filter(s=>s.name.startsWith('svg-stacked-')&&s.pass).length!==2)throw Error('Full regression including both stacked suites must pass');
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));await fs.copyFile(path.join(root,'HTML Studio.html'),path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of await fs.readdir(path.join(previous,'示例文件')))await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
await fs.writeFile(path.join(folder,'示例文件/09-SVG纵向堆叠图.html'),stackedHTML());await fs.writeFile(path.join(folder,'示例文件/10-SVG横向渐变堆叠图.html'),stackedHTML({horizontal:true,gradient:true}));
await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.3.1 本地测试版\n\n用电脑端 Chrome / Edge 打开同目录“HTML Studio.html”。无需 Node.js 或服务器。必要字体内置；其他模板字体可后台下载并缓存，页面原有外部资源仍需可用。\n\n新增 SVG 堆叠柱状图原样编辑：导入示例 09 / 10，双击分段或选中图表后点“编辑图表数据…”。确认分类与系列后修改数值，观察各段尺寸、位置和柱顶合计同步变化。原填色、渐变、描边、字体保留。\n\n保存工程便于继续编辑；导出 HTML 可独立打开。超出支持范围会先说明并询问是否转换，不会自动替换原图。\n`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.3.1 测试反馈\n\n系统 / 浏览器版本：\n文件、页码及图表：\n复现步骤：\n预期与实际：\n识别到的分类、系列和数值是否正确：\n分段尺寸、位置和合计是否同步：\n配色、渐变、描边、字体是否保留：\n关闭、Escape、撤回/重做是否正常：\n编辑、保存重开、预览和导出是否一致：\n是否卡顿，截图/录屏：\n`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.3.1\n\n新增按图形结构识别的 SVG 堆叠柱状图编辑，适用横向/纵向、固定分类与系列、非负数、线性坐标轴的普通矩形分段。支持从可见标签、title、aria-label 或 data-value 读取数值，多个来源与几何尺寸交叉核对。支持原始零段与编辑后归零，提示文字可补足原图未显示的数字。\n\n修改同步更新分段尺寸、堆叠位置、现有数值标签和合计；保留原配色、渐变、描边及字体。超出原范围时扩展刻度并统一缩放，小段文字暂时隐藏以避免溢出。页面独立标题比例、说明及台账不会自动改动。\n\n不自动处理负向堆叠、瀑布、复杂路径/内部变换、数据缺失或系列对应不明、100% 自动归一化。无法可靠保留样式时仍先说明并确认转换。\n\n修复 SVG 数据面板 Escape 关闭时的最后一次输入提交；优化六系列数据表宽度。\n\n验证：macOS Chrome，本地单文件和 HTTP 两种方式；完整回归 ${all.passed} 项检查通过，${all.failedSuites} 个失败套件。新增堆叠专项包括真实双击、取消保护、数据及几何、字体/渐变、缩放、零值、撤回重做、保存重开、预览导出、多个来源及拒绝场景；实际销售报告第 7 页全部 18 段识别和编辑通过，原文件未修改。未验证 Windows 实机或 Safari。\n\n包内只有编辑器、说明、许可和 10 份人工示例；不包含用户报告、QA 导出、截图或草稿。\n`);
execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]);a=pathlib.Path(str(p)+'.zip');assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==16
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const file=path.join(root,'HTML Studio.html'),archive=folder+'.zip',bytes=await fs.readFile(file),zip=await fs.readFile(archive),hash=b=>createHash('sha256').update(b).digest('hex');const summary={version:'0.3.1',date:new Date().toISOString(),checks:all.passed,failedSuites:all.failedSuites,standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:16,crcVerified:true,editorMatchesStandalone:true}};await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
