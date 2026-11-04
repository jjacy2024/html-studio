import { acknowledgeCompatibility } from "./compatibility-support.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, acceptDownloads: true });
const results = [], errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(15000);
const fixture = `<!doctype html><html><head><style>
body{margin:0}.deck-stage{position:absolute;width:1920px;height:1080px;transform:scale(.4)}
.slide{position:absolute;inset:0;width:1920px;height:1080px;visibility:hidden;opacity:0;pointer-events:none;background:#f4f1e8}
.slide.active,.slide.visible{visibility:visible;opacity:1;pointer-events:auto}
h1{position:absolute;left:140px;top:120px;font:64px sans-serif}
.reveal{opacity:0;transform:translateY(30px)}.slide.visible .reveal{opacity:1;transform:none}
</style></head><body><main class="deck-stage">
${[1, 2, 3].map((n) => `<section class="slide${n === 1 ? " active visible" : ""}" data-title="章节 ${n}"><h1 class="reveal">页面 ${n}</h1><div style="position:absolute;left:80px;top:300px;width:100px;height:100px;background:#9871ef"></div></section>`).join("")}
</main><nav>原始导航</nav><script>
window.deck={slides:[...document.querySelectorAll('.slide')],show(i){this.current=i;this.slides.forEach((s,n)=>{s.classList.toggle('active',n===i);s.classList.toggle('visible',n===i)})}};
deck.show(0);addEventListener('keydown',e=>{if(e.key==='ArrowRight')deck.show((deck.current+1)%3)});
</script></body></html>`;
async function test(name, fn) {
  await fn(); results.push(name); console.log("PASS", name);
}
async function load(html) {
  await page.evaluate(async (html) => {
    await htmlStudio.load({ html, name: "分页测试", width: 1080, height: 820 });
    htmlStudio.history = []; htmlStudio.historyIndex = -1;
    htmlStudio.pushHistory("打开"); htmlStudio.dirty = false; htmlStudio.fit();
  }, html);
}
async function clickText() {
  const p = await page.evaluate(() => {
    const el = htmlStudio.pageRoot.querySelector("h1,h2"), r = el.getBoundingClientRect();
    const f = document.querySelector("#edit-frame").getBoundingClientRect();
    return { x: f.x + (r.x + r.width / 2) * htmlStudio.zoom, y: f.y + (r.y + r.height / 2) * htmlStudio.zoom };
  });
  await page.mouse.click(p.x, p.y);
}
async function exportHTML(name) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-button").click()]);
  const dest = path.resolve("qa", name);
  await download.saveAs(dest);
  return fs.readFile(dest, "utf8");
}
try {
  await page.goto(process.env.TEST_URL || pathToFileURL(path.resolve("HTML Studio.html")).href);
  await page.waitForFunction(() => window.htmlStudio?.doc && !htmlStudio.loading);
  await page.evaluate(() => htmlStudio.ready);
  await test("Ordinary pages do not show presentation controls", async () => {
    assert.equal(await page.locator("#page-navigation").isVisible(), false);
    await load('<html><body><section>One</section><section>Two</section></body></html>');
    assert.equal(await page.locator("#page-navigation").isVisible(), false);
  });
  await load(fixture);
  await test("Detects fixed-size slides, titles and the original 1920×1080 canvas", async () => {
    assert.equal(await page.locator("#page-navigation").isVisible(), true);
    assert.equal(await page.locator("#page-select option").count(), 4);
    assert.match(await page.locator("#page-select option").nth(1).textContent(), /02 · 章节 2/);
    assert.deepEqual(await page.evaluate(() => [htmlStudio.width, htmlStudio.height]), [1920, 1080]);
    assert.equal(await page.locator("#page-previous").isDisabled(), true);
  });
  await test("Page selection isolates the requested page, including entrance text", async () => {
    await page.locator("#page-select").selectOption("1");
    assert.deepEqual(await page.evaluate(() => [...htmlStudio.doc.querySelectorAll(".slide")].map((el) => htmlStudio.style(el).display !== "none")), [false, true, false]);
    const state = await page.evaluate(() => {
      const r = htmlStudio.rect(htmlStudio.pageRoot), text = htmlStudio.pageRoot.querySelector("h1");
      return { x: r.x, y: r.y, width: r.width, height: r.height, opacity: htmlStudio.style(text).opacity, transform: htmlStudio.style(text).transform, layers: document.querySelector("#layer-list").textContent };
    });
    assert.deepEqual([state.x, state.y, state.width, state.height], [0, 0, 1920, 1080]);
    assert.equal(state.opacity, "1"); assert.equal(state.transform, "none");
    assert.match(state.layers, /页面 2/); assert.ok(!state.layers.includes("页面 1"));
    assert.ok(!state.layers.includes("原始导航"));
  });
  await test("Navigation preserves source activation and does not create undo steps", async () => {
    assert.equal(await page.evaluate(() => htmlStudio.history.length), 1);
    assert.equal(await page.evaluate(() => htmlStudio.dirty), false);
    assert.deepEqual(await page.evaluate(() => [...htmlStudio.doc.querySelectorAll(".slide")].map((el) => el.className)), ["slide active visible", "slide", "slide"]);
  });
  await test("Real canvas selection and inspector editing affect only the current page", async () => {
    await clickText();
    assert.equal(await page.evaluate(() => htmlStudio.nodes[0].textContent), "页面 2");
    await page.locator('[data-prop="fontSize"]').fill("75");
    await page.locator('[data-prop="fontSize"]').press("Tab");
    await page.locator("#page-next").click();
    assert.equal(await page.locator("#page-next").isDisabled(), true);
    assert.equal(await page.evaluate(() => htmlStudio.selection.length), 0);
    await page.locator("#page-previous").click();
    assert.equal(await page.evaluate(() => htmlStudio.style(htmlStudio.pageRoot.querySelector("h1")).fontSize), "75px");
  });
  await test("New and pasted elements belong to the current slide", async () => {
    await page.evaluate(() => { htmlStudio.insert("text"); htmlStudio.copy(); htmlStudio.select([]); htmlStudio.paste(); });
    assert.equal(await page.evaluate(() => htmlStudio.nodes[0].parentElement === htmlStudio.pageRoot), true);
    assert.equal(await page.evaluate(() => htmlStudio.doc.querySelectorAll(".slide")[0].children.length), 2);
  });
  await test("Undo and redo keep the relevant edit page visible", async () => {
    await page.locator("#undo").click();
    await page.waitForFunction(() => !htmlStudio.loading);
    assert.equal(await page.locator("#page-select").inputValue(), "1");
    assert.equal(await page.evaluate(() => htmlStudio.pageRoot.children.length), 3);
    await page.locator("#redo").click();
    await page.waitForFunction(() => !htmlStudio.loading);
    assert.equal(await page.evaluate(() => htmlStudio.pageRoot.children.length), 4);
  });
  await test("Project save/reopen restores the selected page and all pages' edits", async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#save-button").click()]);
    const dest = path.resolve("qa/pages.htmlstudio"); await download.saveAs(dest);
    const saved = JSON.parse(await fs.readFile(dest, "utf8"));
    assert.equal(saved.pageView.mode, "page");
    assert.ok(!saved.html.includes('data-hs-runtime="page-view"'));
    await page.evaluate(async (saved) => { await htmlStudio.load(saved); htmlStudio.fit(); }, saved);
    assert.equal(await page.locator("#page-select").inputValue(), "1");
    assert.equal(await page.evaluate(() => htmlStudio.pageRoot.children.length), 4);
  });
  await test("Native deck preview starts at the edit page and can still advance", async () => {
    await page.locator("#preview-button").click();
    // A fresh iframe starts with an already-complete about:blank document.
    // Wait for the actual preview runtime before inspecting the deck.
    await page.waitForFunction(() => htmlStudio.previewStatus?.state === "ready");
    const frame = page.frameLocator("#preview-frame");
    assert.equal(await frame.locator("body").evaluate(() => window.deck.current), 1);
    const bounds = await page.locator("#preview-frame").boundingBox();
    await page.mouse.click(bounds.x + 40, bounds.y + 40);
    await page.keyboard.press("ArrowRight");
    assert.equal(await frame.locator("body").evaluate(() => window.deck.current), 2);
    await page.locator("#exit-preview").click();
    assert.equal(await page.locator("#page-select").inputValue(), "1");
  });
  await test("Export keeps every slide and original playback without editor isolation", async () => {
    const html = await exportHTML("pages-export.html");
    assert.ok(!html.includes("data-hs-"));
    assert.ok(!html.includes("html-studio-exit-preview"));
    const exported = await browser.newPage();
    await exported.setContent(html);
    assert.equal(await exported.locator(".slide").count(), 3);
    assert.equal(await exported.evaluate(() => deck.current), 0);
    await exported.locator("body").press("ArrowRight");
    assert.equal(await exported.evaluate(() => deck.current), 1);
    assert.equal(await exported.locator(".slide").nth(1).locator("h1").evaluate((el) => getComputedStyle(el).fontSize), "75px");
    await exported.close();
  });
  await test("Original-layout mode restores the full tree and source visibility", async () => {
    await page.locator("#page-select").selectOption("-1");
    assert.match(await page.locator("#layer-list").textContent(), /导航/);
    assert.deepEqual(await page.evaluate(() => [htmlStudio.width, htmlStudio.height]), [1080, 820]);
    assert.equal(await page.evaluate(() => htmlStudio.style(htmlStudio.doc.querySelectorAll(".slide")[1]).visibility), "hidden");
  });
  if (process.env.DECK_FILE) {
    const filename = path.resolve(process.env.DECK_FILE);
    const before = await fs.readFile(filename, "utf8");
    await test("Imports the supplied 31-page presentation and reaches its final page", async () => {
      await page.evaluate(() => htmlStudio.dirty = false);
      await page.locator("#file-input").setInputFiles(filename);
      await page.waitForFunction(() => !htmlStudio.loading && htmlStudio.pages?.pages.length === 31);
      await acknowledgeCompatibility(page);
      await page.locator("#page-select").selectOption("30");
      assert.match(await page.locator("#page-select option:checked").textContent(), /31 · 结束/);
      assert.deepEqual(await page.evaluate(() => [htmlStudio.width, htmlStudio.height]), [1920, 1080]);
      assert.equal(await page.evaluate(() => htmlStudio.pages.pages.filter((el) => htmlStudio.style(el).display !== "none").length), 1);
      assert.equal(await page.evaluate(() => htmlStudio.style(htmlStudio.pageRoot.querySelector(".reveal")).opacity), "1");
    });
    await test("Edits page 31 and page 4 independently in the supplied presentation", async () => {
      await clickText();
      await page.locator('[data-prop="fontSize"]').fill("101");
      await page.locator('[data-prop="fontSize"]').press("Tab");
      await page.locator("#page-select").selectOption("3");
      await clickText();
      await page.locator('[data-prop="fontSize"]').fill("73");
      await page.locator('[data-prop="fontSize"]').press("Tab");
      await page.locator("#page-select").selectOption("30");
      assert.equal(await page.evaluate(() => htmlStudio.pageRoot.querySelector("h1,h2").style.fontSize), "101px");
      await page.screenshot({ path: "qa/pages-real-deck.png" });
    });
    await test("Supplied deck export retains 31 slides, source scripts and original first page", async () => {
      const html = await exportHTML("real-deck-export.html");
      const result = await page.evaluate(({ html, original }) => {
        const d = new DOMParser().parseFromString(html, "text/html"), source = new DOMParser().parseFromString(original, "text/html");
        return { count: d.querySelectorAll(".slide").length,
          scriptsEqual: [...d.scripts].map((s) => s.textContent).join("") === [...source.scripts].map((s) => s.textContent).join(""),
          classesEqual: [...d.querySelectorAll(".slide")].every((s, i) => s.className === source.querySelectorAll(".slide")[i].className),
          textSize: d.querySelectorAll(".slide")[30].querySelector("h1,h2").style.fontSize };
      }, { html, original: before });
      assert.deepEqual(result, { count: 31, scriptsEqual: true, classesEqual: true, textSize: "101px" });
      assert.equal(await fs.readFile(filename, "utf8"), before);
    });
    await test("Supplied deck preview starts at page 31 and native previous-page navigation works", async () => {
      await page.locator("#preview-button").click();
      await page.waitForFunction(() => htmlStudio.previewStatus?.state === "ready");
      const frame = page.frameLocator("#preview-frame");
      assert.equal(await frame.locator("body").evaluate(() => window.deck?.current), 30);
      const bounds = await page.locator("#preview-frame").boundingBox();
      await page.mouse.click(bounds.x + 40, bounds.y + 40);
      await page.keyboard.press("ArrowLeft");
      assert.equal(await frame.locator("body").evaluate(() => window.deck.current), 29);
      await page.locator("#exit-preview").click();
      assert.equal(await page.locator("#page-select").inputValue(), "30");
    });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile("qa/pages-results.json", JSON.stringify({ passed: results.length, results, errors }, null, 2));
} catch (e) {
  console.error(e.stack); await page.screenshot({ path: "qa/pages-failure.png" }); process.exitCode = 1;
} finally { await browser.close(); }
