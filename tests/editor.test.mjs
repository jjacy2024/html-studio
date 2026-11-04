import { acknowledgeCompatibility } from "./compatibility-support.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const base = process.env.TEST_URL || "http://127.0.0.1:4387";
const browser = await chromium.launch({
  headless: true,
  channel: process.env.TEST_BROWSER || "chrome",
});
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
const results = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
page.setDefaultTimeout(12000);
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
    console.error("FAIL", name, e.message);
    await page
      .screenshot({ path: "qa/failure-" + results.length + ".png" })
      .catch(() => {});
    throw e;
  }
}
async function run(fn, arg) {
  return page.evaluate(fn, arg);
}
async function clickPreview(selector) {
  await page.waitForFunction(() => htmlStudio.previewStatus?.state === 'ready');
  await page
    .frameLocator("#preview-frame")
    .locator("html")
    .evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
    });
  const p = await page
    .frameLocator("#preview-frame")
    .locator(selector)
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: innerWidth };
    });
  const b = await page.locator("#preview-frame").boundingBox();
  await page.mouse.click(
    b.x + (p.x * b.width) / p.w,
    b.y + (p.y * b.width) / p.w,
  );
}
async function newBlank() {
  await run(async () => {
    await htmlStudio.newDocument();
    htmlStudio.zoom = 1;
    htmlStudio.layout();
  });
}
try {
  await page.goto(base);
  await page.waitForFunction(
    () => window.htmlStudio?.doc && !window.htmlStudio.loading,
  );
  await run(() => htmlStudio.ready);
  await test("Loads three-panel editor and 60+ editable demo layers", async () => {
    assert.match(await page.title(), /HTML Studio/);
    assert.ok(
      await run(
        () => htmlStudio.doc.querySelectorAll("[data-hs-id]").length > 60,
      ),
    );
    assert.equal(await page.locator(".left-panel").isVisible(), true);
    await page.screenshot({ path: "qa/editor-desktop.png" });
  });
  await test("Edit text typography through inspector; undo and redo", async () => {
    await run(() => {
      const e = htmlStudio.doc.querySelector("h1");
      htmlStudio.select([htmlStudio.id(e)]);
    });
    const input = page.locator('[data-prop="fontSize"]');
    await input.fill("48");
    await input.press("Tab");
    assert.equal(
      await run(
        () => htmlStudio.style(htmlStudio.doc.querySelector("h1")).fontSize,
      ),
      "48px",
    );
    await page.locator("#undo").click();
    await page.waitForFunction(() => !htmlStudio.loading);
    assert.equal(
      await run(
        () => htmlStudio.style(htmlStudio.doc.querySelector("h1")).fontSize,
      ),
      "57px",
    );
    await page.locator("#redo").click();
    await page.waitForFunction(() => !htmlStudio.loading);
    assert.equal(
      await run(
        () => htmlStudio.style(htmlStudio.doc.querySelector("h1")).fontSize,
      ),
      "48px",
    );
  });
  await test("Preview runs CSS animation and JavaScript click interaction", async () => {
    await page.locator("#preview-button").click();
    const frame = page.frameLocator("#preview-frame");
    await clickPreview("#start-button");
    await frame.locator("#notice").waitFor({ state: "visible" });
    assert.match(await frame.locator("#notice").textContent(), /深呼吸/);
    const a = await frame
      .locator(".mood-card")
      .evaluate((el) => getComputedStyle(el).transform);
    await page.waitForTimeout(250);
    const b = await frame
      .locator(".mood-card")
      .evaluate((el) => getComputedStyle(el).transform);
    assert.notEqual(a, b);
    await page.screenshot({ path: "qa/preview-motion.png" });
    await page.locator("#exit-preview").click();
    assert.equal(
      await run(() => htmlStudio.doc.querySelector("#notice").hidden),
      true,
    );
  });
  await test("Export downloads clean runnable HTML and keeps animation/scripts", async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#export-button").click(),
    ]);
    await download.saveAs("qa/exported-demo.html");
    const html = await fs.readFile("qa/exported-demo.html", "utf8");
    assert.ok(html.includes("@keyframes float"));
    assert.ok(html.includes("addEventListener"));
    assert.ok(!html.includes("data-hs-"));
    const exported = await context.newPage();
    await exported.setContent(html);
    await exported.locator("#start-button").click();
    await exported.locator("#notice").waitFor({ state: "visible" });
    assert.match(await exported.locator("#notice").textContent(), /深呼吸/);
    await exported.close();
  });
  await test("Create elements using toolbar and canvas; drag through actual pointer events", async () => {
    await newBlank();
    await page.locator('[data-tool="rect"]').click();
    await page
      .frameLocator("#edit-frame")
      .locator("body")
      .click({ position: { x: 160, y: 120 } });
    assert.equal(await run(() => htmlStudio.nodes[0].dataset.hsShape), "rect");
    const before = await run(() => htmlStudio.rect(htmlStudio.nodes[0]));
    const frameBox = await page.locator("#edit-frame").boundingBox();
    await page.mouse.move(
      frameBox.x + before.x + 40,
      frameBox.y + before.y + 40,
    );
    await page.mouse.down();
    await page.mouse.move(
      frameBox.x + before.x + 90,
      frameBox.y + before.y + 70,
      { steps: 8 },
    );
    await page.mouse.up();
    const after = await run(() => htmlStudio.rect(htmlStudio.nodes[0]));
    assert.ok(Math.abs(after.x - before.x - 50) < 1);
    assert.ok(Math.abs(after.y - before.y - 30) < 1);
  });
  await test("Corner resize changes geometry and is one undo operation", async () => {
    const before = await run(() => ({
      rect: htmlStudio.rect(htmlStudio.nodes[0]),
      history: htmlStudio.history.length,
    }));
    const h = await page.locator('[data-handle="se"]').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 50, h.y + 30, { steps: 8 });
    await page.mouse.up();
    const after = await run(() => ({
      rect: htmlStudio.rect(htmlStudio.nodes[0]),
      history: htmlStudio.history.length,
    }));
    assert.ok(after.rect.width > before.rect.width + 30);
    assert.equal(after.history, before.history + 1);
    await run(() => htmlStudio.undo());
    const restored = await run(() => htmlStudio.rect(htmlStudio.nodes[0]));
    assert.ok(Math.abs(restored.width - before.rect.width) < 1);
  });
  await test("Multi-selection, batch dimensions/opacity, alignment and distribution", async () => {
    await run(() => {
      htmlStudio.insert("ellipse", { x: 360, y: 180 });
      htmlStudio.insert("triangle", { x: 620, y: 240 });
      htmlStudio.select(
        [...htmlStudio.doc.body.children]
          .filter((el) => el.hasAttribute("data-hs-id"))
          .map((el) => htmlStudio.id(el)),
      );
      htmlStudio.property("width", 120);
      htmlStudio.property("opacity", 65);
      htmlStudio.align("top");
      htmlStudio.align("distributeX");
    });
    const result = await run(() =>
      htmlStudio.nodes.map((el) => ({
        rect: htmlStudio.rect(el),
        opacity: htmlStudio.style(el).opacity,
      })),
    );
    assert.equal(result.length, 3);
    assert.ok(result.every((i) => i.opacity === "0.65"));
    assert.ok(result.every((i) => Math.abs(i.rect.width - 120) < 1));
    assert.ok(result.every((i) => Math.abs(i.rect.y - result[0].rect.y) < 1));
    const gaps = result.map((i) => i.rect).sort((a, b) => a.x - b.x);
    assert.ok(
      Math.abs(gaps[1].x - gaps[0].right - (gaps[2].x - gaps[1].right)) < 1,
    );
  });
  await test("Group and ungroup preserve element positions", async () => {
    const before = await run(() =>
      htmlStudio.nodes.map((el) => ({
        id: htmlStudio.id(el),
        rect: htmlStudio.rect(el),
      })),
    );
    await run(() => htmlStudio.group());
    assert.equal(await run(() => htmlStudio.nodes[0].dataset.hsGroup), "true");
    const grouped = await run(
      (ids) => ids.map((id) => htmlStudio.rect(htmlStudio.get(id))),
      before.map((i) => i.id),
    );
    grouped.forEach((r, i) => {
      assert.ok(Math.abs(r.x - before[i].rect.x) < 1);
      assert.ok(Math.abs(r.y - before[i].rect.y) < 1);
    });
    await run(() => htmlStudio.ungroup());
    assert.equal(await run(() => htmlStudio.selection.length), 3);
    const ungrouped = await run(
      (ids) => ids.map((id) => htmlStudio.rect(htmlStudio.get(id))),
      before.map((i) => i.id),
    );
    ungrouped.forEach((r, i) =>
      assert.ok(Math.abs(r.x - before[i].rect.x) < 1),
    );
  });
  await test("Resizing a free-layout group resizes its child geometry", async () => {
    await run(() => htmlStudio.group());
    const b = await run(() => {
      const g = htmlStudio.nodes[0];
      return {
        width: g.offsetWidth,
        children: [...g.children].map((el) => ({
          width: htmlStudio.rect(el).width,
          x: htmlStudio.rect(el).x,
        })),
      };
    });
    await run((w) => htmlStudio.property("width", w * 1.5), b.width);
    const a = await run(() =>
      [...htmlStudio.nodes[0].children].map((el) => htmlStudio.rect(el)),
    );
    a.forEach((r, i) =>
      assert.ok(Math.abs(r.width - b.children[i].width * 1.5) < 1),
    );
    await run(() => htmlStudio.undo());
    await run(() => htmlStudio.ungroup());
  });
  await test("Layer order, lock, duplicate and deletion work", async () => {
    await run(() => {
      htmlStudio.select([htmlStudio.id(htmlStudio.doc.body.children[0])]);
      htmlStudio.reorder(1, true);
    });
    assert.equal(
      await run(
        () => htmlStudio.doc.body.lastElementChild === htmlStudio.nodes[0],
      ),
      true,
    );
    const id = await run(() => htmlStudio.selection[0]);
    await page
      .locator(`.layer-row[data-id="${id}"] [data-layer-action="lock"]`)
      .click();
    await run(() => htmlStudio.remove());
    assert.equal(await run((id) => !!htmlStudio.get(id), id), true);
    await page
      .locator(`.layer-row[data-id="${id}"] [data-layer-action="lock"]`)
      .click();
    await run(() => htmlStudio.duplicate());
    assert.equal(
      await run(() => htmlStudio.doc.body.querySelectorAll("svg").length),
      4,
    );
    await run(() => htmlStudio.remove());
    assert.equal(
      await run(() => htmlStudio.doc.body.querySelectorAll("svg").length),
      3,
    );
  });
  await test("Flow conversion asks confirmation and preserves layout before grouping", async () => {
    await newBlank();
    await run(() => {
      const d = htmlStudio.doc.createElement("div");
      d.id = "flex";
      d.style.cssText =
        "display:flex;gap:18px;padding:22px;width:700px;background:#eee";
      for (let i = 0; i < 3; i++) {
        const c = htmlStudio.doc.createElement("div");
        c.style.cssText = "width:120px;height:80px;background:purple";
        c.textContent = "Card " + i;
        d.append(c);
      }
      htmlStudio.doc.body.append(d);
      htmlStudio.commit("fixture");
      htmlStudio.select(
        [...d.children].slice(0, 2).map((el) => htmlStudio.id(el)),
      );
    });
    const before = await run(() =>
      [...htmlStudio.doc.querySelector("#flex").children].map((el) =>
        htmlStudio.rect(el),
      ),
    );
    await run(() => htmlStudio.group());
    assert.equal(await page.locator("#dialog").isVisible(), true);
    assert.match(await page.locator("#dialog-body").textContent(), /响应式/);
    await page.getByRole("button", { name: "转换并组合", exact: true }).click();
    assert.equal(await run(() => htmlStudio.nodes[0].dataset.hsGroup), "true");
    const after = await run(() => {
      const g = htmlStudio.nodes[0];
      return [...g.children, g.nextElementSibling].map((el) =>
        htmlStudio.rect(el),
      );
    });
    after.forEach((r, i) => {
      assert.ok(
        Math.abs(r.x - before[i].x) < 1,
        `x ${i} ${r.x} ${before[i].x}`,
      );
      assert.ok(Math.abs(r.y - before[i].y) < 1);
    });
    await run(() => htmlStudio.undo());
    assert.equal(
      await run(
        () => htmlStudio.style(htmlStudio.doc.querySelector("#flex")).display,
      ),
      "flex",
    );
  });
  await test("Auto layout container and spacing update", async () => {
    await run(() => {
      const el = htmlStudio.doc.querySelector("#flex");
      htmlStudio.select([htmlStudio.id(el)]);
      htmlStudio.property("display", "flex");
      htmlStudio.property("flexDirection", "column");
      htmlStudio.property("gap", 24);
    });
    const a = await run(() =>
      [...htmlStudio.nodes[0].children].map((el) => htmlStudio.rect(el)),
    );
    assert.ok(Math.abs(a[1].y - a[0].bottom - 24) < 1);
  });
  await test("SVG import remains vector and supports fill/stroke", async () => {
    await page
      .locator("#svg-input")
      .setInputFiles("tests/fixtures/bundle/assets/icon.svg");
    await page.waitForFunction(
      () => htmlStudio.nodes[0]?.dataset.hsName === "icon.svg",
    );
    await run(() => {
      htmlStudio.property("fill", "#ff8833");
      htmlStudio.property("stroke", "#112233");
      htmlStudio.property("strokeWidth", 2);
    });
    assert.equal(await run(() => htmlStudio.nodes[0].localName), "svg");
    assert.equal(
      await run(
        () => htmlStudio.style(htmlStudio.nodes[0].querySelector("rect")).fill,
      ),
      "rgb(255, 136, 51)",
    );
  });
  await test("Save and reopen project preserves HTML and editable metadata", async () => {
    await run(() => (htmlStudio.name = "回环测试"));
    const expected = await run(() => ({
      html: htmlStudio.doc.body.innerHTML,
      ids: [...htmlStudio.doc.body.querySelectorAll("[data-hs-id]")].map((el) =>
        htmlStudio.id(el),
      ),
    }));
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#save-button").click(),
    ]);
    await download.saveAs("qa/roundtrip.htmlstudio");
    await newBlank();
    await page.locator("#file-input").setInputFiles("qa/roundtrip.htmlstudio");
    await page.waitForFunction(
      () => htmlStudio.name === "回环测试" && !htmlStudio.loading,
    );
    assert.deepEqual(
      await run(() =>
        [...htmlStudio.doc.body.querySelectorAll("[data-hs-id]")].map((el) =>
          htmlStudio.id(el),
        ),
      ),
      expected.ids,
    );
    assert.equal(
      await run(() => htmlStudio.doc.querySelector("#flex") !== null),
      true,
    );
  });
  await test("Directory import embeds CSS, image and script; preview and export run", async () => {
    await page
      .locator("#folder-input")
      .setInputFiles(path.resolve("tests/fixtures/bundle"));
    await page.waitForFunction(
      () => htmlStudio.name === "index" && !htmlStudio.loading,
    );
    await acknowledgeCompatibility(page);
    const data = await run(() => ({
      img: htmlStudio.doc.querySelector("img").src,
      script: htmlStudio.doc.querySelector("script").src,
      warnings: htmlStudio.warnings,
      css: htmlStudio.doc.querySelector("style").textContent,
    }));
    assert.match(data.img, /^(data:|blob:)/);
    assert.match(data.script, /^(data:|blob:)/);
    assert.match(data.css, /@keyframes/);
    assert.ok(!data.warnings.some((w) => w.includes("未找到")));
    await page.locator("#preview-button").click();
    const f = page.frameLocator("#preview-frame");
    await clickPreview("#action");
    assert.equal(await f.locator("#message").textContent(), "交互仍然可用");
    await page.locator("#exit-preview").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#export-button").click(),
    ]);
    await download.saveAs("qa/exported-bundle.html");
    const exportedHTML = await fs.readFile("qa/exported-bundle.html", "utf8");
    assert.ok(!exportedHTML.includes("blob:"), "Export must not depend on session resource URLs");
    assert.match(exportedHTML, /data:image/);
    const exported = await context.newPage();
    await exported.setContent(exportedHTML);
    await exported.locator("#action").click();
    assert.equal(
      await exported.locator("#message").textContent(),
      "交互仍然可用",
    );
    await exported.close();
  });
  await test("Draft recovers after browser reload", async () => {
    await run(() => {
      htmlStudio.name = "草稿恢复测试";
      htmlStudio.commit("rename");
    });
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForFunction(() => htmlStudio.doc && !htmlStudio.loading);
    assert.equal(await run(() => htmlStudio.name), "草稿恢复测试");
  });
  await test("Desktop narrow layout has usable controls at 1280px", async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await run(() => htmlStudio.fit());
    await page.screenshot({ path: "qa/editor-1280.png" });
    assert.ok(await page.locator("#export-button").isVisible());
    assert.equal(
      await run(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
    );
  });
  await test("Text editing supports multiline content and preserves undo", async () => {
    await newBlank();
    await run(() => htmlStudio.insert("text", { x: 100, y: 80 }));
    const frame = page.frameLocator("#edit-frame");
    await run(() => htmlStudio.startText(htmlStudio.nodes[0]));
    await page.keyboard.insertText("你好，HTML Studio");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("第二行");
    await page.keyboard.press("Escape");
    const text = await run(() => htmlStudio.nodes[0].innerText);
    assert.match(text, /你好，HTML Studio/);
    assert.match(text, /第二行/);
    await run(() => htmlStudio.undo());
    assert.equal(await run(() => htmlStudio.nodes[0].textContent), "输入文字");
  });
  await test("Initial-opacity entrance animation is editable without changing export", async () => {
    await run(async () => {
      await htmlStudio.newDocument(
        '<!doctype html><html><head><style>body{margin:0}.reveal{opacity:0;animation:fade 1s forwards}@keyframes fade{to{opacity:1}}</style></head><body><h1 class="reveal">入场标题</h1></body></html>',
        "入场测试",
      );
    });
    assert.equal(
      await run(
        () => htmlStudio.style(htmlStudio.doc.querySelector("h1")).opacity,
      ),
      "1",
    );
    const source = await run(async () => {
      const { cleanDocument } = await import("./document.js");
      return cleanDocument(htmlStudio.doc, { exporting: true });
    });
    assert.ok(source.includes("opacity:0"));
    assert.ok(!source.includes("data-hs-runtime"));
    await page.locator("#preview-button").click();
    const frame = page.frameLocator("#preview-frame");
    await frame.locator("h1").waitFor();
    await page.waitForTimeout(1100);
    assert.equal(
      await frame.locator("h1").evaluate((el) => getComputedStyle(el).opacity),
      "1",
    );
    await clickPreview("h1");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !htmlStudio.preview);
  });
  await test("Unsaved import asks before replacing current work", async () => {
    await run(() => {
      htmlStudio.insert("rect", { x: 40, y: 60 });
    });
    await page
      .locator("#file-input")
      .setInputFiles("tests/fixtures/bundle/index.html");
    await page.locator("#dialog").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await run(() => htmlStudio.name), "入场测试");
    await page
      .locator("#file-input")
      .setInputFiles("tests/fixtures/bundle/index.html");
    await page.locator("#dialog").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "继续打开", exact: true }).click();
    await page.waitForFunction(
      () => htmlStudio.name === "index" && !htmlStudio.loading,
    );
    await acknowledgeCompatibility(page);
    assert.ok(
      await run(() => htmlStudio.warnings.some((w) => w.includes("未找到"))),
    );
  });
  await test("Layer backward order remains visible above the page background", async () => {
    await newBlank();
    await run(() => {
      htmlStudio.insert("rect", { x: 80, y: 80 });
      htmlStudio.insert("ellipse", { x: 100, y: 100 });
      htmlStudio.reorder(-1, true);
    });
    const result = await run(() => {
      const e = htmlStudio;
      const selected = e.nodes[0];
      const top = e.doc.elementFromPoint(120, 120);
      return {
        z: e.style(selected).zIndex,
        selected: e.id(selected),
        top: e.id(top?.ownerSVGElement || top),
      };
    });
    assert.ok(Number(result.z) > 0);
    assert.notEqual(result.top, result.selected);
    await run(() => htmlStudio.reorder(1, true));
    assert.equal(
      await run(() => {
        const top = htmlStudio.doc.elementFromPoint(120, 120);
        return htmlStudio.id(top?.ownerSVGElement || top);
      }),
      result.selected,
    );
  });
  await test("No uncaught runtime errors", async () =>
    assert.deepEqual(errors, []));
} catch (e) {
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    "qa/test-results.json",
    JSON.stringify(
      { date: new Date().toISOString(), browser: "Chrome", results, errors },
      null,
      2,
    ),
  );
  await browser.close();
}
