import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.1-20261029');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.2-20261029');
const qa=path.join(root,'qa/font-loading-v0.2.2');
const report=JSON.parse(await fs.readFile(path.join(root,'qa/latest/all-results.json'),'utf8'));
if(report.failedSuites || !report.suites.find(s=>s.name==='font-loading'&&s.cases.length===10&&s.pass)) throw Error('Current full regression has not passed');
await fs.mkdir(folder); // Never overwrite an existing release.
await fs.mkdir(path.join(folder,'示例文件'));
await fs.copyFile(path.join(root,'HTML Studio.html'),path.join(folder,'HTML Studio.html'));
for(const name of ['02-测试反馈.txt','04-第三方许可.txt']) await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of ['01-静态页面与动效.html','02-三页演示稿.html','03-表格公式与关联图表.html'])
  await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
const originalIntro=await fs.readFile(path.join(previous,'01-开始使用.txt'),'utf8');
const existingFeatures=originalIntro.slice(originalIntro.indexOf('新增功能入口'),originalIntro.indexOf('注意范围'));
await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.2.2 轻量本地测试版 · 2026-10-29

请先保存工程并关闭旧版编辑器。解压后用电脑端 Chrome 打开“HTML Studio.html”。无需 Node.js、服务器或上传文件。编辑器单文件约 8.6 MB，包含 34 个模板。

字体使用
1. 已内置 Inter、Space Grotesk、JetBrains Mono 三套常用字体。其余模板字体打开编辑器后在后台下载；当前模板优先，编辑可以继续。
2. 下载完成后自动更新画布和预览，不重启动效或交互。下载前先使用系统替代字体，排版可能暂时不同。
3. 点击画布上方“字体已就绪／字体待下载”，或文件菜单“模板字体与离线缓存”，可看进度、暂停和重试。
4. 下载需要访问 fonts.gstatic.com。下载成功后缓存在当前浏览器，之后可离线复用；换浏览器、清理浏览器数据、隐私模式等可能需要重新下载。缓存会另外占用本地空间。
5. 保存工程和导出时会检查并携带文档所需字体。若缺少字体，会明确询问取消、重试，或保留在线字体链接继续。含完整中日文字体的导出文件仍可能较大。
6. Arial、Segoe UI、MS Sans Serif 等系统字体保留原引用，继续使用电脑已有字体或原回退列表。

${existingFeatures}
注意范围
- 此轮验证为 macOS Chrome，未验证 Windows 实机或 Safari。
- 普通表格支持最多 200 行、26 列及基础公式；合并单元格、跨表公式和任意业务脚本的数据源不自动识别。
- 外来图表需要主动转换并重新绑定数据；原图表隐藏保留，原脚本仍可能执行，请核对预览。
- 页面脚本中写死的 ID、页码及事件绑定不自动改写。原有旋转、半透明嵌套 iframe 的预览像素差异不在此次字体更新的修复范围。
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.2.2 · 轻量字体包

体积：约 38 MB → 8.6 MB，减少约 77%。内置 3 个字体家族的 28 个文件，其余 47 个家族的 592 个文件后台下载并缓存。保留全部 50 个家族的来源、大小、SHA-256 和许可。

后台下载同时最多 2 个请求，当前模板优先；请求超时或连续失败会停止等待或暂停队列，可手动重试。字体完成后只更新样式，不覆盖文字、不增加撤回步骤、不重启预览。浏览器持久缓存不可用时明确提示，并允许本次会话使用和保存字体。

保存工程、导出、查看代码和写回前都会检查当前文档字体；字体不完整时必须明确选择如何继续。完整文件可携带所需字体离线转交，系统字体仍由接收方电脑提供。

测试：macOS Chrome 下完整回归 ${report.passed} 项通过，0 个失败测试组。包含原有述职报告和 merchant 文件回归，但私人文件未进入分发包。
新增后台加载专项 10 项通过：首次断网、回退字体、导出取消与在线链接选择、编辑和预览不中断、损坏数据拒绝、失败限流、暂停重试、自动超时、缓存不可用、文档切换隔离。
字体专项 40 项通过：使用原始字体字节的受控网络响应完成缓存，再断网验证全部 34 个模板编辑、预览和导出；620 个字体导出哈希一致，新增中日文实际使用自定义字体。另在本机真实访问字体服务验证 Daisy Days 下载成功。

这些结果针对指定用例，不代表所有网页、字体网络服务、Windows、Safari 或全部视觉细节均通过。字体首次下载要求网络可访问 Google 字体文件服务。完整离线版 v0.2.1 仍另行保留。

本包仅包含编辑器、说明、第三方许可和原创／人工数据示例，不含私人 HTML、QA 导出、草稿或测试截图。
`);
const oldLicenses=await fs.readFile(path.join(previous,'05-字体许可.txt'),'utf8');
await fs.writeFile(path.join(folder,'05-字体许可.txt'),oldLicenses.replace('HTML Studio v0.2.1 内置模板字体许可','HTML Studio v0.2.2 模板字体许可（含内置与后台下载字体）'));
const archive=folder+'.zip';
execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]); a=pathlib.Path(str(p)+'.zip')
assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==9
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const bytes=await fs.readFile(path.join(root,'HTML Studio.html'));
const previousBytes=(await fs.stat(path.join(previous,'HTML Studio.html'))).size;
const archiveBytes=await fs.readFile(archive);
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const summary={version:'0.2.2',date:new Date().toISOString(),environment:'macOS Chrome',passed:report.passed,failedSuites:report.failedSuites,
  standalone:{path:path.join(root,'HTML Studio.html'),bytes:bytes.length,sha256:sha(bytes),previousBytes,reductionPercent:100*(1-bytes.length/previousBytes)},
  archive:{path:archive,bytes:archiveBytes.length,sha256:sha(archiveBytes),files:9,crcVerified:true,editorMatchesStandalone:true}};
await fs.copyFile(path.join(root,'qa/latest/all-results.json'),path.join(qa,'full-regression-results.json'));
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
