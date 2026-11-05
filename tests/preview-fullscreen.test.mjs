import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = 'qa/preview-fullscreen';
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const results = [], errors = [];
page.on('pageerror', e => errors.push(e.message));
page.setDefaultTimeout(12000);
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
const ready = () => page.waitForFunction(() => htmlStudio.previewStatus?.state === 'ready');
const preview = () => page.frameLocator('#preview-frame');
const fixture = '<!doctype html><style>body{margin:0;font:24px sans-serif;background:#efeaf8}h1{padding:24px}#bottom{margin-top:3200px;padding:40px;background:#7455e9;color:white}</style><h1>整窗预览</h1><p>保留交互与滚动</p><button onclick="this.textContent=\'已点击\'">测试交互</button><p id="bottom">页面底部</p>';
async function test(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS', name); }
  catch (e) { results.push({ name, pass: false, error: e.stack }); await page.screenshot({ path: dir + '/failure.png' }); throw e; }
}
async function fullViewport() {
  const r = await page.locator('#preview-frame').boundingBox();
  const v = page.viewportSize();
  assert.ok(Math.abs(r.x) < 1 && Math.abs(r.y) < 1 && Math.abs(r.width-v.width)<1 && Math.abs(r.height-v.height)<1, JSON.stringify({r,v}));
  for (const selector of ['.topbar','.left-panel','.right-panel','.canvas-toolbar','.canvas-footer','.floating-tools','.artboard-label']) assert.equal(await page.locator(selector).isVisible(), false, selector);
  const button = await page.locator('#exit-preview').boundingBox();
  assert.ok(button.x>=0 && button.y>=0 && button.x+button.width<=v.width && button.y+button.height<=v.height);
}
try {
  await page.goto(pathToFileURL(path.resolve('HTML Studio.html')).href);
  await page.waitForFunction(() => window.htmlStudio?.doc && !htmlStudio.loading);
  await page.evaluate(() => htmlStudio.ready);
  await page.evaluate(html => htmlStudio.newDocument(html, '整窗预览测试', { width:1080, height:4000 }), fixture);
  for (const size of [{width:1440,height:900},{width:1100,height:720},{width:640,height:480}]) {
    await test(`预览占满 ${size.width} × ${size.height} 窗口，编辑区域隐藏且退出按钮可见`, async () => {
      await page.setViewportSize(size);
      await page.evaluate(() => htmlStudio.togglePreview(true)); await ready(); await fullViewport();
      assert.equal(await page.locator('#preview-frame').getAttribute('sandbox'), 'allow-scripts');
      await page.locator('#exit-preview').click();
    });
  }
  await page.setViewportSize({width:1440,height:900});
  await test('退出恢复缩放、滚动、选择和工程内容；长页面仍可滚动并交互', async () => {
    const original = await page.evaluate(() => {
      htmlStudio.zoomTo(1.5);htmlStudio.select([htmlStudio.id(htmlStudio.doc.querySelector('h1'))]);
      const s=document.querySelector('#canvas-scroll');s.scrollLeft=180;s.scrollTop=950;
      return {zoom:htmlStudio.zoom,x:s.scrollLeft,y:s.scrollTop,selection:[...htmlStudio.selection],html:htmlStudio.doc.documentElement.outerHTML,history:htmlStudio.history.length};
    });
    await page.locator('#preview-button').click();await ready();await fullViewport();
    await preview().getByRole('button',{name:'测试交互'}).click();
    assert.equal(await preview().getByRole('button',{name:'已点击'}).count(),1);
    await preview().locator('#bottom').scrollIntoViewIfNeeded();
    assert.ok(await preview().locator('body').evaluate(()=>scrollY>2000));
    await preview().locator('#bottom').press('Escape');
    await page.waitForFunction(()=>!htmlStudio.preview);
    const current=await page.evaluate(()=>{const s=document.querySelector('#canvas-scroll');return{zoom:htmlStudio.zoom,x:s.scrollLeft,y:s.scrollTop,selection:[...htmlStudio.selection],html:htmlStudio.doc.documentElement.outerHTML,history:htmlStudio.history.length};});
    assert.deepEqual(current,original);
    assert.equal(await page.locator('.topbar').isVisible(),true);
    assert.equal(await page.locator('.left-panel').isVisible(),true);
    assert.equal(await page.locator('.right-panel').isVisible(),true);
  });
  await test('浏览器全屏进出、重新播放和返回编辑不会白屏或遗留全屏', async () => {
    await page.locator('#preview-button').click();await ready();
    await page.locator('#preview-fullscreen').click();
    await page.waitForFunction(()=>document.fullscreenElement===document.documentElement&&document.querySelector('#preview-fullscreen').getAttribute('aria-pressed')==='true');
    assert.equal(await page.locator('#preview-fullscreen').getAttribute('aria-pressed'),'true');
    await page.locator('#restart-preview').click();await ready();
    assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);
    await page.locator('#preview-fullscreen').click();
    await page.waitForFunction(()=>!document.fullscreenElement);
    assert.equal(await page.evaluate(()=>htmlStudio.preview),true);
    await page.locator('#preview-fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);
    await page.locator('#exit-preview').click();await page.waitForFunction(()=>!document.fullscreenElement&&!htmlStudio.preview);
    await page.locator('#preview-button').click();await ready();
    await page.locator('#preview-fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);
    // The browser consumes Esc during native fullscreen. Its fullscreenchange
    // event must also return to editing; emulate that browser exit directly.
    await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!htmlStudio.preview);
  });
  await test('全屏请求被浏览器拒绝时保留整窗预览和退出入口',async()=>{
    await page.locator('#preview-button').click();await ready();
    await page.evaluate(()=>{window.savedFullscreenRequest=document.documentElement.requestFullscreen;document.documentElement.requestFullscreen=()=>Promise.reject(new Error('blocked for test'));});
    await page.locator('#preview-fullscreen').click();
    await page.waitForFunction(()=>!htmlStudio.previewFullscreen);
    assert.equal(await page.evaluate(()=>htmlStudio.preview),true);await fullViewport();
    await page.evaluate(()=>{document.documentElement.requestFullscreen=window.savedFullscreenRequest;delete window.savedFullscreenRequest;});
    await page.locator('#exit-preview').click();
  });
  await test('动态图表模板当前页在整窗预览和重播中保持，返回编辑页码不变',async()=>{
    await page.evaluate(async()=>{await htmlStudio.createFromTemplate('block-frame');const n=htmlStudio.doc.querySelector('[data-studio-template-chart]');htmlStudio.switchPage(htmlStudio.pages.pages.findIndex(p=>p.contains(n)));});
    const before=await page.evaluate(()=>({index:htmlStudio.pages.index,html:htmlStudio.doc.documentElement.outerHTML}));
    for(let i=0;i<3;i++) {
      await page.locator('#preview-button').click();await ready();await fullViewport();
      const chart=preview().locator('[data-studio-template-chart]').first();
      await chart.waitFor({state:'visible'});await page.waitForTimeout(1400);
      const b=await chart.boundingBox();assert.ok(b.width>0&&b.height>0&&b.y<900&&b.y+b.height>0);
      await page.locator('#restart-preview').click();await ready();await chart.waitFor({state:'visible'});
      if(i===2) {await page.waitForTimeout(1400);await page.mouse.move(10,450);await chart.click();await page.screenshot({path:dir+'/full-window.png'});}
      await page.locator('#exit-preview').click();
      assert.deepEqual(await page.evaluate(()=>({index:htmlStudio.pages.index,html:htmlStudio.doc.documentElement.outerHTML})),before);
    }
  });
  await test('无未捕获脚本错误',async()=>assert.deepEqual(errors,[]));
} catch(e) { console.error(e); process.exitCode=1; }
finally { await fs.writeFile(dir+'/results.json',JSON.stringify({date:new Date().toISOString(),browser:await browser.version(),results,errors},null,2));await browser.close(); }
