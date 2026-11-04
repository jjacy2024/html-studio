import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),qa=path.join(root,'qa/preview-v0.3.10'),previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.9-20261031'),folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.10-20261101');
const reportPath=path.resolve(root,process.env.REGRESSION_REPORT||'qa/latest/all-results.json'),all=JSON.parse(await fs.readFile(reportPath,'utf8'));
if(all.failedSuites||!all.suites.every(s=>s.pass))throw Error('Full regression must pass');
for(const [pattern,count] of [[/^preview-(file|http)$/,70],[/^preview-native-(file|http)$/,5],[/^preview-diagnostics-(file|http)$/,5],[/^preview-session-(file|http)$/,6],[/^preview-workflow-(file|http)$/,8],[/^preview-project-(file|http)$/,33]]){
 const suites=all.suites.filter(s=>pattern.test(s.name));if(suites.length!==2||suites.some(s=>s.cases.length!==count))throw Error('Missing evidence: '+pattern);
}
const projects=all.suites.filter(s=>s.name.startsWith('preview-project-'));if(projects.some(s=>s.report.editorVersion!=='0.3.10'||s.report.observedLoaders?.join()!=='native'))throw Error('Release project checks missing');
const chrome155=JSON.parse(await fs.readFile(path.join(qa,'project-155-fixed/results.json'),'utf8')),recovery155=JSON.parse(await fs.readFile(path.join(qa,'session-155/results.json'),'utf8'));
for(const [r,count] of [[chrome155,33],[recovery155,6]])if(!r.browser.startsWith('155.')||r.results.length!==count||r.results.some(c=>!c.pass))throw Error('Chrome 155 validation missing');
if(chrome155.editorVersion!=='0.3.10')throw Error('Wrong Chrome 155 project version');
const hash=b=>createHash('sha256').update(b).digest('hex'),inputs=JSON.parse(await fs.readFile(path.join(qa,'final-run-input-hashes.json'),'utf8'));
for(const [file,digest] of Object.entries(inputs))if(hash(await fs.readFile(path.resolve(root,file)))!==digest)throw Error('Tested file changed: '+file);
const bytes=await fs.readFile(path.join(root,'HTML Studio.html'));if(!bytes.toString().includes('<span class="brand-name">html全能编辑器</span'))throw Error('Requested name missing');
const cleanups=all.suites.filter(s=>s.report?.cleanup?.forcedExit).map(s=>({suite:s.name,cleanup:s.report.cleanup}));
let feedback=null;try{feedback=JSON.parse(await fs.readFile(path.join(qa,'user-feedback.json'),'utf8'));}catch{}
const feedbackText=feedback?.recoveryConfirmed?'用户已反馈此版本能够恢复预览。':'用户当前环境的恢复情况仍待反馈。';
const cleanupText=cleanups.length?`功能断言通过后，自动化浏览器关闭超过时限的套件：${cleanups.map(s=>s.suite).join('、')}。原收尾标记保留。`:'未记录自动化浏览器强制收尾。';
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));const samples=await fs.readdir(path.join(previous,'示例文件'));if(samples.length!==18||samples.some(s=>!/^\d{2}-.*\.html$/.test(s)))throw Error('Unexpected sample inventory');
for(const name of samples)await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));for(const name of ['HTML Studio.html','04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(name==='HTML Studio.html'?root:previous,name),path.join(folder,name));
await fs.writeFile(path.join(folder,'01-开始使用.txt'),`html全能编辑器 v0.3.10 本地测试版

先保存旧窗口的工程，再用 Chrome / Edge 打开本文件夹中的 HTML Studio.html，确认顶部版本为 0.3.10，再导入工程。旧标签页不会自动升级。无需 Node.js、服务器或线上部署。

每次进入预览都会创建新的可见预览容器，退出时销毁。资源准备好后只加载正式文档一次。如果检测到外部预览框可见、内部整份文档却没有布局，会自动重建一次；持续失败时会明确提示，不会循环重试。

如再次空白，请点击“预览诊断”→“下载诊断”，新诊断包含重建次数和首次失败的布局状态。返回编辑仍保留工程内容。
`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`html全能编辑器 v0.3.10

系统、浏览器版本：
编辑器顶部版本：
工程及页码：
进入预览前的编辑步骤：
连续进入/退出是否正常：
是否出现“正在重新初始化”并恢复：
若仍异常，请附上下载的诊断与可复现工程：
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`html全能编辑器 v0.3.10

针对白屏诊断显示“外部 iframe 可见，内部 html 根节点及所有后代无布局矩形”的状态，预览改为每次创建全新可见容器，等待布局时机后加载；退出销毁旧上下文、定时器及监听。原生资源准备完成后只进行一次正式 srcdoc 导航，去掉占位文档与正式文档竞争的初始化步骤。

仅当文档已加载完成、视口有效、根节点应可见却完全没有布局、外部容器也可见时，自动重建一次。正常隐藏样式、单个元素零尺寸、加载失败和脚本错误不触发此重建。持续失败会明确提示并记录次数；不会反复执行页面脚本。沙箱仍为 allow-scripts，不增加同源权限。工程、导出、页序和编辑内容不写入这些预览临时状态。左上角名称保留为“html全能编辑器”。

完整回归 ${all.passed} 项功能检查通过，${all.failedSuites} 个失败套件。另有 Chrome ${chrome155.browser} 的 33 项实际工程检查及 6 项预览会话检查通过。实际工程涵盖 26 页逐页预览、连续切换、重播、保存重开、草稿恢复和独立导出。

证据边界：用户的零布局状态已有实际诊断证据，但在独立 Chrome 155 中，改名后的旧版连续 10 次没有复现同一故障。新容器开发过程中复现了另一种初始化故障：srcdoc 属性已是正式内容，实际文档却停留在占位页；去掉占位导航后真实工程检查通过。不能直接将这个现象断言为用户此前故障的唯一原因。恢复测试中的零布局是测量故障注入，用于验证恢复逻辑，不是浏览器缺陷本身的复现。${feedbackText}

${cleanupText}${all.reruns?.length?'存在独立重跑，原失败和重跑记录保存在完整报告中。':''}

仅含编辑器、说明、许可和 18 个公开/构造示例。不包含用户工程、报告、诊断、录屏、截图、测试浏览器或 QA 导出。未进行 Windows/Safari 实机验证；模板预览检查不代表逐页检查全部模板。
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
if(!bytes.equals(await fs.readFile(path.join(folder,'HTML Studio.html'))))throw Error('Packaged editor differs');
await fs.copyFile(reportPath,path.join(qa,'full-regression-results.json'));const archive=folder+'.zip',zip=await fs.readFile(archive);
const summary={version:'0.3.10',date:new Date().toISOString(),checks:all.passed,failedSuites:all.failedSuites,userLayoutFailureConfirmedByDiagnostics:true,browserRootCauseConfirmed:false,placeholderNavigationFailureReproducedDuringDevelopment:true,userFeedback:feedback,chrome155:{browser:chrome155.browser,projectChecks:33,recoveryChecks:6},cleanups,standalone:{path:path.join(root,'HTML Studio.html'),bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:24,crcVerified:true,editorMatchesStandalone:true}};await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
