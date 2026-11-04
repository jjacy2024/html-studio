import fs from 'node:fs/promises';
import path from 'node:path';
import{fileURLToPath}from'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const before=JSON.parse(await fs.readFile('qa/merchant-20261028/before-results.json','utf8'));
const after=JSON.parse(await fs.readFile('qa/merchant-results.json','utf8'));
const all=JSON.parse(await fs.readFile('qa/latest/all-results.json','utf8'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ms=n=>Number(n).toFixed(1)+' ms';
const table=(heads,rows)=>'<div class="scroll"><table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>商家页面兼容性核验 · HTML Studio v0.1.2</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f5fa;color:#282334;font:15px/1.8 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:1080px;padding:48px 26px 70px;margin:auto}header,.box{background:white;border:1px solid #e6e1f1;border-radius:16px;padding:24px}h1{font-size:28px;margin:6px 0 14px;line-height:1.4}h2{font-size:21px;margin:30px 0 12px}.tag{color:#744bd0;font-weight:600}.muted{color:#766e86;font-size:13px}.warn{background:#fff6df;border-left:4px solid #d59a25;padding:16px 20px;border-radius:6px;margin-top:20px}table{width:100%;border-collapse:collapse;background:white;min-width:620px}th,td{padding:11px 14px;border:1px solid #e8e3f0;text-align:left;vertical-align:top}th{background:#eeebf7}.scroll{overflow:auto}a{color:#6943bb}pre{white-space:pre-wrap;word-break:break-all;padding:16px;background:#eeebf7;border-radius:8px}.screens{display:grid;grid-template-columns:1fr 1fr;gap:15px}.screens img{width:100%;border:1px solid #e6e1f1;border-radius:10px}figure{margin:0}figcaption{font-size:13px;color:#766e86}@media(max-width:700px){.screens{grid-template-columns:1fr}}li{margin:7px 0}</style><main><header><div class="tag">HTML STUDIO · 文件专项核验</div><h1>merchant-onboarding-v9-tmg-optimized.html</h1><p>结论：旧版和上一轮 v0.1.1 中，抽查的已有静态元素都可以通过画布和图层面板选中，未复现持续卡死。该文件的动态商品行、图表和弹窗内容仍不能直接作为静态图层编辑；预览模式也会主动禁用编辑。</p><p class="muted">${esc(new Date(after.date).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))}（北京时间） · macOS Chrome ${esc(after.browser)} · 源文件 ${(after.source.bytes/1024).toFixed(0)} KB，${after.metrics.structure?.nodes} 个 DOM 元素，${after.metrics.structure?.layers} 个可识别图层。原文件哈希已核对，未修改。</p></header>
<h2>反馈对应的情况</h2>${table(['情况','本次观察','当前处理'],[
['已有静态图层无法选中','文字、按钮、SVG、图片与对应左侧图层抽查正常；1280px 窗口也正常。','尚不能认定同事遇到的具体失选步骤已被复现；需要具体元素或操作链进一步定位。'],
['动态内容无法选中',`源文件静态商品列表为 0 行，预览脚本运行后生成 ${after.metrics.preview?.rows} 行；图表也由脚本生成。`,'当前编辑器不把运行时 DOM 转为可编辑图层，v0.1.1 和 v0.1.2 都有此限制。'],
['预览里画布与图层都点不动','预览运行原页面交互，同时禁用图层编辑。退出预览后静态选择恢复。','已将预览提示改为明确说明不可选中编辑，并提示返回编辑。'],
['卡顿','v0.1.1 中多数属性修改约需 50–60 ms；主要耗时来自每次重建 545 行图层 UI。','v0.1.2 改为先在离屏片段中生成图层，再一次性替换，避免逐行读写触发布局。'],
['持续卡死','两版在本次限时操作链中均未复现。','未覆盖同事的实际 Windows/浏览器环境及长时间运行，不把本次未复现等同于问题不存在。']])}
<h2>同机、同文件的修改耗时</h2>${table(['指标','上一轮 v0.1.1','本次 v0.1.2'],[
['连续 40 次字号修改：中位数',ms(before.metrics.editTiming?.median),ms(after.metrics.editTiming?.median)],
['连续 40 次字号修改：P95',ms(before.metrics.editTiming?.p95),ms(after.metrics.editTiming?.p95)],
['连续 40 次字号修改：最大值',ms(before.metrics.editTiming?.max),ms(after.metrics.editTiming?.max)],
['专项检查通过数',`${before.passed} / 10`,`${after.passed} / 10`]
])}<p class="muted">这些数值是浏览器内同步编辑操作的计时，不是从鼠标到屏幕呈现的完整延迟；性能受硬件、浏览器和后台负载影响。专项检查包含对“动态内容不会进入静态图层”的边界验证，因此全部通过并不代表动态图层已获支持。</p>
<h2>专项用例</h2>${table(['用例','结果'],after.results.map(r=>[r.name,r.pass?'通过':r.error]))}<p>同时回归了原有功能、图层定位、字体、31 页述职稿、稳定性和压力测试：共 ${all.passed} 项检查通过，${all.failedSuites} 个失败套件。统计包含不同本地运行环境的重复执行。</p>
<h2>编辑与预览的差异</h2><div class="screens"><figure><img src="../qa/merchant-20261028/verified-edit.png" alt="静态编辑画布"><figcaption>编辑：静态标题能选中，动态数据未生成。</figcaption></figure><figure><img src="../qa/merchant-20261028/verified-preview.png" alt="运行脚本的预览"><figcaption>预览：脚本生成数据并执行交互，不支持选择编辑图层。</figcaption></figure></div>
<div class="warn">若希望直接编辑商品行、数据图表或运行后弹出的内容，需要另行设计“运行后生成可编辑副本”或特定页面适配。它会涉及脚本重新渲染覆盖修改、弹窗状态与导出行为，不能视为普通卡顿修复。本轮未擅自加入该能力。</div>
<h2>复测</h2><pre>MERCHANT_FILE="/path/to/sample.html" npm run test:merchant</pre><p><a href="../tests/merchant.test.mjs">专项测试代码</a> · <a href="../qa/merchant-results.json">专项原始结果</a> · <a href="../qa/latest/all-results.json">回归汇总</a> · <a href="../HTML%20Studio.html">当前编辑器</a></p><p class="muted">这份报告及 QA 截图供本地核验，未包含在同事测试 ZIP 中。没有发布在线版本或修改原始 HTML。</p></main></html>`;
await fs.mkdir('docs',{recursive:true});const filename='docs/商家页面核验-20261028.html';await fs.writeFile(filename,html);console.log(path.resolve(filename));
