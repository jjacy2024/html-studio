import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {matrixHTML} from '../tests/table-editing-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.3-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.4-20261030');
const qa=path.join(root,'qa/table-editing-v0.3.4'),reportFile=path.resolve(root,process.env.REGRESSION_REPORT||'qa/latest/all-results.json');
const all=JSON.parse(await fs.readFile(reportFile,'utf8')),tables=all.suites.filter(s=>s.name.startsWith('table-editing-'));
if(all.failedSuites||!all.suites.every(s=>s.pass)||tables.length!==2||tables.some(s=>!s.pass||s.cases.length!==19||!s.report.salesIncluded))throw Error('Full regression with both table suites and the real report must pass before packaging');
const examples=await fs.readdir(path.join(previous,'示例文件'));
if(examples.length!==14||examples.some(name=>!/^\d{2}-.*\.html$/.test(name)))throw Error('Previous example inventory changed; inspect before packaging');
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
const file=path.join(root,'HTML Studio.html');await fs.copyFile(file,path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of examples)await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
await fs.writeFile(path.join(folder,'示例文件/15-表格样式与合计联动.html'),matrixHTML({sample:true,nested:true}));
await fs.writeFile(path.join(folder,'示例文件/16-核对已有合计差异.html'),matrixHTML({sample:true,nested:true,mismatch:true}));
await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.3.4 本地测试版

用电脑端 Chrome / Edge 打开同目录“HTML Studio.html”，无需 Node.js 或服务器。必要字体内置；其他模板字体可后台下载并缓存，页面原有外部资源仍需可用。

本次修复：修改表格数字不再移除外层色块、边框、内边距、居中及粗体。覆盖数据面板、画布双击、选中整格编辑和右侧文字属性。

导入示例 15，修改任一色块中的数字，行合计、列合计与总计会同步更新。原合计与明细核对一致时，首次修改自动建立 SUM 公式；合计保持原格式。

示例 16 故意让明细与合计不一致。在表格数据面板点“检查合计联动…”，核对原值、求和结果和公式，确认后建立联动。取消不会改动原表。

旧版已经删除的样式标签无法可靠还原：先撤回旧修改或重新导入原 HTML，再用新版编辑。独立说明、标题比例、未绑定图表和跨页台账需另行修改。

保存工程便于继续编辑；导出 HTML 可独立打开。已绑定的公式随工程与 HTML 保留，重新导入后可继续计算。
`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.3.4 测试反馈

系统 / 浏览器版本：
文件、页码及表格：
复现步骤与编辑入口（数据面板 / 双击 / 右侧属性）：
修改前后数字：
色块、边框、居中、字重和字体是否保留：
行合计、列合计与总计是否同步：
千分位、小数位是否保留：
已有合计不一致时，核对、取消和确认是否正常：
插入、删除行列后，样式及公式范围是否正常：
撤回、重做、保存重开、预览和导出是否一致：
是否卡顿，截图/录屏：
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.3.4

旧版表格编辑用纯文字替换整格内容，误删数字外围的 span / strong 等标签；源 HTML 的合计又通常只是固定数字。新版保留原包装，仅修改明确的文本节点；公式重算也保留格式。

自动合计适用于首行列名、末行/末列明确标注合计、明细为普通数值的规则表格。原合计与求和结果一致时，首次修改自动建立 SUM；不一致时须在“检查合计联动…”里核对并确认。已有公式优先保留，手动覆盖合计不会被悄悄改回。支持千分位、负数、小数、空值及零值。

插入行列继承包装样式并调整引用；在自动合计前新增明细时扩展求和范围。撤回/重做、工程保存重开、预览、导出及再导入保持公式和结果。已绑定编辑器图表继续联动，自动识别的末行总计不额外计入分类。

多段富文本格在数据面板只读，可在画布中编辑具体文字。合并格、嵌套表格、多级小计、未明确标注的汇总、比例、均价、带单位文字或语义不明的结构不自动推断求和。保留原色块，不自动推断条件配色；独立说明、其他未绑定图表、标题比例及跨页台账需另行修改。

验证：macOS Chrome，本地单文件与 HTTP 两种方式；完整回归 ${all.passed} 项检查通过，${all.failedSuites} 个失败套件。新增表格专项每种方式 19 项，含实际鼠标输入、样式节点保护、求和、差异确认、数值格式、已有公式、错误输入、行列插删、历史、保存/导出、复制、锁定和真实报告。

补测记录：字体组首次已完成 40 项功能检查，但自动化浏览器清理未结束而超时。测试脚本增加限时清理与提前写入证据后，该组单独复测通过；首轮超时与补测记录保留在本机 QA 报告中。

实际销售报告第 12 页将 480 改为 580 后，粉色色块与黑色边框保留，产品合计 1,050→1,150，天猫合计 1,690→1,790，全表总计 3,860→3,960；原文件未修改。旧版同操作已复现色块丢失且合计不变。未验证 Windows 实机或 Safari。

包内只有编辑器、说明、许可和 16 份测试示例；不包含用户报告、QA 导出、截图或草稿。新表格示例使用单独构造的数据。
`);
execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]);a=pathlib.Path(str(p)+'.zip');assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==22
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const archive=folder+'.zip',bytes=await fs.readFile(file),zip=await fs.readFile(archive),hash=b=>createHash('sha256').update(b).digest('hex');
if(!bytes.equals(await fs.readFile(path.join(folder,'HTML Studio.html'))))throw Error('Packaged editor differs from tested standalone');
await fs.copyFile(reportFile,path.join(qa,'full-regression-results.json'));
const summary={version:'0.3.4',date:new Date().toISOString(),checks:all.passed,failedSuites:all.failedSuites,tableChecks:tables.reduce((n,s)=>n+s.cases.length,0),standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:22,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
