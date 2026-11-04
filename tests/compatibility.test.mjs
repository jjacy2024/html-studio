import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const browser = await chromium.launch({headless:true,channel:'chrome'});
const results = [], report = process.env.COMPATIBILITY_REPORT || 'qa/compatibility-results.json';
const base = process.env.TEST_URL || pathToFileURL(path.resolve('HTML Studio.html')).href;
const clean = '<style>@keyframes pulse{to{opacity:.7}}p{animation:pulse 1s infinite}</style><p id="title">普通文字</p><svg width="40" height="40"><circle cx="20" cy="20" r="15" fill="red"/></svg><img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E">';
const risky = '<h1 id="title">可编辑标题</h1><canvas id="chart" width="200" height="100"></canvas><div id="dynamic"></div><script>window.auditExecuted=true;document.getElementById("dynamic").innerHTML="<p>运行时内容</p>";document.querySelector("canvas").getContext("2d").fillRect(0,0,40,40);</script>';
async function importHTML(page,html,name='audit.html') {
  await page.locator('#file-input').setInputFiles({name,mimeType:'text/html',buffer:Buffer.from(html)});
  await page.waitForFunction(name => htmlStudio.name===name && !htmlStudio.loading && htmlStudio.compatibility !== null,name.replace(/\.html?$/i,''));
}
const codes = page => page.evaluate(()=>htmlStudio.compatibility.issues.map(i=>i.code));
async function test(name,fn){
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  const start=Date.now();
  try{await page.goto(base);await page.evaluate(()=>htmlStudio.ready);await fn(page,context);assert.deepEqual(errors,[]);results.push({name,pass:true,ms:Date.now()-start});console.log('PASS',name)}
  catch(e){results.push({name,pass:false,error:e.message,ms:Date.now()-start});console.error('FAIL',name,e.message);process.exitCode=1}
  finally{await context.close()}
}
try{
  await test('C01 普通静态 HTML、SVG 与 CSS 动效不弹警告',async page=>{
    await importHTML(page,clean);assert.deepEqual(await codes(page),[]);assert.equal(await page.locator('#dialog').evaluate(e=>e.open),false);
    await page.locator('#compatibility-button').click();assert.match(await page.locator('#dialog-title').textContent(),/未发现已知/);
  });
  await test('C02 检出 Canvas 和动态内容，导入检测不执行脚本',async page=>{
    await importHTML(page,risky);assert.deepEqual(await codes(page),['canvas','dynamic']);assert.equal(await page.locator('#dialog').evaluate(e=>e.open),true);
    assert.match(await page.locator('[data-compatibility="canvas"]').textContent(),/Chart.js 3\/4.*其他 Canvas 只能调整整体外框/);
    assert.equal(await page.frameLocator('#edit-frame').locator('body').evaluate(()=>window.auditExecuted),undefined);
    assert.equal(await page.frameLocator('#edit-frame').locator('#dynamic').textContent(),'');
    await page.screenshot({path:'qa/compatibility-notice.png'});
  });
  await test('C03 关闭弹窗后可编辑、撤回，并可重新查看',async page=>{
    await importHTML(page,risky);await page.getByRole('button',{name:'知道了，继续编辑',exact:true}).click();
    await page.evaluate(()=>htmlStudio.select([htmlStudio.id(htmlStudio.doc.querySelector('h1'))]));
    await page.locator('[data-prop="fontSize"]').fill('44');await page.locator('[data-prop="fontSize"]').press('Tab');
    assert.equal(await page.evaluate(()=>htmlStudio.style(htmlStudio.nodes[0]).fontSize),'44px');await page.locator('#undo').click();
    assert.equal(await page.locator('#dialog').evaluate(e=>e.open),false);await page.locator('#compatibility-button').click();assert.ok((await codes(page)).includes('canvas'));
    await page.keyboard.press('Escape');assert.equal(await page.locator('#dialog').evaluate(e=>e.open),false);
  });
  await test('C04 弹窗可直接打开预览，动态内容恢复',async page=>{
    await importHTML(page,risky);await page.getByRole('button',{name:'打开预览',exact:true}).click();
    await page.frameLocator('#preview-frame').getByText('运行时内容').waitFor();assert.equal(await page.evaluate(()=>htmlStudio.preview),true);
    assert.equal(await page.locator('#preview-frame').getAttribute('sandbox'),'allow-scripts');
    await page.locator('#exit-preview').click();assert.equal(await page.frameLocator('#edit-frame').locator('#dynamic').textContent(),'');
  });
  await test('C05 本地配套脚本分析存储、接口、模块与组件风险',async page=>{
    await page.evaluate(async()=>{
      const html=new File(['<x-chart></x-chart><template shadowrootmode="open"><p>Shadow</p></template><script src="app.js"></script><script type="module">import "./other.js";</script>'],'source.html',{type:'text/html'});
      const js=new File(['const unused=()=>{localStorage.getItem("theme");fetch("/api/data");};'],'app.js',{type:'text/javascript'});
      await htmlStudio.importFiles([html,js]);
    });
    const found=await codes(page);for(const code of ['components','modules','browser-context','network'])assert.ok(found.includes(code),code);
    assert.ok(!found.includes('partial-scan'));assert.match(await page.locator('[data-compatibility="browser-context"]').textContent(),/存储.*限制/);
  });
  await test('C06 缺失与远程资源明确提示，不宣称预览成功',async page=>{
    await importHTML(page,'<h1>资源</h1><img src="missing.png"><img src="https://missing.test/photo.png"><script src="https://missing.test/app.js"></script><img srcset="small.png 1x,large.png 2x">');
    for(const code of ['missing-resources','remote-resources','partial-scan','responsive-images'])assert.ok((await codes(page)).includes(code),code);
    assert.match(await page.locator('#dialog-body').textContent(),/未.*完整检查|没有读取/);
  });
  await test('C07 iframe、伪元素与动态子页面说明准确',async page=>{
    await importHTML(page,'<style>#host::before{content:"decor"}</style><div id="host" data-motion-src="page.html"></div><iframe id="frame" srcdoc="<p>内部文字</p>"></iframe>');
    for(const code of ['embedded','pseudo','motion-pages'])assert.ok((await codes(page)).includes(code));
    assert.match(await page.locator('#dialog-body').textContent(),/不会把受限内容替换为统一占位符/);
    assert.equal(await page.frameLocator('#edit-frame').locator('#frame').getAttribute('srcdoc'),'<p>内部文字</p>');
  });
  await test('C08 导出保留原元素和脚本，检测信息不混入 HTML',async page=>{
    await importHTML(page,risky);await page.getByRole('button',{name:'知道了，继续编辑',exact:true}).click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-button').click()]);
    const file=path.resolve('qa/compatibility-export.html');await download.saveAs(file);const html=await fs.readFile(file,'utf8');
    assert.match(html,/<canvas id="chart"/);assert.ok(html.includes('window.auditExecuted=true'));assert.ok(!html.includes('data-compatibility'));assert.ok(!html.includes('部分内容的编辑或预览可能受限'));
  });
  await test('C09 多入口目录只提示选中的文件，下一文件清除旧提示',async page=>{
    await page.evaluate(async({clean,risky})=>htmlStudio.importFiles([new File([clean],'safe.html'),new File([risky],'risk.html')]),{clean,risky});
    await page.locator('[data-entry="1"]').click();await page.locator('[data-compatibility="canvas"]').waitFor();
    await page.getByRole('button',{name:'知道了，继续编辑',exact:true}).click();await importHTML(page,clean,'safe.html');
    assert.deepEqual(await codes(page),[]);assert.equal(await page.locator('#dialog').evaluate(e=>e.open),false);assert.equal(await page.locator('#compatibility-button').textContent(),'兼容性检查');
  });
  await test('C10 检测名称转义，导入内容无法注入弹窗',async page=>{
    await importHTML(page,'<canvas id="&lt;img src=x onerror=alert(1)&gt;"></canvas>','<img onerror=alert(1)>.html');
    assert.equal(await page.locator('#dialog-body img').count(),0);assert.match(await page.locator('#dialog-body').textContent(),/<img/);
  });
  await test('C11 大脚本有扫描上限，纯数据脚本不误报',async page=>{
    await importHTML(page,'<p>内容</p><script type="application/ld+json">{"name":"localStorage createElement"}</script>');assert.deepEqual(await codes(page),[]);
    const start=Date.now();await importHTML(page,'<p>内容</p><script>'+('// filler\n'.repeat(40000))+'</script>','large.html');
    assert.ok((await codes(page)).includes('partial-scan'));assert.ok(Date.now()-start<4000);
  });
  await test('C12 连续导入只显示最后文件的检测结果',async page=>{
    await page.evaluate(async({clean,risky})=>{
      const first=new File([risky],'first.html');first.text=async()=>{await new Promise(r=>setTimeout(r,100));return risky};
      await Promise.all([htmlStudio.importFiles([first]),htmlStudio.importFiles([new File([clean],'last.html')])]);
    },{clean,risky});assert.equal(await page.evaluate(()=>htmlStudio.name),'last');assert.deepEqual(await codes(page),[]);assert.equal(await page.locator('#dialog').evaluate(e=>e.open),false);
  });
  await test('C13 草稿恢复不重复弹窗，可重新检查',async page=>{
    await importHTML(page,risky);await page.getByRole('button',{name:'知道了，继续编辑',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#save-indicator').textContent.includes('已存'));
    await page.reload();await page.evaluate(()=>htmlStudio.ready);assert.equal(await page.locator('#dialog').evaluate(e=>e.open),false);assert.ok((await codes(page)).includes('canvas'));
    await page.locator('#compatibility-button').click();await page.locator('[data-compatibility="canvas"]').waitFor();
  });
}finally{
  await fs.mkdir(path.dirname(report),{recursive:true});await fs.writeFile(report,JSON.stringify({date:new Date().toISOString(),browser:await browser.version(),results,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length},null,2));await browser.close();
}
