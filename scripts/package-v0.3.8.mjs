import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),qa=path.join(root,'qa/preview-v0.3.8');
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.7-20261031');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.3.8-20261031');
const reportPath=path.resolve(root,process.env.REGRESSION_REPORT||'qa/latest/all-results.json');
const all=JSON.parse(await fs.readFile(reportPath,'utf8'));
if(all.failedSuites||!all.suites.every(s=>s.pass))throw Error('All regression suites must pass before packaging');
for(const [pattern,count] of [[/^preview-(file|http)$/,70],[/^preview-native-(file|http)$/,5],[/^preview-workflow-(file|http)$/,8],[/^preview-project-(file|http)$/,33]]){
 const suites=all.suites.filter(s=>pattern.test(s.name));
 if(suites.length!==2||suites.some(s=>s.cases.length!==count))throw Error('Required preview evidence missing: '+pattern);
}
const projects=all.suites.filter(s=>s.name.startsWith('preview-project-'));
if(projects.some(s=>s.report.editorVersion!=='0.3.8'||s.report.observedLoaders?.join()!=='native'))throw Error('Actual project must use the native loader in v0.3.8');
const hash=b=>createHash('sha256').update(b).digest('hex');
const inputs=JSON.parse(await fs.readFile(path.join(qa,'final-run-input-hashes.json'),'utf8'));
for(const [name,digest] of Object.entries(inputs))if(hash(await fs.readFile(path.resolve(root,name)))!==digest)throw Error('Tested input changed: '+name);
const cleanups=all.suites.filter(s=>s.report?.cleanup?.forcedExit).map(s=>({suite:s.name,cleanup:s.report.cleanup}));
const retryText=all.reruns?.length?'存在独立重跑；原失败及重跑记录保存在完整报告中。':'没有另外重跑的套件。';
const cleanupText=cleanups.length?`以下套件功能断言通过，但自动化关闭浏览器超过时限：${cleanups.map(s=>s.suite).join('、')}。报告保留收尾标记。`:'没有记录自动化浏览器强制收尾。';
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
const samples=await fs.readdir(path.join(previous,'示例文件'));
if(samples.length!==18||samples.some(s=>!/^\d{2}-.*\.html$/.test(s)))throw Error('Unexpected sample inventory');
for(const name of samples)await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
for(const name of ['HTML Studio.html','04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(name==='HTML Studio.html'?root:previous,name),path.join(folder,name));
await fs.writeFile(path.join(folder,'01-开始使用.txt'),`HTML Studio v0.3.8 本地测试版

先保存旧窗口里的工程，再用 Chrome / Edge 打开本文件夹的 HTML Studio.html，导入 .htmlstudio 工程。右上角版本应为 0.3.8；原来的标签页不会自动升级。无需 Node.js、服务器或在线部署。

常规大小的文档使用新的原生页面加载方式预览。大型资源沿用 Blob 传递，后台字体下载继续可用。此改动针对“页面已载入，但看不到内容”的兼容性问题；用户录屏白屏的确切根因尚未确认。

如果仍然空白，点击预览底部“预览诊断”→“下载诊断”，将文本文件反馈给开发者。诊断包含加载方式、播放脚本状态、激活页数量、尺寸和浏览器信息，不包含报告正文。
`);
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.3.8 测试反馈

系统、浏览器版本：
编辑器顶部版本：
HTML / 工程及页码：
进入预览前进行了哪些编辑：
预览是否显示、原生翻页是否可用：
重新播放是否恢复：
返回编辑是否保持修改：
附上“下载诊断”生成的文本及可复现的工程：
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.3.8

常规大小的文档改为完整 srcdoc 导航，由浏览器原生解析和执行原脚本，不再依赖 document.write 初始化。预估嵌入大小超过 16 MiB 的文档保留资源传递方式，避免大视频转为巨型 Base64。常规资源编码按 Blob 缓存，切换预览时旧异步读取不能覆盖新文档。源 HTML、工程内容和导出均不包含诊断脚本。

继续保留 sandbox="allow-scripts"，不增加同源访问权限。当前页定位、原生翻页、后台字体更新和大资源预览继续工作。没有删除源页面的隐藏样式或强行显示所有页面。

新增诊断：原生/传递加载方式、页面加载状态、播放接口是否存在、激活页数量、画布尺寸、页面变换状态和浏览器版本，可下载文本。

验证：完整回归 ${all.passed} 项功能断言通过，${all.failedSuites} 个失败套件。预览基础 140 项、原生加载 10 项、连续编辑流程 16 项、实际用户工程 66 项，均包含 file:// 和本机 HTTP 两种方式。实际工程 26 页逐页检查、连续切换、重播、保存重开、测试草稿恢复和导出播放均通过。受控环境禁用 document.write 时，新原生加载路径仍能执行脚本并显示资源。这是兼容性回归验证，不是用户环境根因的证明。

限制：用户 v0.3.7 中确认仍白屏，调整窗口不能恢复；其诊断为内容不可见。相同工程在独立 Chrome 中未复现同一白屏。v0.3.8 改换加载路径并补齐运行信息，是否修复用户当前环境仍需实际反馈，不能声称已经确认并修复根因。未进行 Windows/Safari 实机验证；34 个模板只检查初始预览，不代表逐页检查所有模板。

${cleanupText} ${retryText}

包内仅为编辑器、说明、许可及 18 份公开/构造示例，不含用户工程、报告、录屏、截图或 QA 导出文件。
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
const bytes=await fs.readFile(path.join(root,'HTML Studio.html')),archive=folder+'.zip',zip=await fs.readFile(archive);
if(!bytes.equals(await fs.readFile(path.join(folder,'HTML Studio.html'))))throw Error('Package differs from tested standalone');
await fs.copyFile(reportPath,path.join(qa,'full-regression-results.json'));
const summary={version:'0.3.8',date:new Date().toISOString(),checks:all.passed,failedSuites:all.failedSuites,userBlankRootCauseConfirmed:false,nativeLoaderValidated:true,actualProjectLoaders:projects.map(s=>({mode:s.name,loaders:s.report.observedLoaders,sourceSHA256:s.report.sourceSHA256})),cleanups,standalone:{path:path.join(root,'HTML Studio.html'),bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:24,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
