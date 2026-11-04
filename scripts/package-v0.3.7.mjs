import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.6-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.7-20261031');
const qa=path.join(root,'qa/preview-v0.3.7'),reportFile=path.resolve(root,process.env.REGRESSION_REPORT||'qa/latest/all-results.json');
const all=JSON.parse(await fs.readFile(reportFile,'utf8')),previews=all.suites.filter(s=>/^preview-(file|http)$/.test(s.name));
if(all.failedSuites||!all.suites.every(s=>s.pass)||previews.length!==2||previews.some(s=>s.cases.length!==70||!s.report.salesIncluded))throw Error('Full regression and both 70-case preview suites with the real report must pass');
const workflows=all.suites.filter(s=>s.name.startsWith('preview-workflow-'));
if(workflows.length!==2||workflows.some(s=>s.cases.length!==8||s.report.editedPagesChecked!==26))throw Error('Both edited-report workflows must pass all 8 checks and preview all 26 pages');
const cleanupNotes=all.suites.filter(s=>s.report?.cleanup?.forcedExit).map(s=>({suite:s.name,cleanup:s.report.cleanup}));
const cleanupText=(cleanupNotes.length?`自动化收尾记录：${cleanupNotes.map(n=>n.suite).join('、')}组功能检查通过，但浏览器关闭超过时限，由测试脚本退出。报告保留 cleanup timeout 和 forcedExit 标记；这不计为功能断言失败。`:'本轮最终结果没有记录限时强制退出。')+(all.reruns?.length?' 初次完整回归的 stability-file 在 16 项功能断言通过后，浏览器收尾超时，被测试总控结束；随后独立重跑正常退出并通过。原失败结果与重跑记录均保留。':'');
const examples=await fs.readdir(path.join(previous,'示例文件'));
if(examples.length!==18||examples.some(name=>!/^\d{2}-.*\.html$/.test(name)))throw Error('Previous example inventory changed');
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
const file=path.join(root,'HTML Studio.html');await fs.copyFile(file,path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of examples)await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.3.7 本地测试版

用电脑端 Chrome / Edge 打开同目录“HTML Studio.html”，无需 Node.js 或服务器。请先保存旧窗口中的工程，再用新窗口打开新版文件；旧标签页不会自动升级。

本次改进：支持 presentation.showSlide 与 deck.show 原生演示接口，从当前编辑页进入预览，等待延迟初始化；返回编辑保留原来的编辑页。

预览底部新增“预览诊断”。页面脚本报错、外部脚本加载失败、加载较慢或未检测到可见内容时会提示。可以先点“重新播放”；持续空白时，保存工程，并把工程文件及诊断信息提供给开发者，便于复现当前编辑内容。

原始报告在独立 Chrome 中逐页验证 26 页均可显示；截图中的持续白屏没有在这份原始 HTML 中复现，不能承诺所有草稿和浏览器扩展环境的白屏已解决。未知播放接口仍从原 HTML 的播放入口开始，不自动改写任意 JavaScript。

保存工程便于继续编辑；导出 HTML 可独立打开。当前页定位与诊断仅在编辑器预览使用，不写入导出。必要字体内置，其他模板字体可后台下载；页面原有外部资源仍需可用。
`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.3.7 测试反馈

系统 / Chrome 或 Edge 版本：
文件、页码，原始 HTML 还是保存的工程：
进入预览前的操作（编辑 / 排序 / 复制 / 删除等）：
是否从当前编辑页开始，原生翻页是否正常：
空白持续多久，是否所有页面都发生：
“预览诊断”中的完整文字：
重新播放是否恢复：
返回编辑后，内容和页码是否保留：
可复现的 HTML / 工程文件及截图：
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.3.7

确认并修复：原报告用 presentation.showSlide 播放，旧编辑器只对接 deck.show，导致从不同页进入预览都回到第一页。现在使用对应原生 API 从当前页开始，支持延迟初始化、重排和工程重开，保持原生翻页状态。

针对空白无反馈：新增预览加载状态和诊断，接收脚本异常、Promise 拒绝、外部脚本失败及 CSP 阻止脚本等消息；8 秒未就绪会提示较慢，约 3.5 秒仍没有检测到可见内容时提示检查。切换文档和退出后取消旧监听与超时。保持脚本隔离，不增加同源权限。

证据边界：原始报告在隔离 Chrome 中未复现截图里的持续白屏。确认的错页问题不等于已确认白屏根因。用户实际草稿、浏览器扩展或修改后的 HTML 尚未取得，若新版仍空白，需要当前工程和诊断信息继续排查。可见性检测不是任意页面渲染正确性的保证。

验证：macOS Chrome，file:// 与本机 HTTP；完整回归 ${all.passed} 项功能检查通过，${all.failedSuites} 个失败套件。预览专项各 70 项，合计 140 项，覆盖报告全部 26 页、34 个模板的初始预览、真实键盘翻页、快速切换、重播、延迟初始化、工程/排序、故障诊断、超时恢复、静态与 CSS 动效。报告每页保存截图并核对可见性和画布位置，原文件哈希不变。没有逐页检查所有模板，也未测试 Windows/Safari 实机或用户扩展配置。

根据录屏和“编辑/排序后发生”的补充，另外在两种打开方式各完成 8 项连续流程检查：真实导入、双击改标题、原样修改第 19 页图表、鼠标拖动排序、撤回/重做、工程保存重开、修改后的 26 页逐页预览、导出重导入及原脚本保护。录屏中的 v0.3.6 确认持续空白约 13 秒；这些受控操作仍未复现同一白屏，需要录屏中的实际工程继续定位。

${cleanupText}

前版图表保留样式编辑、表格合计、页面排序、模板、字体等能力继续保留。包内仅有编辑器、说明、许可和 18 份公开/构造示例，不含用户报告、草稿或 QA 截图及导出副本。
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
const summary={version:'0.3.7',date:new Date().toISOString(),checks:all.passed,failedSuites:all.failedSuites,previewChecks:previews.reduce((n,s)=>n+s.cases.length,0),originalReportBlankReproduced:false,wrongStartingPageFixed:true,automationCleanupNotes:cleanupNotes,standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:24,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
