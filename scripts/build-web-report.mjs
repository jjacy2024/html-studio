import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const r=JSON.parse(await fs.readFile('qa/web-results.json','utf8'));
const samples=JSON.parse(await fs.readFile('qa/web-corpus-20261028/manifest.json','utf8'));
const all=JSON.parse(await fs.readFile('qa/latest/all-results.json','utf8'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const timing=r.results.flatMap(x=>x.metrics.edits||[]).sort((a,b)=>a-b);
const ms=n=>Number(n).toFixed(1)+' ms';
const notes={
 'mdn-grid':'Grid 文本、布局样式抽查正常。',
 'mdn-flex':'Flex 换行卡片的静态选择与编辑正常。',
 'mdn-multicol':'可点击分栏文本片段；跨列的整体包围框包含空白，不代表空白处也是文字。',
 'mdn-animation':'CSS 雪花动效在预览和导出中运行，动画时间推进正常。',
 'mdn-dialog':'预览及导出可打开/关闭原生对话框；关闭的对话框内容不自动展开为画布编辑状态。',
 'mdn-svg':'内嵌响应式 SVG 及周围静态内容正常；本轮不测试路径节点编辑。',
 'mdn-table':'合并单元格数据表的静态文本与样式抽查正常。',
 email:'已修复深层图层名称宽度变为 0 的问题；可在图层面板点击文字。',
 'mdn-canvas':'预览和导出能生成两块 Canvas 图形。编辑状态不执行绘图脚本，只能选择 Canvas 宿主；内部图形不是可编辑图层。',
 'mdn-select':'原生控件/静态标题可选；脚本生成的自定义下拉菜单只在预览/导出中生成，不自动成为可编辑图层。',
 'mdn-shadow':'静态宿主内容可编辑；预览/导出有两个 Shadow Root，展开交互正常。Shadow DOM 内部不进入图层树。',
 todo:'预览和导出可新增待办。此版本使用内存存储；新增的运行时列表项不进入静态编辑图层。',
 reveal:'兼容性不足：依赖脚本计算的幻灯片尺寸在编辑态被识别为 160px 宽；沙盒中 sessionStorage/History API 受限，预览翻页失败。导出后直接本地打开可翻页。',
 'bootstrap-blog':'长文章底部可滚动并选中。预览的主题切换脚本因 localStorage 隔离报错；正文、导出正常。',
 'bootstrap-blog-rtl':'RTL 方向与文字样式抽查正常，底部可选。预览的主题切换脚本因 localStorage 隔离报错；导出正常。',
 'bootstrap-checkout':'预览/导出的表单校验正常。预览主题切换因 localStorage 隔离报错；未测试支付或向服务器提交。',
 'bootstrap-dashboard':'预览/导出生成 Chart.js 图表；图表内部不是静态图层。预览主题切换因 localStorage 隔离报错。',
 'bootstrap-carousel':'预览/导出可切换轮播，长页面底部可选。预览主题切换因 localStorage 隔离报错。'
};
const rows=r.results.map(x=>`<tr><td><strong>${esc(x.title)}</strong><small>${esc(x.id)}</small><a href="${esc(x.source)}" target="_blank" rel="noreferrer">网上来源</a> · <a href="../qa/web-corpus-20261028/${x.id}/bundle/index.html">本地样本</a></td><td><span class="pill ${x.status}">${({passed:'本轮未见异常',limited:'存在限制',failed:'失败'})[x.status]}</span></td><td>${esc(notes[x.id]||x.error)}</td><td>${x.document.layers}</td><td>${ms(x.metrics.importMs)}</td><td>${ms(x.metrics.editTiming.median)}</td></tr>`).join('');
const evidence=ids=>ids.map(([id,title])=>`<figure><a href="../qa/web-corpus-20261028/${id}/editor.png"><img loading="lazy" src="../qa/web-corpus-20261028/${id}/editor.png" alt="${esc(title)}"></a><figcaption>${esc(title)}</figcaption></figure>`).join('');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>18 类公开 HTML 兼容性测试 · HTML Studio v0.1.3</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f4f9;color:#302c3a;font:15px/1.8 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:1220px;margin:auto;padding:44px 24px 70px}header,.box{padding:24px;background:white;border:1px solid #e3dfed;border-radius:16px}h1{font-size:30px;line-height:1.4;margin:6px 0 12px}h2{font-size:22px;margin:30px 0 12px}p{margin:10px 0}.muted,small{font-size:12px;color:#766f83}small{display:block}.tag,a{color:#6843bb}a{text-decoration:none}a:hover{text-decoration:underline}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:20px 0}.metric{padding:18px;background:white;border:1px solid #e3dfed;border-radius:12px}.metric b{display:block;font-size:32px;line-height:1.4;color:#6546b5}.warn{padding:18px 22px;background:#fff4dc;border-left:4px solid #ca952e;border-radius:6px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;background:white;min-width:900px}td,th{padding:12px;border:1px solid #e4dfed;text-align:left;vertical-align:top}th{background:#eeebf6}td:first-child{min-width:195px}td:nth-child(3){min-width:300px}.pill{display:inline-block;padding:1px 8px;border-radius:15px;white-space:nowrap;font-size:12px}.passed{background:#e5f5ed;color:#197548}.limited{background:#fff0d3;color:#925b10}.failed{background:#ffe6e6;color:#b22}.screens{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}img{display:block;width:100%;border:1px solid #ddd7e8;border-radius:10px}figcaption{font-size:13px;color:#766f83;margin:7px 0}pre{background:#eeebf6;padding:20px;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere}li{margin:7px 0}summary{cursor:pointer;font-weight:600}code{overflow-wrap:anywhere}@media(max-width:700px){main{padding:20px 14px}.metrics{grid-template-columns:1fr 1fr}.screens{grid-template-columns:1fr}h1{font-size:25px}}</style><main>
<header><div class="tag">HTML STUDIO · v0.1.3 · 2026-10-28</div><h1>18 份公开 HTML 的真实文件测试</h1><p>从 MDN、Bootstrap、Reveal.js、TodoMVC 和开源邮件模板获取了不同结构的 HTML。测试中复现并修复了<strong>长画布无法正常滚动</strong>和<strong>深层图层名称被挤没</strong>两处缺陷。</p><p>修复后，18 份样本的导入、静态选择、属性修改、撤回重做、工程保存重开及导出检查均通过。8 份在本轮场景中未见异常；另外 10 份仍有预览或动态内容编辑限制。</p><p class="muted">实测环境：macOS / Chrome ${esc(r.browser)}，无头自动化；1512 × 982 窗口，针对两处修复另测 1280px 窗口。未在 Windows、Edge 或 Safari 上验证。没有发布在线版本。</p></header>
<div class="metrics"><div class="metric"><b>${r.summary.samples}</b>公开网页样本</div><div class="metric"><b>${r.summary.passedChecks}</b>核心流程检查通过</div><div class="metric"><b>2</b>真实缺陷已修复</div><div class="metric"><b>${all.passed}</b>原有及新增回归检查通过</div></div>
<div class="warn">“核心检查通过”不等于完整支持该网页。Reveal.js 预览翻页仍失败，部分 Bootstrap 主题切换在预览中受限；Canvas、Shadow DOM 和脚本生成内容也不会自动转为内部可编辑图层。测试没有为了运行这些页面而放开预览脚本对编辑器的访问权限。</div>
<h2>发现并修复的问题</h2><div class="box"><ol><li><strong>长页面放大后无法正常滚动。</strong>网格布局按画布内容自动撑高，画布滚动容器的高度超过窗口，鼠标无法到达页面下方。已约束工作区网格和画布的最小高度，让内容在画布内部滚动。博客、RTL 博客、轮播长页已能滚动到下方并通过真实鼠标点击选中。</li><li><strong>嵌套很深时图层名称消失。</strong>邮件表格的多层嵌套持续占用左侧宽度，将文字宽度压到 0。已保留图层名称的最小可用空间、启用横向滚动，并在画布选择时横向定位到名称。保留原有缩进和 DOM 层级。</li></ol><p>新增回归使用 6000px 长页面和 24 层嵌套，覆盖 50% / 100% / 200% 缩放、滚轮、底部点击、名称点击、自动定位及锁定操作。旧 v0.1.2 的 5 项检查全部失败，修复后 5 项全部通过。另回归既有功能、31 页述职稿、大资源压力和商家页面：共 ${all.passed} 项通过，${all.failedSuites} 个失败套件。</p><p><a href="../qa/web-corpus-20261028/viewport-before.json">修复前证据</a> · <a href="../qa/latest/viewport.json">修复后证据</a> · <a href="../tests/viewport.test.mjs">新增回归用例</a></p></div>
<h2>逐份结果与来源</h2><p class="muted">“图层数”是导入的静态可识别层数；“修改中位数”来自每份连续 12 次透明度修改。整体共 ${timing.length} 次，单次同步耗时中位数 ${ms(timing[Math.floor(timing.length/2)])}，最大 ${ms(timing.at(-1))}。这不是完整鼠标到画面呈现的延迟，也不是长时间稳定性保证。</p><div class="table-wrap"><table><thead><tr><th>类型 / 来源</th><th>结论</th><th>具体观察与限制</th><th>图层数</th><th>导入耗时</th><th>修改中位数</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>每份样本实际测了什么</h2><div class="box"><ul><li>通过真实目录导入入口加载 HTML 和静态依赖；检查缺失资源提示。</li><li>和禁用脚本的源页面对照，抽查最多 3 个静态元素的字体、字号、颜色和文字方向。不是逐像素的全页面一致性证明。</li><li>通过真实鼠标点击画布中最多 3 个元素，长页面包含下方目标；点击最多 3 个图层名称。</li><li>连续修改 12 次透明度，验证撤回/重做；保存 .htmlstudio 后在新浏览器环境重开并验证修改与图层数。</li><li>导出 HTML，检查无编辑器标记或会话 Blob 地址泄漏，内联脚本保持一致；通过本地 HTTP 和直接 file:// 打开导出文件，验证各样本的指定交互。</li><li>运行编辑器预览，记录脚本错误、动画/对话框/轮播/表单/图表等结果；返回编辑后恢复选择。</li></ul><p>18 份原始本地样本及其导出文件的指定运行时探针均通过；编辑器预览中 17 份的主要探针通过，Reveal.js 翻页失败。5 份 Bootstrap 页面的主题脚本仍报 localStorage 隔离错误，所以仍标记为“存在限制”。</p><p class="muted">测试中未复现持续卡死；每份样本设 60 秒限时。没有进行小时级长时间压测、服务端/API 请求、外链页面或远程 iframe 功能测试。</p></div>
<h2>本地截图</h2><div class="screens">${evidence([['email','修复后的深层邮件图层'],['bootstrap-blog','修复后的长文章画布'],['bootstrap-blog-rtl','RTL 文章静态编辑'],['reveal','Reveal.js 编辑尺寸仍有限制']])}</div>
<h2>来源、资源与复测</h2><div class="box"><p>公共样本由官方示例仓库或开源项目获取。GitHub 源码固定到提交版本；Bootstrap 官网示例保留下载日期和内容 SHA-256。原始 HTML、准备后的资源包、来源许可及每个依赖的哈希均保存在本地。${samples.reduce((n,s)=>n+s.resources.length,0)} 个引用静态资源下载成功，清单中下载失败数为 ${samples.reduce((n,s)=>n+s.failures.length,0)}。</p><p>为离线复现，样本资源地址改写到本地；CSS 引用改写后去掉对应旧完整性校验值。未修改示例脚本逻辑。下载器不追踪普通链接、远程 iframe 文档及 JavaScript 动态资源请求；本轮运行屏蔽外网请求，只放行测试自己的本地服务。<strong>若手动测试，请在编辑器中导入样本的整个 bundle 文件夹，而不是仅 index.html。</strong></p><pre>npm run test:web:fetch    # 需要联网：重新获取样本与依赖
npm run test:web          # 已下载后可离线运行
npm run test:viewport     # 两处修复的重点回归
npm run test:all          # 常规回归；不自动联网获取样本
WEB_CASE=email npm run test:web</pre><p><a href="../tests/web-samples.json">18 份来源清单</a> · <a href="../qa/web-corpus-20261028/manifest.json">资源、许可及哈希记录</a> · <a href="../qa/web-results.json">完整测试结果</a> · <a href="../tests/web-corpus.test.mjs">网页测试用例</a> · <a href="../qa/latest/all-results.json">常规回归结果</a></p><details><summary>验证过的编辑器文件</summary><p>SHA-256：<code>${esc(r.editorHash)}</code></p><p>本次下载的公开样本、私人述职稿和商家文件均未加入同事测试 ZIP；该 ZIP 只包含编辑器、使用说明和原有离线示例。</p></details></div>
<h2>本地交付</h2><p><a href="../HTML%20Studio.html">打开 v0.1.3 编辑器</a> · <a href="../releases/HTML-Studio-同事测试包-v0.1.3-20261028.zip">同事测试包 ZIP</a></p></main></html>`;
await fs.mkdir('docs',{recursive:true});const out='docs/网上样本兼容性测试-20261028.html';await fs.writeFile(out,html);console.log(path.resolve(out));
