import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const results = [];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(12000);
const fixture = `<!doctype html><html><head><style>
  body { margin: 0; font: 20px sans-serif; }
  #early { position: absolute; left: 100px; top: 60px; width: 180px; height: 60px; background: #eee; }
  .filler { position: absolute; left: 5px; top: 5px; width: 2px; height: 2px; }
  #outer { position: absolute; left: 100px; top: 180px; width: 360px; height: 220px; background: #ddf; }
  #inner { margin: 40px; padding: 20px; background: #fff; }
  #target { margin: 0; height: 80px; }
  #unrelated { position: absolute; left: 600px; top: 180px; }
  </style></head><body><div id="early">顶部图层</div>
  ${Array.from({ length: 65 }, (_, i) => `<div class="filler" id="before-${i}"></div>`).join("")}
  <section id="outer"><div id="inner"><h2 id="target">深层目标</h2></div></section>
  ${Array.from({ length: 40 }, (_, i) => `<div class="filler" id="after-${i}"></div>`).join("")}
  <section id="unrelated"><span>保持折叠</span></section></body></html>`;

async function settle() {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function point(selector, offset) {
  const local = await page.frameLocator("#edit-frame").locator(selector).evaluate((el, offset) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + (offset?.x ?? r.width / 2), y: r.y + (offset?.y ?? r.height / 2), width: innerWidth };
  }, offset);
  const frame = await page.locator("#edit-frame").boundingBox();
  return { x: frame.x + local.x * frame.width / local.width, y: frame.y + local.y * frame.width / local.width };
}
async function clickCanvas(selector, options = {}, offset) {
  const p = await point(selector, offset);
  await page.mouse.click(p.x, p.y, options);
  await settle();
}
async function state(selector) {
  return page.evaluate((selector) => {
    const id = htmlStudio.id(htmlStudio.doc.querySelector(selector));
    const pane = document.querySelector("#layers-pane");
    const row = pane.querySelector(`[data-id="${id}"]`);
    const r = row?.getBoundingClientRect();
    const p = pane.getBoundingClientRect();
    return {
      id, selected: htmlStudio.selection.includes(id), count: htmlStudio.selection.length,
      visible: !!r && !pane.hidden && r.top >= p.top - 1 && r.bottom <= p.top + pane.clientHeight + 1,
      scrollTop: pane.scrollTop,
      canvas: [document.querySelector("#canvas-scroll").scrollLeft, document.querySelector("#canvas-scroll").scrollTop, scrollX, scrollY],
    };
  }, selector);
}
async function test(name, fn) {
  await fn();
  results.push(name);
  console.log("PASS", name);
}
try {
  await page.goto(process.env.TEST_URL || pathToFileURL(path.resolve("HTML Studio.html")).href);
  await page.waitForFunction(() => window.htmlStudio?.doc && !htmlStudio.loading);
  await page.evaluate(() => htmlStudio.ready);
  await page.evaluate(async (html) => {
    await htmlStudio.load({ html, width: 1080, height: 820, name: "图层定位验证" });
    htmlStudio.pushHistory("测试页面");
    htmlStudio.fit();
  }, fixture);
  await test("Canvas selection reveals an offscreen layer without scrolling the canvas", async () => {
    const before = await state("#target");
    assert.equal(before.visible, false);
    await clickCanvas("#target");
    const after = await state("#target");
    assert.ok(after.selected && after.visible);
    assert.ok(after.scrollTop > 0);
    assert.deepEqual(after.canvas, before.canvas);
  });
  await test("Selecting a layer above the current viewport scrolls upward", async () => {
    await clickCanvas("#early");
    assert.ok((await state("#early")).visible);
  });
  await test("Collapsed ancestors expand while unrelated branches stay collapsed", async () => {
    await page.evaluate(() => {
      for (const selector of ["#outer", "#inner", "#unrelated"])
        htmlStudio.collapsed.add(htmlStudio.id(htmlStudio.doc.querySelector(selector)));
      htmlStudio.renderLayers();
    });
    await clickCanvas("#target");
    assert.ok((await state("#target")).visible);
    assert.deepEqual(await page.evaluate(() => ["#outer", "#inner", "#unrelated"].map((s) => htmlStudio.collapsed.has(htmlStudio.id(htmlStudio.doc.querySelector(s))))), [false, false, true]);
  });
  await test("Clicking an existing selection reanchors it after manual layer scrolling", async () => {
    await page.locator("#layers-pane").evaluate((pane) => pane.scrollTop = 0);
    await clickCanvas("#target");
    assert.ok((await state("#target")).visible);
  });
  await test("Already-visible selected rows keep their exact scroll position", async () => {
    await page.evaluate(() => {
      const pane = document.querySelector("#layers-pane");
      const row = pane.querySelector(".selected");
      pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 2;
    });
    await settle();
    const before = await state("#target");
    await clickCanvas("#target");
    assert.equal((await state("#target")).scrollTop, before.scrollTop);
  });
  await test("Multi-selection anchors the newly added layer and preserves the selection", async () => {
    await clickCanvas("#early");
    await page.keyboard.down("Shift");
    await clickCanvas("#target");
    await page.keyboard.up("Shift");
    const target = await state("#target");
    assert.ok(target.selected && target.visible);
    assert.equal(target.count, 2);
    await clickCanvas("#early");
    const early = await state("#early");
    assert.ok(early.visible && early.selected);
    assert.equal(early.count, 2);
    await page.keyboard.down("Shift");
    await clickCanvas("#early");
    await page.keyboard.up("Shift");
    assert.equal((await state("#target")).scrollTop, early.scrollTop);
    assert.equal((await state("#target")).count, 1);
  });
  await test("Inspector updates preserve manual scroll and collapsed branches", async () => {
    await page.evaluate(() => {
      htmlStudio.collapsed.add(htmlStudio.id(htmlStudio.doc.querySelector("#outer")));
      htmlStudio.renderLayers();
      document.querySelector("#layers-pane").scrollTop = 0;
    });
    await page.locator('[data-prop="fontSize"]').fill("32");
    await page.locator('[data-prop="fontSize"]').press("Tab");
    await settle();
    assert.equal((await state("#target")).scrollTop, 0);
    assert.ok(await page.evaluate(() => htmlStudio.collapsed.has(htmlStudio.id(htmlStudio.doc.querySelector("#outer")))));
  });
  await test("Canvas selection clears a hiding search and returns from Insert to Layers", async () => {
    await page.locator("#layer-search").fill("no-matching-layer");
    await page.locator('[data-left-tab="insert"]').click();
    await clickCanvas("#target");
    assert.equal(await page.locator("#layer-search").inputValue(), "");
    assert.ok((await state("#target")).visible);
    await page.locator("#layer-search").fill("target");
    await clickCanvas("#target");
    assert.equal(await page.locator("#layer-search").inputValue(), "target");
    assert.ok((await state("#target")).visible);
    await page.locator("#layer-search").fill("");
  });
  await test("Layer-panel selection and collapse keep the user's chosen tree position", async () => {
    await page.locator("#layers-pane").evaluate((pane) => pane.scrollTop = 400);
    const before = await page.locator("#layers-pane").evaluate((pane) => {
      const p = pane.getBoundingClientRect();
      const row = [...pane.querySelectorAll(".layer-row")].find((r) => r.getBoundingClientRect().top > p.top + 150);
      return { scroll: pane.scrollTop, id: row.dataset.id };
    });
    await page.locator(`.layer-row[data-id="${before.id}"] .layer-text`).click();
    await settle();
    assert.equal(await page.locator("#layers-pane").evaluate((pane) => pane.scrollTop), before.scroll);
    await clickCanvas("#target");
    const outerId = (await state("#outer")).id;
    await page.locator(`.layer-row[data-id="${outerId}"] .layer-toggle`).click();
    assert.equal(await page.locator(`.layer-row[data-id="${(await state("#target")).id}"]`).count(), 0);
  });
  await test("Canvas container selection anchors the container itself", async () => {
    await page.locator("#layers-pane").evaluate((pane) => pane.scrollTop = 0);
    await clickCanvas("#outer", {}, { x: 12, y: 12 });
    const s = await state("#outer");
    assert.ok(s.selected && s.visible);
    assert.equal(s.count, 1);
  });
  await test("Context-menu selection reveals the layer", async () => {
    await page.locator("#layers-pane").evaluate((pane) => pane.scrollTop = 0);
    await clickCanvas("#target", { button: "right" });
    assert.ok((await state("#target")).visible);
    await page.keyboard.press("Escape");
  });
  assert.deepEqual(errors, []);
  await clickCanvas("#target");
  await page.screenshot({ path: "qa/layer-reveal.png" });
  await fs.writeFile("qa/layer-reveal-results.json", JSON.stringify({ passed: results.length, results, errors }, null, 2));
} catch (e) {
  console.error(e.stack);
  await page.screenshot({ path: "qa/layer-reveal-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
