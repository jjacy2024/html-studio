import { acknowledgeCompatibility } from "./compatibility-support.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const results = [];
const report = process.env.STABILITY_REPORT || "qa/stability-results.json";
const base = process.env.TEST_URL || pathToFileURL(path.resolve("HTML Studio.html")).href;
async function test(name, fn) {
  if (process.env.STABILITY_CASE && !name.startsWith(process.env.STABILITY_CASE)) return;
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => errors.push(e.message));
  let timer;
  const start = Date.now();
  try {
    await Promise.race([(async () => {
      await page.goto(base);
      await page.waitForFunction(() => window.htmlStudio?.doc && !htmlStudio.loading);
      await page.evaluate(() => htmlStudio.ready);
      await fn(page, context);
      assert.deepEqual(errors, []);
    })(), new Promise((_, reject) => timer = setTimeout(() => reject(Error("Case exceeded 25 seconds")), 25000))]);
    results.push({ name, pass: true, ms: Date.now() - start });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, pass: false, ms: Date.now() - start, error: e.message });
    console.error("FAIL", name, e.message.split("\n")[0]);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await context.close();
  }
}
const small = '<!doctype html><html><body><h1 id="title" style="font-size:32px">测试文字</h1></body></html>';
async function load(page, html = small) {
  await page.evaluate((html) => htmlStudio.newDocument(html, "稳定性测试"), html);
}
async function selectTitle(page) {
  await page.evaluate(() => htmlStudio.select([htmlStudio.id(htmlStudio.doc.querySelector("h1"))]));
}
try {
  await test("S01 Pending image requests do not lock the editor", async (page) => {
    await page.route("https://slow.test/**", () => {});
    const state = await page.evaluate(async () => {
      let done = false;
      htmlStudio.newDocument('<h1>Ready to edit</h1><img src="https://slow.test/pending.png">').then(() => done = true);
      await new Promise((r) => setTimeout(r, 1500));
      return { done, loading: htmlStudio.loading };
    });
    assert.deepEqual(state, { done: true, loading: false });
    await selectTitle(page);
    await page.locator('[data-prop="fontSize"]').fill("40");
    await page.locator('[data-prop="fontSize"]').press("Tab");
  });
  await test("S02 Slow remote stylesheet has a bounded editor fallback", async (page) => {
    await page.route("https://slow.test/**", () => {});
    const state = await page.evaluate(async () => {
      let done = false;
      htmlStudio.newDocument('<link rel="stylesheet" href="https://slow.test/theme.css"><h1>Ready</h1>').then(() => done = true);
      await new Promise((r) => setTimeout(r, 2200));
      return { done, loading: htmlStudio.loading };
    });
    assert.deepEqual(state, { done: true, loading: false });
  });
  await test("S03 First inspector click after inline text editing retains focus", async (page) => {
    await load(page); await selectTitle(page);
    await page.evaluate(() => htmlStudio.startText(htmlStudio.nodes[0]));
    await page.locator('[data-prop="fontSize"]').click();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.prop), "fontSize");
    await page.keyboard.press("Meta+A"); await page.keyboard.type("46"); await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => htmlStudio.style(htmlStudio.nodes[0]).fontSize), "46px");
  });
  await test("S04 Overlapping document loads settle and retain the newest document", async (page) => {
    const result = await page.evaluate(async () => {
      const work = [htmlStudio.newDocument('<h1>First</h1>', 'first'), htmlStudio.newDocument('<h1>Last</h1>', 'last')];
      const done = await Promise.race([Promise.allSettled(work).then(() => true), new Promise((r) => setTimeout(() => r(false), 2000))]);
      return { done, name: htmlStudio.name, text: htmlStudio.doc.querySelector('h1')?.textContent, loading: htmlStudio.loading };
    });
    assert.deepEqual(result, { done: true, name: "last", text: "Last", loading: false });
  });
  await test("S05 Losing window focus ends a drag instead of leaving it stuck", async (page) => {
    await load(page); await selectTitle(page);
    const position = await page.evaluate(() => {
      const e = htmlStudio, el = e.nodes[0];
      e.startMove({ clientX: 0, clientY: 0, pointerId: 43, view: e.doc.defaultView });
      window.dispatchEvent(new Event("blur"));
      e.doc.dispatchEvent(new e.doc.defaultView.PointerEvent("pointermove", { pointerId: 43, clientX: 100, clientY: 100 }));
      return e.translation(el);
    });
    assert.deepEqual(position, { x: 0, y: 0 });
  });
  await test("S06 Large embedded assets are shared across undo states", async (page) => {
    const state = await page.evaluate(async () => {
      const data = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>' + ' '.repeat(8 * 1024 * 1024));
      await htmlStudio.newDocument('<h1>Large asset</h1><img src="' + data + '">');
      htmlStudio.select([htmlStudio.id(htmlStudio.doc.querySelector('h1'))]);
      for (let i = 0; i < 8; i++) htmlStudio.property('fontSize', String(31 + i));
      return { states: htmlStudio.history.length, bytes: htmlStudio.history.reduce((n, s) => n + s.html.length, 0) };
    });
    assert.equal(state.states, 9);
    assert.ok(state.bytes < 1024 * 1024, `Undo states retain ${state.bytes} bytes`);
    for (let i = 0; i < 5; i++) await page.evaluate(() => htmlStudio.undo());
    assert.equal(await page.evaluate(() => htmlStudio.style(htmlStudio.nodes[0]).fontSize), "33px");
  });
  await test("S07 Asset-backed draft recovers images after browser reload", async (page) => {
    await load(page, small.replace('</body>', '<img id="asset" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZ2h0PSIxMiI+PC9zdmc+"></body>'));
    await page.waitForFunction(() => document.querySelector('#save-indicator').textContent.includes('已存'));
    await page.reload(); await page.evaluate(() => htmlStudio.ready);
    await page.frameLocator('#edit-frame').locator('#asset').evaluate((el) => el.decode());
    assert.equal(await page.frameLocator('#edit-frame').locator('#asset').evaluate((el) => el.naturalWidth), 12);
  });
  await test("S08 Interrupted imports do not save old HTML with the new document name", async (page) => {
    await load(page); await selectTitle(page);
    await page.evaluate(() => htmlStudio.property('fontSize', '40'));
    await page.route("https://slow.test/**", () => {});
    await page.evaluate(() => { void htmlStudio.newDocument('<h1>New content</h1><img src="https://slow.test/a.png">', 'New name'); });
    await page.waitForTimeout(2500);
    const draft = await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('html-studio-local', 1);
      req.onsuccess = () => { const db = req.result, op = db.transaction('drafts').objectStore('drafts').get('current'); op.onsuccess = () => { db.close(); resolve({ name: op.result?.name, html: op.result?.html || '' }); }; op.onerror = reject; };
    }));
    assert.equal(draft.name, 'New name');
    assert.ok(draft.html.includes('New content'));
  });
  await test("S09 Corrupt project import preserves the current document", async (page) => {
    await load(page);
    await page.locator('#file-input').setInputFiles({ name: 'bad.htmlstudio', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('打开失败'));
    assert.equal(await page.evaluate(() => htmlStudio.doc.querySelector('h1').textContent), '测试文字');
    assert.equal(await page.evaluate(() => htmlStudio.loading), false);
  });
  await test("S10 Edit scripts stay inert and exported assets are portable", async (page, context) => {
    await load(page, '<h1>Portable</h1><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZ2h0PSIxMiI+PC9zdmc+"><script>document.querySelector("h1").textContent="Executed"</script>');
    assert.equal(await page.evaluate(() => htmlStudio.doc.querySelector('h1').textContent), 'Portable');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-button').click()]);
    const out = path.resolve('qa/stability-export.html'); await download.saveAs(out);
    const content = await fs.readFile(out, 'utf8');
    assert.ok(content.includes('data:image/svg+xml;base64,')); assert.ok(!content.includes('blob:'));
    const exported = await context.newPage(); await exported.goto(pathToFileURL(out).href);
    assert.equal(await exported.locator('h1').textContent(), 'Executed');
    assert.equal(await exported.locator('img').evaluate((el) => el.naturalWidth), 12);
  });
  await test("S11 Opaque preview loads shared images and classic scripts", async (page) => {
    await page.locator('#folder-input').setInputFiles(path.resolve('tests/fixtures/bundle'));
    await page.waitForFunction(() => htmlStudio.name === 'index' && !htmlStudio.loading);
    await acknowledgeCompatibility(page);
    await page.evaluate(() => {
      const script=htmlStudio.doc.createElement('script');
      script.textContent='const token="authored-token";document.body.dataset.token=token;';
      htmlStudio.doc.body.append(script);
    });
    for (let i=0; i<3; i++) {
      await page.evaluate(() => htmlStudio.togglePreview(true));
      const preview = page.frameLocator('#preview-frame');
      await preview.locator('img').evaluate(el => el.decode());
      assert.ok(await preview.locator('img').evaluate(el => el.naturalWidth > 0));
      await preview.locator('#action').evaluate(el => el.click());
      assert.equal(await preview.locator('#message').textContent(), '交互仍然可用');
      assert.equal(await preview.locator('body').getAttribute('data-token'),'authored-token');
      assert.equal(await preview.locator('html').evaluate(() => { try { return !!parent.document; } catch { return false; } }), false);
      await page.evaluate(() => htmlStudio.togglePreview(false));
    }
  });
  await test("S12 Clipboard and undo retain assets across new documents", async (page) => {
    await load(page, '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZ2h0PSIxMiI+PC9zdmc+">');
    await page.evaluate(async () => {
      const e=htmlStudio;e.select([e.id(e.doc.querySelector('img'))]);e.copy();
      await e.newDocument('<h1>New document</h1>');e.paste();e.remove();await e.undo();
    });
    await page.frameLocator('#edit-frame').locator('img').evaluate(el => el.decode());
    assert.equal(await page.frameLocator('#edit-frame').locator('img').evaluate(el => el.naturalWidth), 12);
  });
  await test("S13 Saved project reopens with resources in a fresh browser context", async (page) => {
    await page.locator('#folder-input').setInputFiles(path.resolve('tests/fixtures/bundle'));
    await page.waitForFunction(() => htmlStudio.name === 'index' && !htmlStudio.loading);
    await acknowledgeCompatibility(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save-button').click()]);
    const out=path.resolve('qa/stability-assets.htmlstudio');await download.saveAs(out);
    const content=await fs.readFile(out,'utf8');assert.ok(!content.includes('blob:'));
    const other=await browser.newContext();
    try {
      const fresh=await other.newPage();await fresh.goto(base);await fresh.evaluate(() => htmlStudio.ready);
      await fresh.locator('#file-input').setInputFiles(out);
      await fresh.waitForFunction(() => htmlStudio.name==='index'&&!htmlStudio.loading);
      await fresh.frameLocator('#edit-frame').locator('img').evaluate(el=>el.decode());
      await fresh.evaluate(()=>htmlStudio.togglePreview(true));
      await fresh.frameLocator('#preview-frame').locator('#action').evaluate(el=>el.click());
      assert.equal(await fresh.frameLocator('#preview-frame').locator('#message').textContent(),'交互仍然可用');
    } finally {await other.close();}
  });
  await test("S14 Replacing resource documents releases old session resources", async (page) => {
    const count=await page.evaluate(async()=>{
      for(let i=0;i<15;i++)await htmlStudio.newDocument('<img src="data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+(i+1)+'" height="12"></svg>')+'">');
      return htmlStudio.assets.entries.size;
    });
    assert.equal(count,1);
  });
  await test("S15 Stylesheet timeout keeps the original reference in exported HTML", async (page) => {
    await page.route('https://slow.test/**',()=>{});
    await load(page,'<link rel="stylesheet" href="https://slow.test/theme.css"><h1>Style fallback</h1>');
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-button').click()]);
    const out=path.resolve('qa/stability-stylesheet.html');await download.saveAs(out);
    const content=await fs.readFile(out,'utf8');assert.ok(content.includes('href="https://slow.test/theme.css"'));assert.ok(!content.includes('data-hs-'));
    assert.ok(await page.evaluate(()=>htmlStudio.warnings.some(w=>w.includes('样式加载超时'))));
  });
  await test("S16 Overlapping file imports keep the most recently chosen file", async (page) => {
    const result=await page.evaluate(async()=>{
      const first=new File(['<h1>First file</h1>'],'first.html',{type:'text/html'});
      first.text=async()=>{await new Promise(r=>setTimeout(r,250));return '<h1>First file</h1>';};
      const last=new File(['<h1>Last file</h1>'],'last.html',{type:'text/html'});
      await Promise.all([htmlStudio.importFiles([first]),htmlStudio.importFiles([last])]);
      return {name:htmlStudio.name,text:htmlStudio.doc.querySelector('h1').textContent};
    });
    assert.deepEqual(result,{name:'last',text:'Last file'});
  });
} finally {
  await fs.mkdir(path.dirname(report), { recursive: true });
  await fs.writeFile(report, JSON.stringify({ results, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length }, null, 2));
  await browser.close();
}
