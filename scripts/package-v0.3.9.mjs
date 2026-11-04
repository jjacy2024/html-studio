import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),qa=path.join(root,'qa/preview-v0.3.9');
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.8-20261031');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.9-20261031');
const reportPath=path.resolve(root,process.env.REGRESSION_REPORT||'qa/latest/all-results.json');
const all=JSON.parse(await fs.readFile(reportPath,'utf8'));
if(all.failedSuites||!all.suites.every(s=>s.pass))throw Error('All regression suites must pass before packaging');
for(const [pattern,count] of [[/^preview-(file|http)$/,70],[/^preview-native-(file|http)$/,5],[/^preview-diagnostics-(file|http)$/,5],[/^preview-workflow-(file|http)$/,8],[/^preview-project-(file|http)$/,33]]){
 const suites=all.suites.filter(s=>pattern.test(s.name));
 if(suites.length!==2||suites.some(s=>s.cases.length!==count))throw Error('Required preview evidence missing: '+pattern);
}
const projects=all.suites.filter(s=>s.name.startsWith('preview-project-'));
if(projects.some(s=>s.report.editorVersion!=='0.3.9'||s.report.observedLoaders?.join()!=='native'))throw Error('Actual project must use the native loader in v0.3.9');
const chrome155=JSON.parse(await fs.readFile(path.join(qa,'release-project-155/results.json'),'utf8'));
if(!chrome155.browser.startsWith('155.')||chrome155.editorVersion!=='0.3.9'||chrome155.results.length!==33||chrome155.results.some(r=>!r.pass))throw Error('Chrome 155 release validation missing');
const hash=b=>createHash('sha256').update(b).digest('hex');
const inputs=JSON.parse(await fs.readFile(path.join(qa,'final-run-input-hashes.json'),'utf8'));
for(const [name,digest] of Object.entries(inputs))if(hash(await fs.readFile(path.resolve(root,name)))!==digest)throw Error('Tested input changed: '+name);
const baseline=await fs.readFile(path.join(root,'HTML Studio-预览定位版.html'),'utf8'),bytes=await fs.readFile(path.join(root,'HTML Studio.html'));
if(hash(baseline)!=='5651431af28d1bb9f8c33c24721771968b21968a3e67edb6b293ff17f6b967fd'||bytes.toString()!==baseline.replaceAll('0.3.8 · 诊断版 2','0.3.9'))throw Error('Release must match the user-confirmed diagnostic build except version labels');
const cleanups=all.suites.filter(s=>s.report?.cleanup?.forcedExit).map(s=>({suite:s.name,cleanup:s.report.cleanup}));
const retryText=all.reruns?.length?'存在独立重跑；原失败及重跑记录保存在完整报告中。':'没有另外重跑的套件。';
const cleanupText=cleanups.length?`以下套件功能断言通过，但自动化关闭浏览器超过时限：${cleanups.map(s=>s.suite).join('、')}。报告保留收尾标记。`:'没有记录自动化浏览器强制收尾。';
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
const samples=await fs.readdir(path.join(previous,'示例文件'));
if(samples.length!==18||samples.some(s=>!/^\d{2}-.*\.html$/.test(s)))throw Error('Unexpected sample inventory');
for(const name of samples)await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
for(const name of ['HTML Studio.html','04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(name==='HTML Studio.html'?root:previous,name),path.join(folder,name));
await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.3.9 本地测试版

先保存旧窗口里的工程，再用 Chrome / Edge 打开本文件夹的 HTML Studio.html，导入 .htmlstudio 工程。顶部版本应为 0.3.9；原来的标签页不会自动升级。无需 Node.js、服务器或在线部署。

此版本保留用户已确认能正常预览的“0.3.8 · 诊断版 2”的完整程序，仅更新版本文字。原诊断版文件继续保留。用户确认恢复，不等于已证明之前白屏的确切原因。

如果后续再出现空白，点击“预览诊断”→“下载诊断”。新的即时诊断包含内部根节点、父容器与外部预览容器的尺寸和显示状态，不包含报告正文。
`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.3.9 测试反馈

系统、浏览器版本：
编辑器顶部版本：
HTML / 工程及页码：
进入预览前进行了哪些编辑：
预览是否显示、翻页是否可用：
重新播放是否恢复：
返回编辑是否保持修改：
如有异常，请附上“下载诊断”生成的文本及可复现的工程：
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.3.9

本次保留用户已确认预览恢复的补充诊断版代码，正式构建与该文件逐字节比较后仅版本文字不同。没有进一步更换预览加载方式，没有删除源页面的隐藏样式或修改原播放脚本。

诊断会主动采集内部根节点、body、画布祖先与外部 iframe 宿主的布局状态。打开诊断时请求即时数据，700ms 无响应则保留旧读数并注明；取消预览会取消待处理的诊断请求。诊断脚本不会写入工程或导出。仍采用 sandbox="allow-scripts"，不增加同源访问权限。

验证：完整回归 ${all.passed} 项功能断言通过，${all.failedSuites} 个失败套件，含本地 file:// 与本机 HTTP 预览、编辑排序、保存重开、导出、图表、表格、字体及稳定性。另在 Chrome ${chrome155.browser} 中对实际用户工程执行 33 项检查，含 26 页逐页预览，全部通过。

证据边界：用户明确反馈补充诊断版打开同一工程后预览正常。此前普通和无痕窗口诊断均显示页面激活但舞台实际尺寸为零；同一故障未在独立 Chrome 155/156 中复现，因此不声称已经证明白屏根因。新增布局读取可能影响浏览器的计算时机，但没有对照证据确认此机制。未进行 Windows/Safari 实机验证；34 个模板只检查初始预览，不代表逐页检查所有模板。

${cleanupText} ${retryText}

包内仅为编辑器、说明、许可及 18 份公开/构造示例，不含用户工程、报告、录屏、截图、诊断或 QA 导出文件。
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
const archive=folder+'.zip',zip=await fs.readFile(archive);
if(!bytes.equals(await fs.readFile(path.join(folder,'HTML Studio.html'))))throw Error('Package differs from tested standalone');
await fs.copyFile(reportPath,path.join(qa,'full-regression-results.json'));
const summary={version:'0.3.9',date:new Date().toISOString(),checks:all.passed,failedSuites:all.failedSuites,userConfirmedDiagnosticRecovery:true,userBlankRootCauseConfirmed:false,onlyVersionLabelsDifferFromWorkingDiagnostic:true,chrome155:{browser:chrome155.browser,checks:33,sourceSHA256:chrome155.sourceSHA256},cleanups,standalone:{path:path.join(root,'HTML Studio.html'),bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:24,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
