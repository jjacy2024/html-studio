import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const current=JSON.parse(await fs.readFile('qa/latest/all-results.json','utf8'));
const baseline=JSON.parse(await fs.readFile('qa/audit-20261028/baseline-resource-performance.json','utf8'));
const perf=current.suites.find(s=>s.name==='performance')?.report;
const oldDeck=baseline.results.find(r=>r.name.startsWith('P04'))?.metrics;
const newDeck=perf?.results.find(r=>r.name.startsWith('P04'))?.metrics;
const oldAsset=baseline.results[0].metrics,newAsset=perf?.results[0].metrics;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ms=n=>Number.isFinite(n)?n.toFixed(1)+' ms':'未记录';
const chars=n=>Number.isFinite(n)?(n/1e6).toFixed(2)+' M 字符':'未记录';
const checks=[
 ['S01','加载卡住的图片','让图片请求持续挂起，打开后修改字号。','1.5 秒内可编辑；不等待所有图片结束。'],
 ['S02','加载卡住的样式表','让外部 CSS 请求持续挂起。','2.2 秒内恢复编辑，显示样式超时提示。'],
 ['S03','文字编辑后点击属性','双击画布文字，直接点击右侧字号并输入。','第一次点击即保持焦点，字号成功应用。'],
 ['S04','连续打开两个文档','同时发起两次文档加载。','两个操作都结束，最终显示后选文档。'],
 ['S05','拖动期间切出窗口','开始拖动，触发失焦，再移动鼠标。','拖动结束，不再意外移动元素。'],
 ['S06','大图片下连续修改','加载带 8 MiB SVG 的文档，连续改 8 次字号。','保留 9 个状态，历史 HTML 小于 1 MiB；撤回值准确。'],
 ['S07','草稿资源恢复','等待自动保存后刷新浏览器。','图片仍能解码且尺寸正确。'],
 ['S08','切换文件时自动保存','旧稿修改后立刻打开带慢资源的新稿。','草稿名称与 HTML 都来自新文档。'],
 ['S09','损坏工程文件','导入无效 JSON。','显示错误且当前文档保留。'],
 ['S10','导出可移植性','导出含脚本与图片的 HTML，并独立打开。','编辑时脚本不执行；导出无会话链接，图片与脚本可用。'],
 ['S11','隔离预览资源与脚本','导入本地资源目录，反复预览含图片、经典脚本的页面。','图片可见，按钮交互正常，源脚本变量不冲突，无法读取编辑器文档。'],
 ['S12','跨文档粘贴资源','复制图片，打开新文档，粘贴、删除、撤回。','图片资源保留且能恢复。'],
 ['S13','工程跨会话打开','下载含图片和脚本的工程，在全新浏览器上下文中打开。','资源、预览交互完整；文件不含临时 blob 地址。'],
 ['S14','连续替换资源文档','连续新建 15 份带不同图片的文档。','资源池只保留当前需要的 1 项。'],
 ['S15','超时样式导出','触发 CSS 超时后导出 HTML。','原 CSS 地址保留，临时编辑标记移除。'],
 ['S16','并发文件导入','第一份文件读取故意延迟，同时选入第二份。','后选文件获胜，不被先选文件覆盖。'],
 ['P01','12 MiB 资源压力','加载带 12 MiB SVG 的文档并连续改 8 次字号。','记录加载/编辑时间、快照字符数和历史步数。'],
 ['P02','3,000 图层压力','新建 3,000 个文本，选择 25 个，连续批量改 20 次。','选择保持，单次编辑小于 1.5 秒；阈值用于防严重回归，不代表流畅标准。'],
 ['P03','长序列操作','连续 100 次编辑、10 次撤回与重做、20 次预览往返。','最终字号正确，历史不超过 60 步，资源池保持稳定。'],
 ['P04','真实 31 页述职报告','导入 89 个本地资源，逐页选择与改字，抽查视频页预览，导出并刷新恢复。','全部页可编辑；页面/资源状态恢复正确；导出不含会话资源地址。'],
];
const fixes=[
 ['加载图片一直不结束','从等待 iframe 全部资源改为等待文档可编辑。','S01'],
 ['外部 CSS 阻塞','提供有时限的降级，提示缺失样式，导出仍保留原引用。','S02 / S15'],
 ['第一次属性点击丢焦点','文字失焦提交时保留正在接收焦点的属性控件。','S03'],
 ['连续打开文档互相覆盖、等待不结束','取消旧加载任务，使用加载版本判定最终结果。','S04'],
 ['切出窗口后拖动粘住','在失焦、丢失指针捕获和取消时统一结束拖动。','S05'],
 ['大资源拖慢每次修改并挤掉撤回','会话内共享二进制资源；快照只保存引用，草稿单独保存 Blob；下载时才嵌入。','S06 / S07 / P01 / P04'],
 ['新旧文档草稿混写','切换时清除旧定时器，串行保存文档与其对应资源。','S08'],
 ['较慢的旧文件覆盖新导入文件','导入过程检查请求版本，丢弃过期读取结果。','S16'],
];
const timingRows=[
 ['真实述职稿资源导入',ms(oldDeck?.importMs),ms(newDeck?.importMs)],
 ['逐页文字修改：中位数',ms(oldDeck?.editTiming.median),ms(newDeck?.editTiming.median)],
 ['逐页文字修改：P95',ms(oldDeck?.editTiming.p95),ms(newDeck?.editTiming.p95)],
 ['逐页切换：中位数',ms(oldDeck?.switchTiming.median),ms(newDeck?.switchTiming.median)],
 ['逐页切换：P95',ms(oldDeck?.switchTiming.p95),ms(newDeck?.switchTiming.p95)],
 ['31 次编辑后历史状态',String(oldDeck?.history.states),String(newDeck?.history.states)],
 ['对应历史 HTML 体积',chars(oldDeck?.history.chars),chars(newDeck?.history.chars)],
 ['12 MiB 资源，编辑中位数',ms(oldAsset.editTiming.median),ms(newAsset?.editTiming.median)],
 ['12 MiB 资源，历史状态',String(oldAsset.historyStates),String(newAsset?.historyStates)],
 ['12 MiB 资源，历史 HTML',chars(oldAsset.historyChars),chars(newAsset?.historyChars)],
];
const table=(heads,rows)=>'<div class="scroll"><table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HTML Studio 测试报告 · 2026-10-28</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f5fa;color:#242137;font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:1120px;margin:auto;padding:48px 28px 80px}header{padding:30px;background:#fff;border-radius:18px;border:1px solid #e5e2f2}h1{font-size:30px;line-height:1.3;margin:8px 0 14px}h2{margin:38px 0 14px;font-size:22px}p{margin:10px 0}small,.muted{color:#6e687b}.tag{color:#6d4cce;font-weight:600;letter-spacing:1px}.stats{display:flex;gap:14px;margin:24px 0}.stat{background:white;border:1px solid #e5e2f2;border-radius:14px;flex:1;padding:18px 24px}.stat b{font-size:30px;display:block;color:#6745cc}.scroll{overflow:auto;background:white;border:1px solid #e5e2f2;border-radius:12px}table{border-collapse:collapse;width:100%;min-width:680px}td,th{padding:12px 16px;border-bottom:1px solid #eeeaf5;vertical-align:top;text-align:left}th{background:#f0ecfa;font-size:13px}tr:last-child td{border-bottom:0}code,pre{font-family:ui-monospace,monospace;background:#edeaf5}pre{overflow:auto;padding:18px;border-radius:12px;font-size:13px}details{margin:12px 0;background:white;border:1px solid #e5e2f2;border-radius:12px;padding:14px 18px}summary{cursor:pointer;font-weight:600}.ok{color:#237858}.warn{padding:16px 20px;background:#fff6e6;border-radius:12px}a{color:#6745cc}li{margin:6px 0}@media print{body{background:white}main{padding:0}.scroll{overflow:visible}details{break-inside:avoid}table{min-width:0}td,th{padding:7px}header,.stats{break-inside:avoid}}
</style><main><header><div class="tag">HTML STUDIO · 本地质量检验</div><h1>功能、稳定性与多页大文件测试</h1><p>本轮聚焦《酒一-转正述职》：31 页、1920 × 1080，以及 89 个可找到的本地资源（约 114.7 MB）。测试使用临时浏览器上下文，原始报告未被改写。</p><p class="muted">执行：${esc(current.date)} · ${esc(current.platform)} · Google Chrome ${esc(perf?.browser)} · 本地单文件与本地 HTTP</p></header>
<div class="stats"><div class="stat"><b>${current.passed}</b>通过的检查项</div><div class="stat"><b>${current.failedSuites}</b>失败的测试套件</div><div class="stat"><b>20</b>新增稳定性 / 压力场景</div></div>
<p>本轮先记录旧版问题，再修复并回归。16 个稳定性场景分别通过 file:// 与本地 HTTP 执行；另有 4 个性能场景，加上现有功能检查。统计包含重复环境执行，不能理解为 ${current.passed} 个互不重复的功能。</p>
<h2>确认并修复的问题</h2>${table(['现象','修复方式','对应验证'],fixes)}
<h2>同一真实文档的前后对照</h2>${table(['指标','修复前','修复后'],timingRows)}
<p class="muted">耗时来自当前 Mac 的自动化浏览器。资源导入耗时从文件已交给浏览器后计起，不包括人工选文件。选择、切页、改字使用浏览器内计时，衡量同步编辑操作；不等同于完整输入到屏幕呈现的延迟。外网请求被中止以固定测试条件。P95 为排序后第 95 百分位近似值。快照以 HTML 字符数计量，不是浏览器实际内存峰值。资源本体仍单独保留，不能把快照缩小比例当成总内存降幅。</p>
<p>旧版真实大文件用例在等待自动草稿成功的 30 秒期限内未完成；修复版完成了草稿恢复。修复后导出文件仍需包含全部静态资源，约 ${newDeck?(newDeck.exportBytes/1e6).toFixed(1):'?'} MB，本次生成并保存约 ${newDeck?(newDeck.exportMs/1000).toFixed(2):'?'} 秒。切页性能未显示同等幅度的改善；本轮主要改善的是大资源导致的编辑和历史记录开销。</p>
<p>资源预览抽查：${(newDeck?.previewPages||[]).map(p=>`第 ${p.page} 页（${p.images} 张图片、${p.videos} 个视频资源）`).join("；")}。图片执行解码检查，视频验证元数据加载；此项不等同于逐帧画质或音画同步检查。</p>
<h2>新增可重复执行的测试用例</h2>${table(['编号','场景','操作 / 输入','预期'],checks)}
<h2>完整覆盖与执行明细</h2>${table(['套件','通过检查','结果'],current.suites.map(s=>[s.name,s.cases.filter(c=>c.pass).length,s.pass?'通过':'未通过']))}
${current.suites.map(s=>`<details><summary>${esc(s.name)} · ${s.pass?'通过':'未通过'}</summary><ol>${s.cases.map(c=>`<li><span class="${c.pass?'ok':''}">${c.pass?'✓':'×'}</span> ${esc(c.name)}${c.error?'<pre>'+esc(c.error)+'</pre>':''}</li>`).join('')}</ol>${s.error?'<p>'+esc(s.error)+'</p>':''}</details>`).join('')}
<h2>覆盖范围与尚未验证的边界</h2><div class="warn"><ul><li>已覆盖文本 / 字体、基础形状和 SVG、拖动缩放、多选、对齐分布、样式、组合解绑、Flex 转自由布局确认、图层排序锁定、图层自动定位、分页、撤回重做、草稿、工程与 HTML 导出、脚本隔离和预览。</li><li>真实报告逐页执行选择与文字修改；抽查视频页、较密集页面和末页预览。没有逐像素核对全部 31 页，也没有验证每一个原稿自带按钮。</li><li>原稿的 data-motion-src 子页面由脚本加载，其中的嵌套依赖仍不自动打包；编辑器会提示。不能承诺所有嵌入动效在单 HTML 导出后完整可用。</li><li>Google Fonts 等远程资源在本轮性能测试中未联网加载；字体最终外观仍取决于本机字体或网络。CSS 超时会暂时缺少相应样式，重新联网打开可重试。</li><li>3,000 图层批量编辑中位耗时约 ${ms(perf?.results[1]?.metrics.editTiming.median)}，仍可能感到延迟。尚未实现图层树虚拟化或历史增量存储。</li><li>本次仅在 macOS Chrome 上执行；Windows 实机、Edge / Safari、连续数小时耐久测试、系统级内存压力和崩溃恢复未验证。通过测试不代表不存在其他问题。</li></ul></div>
<h2>如何再次运行</h2><p>开发机安装 Node.js 和 Google Chrome。首次安装依赖执行 <code>npm install</code>。通用测试由下面命令自动构建、启动临时本地服务、运行检查并关闭服务：</p><pre>npm run test:all</pre><p>加入这份真实述职报告：</p><pre>DECK_FILE="/path/to/deck.html" npm run test:all</pre><p>原始结果：<a href="../qa/latest/all-results.json">汇总 JSON</a>；测试代码：<a href="../tests/stability.test.mjs">稳定性场景</a>、<a href="../tests/performance.test.mjs">性能场景</a>。失败会返回非零退出码；结果与日志保存在 <code>qa/latest/</code>。测试会生成包含原稿内容的本地 QA 文件，不应将整个 QA 目录发给同事。</p><p>普通使用者只需打开修复后的 <a href="../HTML%20Studio.html">HTML Studio.html</a>。同事包只包含编辑器、通用示例与说明，不包含述职报告和媒体。</p></main></html>`;
await fs.mkdir('docs',{recursive:true});await fs.writeFile('docs/测试报告-20261028.html',html);console.log(path.resolve('docs/测试报告-20261028.html'));
