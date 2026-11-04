// Page isolation is an editor-only stylesheet. The authored DOM, classes,
// scripts and inactive pages remain intact for history, saving and export.
export class PageNavigator {
  constructor(editor, saved) {
    this.editor = editor;
    this.doc = editor.doc;
    const size = (value, fallback, max) => Number.isFinite(value)
      ? Math.max(160, Math.min(max, value)) : fallback;
    this.viewport = {
      width: size(saved?.viewport?.width, editor.width, 7680),
      height: size(saved?.viewport?.height, editor.height, 24000),
    };
    this.selector = ".slide, [data-slide], .slides > section, deck-stage > section";
    const groups = new Map();
    for (const el of this.doc.querySelectorAll(this.selector)) {
      if (el.parentElement.closest(this.selector)) continue;
      const parent = el.parentElement;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(el);
    }
    const candidates = [...groups].filter(([parent, pages]) => {
      if (pages.length < 1) return false;
      return parent.matches("deck-stage, .deck-stage, .slides, [data-deck], [data-studio-pages]") ||
        pages.every((el) => ["absolute", "fixed"].includes(editor.style(el).position)) ||
        (pages.some((el) => el.matches(".active, .visible, .present")) &&
          pages.some((el) => el.hidden || editor.style(el).display === "none" || editor.style(el).visibility === "hidden"));
    }).sort((a, b) => b[1].length - a[1].length);
    this.parent = candidates[0]?.[0];
    this.pages = candidates[0]?.[1] || [];
    this.index = -1;
    if (!this.pages.length) return;
    this.sheet = this.doc.createElement("style");
    this.sheet.dataset.hsRuntime = "page-view";
    this.doc.head.append(this.sheet);
    const found = this.pages.findIndex((el) => editor.id(el) === saved?.id);
    const initial = this.pages.findIndex((el) => el.matches(".active, .is-active, .visible, .present, [data-deck-active]"));
    this.show(saved?.mode === "document" ? -1 : found >= 0 ? found : initial >= 0 ? initial : 0);
  }
  get current() {
    return this.pages[this.index] || null;
  }
  get state() {
    return this.pages.length ? {
      mode: this.current ? "page" : "document",
      id: this.editor.id(this.current),
      viewport: this.viewport,
    } : null;
  }
  title(el, index) {
    return (el.dataset.title || el.dataset.label || el.getAttribute("aria-label") ||
      el.querySelector("h1,h2,h3")?.textContent || `页面 ${index + 1}`)
      .replace(/\s+/g, " ").trim().slice(0, 60);
  }
  refresh() {
    if (!this.parent) return;
    const selected = this.current;
    const pages = this.parent.isConnected
      ? [...this.parent.children].filter((el) => el.matches(this.selector)) : [];
    const changed = pages.length !== this.pages.length || pages.some((el, i) => el !== this.pages[i]);
    this.pages = pages;
    if (changed) {
      const found = pages.indexOf(selected);
      this.show(this.index < 0 ? -1 : found >= 0 ? found : Math.min(this.index, pages.length - 1));
    }
  }
  show(index) {
    if (!this.sheet) return;
    this.index = Math.max(-1, Math.min(this.pages.length - 1, Number(index)));
    this.sheet.textContent = "";
    const el = this.current;
    const editor = this.editor;
    if (!el) {
      Object.assign(editor, this.viewport);
      editor.layout();
      return;
    }
    const computed = editor.style(el);
    const dimension = (name, fallback) => {
      const size = (this.parent.matches('deck-stage') && (parseFloat(this.parent.getAttribute(name)) || (name === 'width' ? 1920 : 1080))) || parseFloat(computed[name]) || parseFloat(editor.style(this.parent)[name]) || fallback;
      return Math.max(160, Math.min(name === "width" ? 7680 : 24000, Math.round(size)));
    };
    editor.width = dimension("width", this.viewport.width);
    editor.height = dimension("height", this.viewport.height);
    const display = computed.display === "none" ? "block" : computed.display;
    const selector = (node) => `[data-hs-id="${CSS.escape(editor.id(node))}"]`;
    const rules = [];
    for (let node = el; node && node !== this.doc.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && editor.id(sibling))
          rules.push(`${selector(sibling)}{display:none!important}`);
      }
      if (node !== el) {
        rules.push(`${selector(node)}{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;transform:none!important;translate:none!important;scale:none!important;rotate:none!important;overflow:visible!important;visibility:visible!important;opacity:1!important}`);
      }
    }
    rules.push(`html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important}`);
    rules.push(`${selector(el)}{display:${display}!important;position:absolute!important;inset:auto!important;left:0!important;top:0!important;width:${editor.width}px!important;height:${editor.height}px!important;margin:0!important;visibility:visible!important;pointer-events:auto!important;transform:none!important}`);
    rules.push(`${selector(el)}:not([data-hs-opacity-edited]){opacity:1!important}`);
    rules.push(`${selector(el)} :is(.reveal,.reveal-left,.reveal-scale):not([data-hs-opacity-edited]){opacity:1!important;transform:none!important}`);
    this.sheet.textContent = rules.join("\n");
    editor.layout();
  }
  renderUI() {
    const nav = document.querySelector("#page-navigation");
    nav.hidden = this.pages.length < 2 && !this.current;
    const select = document.querySelector("#page-select");
    const options = this.pages.map((el, i) => ({ value: String(i), text: `${String(i + 1).padStart(2, "0")} · ${this.title(el, i)}` }));
    options.push({ value: "-1", text: "完整页面 · 原始布局" });
    const signature = JSON.stringify(options);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...options.map(({ value, text }) => new Option(text, value)));
      select.dataset.options = signature;
    }
    select.value = String(this.index);
    select.disabled = this.editor.preview;
    document.querySelector("#page-previous").disabled = this.editor.preview || this.index <= 0;
    document.querySelector("#page-next").disabled = this.editor.preview || this.index >= this.pages.length - 1;
    document.querySelector("#manage-pages").disabled = this.editor.preview || this.editor.loading;
    document.querySelector("#page-count").textContent = this.current ? `${this.index + 1} / ${this.pages.length}` : `${this.pages.length} 页`;
    document.querySelector("#layer-page-label").textContent = this.current ? `第 ${this.index + 1} 页图层` : this.pages.length ? "完整文档图层" : "页面 1";
    document.querySelector("#desktop-size").hidden = !!this.current;
    document.querySelector("#mobile-size").hidden = !!this.current;
    if (this.current) document.querySelector("#artboard-name").textContent = `第 ${this.index + 1} 页 · ${this.title(this.current, this.index)}`;
  }
  previewStart() {
    if (!this.current) return "";
    return `(${startPagePreview.toString()})(${this.index},${this.pages.length});`;
  }
}

// Run only in the preview copy. Wait for delayed initialization, then use the
// deck's own API so active classes, controls, notes and keyboard state agree.
function startPagePreview(index, count) {
  let finished = false, timer, attempts = 0;
  const start = () => {
    if (finished) return;
    const candidates = [[window.deck, 'show'], [window.presentation, 'showSlide']];
    const entry = candidates.find(([controller, method]) => typeof controller?.[method] === 'function' &&
      controller.slides?.length === count && Array.from(controller.slides).every(node => node?.isConnected));
    if (entry) {
      finished = true; clearTimeout(timer);
      try { entry[0][entry[1]](index); document.dispatchEvent(new CustomEvent('studio-preview-page-ready')); }
      catch (error) { document.dispatchEvent(new CustomEvent('studio-preview-navigation-error', {detail:String(error.message || error)})); }
    } else if (++attempts < 60) timer = setTimeout(start, 50);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, {once:true});
  else start();
}
