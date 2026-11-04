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
const picker = page.locator('[data-prop="fontFamily"]');
const html = `<!doctype html><html><head><style>
@font-face{font-family:"Page Serif";src:local("Georgia")}
p{font-family:Archivo,"Noto Sans SC",sans-serif;font-size:36px}
</style></head><body><p id="one">字体选择 Font test</p><p id="two" style="font-family:monospace">另一段文字</p></body></html>`;
async function test(name, fn) { await fn(); results.push(name); console.log("PASS", name); }
async function font() { return page.evaluate(() => htmlStudio.style(htmlStudio.nodes[0]).fontFamily); }
async function select(selector) {
  await page.evaluate((selector) => htmlStudio.select([htmlStudio.id(htmlStudio.doc.querySelector(selector))]), selector);
}
try {
  await page.goto(pathToFileURL(path.resolve("HTML Studio.html")).href);
  await page.waitForFunction(() => window.htmlStudio?.doc && !htmlStudio.loading);
  await page.evaluate(() => htmlStudio.ready);
  await page.evaluate(async (html) => {
    await htmlStudio.load({ html, width: 1080, height: 820, name: "字体菜单验证" });
    htmlStudio.history = []; htmlStudio.historyIndex = -1; htmlStudio.pushHistory("打开");
  }, html);
  await select("#one");
  await test("Font stacks use a real unfiltered menu with page and common fonts", async () => {
    assert.equal(await picker.evaluate((el) => el.tagName), "SELECT");
    assert.equal(await picker.inputValue(), 'Archivo, "Noto Sans SC", sans-serif');
    assert.ok(await picker.locator("option").count() >= 18);
    assert.equal(await picker.locator('optgroup[label="页面字体"] option').textContent(), "Page Serif");
    assert.equal(await picker.locator('option[value="serif"]').count(), 1);
  });
  await test("Clicking the menu and using keyboard typeahead selects Georgia immediately", async () => {
    await picker.click();
    await page.keyboard.press("g");
    await page.keyboard.press("Enter");
    assert.equal(await font(), "Georgia");
  });
  await test("Selecting Chinese fonts applies immediately and supports undo/redo", async () => {
    await picker.selectOption('"Songti SC"');
    assert.equal(await font(), '"Songti SC"');
    await page.locator("#undo").click(); await page.waitForFunction(() => !htmlStudio.loading);
    assert.equal(await font(), "Georgia");
    await page.locator("#redo").click(); await page.waitForFunction(() => !htmlStudio.loading);
    assert.equal(await font(), '"Songti SC"');
  });
  await test("Mixed selections keep font choices available and apply to both elements", async () => {
    await page.evaluate(() => htmlStudio.select([...htmlStudio.doc.querySelectorAll("p")].map((el) => htmlStudio.id(el))));
    assert.equal(await picker.locator("option:checked").textContent(), "混合字体");
    await picker.selectOption("serif");
    assert.deepEqual(await page.evaluate(() => htmlStudio.nodes.map((el) => htmlStudio.style(el).fontFamily)), ["serif", "serif"]);
  });
  await test("Canceling custom font entry preserves the selected font and history", async () => {
    const before = await page.evaluate(() => htmlStudio.historyIndex);
    await picker.selectOption("__custom_font__");
    assert.equal(await page.locator("#dialog").isVisible(), true);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await font(), "serif");
    assert.equal(await picker.inputValue(), "serif");
    assert.equal(await page.evaluate(() => htmlStudio.historyIndex), before);
  });
  await test("Custom names with punctuation apply with Enter and survive export", async () => {
    await picker.selectOption("__custom_font__");
    await page.getByLabel("自定义字体名称").fill("My Font 3.0");
    await page.getByLabel("自定义字体名称").press("Enter");
    assert.equal(await font(), '"My Font 3.0"');
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-button").click()]);
    await download.saveAs("qa/fonts-export.html");
    const exported = await fs.readFile("qa/fonts-export.html", "utf8");
    assert.match(exported, /My Font 3\.0/);
    assert.ok(!exported.includes("__custom_font__"));
    assert.ok(!exported.includes("data-hs-"));
  });
  if (process.env.DECK_FILE) {
    await test("The supplied presentation's existing font stack no longer hides alternatives", async () => {
      await page.evaluate(() => htmlStudio.dirty = false);
      await page.locator("#file-input").setInputFiles(path.resolve(process.env.DECK_FILE));
      await page.waitForFunction(() => !htmlStudio.loading && htmlStudio.pages?.pages.length === 31);
      await acknowledgeCompatibility(page);
      await page.locator("#page-select").selectOption("3");
      await page.evaluate(() => htmlStudio.select([htmlStudio.id(htmlStudio.pageRoot.querySelector("h2"))]));
      assert.equal(await picker.evaluate((el) => el.tagName), "SELECT");
      await picker.selectOption('"Songti SC"');
      assert.equal(await font(), '"Songti SC"');
      await page.locator("#page-select").selectOption("30");
      await page.evaluate(() => htmlStudio.select([htmlStudio.id(htmlStudio.pageRoot.querySelector("h1,h2"))]));
      await picker.selectOption("serif");
      assert.equal(await font(), "serif");
      await page.locator("#page-select").selectOption("3");
      await page.evaluate(() => htmlStudio.select([htmlStudio.id(htmlStudio.pageRoot.querySelector("h2"))]));
      assert.equal(await font(), '"Songti SC"');
      await page.screenshot({ path: "qa/fonts-real-deck.png" });
    });
  }
  assert.deepEqual(errors, []);
  await fs.writeFile("qa/fonts-results.json", JSON.stringify({ passed: results.length, results, errors }, null, 2));
} catch (e) {
  console.error(e.stack); await page.screenshot({ path: "qa/fonts-failure.png" }); process.exitCode = 1;
} finally { await browser.close(); }
