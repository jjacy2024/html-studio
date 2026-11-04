import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:4387");
await page.waitForFunction(
  () => window.htmlStudio?.doc && !window.htmlStudio.loading,
);
await page.screenshot({ path: "qa/initial.png" });
console.log(
  JSON.stringify(
    {
      title: await page.title(),
      errors,
      state: await page.evaluate(() => ({
        layers: htmlStudio.doc.querySelectorAll("[data-hs-id]").length,
        selection: htmlStudio.selection,
        zoom: htmlStudio.zoom,
        history: htmlStudio.history.length,
        inspector: document
          .querySelector("#inspector")
          .textContent.slice(0, 300),
      })),
    },
    null,
    2,
  ),
);
await browser.close();
