import { replaceTemplateFontLinks } from './template-fonts.js';
export const SKIP = new Set([
  "BR",
  "SCRIPT",
  "STYLE",
  "LINK",
  "META",
  "TITLE",
  "NOSCRIPT",
  "TEMPLATE",
  "DEFS",
  "LINEARGRADIENT",
  "RADIALGRADIENT",
  "STOP",
  "CLIPPATH",
  "MASK",
]);
export function uid() {
  return "n" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}
export function escapeHTML(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function selectable(el) {
  return (
    el?.nodeType === 1 &&
    !SKIP.has(el.tagName.toUpperCase()) &&
    !el.hasAttribute("data-hs-runtime") &&
    !el.parentElement?.closest('[data-studio-chart]') &&
    !el.ownerSVGElement
  );
}
export function annotate(doc) {
  const seen = new Set();
  [doc.body, ...doc.body.querySelectorAll("*")].forEach((el) => {
    if (!selectable(el)) return;
    let id = el.getAttribute("data-hs-id");
    if (!id || seen.has(id)) el.setAttribute("data-hs-id", (id = uid()));
    seen.add(id);
  });
}
export function label(el) {
  return (
    el?.getAttribute("data-hs-name") ||
    el?.id ||
    ({
      BODY: "页面",
      MAIN: "主内容",
      SECTION: "区块",
      NAV: "导航",
      BUTTON: "按钮",
      IMG: "图片",
      VIDEO: "视频",
      TABLE: "表格",
      SVG: "矢量图",
      INPUT: "输入框",
      DIV: "容器",
      P: "段落",
      H1: "标题",
      H2: "标题",
      SPAN: "文本",
      A: "链接",
    }[el?.tagName?.toUpperCase()] ||
      el?.tagName?.toLowerCase() ||
      "元素") +
      (el?.matches("h1,h2,h3,h4,p,span,button,a,label")
        ? " · " + el.textContent.trim().slice(0, 18)
        : "")
  );
}
export function isText(el) {
  return (
    !!el &&
    el.tagName !== "BODY" &&
    el.namespaceURI !== "http://www.w3.org/2000/svg" &&
    !el.matches("img,input,video,canvas,iframe,[data-studio-chart]") &&
    [...el.children].every((c) =>
      c.matches("span,br,b,strong,i,em,u,s,small,a,sub,sup,mark"),
    )
  );
}
export function cleanDocument(doc, { exporting = false } = {}) {
  const clone = doc.documentElement.cloneNode(true);
  clone.querySelectorAll("[data-hs-runtime]").forEach((el) => el.remove());
  clone.querySelectorAll('canvas[data-hs-canvas-width]').forEach(canvas => {
    for (const dimension of ['width', 'height']) {
      const value = canvas.getAttribute('data-hs-canvas-' + dimension);
      if (value) canvas.setAttribute(dimension, value);
      else canvas.removeAttribute(dimension);
      canvas.removeAttribute('data-hs-canvas-' + dimension);
    }
  });
  clone.querySelectorAll("[data-hs-pending-stylesheet]").forEach((el) => {
    el.setAttribute("href", el.getAttribute("data-hs-pending-stylesheet"));
    el.removeAttribute("data-hs-pending-stylesheet");
  });
  clone.querySelectorAll("[data-hs-editing]").forEach((el) => {
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-hs-editing");
    el.removeAttribute("spellcheck");
  });
  clone.querySelectorAll("[data-hs-original-http-equiv]").forEach((el) => {
    el.setAttribute(
      "http-equiv",
      el.getAttribute("data-hs-original-http-equiv"),
    );
    el.removeAttribute("data-hs-original-http-equiv");
  });
  if (exporting) {
    clone.querySelectorAll("*").forEach((el) => {
      for (const a of [...el.attributes])
        if (a.name.startsWith("data-hs-")) el.removeAttribute(a.name);
    });
    for (const a of [...clone.attributes])
      if (a.name.startsWith("data-hs-")) clone.removeAttribute(a.name);
  }
  return "<!DOCTYPE html>\n" + clone.outerHTML;
}
export function prepareHTML(html) {
  const d = new DOMParser().parseFromString(html, "text/html");
  d.querySelectorAll("meta[http-equiv]").forEach((el) => {
    if (/refresh|content-security-policy/i.test(el.httpEquiv)) {
      el.setAttribute("data-hs-original-http-equiv", el.httpEquiv);
      el.removeAttribute("http-equiv");
    }
  });
  annotate(d);
  const style = d.createElement("style");
  style.dataset.hsRuntime = "edit-style";
  style.textContent =
    "html{scroll-behavior:auto!important;overflow:hidden!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:#7951df}iframe{pointer-events:none!important}video:not([controls])::-webkit-media-controls{display:none!important}video:not([controls])::-webkit-media-controls-enclosure{display:none!important}a,button{cursor:default!important}[data-hs-editing]{outline:1px dashed #9871ef!important;cursor:text!important}";
  d.head.append(style);
  return "<!DOCTYPE html>\n" + d.documentElement.outerHTML;
}
export function snapshot(editor) {
  return {
    html: cleanDocument(editor.doc),
    name: editor.name,
    width: editor.width,
    height: editor.height,
    selection: [...editor.selection],
    pageView: editor.pages?.state || null,
    warnings: [...editor.warnings],
  };
}
export function projectData(editor) {
  return {
    format: "html-studio",
    version: 1,
    savedAt: new Date().toISOString(),
    ...snapshot(editor),
  };
}
export function fileDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function normalized(path) {
  const out = [];
  for (const x of path.split("/")) {
    if (x === "..") out.pop();
    else if (x && x !== ".") out.push(x);
  }
  return out.join("/");
}
export async function importBundle(files, entry, assets) {
  const map = new Map(files.map((f) => [f.webkitRelativePath || f.name, f]));
  const warnings = new Set();
  const pending = new Map();
  const root = entry.webkitRelativePath
    ? entry.webkitRelativePath.split("/")[0] + "/"
    : "";
  function resolve(ref, base) {
    if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref))
      return null;
    let decoded;
    try {
      decoded = decodeURIComponent(ref.split(/[?#]/)[0]);
    } catch {
      decoded = ref.split(/[?#]/)[0];
    }
    return normalized(
      (ref.startsWith("/")
        ? root
        : base.split("/").slice(0, -1).join("/") + "/") + decoded,
    );
  }
  async function resource(ref, base) {
    const path = resolve(ref, base);
    if (!path) return ref;
    const f = map.get(path);
    if (!f) {
      warnings.add("未找到资源：" + path);
      return ref;
    }
    if (!pending.has(path)) pending.set(path, assets ? assets.addFile(f) : fileDataURL(f));
    return pending.get(path);
  }
  async function css(text, base, ancestors = new Set()) {
    const imports = [
      ...text.matchAll(
        /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?([^;]*);/gi,
      ),
    ];
    for (const m of imports) {
      const p = resolve(m[1], base);
      if (p && map.has(p) && !ancestors.has(p)) {
        const chain = new Set(ancestors);
        chain.add(p);
        const inner = await css(await map.get(p).text(), p, chain);
        text = text.replace(
          m[0],
          m[2].trim() ? `@media ${m[2].trim()}{${inner}}` : inner,
        );
      }
    }
    const urls = [...text.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g)];
    for (const m of urls) {
      const u = await resource(m[2], base);
      text = text.replace(m[0], `url("${u}")`);
    }
    return text;
  }
  const entryPath = entry.webkitRelativePath || entry.name;
  const doc = new DOMParser().parseFromString(replaceTemplateFontLinks(await entry.text()), "text/html");
  for (const link of doc.querySelectorAll('link[rel="stylesheet"][href]')) {
    const p = resolve(link.getAttribute("href"), entryPath);
    if (p && map.has(p)) {
      const style = doc.createElement("style");
      style.textContent = await css(await map.get(p).text(), p, new Set([p]));
      link.replaceWith(style);
    } else if (p) warnings.add("未找到样式：" + p);
  }
  for (const style of doc.querySelectorAll("style"))
    style.textContent = await css(style.textContent, entryPath);
  for (const el of doc.querySelectorAll("[style]"))
    el.setAttribute("style", await css(el.getAttribute("style"), entryPath));
  for (const el of doc.querySelectorAll("[src],[poster]"))
    for (const a of ["src", "poster"])
      if (el.hasAttribute(a))
        el.setAttribute(a, await resource(el.getAttribute(a), entryPath));
  for (const el of doc.querySelectorAll(
    'svg image[href],link[rel="icon"][href]',
  ))
    el.setAttribute("href", await resource(el.getAttribute("href"), entryPath));
  if (doc.querySelector("[srcset]"))
    warnings.add("srcset 响应式图片请检查资源引用；初版只自动嵌入 src。");
  if (doc.querySelector("[data-motion-src]"))
    warnings.add("检测到 data-motion-src 动态子页面：初版不自动打包其内部依赖，预览和导出需检查这些局部动效。");
  if (doc.querySelector('script[type="module"]'))
    warnings.add(
      "检测到模块脚本：相对模块导入需要完整开发环境，初版不保证运行。",
    );
  if (
    doc.querySelector(
      'script[src^="http"],link[href^="http"],img[src^="http"]',
    ) ||
    /url\(["']?https?:/.test(doc.documentElement.outerHTML)
  )
    warnings.add("页面使用远程资源，预览和导出可能需要联网。");
  if (doc.querySelector("script"))
    warnings.add(
      "脚本仅在隔离预览中运行；脚本生成的图表、列表等不会自动成为可编辑图层。修改结构后请验证交互。",
    );
  return {
    html: "<!DOCTYPE html>\n" + doc.documentElement.outerHTML,
    warnings: [...warnings],
  };
}
let draftQueue = Promise.resolve();
export function saveDraft(data, assets) {
  // Capture the document and its blobs together, before another document loads.
  const entries = assets?.references(data.html) || [];
  const current = { ...data, assets: entries.map(({ id, url }) => ({ id, url })) };
  const save = async () => {
    await dbAction("readwrite", (s) => {
      const keys = s.getAllKeys();
      keys.addEventListener("success", () => {
        const keep = new Set(entries.map((e) => "asset:" + e.id));
        for (const key of keys.result)
          if (String(key).startsWith("asset:") && !keep.has(key)) s.delete(key);
        for (const entry of entries)
          if (!assets.persisted.has(entry.id))
            s.put({ assetId: entry.id, blob: entry.blob }, "asset:" + entry.id);
        s.put(current, "current");
      });
      return keys;
    });
    if (assets) assets.persisted = new Set(entries.map((e) => e.id));
  };
  const next = draftQueue.then(save, save);
  draftQueue = next.catch(() => {});
  return next;
}
export async function loadDraft() {
  const values = await dbAction("readonly", (s) => s.getAll());
  const current = values.find((v) => v?.format === "html-studio");
  if (!current) return null;
  const blobs = new Map(values.filter((v) => v?.assetId).map((v) => [v.assetId, v.blob]));
  current.assets = (current.assets || []).map((e) => ({ ...e, blob: blobs.get(e.id) }));
  return current;
}
async function dbAction(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("html-studio-local", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("drafts");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction("drafts", mode);
      const op = fn(t.objectStore("drafts"));
      let result;
      op.onsuccess = () => (result = op.result);
      t.oncomplete = () => {
        db.close();
        resolve(result);
      };
      t.onerror = () => {
        db.close();
        reject(t.error);
      };
    };
  });
}
