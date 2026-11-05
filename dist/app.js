import {installTemplateCharts,templateChartTarget,templateChartDataTarget} from './template-charts.js';
import {createEditorOperations,createEditorArtifact} from './operations.js';
import {installAgentBridge} from './agent-bridge.js';
import { icon, hydrateIcons } from "./icons.js";
import { blankHTML } from "./demo.js";
import { PageNavigator } from "./pages.js";
import { AssetStore } from "./assets.js";
import { inspectCompatibility } from "./compatibility.js";
import { installGrouping } from "./grouping.js";
import { installFitContent } from "./fit-content.js";
import { installAuthoring } from "./authoring.js";
import { localizeTemplateFonts, templateFontIds } from "./template-fonts.js";
import { startCanvasPreview } from "./preview-session.js";
import { fontLibrary } from "./font-cache.js";
import { installFontSupport } from "./font-ui.js";
import { installDataTools, recalculateData } from "./data-tools.js";
import {tableCellSlot,tableCellText,putTableCell,inspectTableTotals,ensureTableTotals} from "./table-editing.js";
import { installSVGCharts } from "./svg-chart.js";
import { installHTMLBars, htmlBarTarget } from "./html-bars.js";
import { htmlShareTarget } from "./html-share.js";
import { installCanvasCharts, hydrateCanvasCharts } from "./canvas-charts.js";
import {
  uid,
  escapeHTML as esc,
  selectable,
  annotate,
  label,
  isText,
  cleanDocument,
  prepareHTML,
  snapshot,
  projectData,
  importBundle,
  saveDraft,
  loadDraft,
} from "./document.js";
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round = (n) => Math.round(n * 10) / 10;
const num = (s, fallback = 0) =>
  Number.isFinite(parseFloat(s)) ? parseFloat(s) : fallback;
const svgNS = "http://www.w3.org/2000/svg";
hydrateIcons();
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 4300);
}
function modal(title, body, actions = []) {
  $("#dialog").flushData?.();
  $("#dialog").disposeContent?.();
  delete $("#dialog").dataset.kind;
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = body;
  $("#dialog-actions").replaceChildren();
  for (const a of actions) {
    const b = document.createElement("button");
    b.className = a.primary ? "primary-button" : "text-button";
    b.textContent = a.label;
    b.onclick = () => a.run();
    $("#dialog-actions").append(b);
  }
  if (!$("#dialog").open) $("#dialog").showModal();
  return $("#dialog-body");
}
function closeModal() {
  $("#dialog").flushData?.();
  $("#dialog").disposeContent?.();
  $("#dialog").close();
}
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function hex(color) {
  const m = color?.match(/[\d.]+/g);
  if (!m || m.length < 3) return "#000000";
  return (
    "#" +
    m
      .slice(0, 3)
      .map((n) => Math.round(Number(n)).toString(16).padStart(2, "0"))
      .join("")
  );
}
const titles = {
  select: "选择",
  hand: "抓手",
  rect: "矩形",
  ellipse: "椭圆",
  text: "文本",
  frame: "容器",
  line: "线条",
  triangle: "三角形",
  star: "星形",
};
class Editor {
  constructor() {
    this.frame = $("#edit-frame");
    this.selection = [];
    this.width = 1080;
    this.height = 820;
    this.name = "未打开文件";
    this.isHome = true;
    this.zoom = 0.75;
    this.tool = "select";
    this.preview = false;
    this.history = [];
    this.historyIndex = -1;
    this.warnings = [];
    this.compatibility = null;
    this.collapsed = new Set();
    this.clipboard = null;
    this.space = false;
    this.dirty = false;
    this.loading = false;
    this.transaction = false;
    this.pasteCount = 0;
    this.fileHandle = null;
    this.assets = new AssetStore();
    fontLibrary.subscribe(() => this.refreshTemplateFontStyles());
    this.revision = 0;
    this.loadVersion = 0;
    this.openVersion = 0;
    this.ready = this.init();
  }
  async init() {
    let draft = null;
    try {
      draft = await loadDraft();
    } catch {}
    this.recoverableDraft = draft?.format === 'html-studio' && typeof draft.html === 'string' ? draft : null;
    // The empty editor is UI state, not a new document or a replacement draft.
    await this.load({html: blankHTML(), name: '未打开文件', width: 1080, height: 820}, {home:true});
    fontLibrary.start();
  }
  setHomeUI(home) {
    this.isHome = home;
    $('#app').classList.toggle('is-home', home);
    $('#start-screen').hidden = !home;
    for (const selector of ['.left-panel','.right-panel','#canvas-scroll','.floating-tools']) $(selector).inert = home;
    for (const id of ['document-name','save-button','export-button','preview-button']) $('#'+id).disabled = home;
  }
  renderHome() {
    $('#document-name').value = '未打开文件';
    $('#canvas-title').textContent = '开始';
    $('#save-indicator').textContent = '尚未打开文件';
    $('#undo').disabled = $('#redo').disabled = true;
    $('#page-navigation').hidden = true;
    $('#layer-page-label').textContent = '暂无页面';
    $('#layer-list').innerHTML = '<p class="home-panel-note">打开文件后显示图层</p>';
    $('#inspector').innerHTML = '<div class="empty-illustration">'+icon('cursor')+'</div><p class="home-panel-note">打开 HTML、工程或从模板新建，<br>即可开始编辑。</p>';
    $('#restore-draft-button').hidden = !this.recoverableDraft;
  }
  async restoreDraft() {
    if (!this.isHome || !this.recoverableDraft || this.loading) return;
    const draft = this.recoverableDraft;
    try {
      if (!await this.load(draft)) return;
      this.recoverableDraft = null;
      this.history = []; this.historyIndex = -1;
      this.pushHistory('恢复草稿');
      this.fileHandle = null; this.dirty = false;
      await this.refreshCompatibility();
      this.fit(); this.render();
      this.showSavedDraft(draft.savedAt, true);
      toast('已恢复上次的本地草稿');
    } catch(error) { toast('恢复失败：'+error.message); }
  }
  id(el) {
    return el?.getAttribute("data-hs-id");
  }
  get(id) {
    return this.doc?.querySelector(`[data-hs-id="${CSS.escape(id)}"]`);
  }
  get nodes() {
    return this.selection.map((id) => this.get(id)).filter(Boolean);
  }
  get roots() {
    const nodes = this.nodes;
    return nodes.filter((el) => !nodes.some((p) => p !== el && p.contains(el)));
  }
  style(el) {
    return this.doc.defaultView.getComputedStyle(el);
  }
  rect(el) {
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      right: r.right,
      bottom: r.bottom,
    };
  }
  bounds(nodes = this.roots) {
    const rs = nodes.map((el) => this.rect(el));
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.x)),
      y = Math.min(...rs.map((r) => r.y));
    return {
      x,
      y,
      width: Math.max(...rs.map((r) => r.right)) - x,
      height: Math.max(...rs.map((r) => r.bottom)) - y,
    };
  }
  locked(el) {
    return !!el?.closest('[data-hs-locked="true"]');
  }
  editable() {
    if (this.preview || this.loading || this.isHome) return false;
    if (this.nodes.some((el) => this.locked(el))) {
      toast("选中图层已锁定，请先解锁");
      return false;
    }
    return true;
  }
  async load(data, {home=false,history=false} = {}) {
    if (!history) {
      this.documentEpoch = (this.documentEpoch || 0) + 1;
      window.dispatchEvent(new Event('html-studio-document-change'));
    }
    if ($("#dialog").open) closeModal();
    this.finishText?.();
    this.endTracking?.();
    this.cancelLoad?.();
    this.cancelPreview?.();
    this.cancelPreview = null;
    clearTimeout(this.draftTimer);
    const version = ++this.loadVersion;
    this.revision++;
    this.loading = true;
    $('#save-indicator').textContent = '正在打开…';
    try {
      let html = this.assets.restore(data.html || blankHTML(), data.assets);
      html = localizeTemplateFonts(html, this.assets);
      fontLibrary.request(templateFontIds(html));
      html = await this.assets.compact(html);
      if (version !== this.loadVersion) return false;
      this.name = data.name || "未命名页面";
      this.width = clamp(num(data.width, 1080), 160, 7680);
      this.height = clamp(num(data.height, 820), 160, 24000);
      this.warnings = [...(data.warnings || [])];
      this.selection = data.selection || [];
      this.preview = false;
      this.setPreviewUI();
      this.layout();
      $("#preview-frame").srcdoc = "";
      const ready = await new Promise((resolve, reject) => {
        const previous = this.frame.contentDocument;
        const started = performance.now();
        let timer;
        const finish = (value, error) => {
          clearTimeout(timer);
          this.cancelLoad = null;
          error ? reject(error) : resolve(value);
        };
        this.cancelLoad = () => finish(false);
        this.frame.srcdoc = prepareHTML(html);
        const check = () => {
          const doc = this.frame.contentDocument;
          if (doc && doc !== previous && doc.body && doc.readyState !== "loading") {
            const pending = [...doc.querySelectorAll('link[rel="stylesheet"][href]')]
              .filter((link) => !link.sheet && !link.disabled);
            if (!pending.length || performance.now() - started >= 1000) {
              for (const link of pending) {
                link.setAttribute("data-hs-pending-stylesheet", link.getAttribute("href"));
                link.removeAttribute("href");
              }
              if (pending.length) this.warnings.push("部分外部样式加载超时，编辑时暂用已加载样式；导出保留原始引用，可联网后重新打开。");
              finish(true);
              return;
            }
          }
          if (performance.now() - started > 10000) return finish(false, Error("页面解析超时，请检查 HTML 文件"));
          timer = setTimeout(check, 16);
        };
        check();
      });
      if (!ready || version !== this.loadVersion) return false;
      this.doc = this.frame.contentDocument;
      recalculateData(this.doc);
      annotate(this.doc);
      await hydrateCanvasCharts(this.doc);
      this.pages = new PageNavigator(this, data.pageView);
      this.revealAnimatedContent();
      this.selection = this.selection.filter((id) => this.inCurrentPage(this.get(id)));
      this.bindFrame();
      this.loading = false;
      this.setHomeUI(home);
      this.renderCompatibility();
      this.render();
      this.refreshTemplateFontStyles();
      return true;
    } finally {
      if (version === this.loadVersion) this.loading = false;
    }
  }
  renderCompatibility() {
    const button = $("#compatibility-button");
    const count = this.compatibility?.issues.length || 0;
    button.textContent = count ? `兼容性 · ${count}` : "兼容性检查";
    button.classList.toggle("has-issues", count > 0);
    button.title = count ? `${count} 类内容需注意，点击重新检测并查看` : "检查当前文件的编辑与预览限制";
  }
  async refreshCompatibility() {
    if (this.loading || !this.doc) return null;
    const doc = this.doc, version = this.loadVersion;
    let report;
    try { report = await inspectCompatibility(doc, this.assets, this.warnings); }
    catch {
      report = {partial:true, issues:[{code:"scan-error",title:"兼容性检测未完成",count:0,
        editing:"文件已打开，但未能完成内容检查。现有静态元素仍可尝试编辑。",
        preview:"请手动核对预览与导出；未检测到问题不代表全部内容都受支持。",examples:[]}]};
    }
    if (version !== this.loadVersion || doc !== this.doc) return null;
    this.compatibility = report;
    this.renderCompatibility();
    return report;
  }
  showCompatibility(report = this.compatibility) {
    if (!report || this.loading) return;
    const issues = report.issues;
    modal(
      issues.length ? "部分内容的编辑或预览可能受限" : "未发现已知的兼容性风险",
      `<div class="compatibility-summary"><strong>${esc(this.name)}</strong><p>${issues.length ? `检测到 ${issues.length} 类需要注意的内容，其他静态内容仍可继续编辑。` : "本次源文件检测未发现已知风险，可以继续编辑。"}</p></div>` +
      issues.map(item => `<section class="compatibility-item" data-compatibility="${esc(item.code)}"><h3>${esc(item.title)}${item.count ? `<span>${item.count} 处</span>` : ""}</h3><dl><dt>编辑时</dt><dd>${esc(item.editing)}</dd><dt>预览时</dt><dd>${esc(item.preview)}</dd></dl>${item.examples.length ? `<div class="compatibility-examples">涉及内容：${item.examples.map(esc).join("；")}${item.count > item.examples.length ? " 等" : ""}</div>` : ""}</section>`).join("") +
      '<p class="compatibility-note">不会把受限内容替换为统一占位符。保留原 HTML；无法显示的区域可能空白、破图或使用原页面自带的占位内容。</p><p class="source-note">检测不运行文件脚本，结果仅供提前提醒，不能保证识别全部问题。关闭后可从画布上方“兼容性检查”重新查看。</p>',
      [{label:"打开预览",run:()=>{closeModal();this.togglePreview(true);}},
        {label:"知道了，继续编辑",primary:true,run:()=>{closeModal();if(this.preview)this.togglePreview(false);}}],
    );
    $("#dialog").dataset.kind = "compatibility";
  }
  get pageRoot() {
    return this.pages?.current || this.doc.body;
  }
  inCurrentPage(el) {
    return !!el && this.pageRoot.contains(el);
  }
  switchPage(index) {
    if (this.preview || this.loading || !this.pages?.pages.length) return;
    const next = Number(index);
    if (!Number.isInteger(next) || next < -1 || next >= this.pages.pages.length) return;
    this.finishText?.();
    this.pages.show(next);
    this.selection = [];
    $("#layer-search").value = "";
    $("#layers-pane").scrollTop = 0;
    leftTab("layers");
    this.render();
    this.fit();
    // Page navigation changes the view, not the document's undo history.
    const current = this.history[this.historyIndex];
    if (current) Object.assign(current, { pageView: this.pages.state, selection: [] });
    this.scheduleDraft();
  }
  layout() {
    const z = this.zoom;
    $("#artboard").style.width = this.width + "px";
    $("#artboard").style.height = this.height + "px";
    $("#surface").style.width = this.width + 144 + "px";
    $("#surface").style.height = this.height + 170 + "px";
    $("#surface").style.transform = `scale(${z})`;
    $("#surface-shell").style.width = (this.width + 144) * z + "px";
    $("#surface-shell").style.height = (this.height + 170) * z + "px";
    $("#artboard-size").textContent = `${this.width} × ${this.height}`;
    $("#artboard-name").textContent = this.pages?.current
      ? `第 ${this.pages.index + 1} 页 · ${this.pages.title(this.pages.current, this.pages.index)}`
      : this.width < 650 ? "Mobile" : "Desktop";
    $("#zoom-label").textContent = Math.round(z * 100) + "%";
    $("#desktop-size").classList.toggle("active", this.width >= 650);
    $("#mobile-size").classList.toggle("active", this.width < 650);
  }
  fit() {
    const area = $("#canvas-scroll");
    this.zoom = clamp(
      Math.min(
        (area.clientWidth - 48) / (this.width + 144),
        (area.clientHeight - 38) / (this.height + 130),
      ),
      0.15,
      1,
    );
    this.layout();
    area.scrollLeft = 0;
    area.scrollTop = 0;
    this.draw();
  }
  zoomTo(z) {
    this.zoom = clamp(z, 0.1, 3);
    this.layout();
    this.draw();
  }
  select(ids, { reveal = false, anchor = ids.at(-1) } = {}) {
    this.finishText?.();
    this.selection = [...new Set(ids)].filter(
      (id) => this.inCurrentPage(this.get(id)) && this.get(id) !== this.doc.body,
    );
    if (reveal && this.selection.length) {
      if (!this.selection.includes(anchor)) anchor = this.selection.at(-1);
      leftTab("layers");
      for (const el of this.nodes) {
        for (
          let parent = el.parentElement;
          parent;
          parent = parent.parentElement
        )
          this.collapsed.delete(this.id(parent));
      }
      const search = $("#layer-search");
      if (
        !label(this.get(anchor))
          .toLowerCase()
          .includes(search.value.trim().toLowerCase())
      )
        search.value = "";
    }
    this.render();
    if (reveal) this.scrollLayerIntoView(anchor);
  }
  scrollLayerIntoView(id) {
    if (!id) return;
    const pane = $("#layers-pane");
    const row = $(`.layer-row[data-id="${CSS.escape(id)}"]`, pane);
    if (!row || pane.hidden) return;
    const bounds = row.getBoundingClientRect();
    const top = pane.getBoundingClientRect().top + pane.clientTop;
    const bottom = top + pane.clientHeight;
    // Scroll only the layer pane; scrollIntoView can also move the workspace.
    if (bounds.top < top) pane.scrollTop += bounds.top - top;
    else if (bounds.bottom > bottom) pane.scrollTop += bounds.bottom - bottom;
    // Deep trees can extend horizontally. Reveal the name without moving
    // the canvas or losing the actual nesting indentation.
    const text = row.querySelector(".layer-text").getBoundingClientRect();
    const left = pane.getBoundingClientRect().left + pane.clientLeft;
    const right = left + pane.clientWidth;
    if (text.left < left) pane.scrollLeft += text.left - left - 8;
    else if (text.right > right) pane.scrollLeft += text.right - right + 8;
  }
  render() {
    if (!this.doc) return;
    if (this.isHome) { this.renderHome(); return; }
    this.pages?.renderUI();
    $("#document-name").value = this.name;
    $("#canvas-title").textContent = this.name;
    $("#undo").disabled = this.historyIndex <= 0 || this.preview;
    $("#redo").disabled =
      this.historyIndex >= this.history.length - 1 || this.preview;
    this.renderLayers();
    if (!this.preserveInspector) this.renderInspector();
    this.draw();
    $("#selection-status").textContent = this.selection.length
      ? `${this.selection.length} 个图层已选中 · ${this.nodes.length === 1 ? label(this.nodes[0]) : "Shift 点击增减选择"}`
      : "点击元素开始编辑 · Shift 多选 · 空格拖动画布";
  }
  draw() {
    const overlay = $("#overlay");
    overlay.replaceChildren();
    if (this.preview) return;
    const nodes = this.roots.filter((el) => this.style(el).display !== "none");
    if (!nodes.length) return;
    const b = this.bounds(nodes);
    if (!b || !Number.isFinite(b.x)) return;
    const append = (r, child = false) => {
      const box = document.createElement("div");
      box.className = "selection-box" + (child ? " child-box" : "");
      Object.assign(box.style, {
        left: r.x + "px",
        top: r.y + "px",
        width: r.width + "px",
        height: r.height + "px",
      });
      overlay.append(box);
      return box;
    };
    if (nodes.length > 1) nodes.forEach((el) => append(this.rect(el), true));
    const box = append(b);
    const caption = document.createElement("span");
    caption.className = "selection-caption";
    caption.textContent =
      nodes.length === 1
        ? label(nodes[0]).slice(0, 28)
        : `${nodes.length} 个图层`;
    box.append(caption);
    const size = document.createElement("span");
    size.className = "selection-size";
    size.textContent = `${round(b.width)} × ${round(b.height)}`;
    box.append(size);
    if (!nodes.some((el) => this.locked(el)))
      for (const h of ["nw", "ne", "sw", "se"]) {
        const handle = document.createElement("div");
        handle.className = "resize-handle";
        handle.dataset.handle = h;
        handle.onpointerdown = (e) => this.startResize(e, h);
        box.append(handle);
      }
  }
  pushHistory(action) {
    const s = snapshot(this);
    const prev = this.history[this.historyIndex];
    if (
      prev &&
      prev.html === s.html &&
      prev.name === s.name &&
      prev.width === s.width &&
      prev.height === s.height
    )
      return false;
    let discarded = this.history.length > this.historyIndex + 1;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push({ ...s, action });
    let bytes = this.history.reduce((n, s) => n + s.html.length, 0);
    while (
      this.history.length > 2 &&
      (this.history.length > 60 || bytes > 24000000)
    ) {
      bytes -= this.history.shift().html.length;
      discarded = true;
    }
    this.historyIndex = this.history.length - 1;
    if (discarded || this.history.length === 1)
      this.assets.prune(this.history.map((state) => state.html).join("\n") + JSON.stringify(this.clipboard || ""));
    return true;
  }
  commit(action = "修改") {
    if (!this.doc || this.loading || this.isHome) return;
    recalculateData(this.doc);
    annotate(this.doc);
    this.pages?.refresh();
    hydrateCanvasCharts(this.doc);
    const changed = this.pushHistory(action);
    this.render();
    if (changed) {
      this.revision++;
      this.dirty = true;
      this.scheduleDraft();
    }
  }
  showSavedDraft(savedAt, restored = false) {
    const indicator = $('#save-indicator');
    indicator.innerHTML = '<i></i>' + (restored ? '已恢复本地草稿' : '已存本地草稿');
    const date = new Date(savedAt);
    if (!savedAt || !Number.isFinite(date.getTime())) return;
    const pad = value => String(value).padStart(2, '0');
    const time = document.createElement('time');
    time.dateTime = date.toISOString();
    time.textContent = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    time.title = `最后保存：${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${time.textContent}`;
    time.setAttribute('aria-label', time.title);
    indicator.append(time);
  }
  scheduleDraft() {
    clearTimeout(this.draftTimer);
    if (this.loading || this.isHome) return;
    $("#save-indicator").innerHTML =
      '<i style="background:#c8ad79"></i>正在保存';
    this.draftTimer = setTimeout(async () => {
      if (this.loading || this.isHome) return;
      const revision = this.revision, version = this.loadVersion;
      const current = () => revision === this.revision && version === this.loadVersion && !this.loading && !this.isHome;
      try {
        const data = projectData(this);
        await saveDraft(data, this.assets);
        if (current()) this.showSavedDraft(data.savedAt);
      } catch {
        if (!current()) return;
        $("#save-indicator").textContent = "草稿保存失败";
        toast("浏览器草稿空间不足或不可用，请及时保存工程文件");
      }
    }, 350);
  }
  async undo() {
    if (this.preview || this.loading || this.historyIndex <= 0) return;
    const h = this.history[--this.historyIndex];
    await this.load(h,{history:true});
    this.scheduleDraft();
    toast("已撤回");
  }
  async redo() {
    if (
      this.preview ||
      this.loading ||
      this.historyIndex >= this.history.length - 1
    )
      return;
    await this.load(this.history[++this.historyIndex],{history:true});
    this.scheduleDraft();
    toast("已重做");
  }
  bindFrame() {
    this.doc.querySelectorAll('video').forEach(video => video.pause());
    this.doc.addEventListener('play', event => { if (event.target.tagName === 'VIDEO') event.target.pause(); }, true);
    this.doc.addEventListener("pointerdown", (e) => this.pointerDown(e));
    this.doc.addEventListener("dblclick", (e) => {
      // Once editing, let the browser handle double-click word selection.
      if (this.preview || this.tool !== "select" || this.finishText) return;
      const templateChart=templateChartTarget(e.target);
      if(templateChart&&templateChartDataTarget(templateChart,e.target)&&this.openTemplateChartEditor(templateChart)){e.preventDefault();this.select([this.id(templateChart)],{reveal:true});return;}
      const svg = e.target.closest?.('svg');
      if (!templateChart && svg && !svg.closest('[data-studio-chart]') && e.target.closest('rect,text,circle') &&
          this.openSVGChartEditor(svg, e.target, { quiet: true })) {
        e.preventDefault();
        this.select([this.id(svg)], { reveal: true, anchor: this.id(svg) });
        return;
      }
      const canvas = e.target.closest?.('canvas');
      if (canvas && !this.locked(canvas)) {
        e.preventDefault();
        this.select([this.id(canvas)], { reveal: true, anchor: this.id(canvas) });
        this.openCanvasChartEditor(canvas);
        return;
      }
      // Only chart-labelled content opts into data editing; normal text keeps its editor.
      const barNode = e.target.closest?.('[data-studio-html-chart],[class*="bar"],[class*="chart"]') || (!svg && htmlShareTarget(e.target));
      if (!templateChart && !svg && barNode && !this.locked(e.target)) {
        const target = htmlBarTarget(e.target);
        if (this.openHTMLBarEditor(target, e.target, { quiet: true })) {
          e.preventDefault();
          this.select([this.id(target)], { reveal: true, anchor: this.id(target) });
          return;
        }
      }
      const el = this.hit(e.target, true, { x: e.clientX, y: e.clientY });
      if (el && isText(el) && !this.locked(el)) {
        e.preventDefault();
        this.startText(el);
      }
    });
    this.doc.addEventListener("keydown", (e) => handleKey(e));
    this.doc.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.space = false;
        $("#canvas-scroll").classList.remove("hand");
      }
    });
    this.doc.addEventListener("contextmenu", (e) => {
      if (this.finishText) return;
      e.preventDefault();
      const el = this.hit(e.target, true, { x: e.clientX, y: e.clientY });
      if (el)
        this.select(
          this.selection.includes(this.id(el)) ? this.selection : [this.id(el)],
          { reveal: true, anchor: this.id(el) },
        );
      const r = this.frame.getBoundingClientRect();
      contextMenu(
        r.left + e.clientX * this.zoom,
        r.top + e.clientY * this.zoom,
      );
    });
    this.doc.addEventListener(
      "click",
      (e) => {
        if (!this.finishText) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
    this.doc.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey)
          this.zoomTo(this.zoom * (e.deltaY > 0 ? 0.95 : 1.05));
        else {
          const c = $("#canvas-scroll");
          c.scrollLeft += e.deltaX;
          c.scrollTop += e.deltaY;
        }
      },
      { passive: false },
    );
    this.doc.addEventListener("paste", (e) => {
      if (this.finishText) {
        e.preventDefault();
        const t = e.clipboardData.getData("text/plain");
        const sel = this.doc.getSelection();
        if (sel.rangeCount) {
          const r = sel.getRangeAt(0);
          r.deleteContents();
          const node = this.doc.createTextNode(t);
          r.insertNode(node);
          r.setStartAfter(node);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
    });
  }
  hit(target, deep = false, point) {
    if (!target) return null;
    let el = target.nodeType === 1 ? target : target.parentElement;
    // Nested browsing contexts swallow pointer events. Edit mode disables
    // their hit testing; map the exposed parent surface back to the frame.
    if (point) {
      const frames = [...this.doc.querySelectorAll("iframe[data-hs-id]")];
      const frame = frames.find((frame) => {
        const r = frame.getBoundingClientRect();
        return el.contains(frame) && this.style(frame).visibility === "visible" &&
          point.x >= r.left && point.x < r.right && point.y >= r.top && point.y < r.bottom;
      });
      if (frame) el = frame;
    }
    if (el?.ownerSVGElement) el = el.ownerSVGElement;
    el = el?.closest("[data-hs-id]");
    if (el === this.doc.body) return null;
    if (!this.inCurrentPage(el)) return null;
    if (!deep) {
      const group = el?.closest("[data-hs-group]");
      if (group) el = group;
    }
    return el;
  }
  pointerDown(e) {
    if (e.button !== 0 || this.loading || this.preview) return;
    if (this.finishText && e.target.closest("[data-hs-editing]")) return;
    this.finishText?.();
    hideMenu();
    if (this.tool === "hand" || this.space) {
      e.preventDefault();
      this.startPan(e, true);
      return;
    }
    if (this.tool !== "select") {
      e.preventDefault();
      this.insert(this.tool, { x: e.clientX, y: e.clientY });
      return;
    }
    const el = this.hit(e.target, e.metaKey || e.ctrlKey, { x: e.clientX, y: e.clientY });
    e.preventDefault();
    if (!el) {
      if (!e.shiftKey) this.select([]);
      this.startMarquee(e);
      return;
    }
    const id = this.id(el);
    if (e.shiftKey) {
      const removing = this.selection.includes(id);
      this.select(
        removing
          ? this.selection.filter((x) => x !== id)
          : [...this.selection, id],
        { reveal: !removing, anchor: id },
      );
      return;
    }
    this.select(this.selection.includes(id) ? this.selection : [id], {
      reveal: true,
      anchor: id,
    });
    if (this.editable()) this.startMove(e);
  }
  track(e, move, up, captureTarget) {
    this.endTracking?.();
    const doc = e.view?.document || document;
    const target = captureTarget || doc.documentElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {}
    const moveListener = (ev) => {
      if (ev.pointerId === e.pointerId) move(ev);
    };
    let ended = false;
    const end = (ev) => {
      if (ended || (ev?.pointerId != null && ev.pointerId !== e.pointerId)) return;
      ended = true;
      doc.removeEventListener("pointermove", moveListener);
      doc.removeEventListener("pointerup", end);
      doc.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
      doc.defaultView.removeEventListener("blur", end);
      target.removeEventListener("lostpointercapture", end);
      this.endTracking = null;
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {}
      up?.(ev);
    };
    doc.addEventListener("pointermove", moveListener);
    doc.addEventListener("pointerup", end);
    doc.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    doc.defaultView.addEventListener("blur", end);
    target.addEventListener("lostpointercapture", end);
    this.endTracking = end;
  }
  translation(el) {
    const t = this.style(el).translate.split(/\s+/);
    return {
      x:
        num(t[0]) *
        (t[0]?.includes("%")
          ? (el.offsetWidth || this.rect(el).width) / 100
          : 1),
      y:
        num(t[1]) *
        (t[1]?.includes("%")
          ? (el.offsetHeight || this.rect(el).height) / 100
          : 1),
    };
  }
  moveBy(el, dx, dy, start = this.translation(el)) {
    const before = this.rect(el);
    this.ensureBox(el);
    const after = this.rect(el);
    dx += before.x - after.x;
    dy += before.y - after.y;
    // Measure the local axes so a screen-space move stays accurate inside
    // scaled/rotated ancestors (including independent CSS transform properties).
    const current = this.translation(el);
    this.setStyle(el, "translate", `${current.x + 64}px ${current.y}px`);
    const x = this.rect(el);
    this.setStyle(el, "translate", `${current.x}px ${current.y + 64}px`);
    const y = this.rect(el);
    const a = (x.x - after.x) / 64, b = (x.y - after.y) / 64;
    const c = (y.x - after.x) / 64, d = (y.y - after.y) / 64;
    const det = a * d - b * c;
    const localX = Math.abs(det) > 1e-6 ? (d * dx - c * dy) / det : 0;
    const localY = Math.abs(det) > 1e-6 ? (a * dy - b * dx) / det : 0;
    this.setStyle(el, "translate", `${round(start.x + localX)}px ${round(start.y + localY)}px`);
  }
  ensureBox(el) {
    if (this.style(el).display === "inline" &&
        !el.matches("img,input,textarea,select,video,audio,canvas,iframe,svg"))
      this.setStyle(el, "display", "inline-block");
  }
  setStyle(el, property, value) {
    const css = property.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    if (el.style.getPropertyPriority(css) === "important") {
      el.style.setProperty(css, value, "important");
      return;
    }
    el.style.setProperty(css, value);
    const normal = this.style(el).getPropertyValue(css);
    el.style.setProperty(css, value, "important");
    // Escalate only when the authored cascade actually blocks this edit.
    if (normal === this.style(el).getPropertyValue(css))
      el.style.setProperty(css, value);
  }
  startMove(e) {
    const start = { x: e.clientX, y: e.clientY };
    const nodes = this.roots;
    const originals = nodes.map((el) => ({ el, t: this.translation(el) }));
    let moved = false;
    this.track(
      e,
      (ev) => {
        let dx = ev.clientX - start.x,
          dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        if (ev.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        originals.forEach(({ el, t }) => this.moveBy(el, dx, dy, t));
        this.draw();
      },
      () => {
        if (moved) this.commit("移动图层");
      },
      // A click also starts move tracking. Capturing on <html> retargets click
      // and dblclick to the page, losing the text that the user actually hit.
      // Content nodes stay in place while moving; resize handles still use
      // track's stable document root because draw() recreates those handles.
      e.target,
    );
  }
  captureGroup(el) {
    if (!el.dataset.hsGroup || this.style(el).display !== "block") return [];
    return [...el.children].filter(selectable).map((c) => ({
      el: c,
      x: num(this.style(c).left),
      y: num(this.style(c).top),
      w: c.offsetWidth || this.rect(c).width,
      h: c.offsetHeight || this.rect(c).height,
      t: this.translation(c),
      children: this.captureGroup(c),
    }));
  }
  scaleGroup(records, sx, sy) {
    for (const r of records) {
      Object.assign(r.el.style, {
        left: r.x * sx + "px",
        top: r.y * sy + "px",
        width: r.w * sx + "px",
        height: r.h * sy + "px",
        boxSizing: "border-box",
        translate: `${r.t.x * sx}px ${r.t.y * sy}px`,
      });
      this.scaleGroup(r.children, sx, sy);
    }
  }
  startResize(e, corner) {
    e.preventDefault();
    e.stopPropagation();
    if (!this.editable()) return;
    const nodes = this.roots,
      b = this.bounds(nodes),
      start = { x: e.clientX, y: e.clientY };
    const records = nodes.map((el) => ({
      el,
      r: this.rect(el),
      w: el.offsetWidth || this.rect(el).width,
      h: el.offsetHeight || this.rect(el).height,
      t: this.translation(el),
      children: this.captureGroup(el),
    }));
    this.track(
      e,
      (ev) => {
        let dx = (ev.clientX - start.x) / this.zoom,
          dy = (ev.clientY - start.y) / this.zoom;
        let w = Math.max(4, b.width + (corner.includes("e") ? dx : -dx)),
          h = Math.max(4, b.height + (corner.includes("s") ? dy : -dy));
        if (ev.shiftKey) h = (w * b.height) / b.width;
        const nx = corner.includes("w") ? b.x + b.width - w : b.x,
          ny = corner.includes("n") ? b.y + b.height - h : b.y;
        const sx = w / (b.width || 1),
          sy = h / (b.height || 1);
        records.forEach(({ el, r, w: ow, h: oh, t, children }) => {
          this.scaleGroup(children, sx, sy);
          el.style.boxSizing = "border-box";
          el.style.width = Math.max(1, ow * sx) + "px";
          el.style.height = Math.max(1, oh * sy) + "px";
          el.style.translate = `${t.x}px ${t.y}px`;
        });
        records.forEach(({ el, r }) => {
          const current = this.rect(el);
          this.moveBy(
            el,
            nx + (r.x - b.x) * sx - current.x,
            ny + (r.y - b.y) * sy - current.y,
          );
        });
        this.draw();
      },
      () => this.commit("调整尺寸"),
    );
  }
  startMarquee(e) {
    const start = { x: e.clientX, y: e.clientY };
    const existing = [...this.selection];
    const box = document.createElement("div");
    box.className = "marquee";
    $("#overlay").append(box);
    let r;
    this.track(
      e,
      (ev) => {
        r = {
          x: Math.min(start.x, ev.clientX),
          y: Math.min(start.y, ev.clientY),
          width: Math.abs(ev.clientX - start.x),
          height: Math.abs(ev.clientY - start.y),
        };
        Object.assign(box.style, {
          left: r.x + "px",
          top: r.y + "px",
          width: r.width + "px",
          height: r.height + "px",
        });
      },
      () => {
        box.remove();
        if (!r || r.width < 4 || r.height < 4) return;
        const found = $$("[data-hs-id]", this.pageRoot).filter((el) => {
          if (this.locked(el) || this.style(el).display === "none")
            return false;
          const b = this.rect(el);
          return (
            b.width > 0 &&
            b.height > 0 &&
            b.x >= r.x &&
            b.y >= r.y &&
            b.right <= r.x + r.width &&
            b.bottom <= r.y + r.height
          );
        });
        const root = found.filter(
          (el) => !found.some((p) => p !== el && p.contains(el)),
        );
        this.select([...existing, ...root.map((el) => this.id(el))], {
          reveal: root.length > 0,
        });
      },
    );
  }
  startPan(e, inFrame = false) {
    const scroll = $("#canvas-scroll"),
      x = e.clientX,
      y = e.clientY,
      sx = scroll.scrollLeft,
      sy = scroll.scrollTop;
    scroll.classList.add("panning");
    this.track(
      e,
      (ev) => {
        scroll.scrollLeft = sx - (ev.clientX - x) * (inFrame ? this.zoom : 1);
        scroll.scrollTop = sy - (ev.clientY - y) * (inFrame ? this.zoom : 1);
      },
      () => scroll.classList.remove("panning"),
    );
  }
  startText(el) {
    if (this.loading || this.preview || !el || !isText(el) || this.locked(el)) return;
    if (el.closest('[data-studio-formula]')) { this.openDataEditor(el.closest('table')); return; }
    this.finishText?.();
    const cell=el.closest('td,th'),table=cell?.closest('table'),slot=cell&&tableCellSlot(cell);
    if(cell&&!slot&&el===cell){toast('此单元格含多个文本片段，请双击具体文字编辑，以保留原样式');return;}
    const totals=table&&inspectTableTotals(table);
    if(totals?.matched&&totals.entries.some(e=>e.cell===cell)){this.openDataEditor(table);return;}
    if(slot?.node&&(el===cell||el.contains(slot.node)))el=slot.container;
    if(this.locked(el))return;
    this.select([this.id(el)], { reveal: true });
    el.setAttribute("data-hs-editing", "true");
    el.contentEditable = "true";
    el.spellcheck = false;
    el.focus();
    const range = this.doc.createRange();
    range.selectNodeContents(el);
    const selection = this.doc.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let prepared=false;
    const beforeInput=()=>{if(!prepared&&table){prepared=true;ensureTableTotals(table);}};
    const input=()=>{if(table){recalculateData(this.doc);this.draw();}};
    el.addEventListener('beforeinput',beforeInput);el.addEventListener('input',input);
    const finish = (event) => {
      if (!this.finishText) return;
      this.finishText = null;
      el.removeEventListener("blur", finish);
      el.removeEventListener('beforeinput',beforeInput);el.removeEventListener('input',input);
      // Removing contenteditable does not clear the browser's text range.
      // Canvas pointer handlers prevent the default deselection, so explicitly
      // release this editor's range and focus when ending the text session.
      const selection = this.doc.getSelection();
      if (el.contains(selection?.anchorNode) || el.contains(selection?.focusNode))
        selection.removeAllRanges();
      if (el.contains(this.doc.activeElement)) this.doc.activeElement.blur();
      el.removeAttribute("data-hs-editing");
      el.removeAttribute("contenteditable");
      el.removeAttribute("spellcheck");
      if(cell&&tableCellSlot(cell)&&tableCellText(cell).startsWith('='))putTableCell(cell,tableCellText(cell));
      // A blur can be the first half of a click on an inspector input.
      // Do not replace that input while the browser is transferring focus.
      this.preserveInspector = event?.type === "blur";
      try { this.commit("编辑文字"); }
      finally { this.preserveInspector = false; }
    };
    this.finishText = finish;
    el.addEventListener("blur", finish);
  }
  setTool(tool) {
    this.finishText?.();
    this.tool = tool;
    $$("[data-tool]").forEach((b) =>
      b.classList.toggle("active", b.dataset.tool === tool),
    );
    $("#canvas-scroll").classList.toggle("hand", tool === "hand");
    $("#selection-status").textContent =
      tool === "select"
        ? "点击选择 · Shift 多选"
        : tool === "hand"
          ? "拖动平移画布"
          : `点击画布插入${titles[tool] || tool}`;
  }
  insert(kind, point) {
    if (this.preview) return;
    let parent =
      this.nodes.length === 1 && this.nodes[0].hasAttribute("data-hs-frame")
        ? this.nodes[0]
        : this.pageRoot;
    if (this.locked(parent)) parent = this.pageRoot;
    if (this.locked(parent)) return toast("当前页面已锁定，请先解锁");
    const pr = parent === this.doc.body ? { x: 0, y: 0 } : this.rect(parent);
    let p = point || { x: Math.min(this.width - 200, 140), y: 120 };
    const el =
      kind === "text"
        ? this.doc.createElement("div")
        : kind === "frame"
          ? this.doc.createElement("div")
          : this.doc.createElementNS(svgNS, "svg");
    let w = 160,
      h = 120;
    if (kind === "text") {
      el.textContent = "输入文字";
      w = 180;
      h = 40;
      Object.assign(el.style, {
        fontSize: "24px",
        lineHeight: "1.5",
        color: "#30333b",
        fontFamily: "inherit",
        whiteSpace: "pre-wrap",
      });
    } else if (kind === "frame") {
      el.dataset.hsFrame = "true";
      w = 280;
      h = 200;
      Object.assign(el.style, {
        background: "#f4f0fc",
        border: "1px solid #e2d9ee",
        borderRadius: "12px",
        overflow: "visible",
      });
    } else {
      if (kind === "line") h = 4;
      el.setAttribute("viewBox", `0 0 ${w} ${h}`);
      el.setAttribute("preserveAspectRatio", "none");
      const shapes = {
        rect: `<rect width="160" height="120" rx="0"/>`,
        ellipse: '<ellipse cx="80" cy="60" rx="80" ry="60"/>',
        line: '<path d="M0 2H160" fill="none" stroke="currentColor" stroke-width="4"/>',
        triangle: '<path d="M80 0 160 120H0Z"/>',
        star: '<path d="m80 0 20 39 44 6-32 31 8 44-40-21-40 21 8-44-32-31 44-6Z"/>',
      };
      el.innerHTML = shapes[kind] || shapes.rect;
      el.style.fill = "#b5a0e4";
      el.style.color = "#9175c9";
      el.style.overflow = "visible";
      el.dataset.hsShape = kind;
    }
    el.dataset.hsId = uid();
    el.dataset.hsName = titles[kind] || "元素";
    Object.assign(el.style, {
      position: "absolute",
      left: Math.max(0, p.x - pr.x) + "px",
      top: Math.max(0, p.y - pr.y) + "px",
      width: w + "px",
      height: h + "px",
      boxSizing: "border-box",
    });
    if (parent !== this.doc.body && this.style(parent).position === "static")
      parent.style.position = "relative";
    parent.append(el);
    this.selection = [this.id(el)];
    this.setTool("select");
    this.commit("新建" + (titles[kind] || "元素"));
  }
  renderLayers() {
    $("#layer-actions").disabled = this.preview || this.loading;
    const list = $("#layer-list");
    const pane = $("#layers-pane");
    const scrollTop = pane.scrollTop;
    const scrollLeft = pane.scrollLeft;
    // Build off-document so computed-style reads in the canvas do not force
    // layout after every inserted layer row in the surrounding editor.
    const fragment = document.createDocumentFragment();
    const q = $("#layer-search").value.trim().toLowerCase();
    const visit = (el, depth) => {
      if (!selectable(el)) return;
      const children = [...el.children].filter(selectable);
      const matches = !q || label(el).toLowerCase().includes(q);
      if (matches) {
        const hidden = this.style(el).display === "none";
        const row = document.createElement("div");
        row.className =
          "layer-row" +
          (this.selection.includes(this.id(el)) ? " selected" : "") +
          (hidden ? " is-hidden" : "");
        row.style.paddingLeft = 10 + depth * 14 + "px";
        row.style.minWidth = 180 + depth * 14 + "px";
        row.dataset.id = this.id(el);
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-selected", this.selection.includes(this.id(el)));
        row.draggable = true;
        const type = el.hasAttribute("data-hs-group")
          ? "group"
          : el.tagName.toLowerCase() === "svg"
            ? "vector"
            : el.tagName === "IMG"
              ? "image"
              : isText(el)
                ? "text"
                : "frame";
        row.innerHTML = `<button class="layer-toggle" tabindex="-1">${children.length ? (this.collapsed.has(this.id(el)) ? "›" : "⌄") : ""}</button><span class="layer-icon">${icon(type)}</span><span class="layer-text" title="${esc(label(el))}">${esc(label(el))}</span><button class="layer-control ${el.dataset.hsLocked ? "on" : ""}" data-layer-action="lock" title="锁定 / 解锁" aria-label="锁定 ${esc(label(el))}">${icon(el.dataset.hsLocked ? "lock" : "unlock")}</button><button class="layer-control ${hidden ? "on" : ""}" data-layer-action="visibility" title="显示 / 隐藏" aria-label="隐藏 ${esc(label(el))}">${icon(hidden ? "eyeoff" : "eye")}</button>`;
        row.onclick = (e) => {
          if (e.target.closest(".layer-toggle") && children.length) {
            const id = this.id(el);
            this.collapsed.has(id)
              ? this.collapsed.delete(id)
              : this.collapsed.add(id);
            this.renderLayers();
            return;
          }
          const action = e.target.closest("[data-layer-action]")?.dataset
            .layerAction;
          if (action) {
            if (action === "lock") {
              if (el.dataset.hsLocked) delete el.dataset.hsLocked;
              else el.dataset.hsLocked = "true";
            } else {
              if (el.dataset.hsHidden === "true") {
                el.style.display = el.dataset.hsDisplay || "";
                delete el.dataset.hsHidden;
                delete el.dataset.hsDisplay;
              } else {
                el.dataset.hsDisplay = el.style.display;
                el.dataset.hsHidden = "true";
                el.style.display = "none";
              }
            }
            this.commit(action === "lock" ? "锁定图层" : "显示/隐藏图层");
            return;
          }
          const id = this.id(el);
          this.select(
            e.shiftKey
              ? this.selection.includes(id)
                ? this.selection.filter((x) => x !== id)
                : [...this.selection, id]
              : [id],
          );
        };
        row.ondblclick = (e) => {
          if (e.target.closest("button")) return;
          this.rename(el);
        };
        row.ondragstart = (e) => {
          if (this.locked(el)) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData(
            "application/x-html-studio-layer",
            this.id(el),
          );
          e.dataTransfer.effectAllowed = "move";
        };
        row.ondragover = (e) => {
          if (
            [...e.dataTransfer.types].includes(
              "application/x-html-studio-layer",
            )
          ) {
            e.preventDefault();
            row.classList.add("drop-target");
          }
        };
        row.ondragleave = () => row.classList.remove("drop-target");
        row.ondrop = (e) => {
          e.preventDefault();
          row.classList.remove("drop-target");
          const dragged = this.get(
            e.dataTransfer.getData("application/x-html-studio-layer"),
          );
          if (!dragged || dragged === el) return;
          if (dragged.parentElement !== el.parentElement) {
            toast("初版支持同一容器内拖动排序，跨容器请使用剪切 / 粘贴或组合");
            return;
          }
          if (this.locked(el)) {
            toast("目标图层已锁定");
            return;
          }
          el.before(dragged);
          this.normalizeStack(el.parentElement);
          this.commit("图层排序");
        };
        fragment.append(row);
      }
      if (!this.collapsed.has(this.id(el)) || q)
        children.forEach((c) => visit(c, depth + 1));
    };
    const roots = this.pages?.current ? [this.pageRoot] : [...this.doc.body.children];
    roots.forEach((el) => visit(el, 0));
    list.replaceChildren(fragment);
    if (!list.children.length)
      list.innerHTML =
        '<p class="panel-note">' +
        (q ? "没有找到匹配图层" : "画布还是空的，试试插入文本或形状。") +
        "</p>";
    pane.scrollTop = scrollTop;
    pane.scrollLeft = scrollLeft;
  }
  rename(el) {
    modal(
      "重命名图层",
      `<input class="dialog-input" id="rename-input" value="${esc(label(el))}" aria-label="图层名称">`,
      [
        { label: "取消", run: closeModal },
        {
          label: "重命名",
          primary: true,
          run: () => {
            el.dataset.hsName = $("#rename-input").value.trim() || "图层";
            closeModal();
            this.commit("重命名图层");
          },
        },
      ],
    );
    $("#rename-input").select();
  }
  revealAnimatedContent() {
    const style = this.doc.querySelector('[data-hs-runtime="edit-style"]');
    if (!style) return;
    this.doc.querySelectorAll('[data-hs-runtime="reveal-animation"]').forEach(el => el.remove());
    style.disabled = true;
    const animated = $$("[data-hs-id]", this.doc.body).filter(
      (el) => this.style(el).animationName !== "none",
    );
    style.disabled = false;
    const ids = animated
      .filter(
        (el) =>
          num(this.style(el).opacity, 1) === 0 &&
          !el.hasAttribute("data-hs-opacity-edited"),
      )
      .map((el) => this.id(el));
    // Some decks only assign animation-name after their script adds .is-active.
    // Their known entrance markers still need a visible editing state without
    // running that script or changing authored classes. A normal CSS rule keeps
    // inline opacity (for example muted subtitles) and explicit user edits intact.
    const entrance = ['fade-in', 'fade-up', 'reveal-left', 'reveal-right', 'scale-in']
      .map(name => `[data-anim="${name}"]`).join(',');
    const rules = ids.map(id =>
      `[data-hs-id="${id}"]:not([data-hs-opacity-edited]){opacity:1!important}`);
    if (this.doc.querySelector(`.slide :is(${entrance})`))
      rules.push(`.slide :is(${entrance}):not([data-hs-opacity-edited]){opacity:1}`);
    if (rules.length) {
      const reveal = this.doc.createElement("style");
      reveal.dataset.hsRuntime = "reveal-animation";
      reveal.textContent = rules.join("");
      this.doc.head.append(reveal);
    }
  }
  field(prop, title, value, unit = "", type = "number", wide = false) {
    return `<label class="field ${wide ? "wide" : ""}"><span class="field-label">${title}</span><input type="${type}" data-prop="${prop}" aria-label="${esc(title)}" value="${esc(value ?? "")}" step="${type === "number" ? "0.1" : ""}"><span class="field-unit">${unit}</span></label>`;
  }
  selectField(prop, title, value, options, wide = false) {
    return `<label class="field ${wide ? "wide" : ""}"><span class="field-label">${title}</span><select data-prop="${prop}" aria-label="${esc(title)}">${options.map(([v, n]) => `<option value="${v}" ${v === value ? "selected" : ""}>${n}</option>`).join("")}</select></label>`;
  }
  fontField(value) {
    const presets = [
      ["sans-serif", "无衬线 · sans-serif"],
      ["serif", "衬线 · serif"],
      ["monospace", "等宽 · monospace"],
      ["system-ui", "系统默认 · system-ui"],
      ['"PingFang SC"', "苹方 · PingFang SC"],
      ['"Songti SC"', "宋体 · Songti SC"],
      ['"Heiti SC"', "黑体 · Heiti SC"],
      ['"Microsoft YaHei"', "微软雅黑 · Microsoft YaHei"],
      ['"Noto Sans SC"', "思源黑体 · Noto Sans SC"],
      ['"Noto Serif SC"', "思源宋体 · Noto Serif SC"],
      ["Arial", "Arial"],
      ['"Helvetica Neue"', "Helvetica Neue"],
      ["Inter", "Inter"],
      ['"SF Pro Display"', "SF Pro Display"],
      ["Georgia", "Georgia"],
      ['"Times New Roman"', "Times New Roman"],
    ];
    const pageFonts = [...new Set([...this.doc.fonts].map((font) =>
      font.family.replace(/^["']|["']$/g, ""),
    ))].map((name) => [JSON.stringify(name), name]);
    const option = ([v, name]) => `<option value="${esc(v)}">${esc(name)}</option>`;
    // Keep the complete authored fallback stack as the current option. Unlike a
    // datalist, this menu never filters out alternatives based on that stack.
    return `<label class="field wide"><span class="field-label">字体</span><select data-prop="fontFamily" aria-label="字体" title="选择字体后立即应用"><option value="${esc(value)}" selected ${value ? "" : "disabled"}>${value ? esc(value) : "混合字体"}</option>${pageFonts.length ? `<optgroup label="页面字体">${pageFonts.map(option).join("")}</optgroup>` : ""}<optgroup label="常用字体">${presets.map(option).join("")}</optgroup><option value="__custom_font__">输入其他字体名称…</option></select></label>`;
  }
  customFont() {
    this.renderInspector();
    const apply = () => {
      const name = $("#custom-font-name").value.trim().replace(/^["']|["']$/g, "");
      if (!name) {
        $("#custom-font-name").focus();
        return toast("请输入字体名称");
      }
      const generic = ["serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"];
      this.property("fontFamily", generic.includes(name.toLowerCase()) ? name.toLowerCase() : JSON.stringify(name));
      closeModal();
    };
    modal(
      "输入字体名称",
      '<input id="custom-font-name" class="dialog-input" aria-label="自定义字体名称" placeholder="例如 Songti SC" autocomplete="off"><p class="source-note">请输入字体的准确名称。字体需已安装在本机，或已在当前 HTML 中加载；否则浏览器会使用替代字体。</p>',
      [{ label: "取消", run: closeModal }, { label: "应用字体", primary: true, run: apply }],
    );
    const input = $("#custom-font-name");
    input.onkeydown = (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        apply();
      }
    };
    input.focus();
  }
  colorField(prop, color) {
    const h = hex(color);
    return `<div class="color-field"><input type="color" data-prop="${prop}" aria-label="${prop === "color" ? "字色" : prop === "fill" ? "填充颜色" : "描边颜色"}" value="${h}"><input type="text" data-prop="${prop}" aria-label="${prop} HEX" value="${h.toUpperCase()}" spellcheck="false"><span>HEX</span></div>`;
  }
  renderInspector() {
    const pane = $("#inspector");
    const nodes = this.nodes;
    const section = (title, body, extra = "") =>
      `<section class="inspector-section"><div class="section-heading"><span>${title}</span>${extra}</div>${body}</section>`;
    if (!nodes.length) {
      pane.innerHTML =
        section(
          "页面设置",
          `<div class="field-grid">${this.field("pageWidth", "宽度", this.width, "px")}${this.field("pageHeight", "高度", this.height, "px")}</div><div class="property-label">页面背景</div>${this.colorField("pageBackground", this.style(this.pageRoot).backgroundColor)}<button class="full-button" data-action="auto-height" style="margin-top:10px">适应页面内容高度</button>`,
        ) +
        section(
          "HTML 工作台",
          `<div class="empty-illustration">${icon("cursor")}</div><div class="empty-text">选择一个元素，开始设计。<br>也可以拖入自己的 HTML 文件。</div><div class="shortcut-list"><div><span>多选</span><kbd>Shift + 点击</kbd></div><div><span>编辑文字</span><kbd>双击文本</kbd></div><div><span>移动 / 大步移动</span><kbd>方向键 / Shift</kbd></div><div><span>组合 / 解绑</span><kbd>⌘ G / ⌘ ⇧ G</kbd></div><div><span>撤回 / 重做</span><kbd>⌘ Z / ⌘ ⇧ Z</kbd></div><div><span>适合画布</span><kbd>Shift 1</kbd></div></div>`,
        ) +
        section(
          "动效与资源",
          `<div class="motion-chip">${icon("motion")} CSS 动效已暂停，预览时恢复</div><p class="inspector-note">脚本仅在预览中运行。导出保留原始动画与交互代码。</p>${this.warnings.map((w) => `<div class="warning-line">${esc(w)}</div>`).join("")}`,
        );
      return;
    }
    const el = nodes[0],
      s = this.style(el),
      r = this.rect(el),
      b = this.bounds();
    const mixed = (get) => {
      const v = nodes.map(get);
      return v.every((x) => x === v[0]) ? v[0] : "";
    };
    const text = nodes.every(isText),
      vector = nodes.every((n) => n.namespaceURI === svgNS);
    const fill = vector
      ? s.fill === "none"
        ? "rgb(0,0,0)"
        : s.fill
      : s.backgroundColor;
    const alignNames = [
      ["left", "alignleft", "左对齐"],
      ["center", "aligncenter", "水平居中"],
      ["right", "alignright", "右对齐"],
      ["top", "aligntop", "顶对齐"],
      ["middle", "alignmiddle", "垂直居中"],
      ["bottom", "alignbottom", "底对齐"],
    ];
    let html = section(
      `<div class="selection-name">${nodes.length > 1 ? nodes.length + " 个图层" : esc(label(el))}</div>`,
      `<div class="selection-type">${nodes.length > 1 ? "批量编辑 · 混合值留空" : esc(el.tagName.toLowerCase()) + " · " + (this.locked(el) ? "已锁定" : "可编辑")}</div>`,
    );
    if (nodes.length === 1 && el.closest('table,[data-studio-chart]'))
      html += section('数据', '<button class="full-button" data-action="edit-data">编辑数据与行列…</button><p class="inspector-note">表格公式和绑定图表会随数据同步更新。</p>');
    else if (nodes.length === 1 && (el.matches('svg,canvas,div,figure,section') || el.closest('[data-studio-html-chart],[data-studio-template-chart]')))
      html += section('数据图表', '<button class="full-button" data-action="edit-chart-data">编辑图表数据…</button><p class="inspector-note">优先保留原样式；无法保留时会先询问。</p>');
    if (nodes.length === 1 && el.tagName === 'VIDEO')
      html += section('视频播放', ['controls','loop','muted','autoplay'].map((key,i) => `<label class="video-option"><input type="checkbox" data-video-prop="${key}" ${el.hasAttribute(key)?'checked':''}>${['显示播放控件','循环播放','静音','自动播放（同时开启静音）'][i]}</label>`).join('') + '<p class="inspector-note">编辑时用于选择和排版，点击顶部预览播放。导出内嵌视频；播放取决于浏览器支持的编码。</p>');
    html += section(
      "位置与尺寸",
      `<div class="button-row">${alignNames.map(([a, i, t]) => `<button data-align="${a}" title="${t}" aria-label="${t}">${icon(i)}</button>`).join("")}</div><div class="field-grid">${this.field("x", "X", round(b.x), "px")}${this.field("y", "Y", round(b.y), "px")}${this.field(
        "width",
        "W",
        mixed((n) => round(n.offsetWidth || this.rect(n).width)),
        "px",
      )}${this.field(
        "height",
        "H",
        mixed((n) => round(n.offsetHeight || this.rect(n).height)),
        "px",
      )}${this.field(
        "rotate",
        "旋转",
        mixed((n) => num(this.style(n).rotate)),
        "°",
      )}${this.field(
        "radius",
        "圆角",
        mixed((n) => num(this.style(n).borderRadius)),
        "px",
      )}</div><div class="button-row" style="margin:9px 0 0"><button data-align="distributeX" ${nodes.length < 3 ? "disabled" : ""} title="水平等间距">${icon("distributex")}<small>水平分布</small></button><button data-align="distributeY" ${nodes.length < 3 ? "disabled" : ""} title="垂直等间距">${icon("distributey")}<small>垂直分布</small></button></div><p class="inspector-note">X / Y 为画布坐标。拖动以偏移微调，保留原布局。</p>`,
    );
    if (nodes.every(n => this.canFitContent(n))) html += section(
      "适应内容",
      `<button class="full-button" data-action="fit-content" ${nodes.some(n=>this.locked(n))?'disabled':''}>适应内容尺寸</button><p class="inspector-note">宽高贴合可见子元素，去掉四周空白和内边距，保留边框与元素间距。需要改变布局规则时先确认。</p>`,
    );
    if (text) {
      html += section(
        "文本",
        `${nodes.length === 1 && [...el.children].every((c) => c.tagName === "BR") ? `<textarea class="content-input" data-prop="text" aria-label="文本内容">${esc(el.innerText || el.textContent)}</textarea>` : `<button class="full-button" data-action="edit-text" ${nodes.length > 1 ? "disabled" : ""}>双击画布文字，保留行内样式编辑</button>`}<div class="field-grid" style="margin-top:9px">${this.fontField(mixed((n) => this.style(n).fontFamily))}${this.field(
          "fontSize",
          "字号",
          mixed((n) => num(this.style(n).fontSize)),
          "px",
        )}${this.selectField(
          "fontWeight",
          "字重",
          mixed((n) => this.style(n).fontWeight),
          [
            ["300", "Light"],
            ["400", "Regular"],
            ["500", "Medium"],
            ["600", "Semibold"],
            ["700", "Bold"],
            ["800", "Extra bold"],
          ],
        )}${this.field(
          "lineHeight",
          "行高",
          mixed((n) =>
            this.style(n).lineHeight === "normal"
              ? ""
              : num(this.style(n).lineHeight),
          ),
          "px",
        )}${this.field(
          "letterSpacing",
          "字距",
          mixed((n) => num(this.style(n).letterSpacing)),
          "px",
        )}</div><div class="button-row" style="margin:10px 0"><button data-text-align="left" class="${s.textAlign === "left" ? "on" : ""}" title="文字左对齐">${icon("alignleft")}</button><button data-text-align="center" class="${s.textAlign === "center" ? "on" : ""}" title="文字居中">${icon("aligncenter")}</button><button data-text-align="right" class="${s.textAlign === "right" ? "on" : ""}" title="文字右对齐">${icon("alignright")}</button></div>${this.colorField("color", s.color)}`,
      );
    }
    if (!vector && !text) {
      const display = ["flex", "grid"].includes(s.display)
        ? s.display
        : "block";
      html += section(
        "布局",
        `<div class="field-grid">${this.selectField(
          "display",
          "方式",
          display,
          [
            ["block", "普通布局"],
            ["flex", "自动布局 · Flex"],
            ["grid", "网格 · Grid"],
          ],
          true,
        )}${
          display === "flex"
            ? this.selectField(
                "flexDirection",
                "方向",
                s.flexDirection,
                [
                  ["row", "水平 →"],
                  ["column", "垂直 ↓"],
                ],
                true,
              )
            : ""
        }${display === "grid" ? this.field("gridColumns", "列数", s.gridTemplateColumns.split(" ").length, "列", "number", true) : ""}${display !== "block" ? this.field("gap", "间距", num(s.gap), "px") : ""}${this.field("padding", "内边距", num(s.paddingTop), "px")}${
          display === "flex"
            ? this.selectField(
                "alignItems",
                "交叉轴",
                s.alignItems,
                [
                  ["flex-start", "起点"],
                  ["center", "居中"],
                  ["flex-end", "终点"],
                  ["stretch", "拉伸"],
                ],
                true,
              ) +
              this.selectField(
                "justifyContent",
                "主轴",
                s.justifyContent,
                [
                  ["flex-start", "起点"],
                  ["center", "居中"],
                  ["flex-end", "终点"],
                  ["space-between", "两端分布"],
                ],
                true,
              ) +
              this.selectField(
                "flexWrap",
                "换行",
                s.flexWrap,
                [
                  ["nowrap", "不换行"],
                  ["wrap", "自动换行"],
                ],
                true,
              )
            : ""
        }</div><button class="full-button" data-action="free-layout" style="margin-top:10px">转换为自由布局…</button>`,
      );
    }
    html += section(
      "外观",
      `<div class="color-row">${this.colorField("fill", fill)}<button class="icon-button" data-action="no-fill" title="移除填充">${icon("minus")}</button></div><div class="opacity-row"><input type="range" data-prop="opacity" min="0" max="100" value="${num(s.opacity, 1) * 100}" aria-label="透明度滑块">${this.field(
        "opacity",
        "透明度",
        mixed((n) => round(num(this.style(n).opacity, 1) * 100)),
        "%",
      )}</div><p class="inspector-note">${!vector && /rgba\([^)]*,\s*0\)/.test(fill) ? "当前填充透明；选择颜色可添加填充。" : s.backgroundImage !== "none" ? "当前含背景图或渐变；修改填充将替换它。" : vector ? "SVG 填色会将可见形状统一为所选颜色。" : ""}</p>`,
    );
    html += section(
      "描边",
      `<div class="color-row">${this.colorField("stroke", vector ? s.stroke : s.borderTopColor)}</div><div class="field-grid" style="margin-top:8px">${this.field("strokeWidth", "宽度", vector ? num(s.strokeWidth) : num(s.borderTopWidth), "px")}${this.selectField(
        "strokeStyle",
        "样式",
        vector
          ? s.stroke === "none" ? "none"
            : s.strokeDasharray === "8px, 5px" ? "dashed"
            : s.strokeDasharray === "1px, 4px" ? "dotted" : "solid"
          : s.borderTopStyle,
        [
          ["solid", "实线"],
          ["dashed", "虚线"],
          ["dotted", "点线"],
          ["none", "无"],
        ],
      )}</div>`,
    );
    const shadow = s.boxShadow === "none" ? null : s.boxShadow;
    const colorMatch = shadow?.match(/rgba?\([^)]+\)/)?.[0] || "rgb(0,0,0)";
    const values =
      shadow?.replace(/rgba?\([^)]+\)/g, "").match(/-?[\d.]+px/g) || [];
    html += section(
      "阴影",
      `<div class="field-grid">${this.field("shadowX", "X", num(values[0]), "px")}${this.field("shadowY", "Y", shadow ? num(values[1]) : 8, "px")}${this.field("shadowBlur", "模糊", shadow ? num(values[2]) : 20, "px")}${this.field("shadowSpread", "扩展", num(values[3]), "px")}</div><div class="color-row" style="margin-top:8px">${this.colorField("shadowColor", colorMatch)}<button class="icon-button" data-action="no-shadow" title="移除阴影">${icon("minus")}</button></div>${this.field("shadowOpacity", "阴影透明度", shadow ? round(num(colorMatch.match(/[\d.]+/g)?.[3], 1) * 100) : 12, "%", "number", true)}`,
    );
    pane.innerHTML = html;
  }
  property(prop, value, { live = false } = {}) {
    if (prop.startsWith("page")) {
      if (prop === "pageWidth") this.width = clamp(num(value, 1080), 160, 7680);
      if (prop === "pageHeight")
        this.height = clamp(num(value, 820), 160, 24000);
      if (prop === "pageBackground") this.setStyle(this.pageRoot, "background", value);
      if (this.pages?.current) {
        if (prop === "pageWidth") this.pageRoot.style.width = this.width + "px";
        if (prop === "pageHeight") this.pageRoot.style.height = this.height + "px";
        if (prop === 'pageWidth' || prop === 'pageHeight') this.pages.show(this.pages.index);
      }
      this.layout();
      if (!live) this.commit("页面设置");
      return;
    }
    if (!this.editable()) return;
    const nodes = this.roots;
    if (!nodes.length) return;
    if (prop === "fontFamily" && (!value.trim() || !CSS.supports("font-family", value))) {
      toast("请输入有效的字体名称");
      return;
    }
    if (
      ["fill", "color", "stroke", "shadowColor"].includes(prop) &&
      !CSS.supports("color", value)
    ) {
      toast("请输入有效的颜色，如 #7455E9");
      return;
    }
    if (prop === "x" || prop === "y") {
      const b = this.bounds();
      const delta = num(value) - (prop === "x" ? b.x : b.y);
      nodes.forEach((el) =>
        this.moveBy(el, prop === "x" ? delta : 0, prop === "y" ? delta : 0),
      );
    } else if (prop === "text") {
      nodes.forEach((el) => {
        const cell=el.closest('td,th'),slot=cell&&tableCellSlot(cell);
        if(cell&&(el===cell&&!slot||slot&&this.locked(slot.container))){toast('请解锁后选择具体文字编辑，以保留单元格样式');return;}
        if(cell){ensureTableTotals(cell.closest('table'));if(slot&&(el===cell||slot.node&&el.contains(slot.node))){putTableCell(cell,String(value));return;}}
        el.removeAttribute('data-studio-formula');el.textContent=value;
        this.setStyle(el, "whiteSpace", "pre-wrap");
      });
      recalculateData(this.doc);
    } else if (prop === "display") {
      nodes.forEach((el) => {
        this.setStyle(el, "display", value);
        if (value === "flex" || value === "grid") {
          this.setStyle(el, "gap", el.style.gap || "16px");
          [...el.children].filter(selectable).forEach((c) => {
            if (["absolute", "fixed"].includes(this.style(c).position)) {
              Object.assign(c.style, {
                position: "relative",
                left: "auto",
                top: "auto",
                right: "auto",
                bottom: "auto",
                translate: "none",
                flex: "0 0 auto",
              });
            }
          });
        }
      });
    } else if (prop.startsWith("shadow")) {
      const pane = $("#inspector"),
        get = (p) => num(p === prop ? value : pane.querySelector(`[data-prop="${p}"]`)?.value);
      const color = prop === "shadowColor" ? value :
        pane.querySelector('[data-prop="shadowColor"]')?.value || "#000000";
      const rgb = hexToRGB(color);
      const v = `${get("shadowX")}px ${get("shadowY")}px ${Math.max(0, get("shadowBlur"))}px ${get("shadowSpread")}px rgba(${rgb.join(",")},${clamp(get("shadowOpacity"), 0, 100) / 100})`;
      nodes.forEach((el) => this.setStyle(el, "boxShadow", v));
    } else
      nodes.forEach((el) => {
        const vector = el.namespaceURI === svgNS;
        if (prop === "fill") {
          if (vector) {
            this.setStyle(el, "fill", value);
            el.querySelectorAll(
              "path,rect,circle,ellipse,polygon,polyline,text",
            ).forEach((c) => {
              if (
                !c.closest("defs,clipPath,mask") &&
                c.getAttribute("fill") !== "none" &&
                c.style.fill !== "none"
              ) {
                c.setAttribute("fill", value);
                this.setStyle(c, "fill", value);
              }
            });
          } else {
            this.setStyle(el, "backgroundImage", "none");
            this.setStyle(el, "backgroundColor", value);
          }
        } else if (prop === "stroke") {
          if (vector) {
            this.setStyle(el, "stroke", value);
            el.querySelectorAll(
              "path,rect,circle,ellipse,polygon,polyline,line",
            ).forEach((c) => {
              if (!c.closest("defs,clipPath,mask")) {
                this.setStyle(c, "stroke", value);
                if (!num(this.style(c).strokeWidth))
                  this.setStyle(c, "strokeWidth", "1px");
              }
            });
          } else {
            this.setStyle(el, "borderColor", value);
            if (!num(this.style(el).borderTopWidth)) {
              this.setStyle(el, "borderWidth", "1px");
              this.setStyle(el, "borderStyle", "solid");
            }
          }
        } else if (prop === "strokeWidth") {
          if (vector) {
            this.setStyle(el, "strokeWidth", Math.max(0, num(value)) + "px");
            el.querySelectorAll(
              "path,rect,circle,ellipse,polygon,polyline,line",
            ).forEach((c) => {
              if (!c.closest("defs,clipPath,mask"))
                this.setStyle(c, "strokeWidth", Math.max(0, num(value)) + "px");
            });
            if (this.style(el).stroke === "none") this.setStyle(el, "stroke", "#777");
          } else {
            this.setStyle(el, "borderWidth", Math.max(0, num(value)) + "px");
            this.setStyle(el, "borderStyle", el.style.borderStyle || "solid");
          }
        } else if (prop === "strokeStyle") {
          if (vector) {
            const shapes = [el, ...el.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line")]
              .filter((shape) => !shape.closest("defs,clipPath,mask"));
            for (const shape of shapes) {
              this.setStyle(shape, "strokeDasharray",
                value === "dashed" ? "8 5" : value === "dotted" ? "1 4" : "none");
              if (value === "none") this.setStyle(shape, "stroke", "none");
              else if (this.style(shape).stroke === "none") this.setStyle(shape, "stroke", "#777");
            }
          } else this.setStyle(el, "borderStyle", value);
        } else if (prop === "opacity") {
          el.dataset.hsOpacityEdited = "true";
          this.setStyle(el, "opacity", String(clamp(num(value), 0, 100) / 100));
        } else if (prop === "rotate") {
          this.ensureBox(el);
          this.setStyle(el, "rotate", num(value) + "deg");
        }
        else if (prop === "radius") {
          this.setStyle(el, "borderRadius", Math.max(0, num(value)) + "px");
          if (el.dataset.hsShape === "rect")
            el.querySelector("rect")?.setAttribute(
              "rx",
              Math.max(0, num(value)),
            );
        } else if (prop === "gridColumns")
          this.setStyle(el, "gridTemplateColumns", `repeat(${clamp(Math.round(num(value, 1)), 1, 24)},minmax(0,1fr))`);
        else if (["width", "height"].includes(prop)) {
          this.ensureBox(el);
          const old =
            prop === "width"
              ? el.offsetWidth || this.rect(el).width
              : el.offsetHeight || this.rect(el).height;
          const ratio = Math.max(1, num(value)) / (old || 1);
          this.scaleGroup(
            this.captureGroup(el),
            prop === "width" ? ratio : 1,
            prop === "height" ? ratio : 1,
          );
          this.setStyle(el, "boxSizing", "border-box");
          this.setStyle(el, prop, Math.max(1, num(value)) + "px");
          this.setStyle(el, "flexShrink", "0");
        } else if (
          [
            "fontSize",
            "lineHeight",
            "letterSpacing",
            "gap",
            "padding",
          ].includes(prop)
        ) {
          this.setStyle(el, prop,
            prop === "lineHeight" && !value
              ? "normal"
              : Math.max(prop === "letterSpacing" ? -100 : 0, num(value)) +
                "px");
        } else if (
          [
            "fontFamily",
            "fontWeight",
            "color",
            "textAlign",
            "flexDirection",
            "alignItems",
            "justifyContent",
            "flexWrap",
          ].includes(prop)
        )
          this.setStyle(el, prop, value);
      });
    if (['width','height'].includes(prop) && this.pages?.current && nodes.includes(this.pages.current)) this.pages.show(this.pages.index);
    this.draw();
    if (!live) this.commit("修改属性");
  }
  align(kind) {
    if (!this.editable()) return;
    const nodes = this.roots;
    if (!nodes.length) return;
    if (kind.startsWith("distribute")) {
      if (nodes.length < 3) return;
      const axis = kind === "distributeX" ? "x" : "y",
        size = axis === "x" ? "width" : "height";
      const items = nodes
        .map((el) => ({ el, r: this.rect(el) }))
        .sort((a, b) => a.r[axis] - b.r[axis]);
      const first = items[0],
        last = items.at(-1);
      const gap =
        (last.r[axis] +
          last.r[size] -
          first.r[axis] -
          items.reduce((n, i) => n + i.r[size], 0)) /
        (items.length - 1);
      let pos = first.r[axis];
      items.forEach(({ el, r }) => {
        this.moveBy(
          el,
          axis === "x" ? pos - r.x : 0,
          axis === "y" ? pos - r.y : 0,
        );
        pos += r[size] + gap;
      });
    } else {
      const parent = nodes[0].parentElement;
      const b =
        nodes.length > 1
          ? this.bounds()
          : parent === this.doc.body
            ? { x: 0, y: 0, width: this.width, height: this.height }
            : this.rect(parent);
      nodes.forEach((el) => {
        const r = this.rect(el);
        let dx = 0,
          dy = 0;
        if (kind === "left") dx = b.x - r.x;
        if (kind === "center") dx = b.x + (b.width - r.width) / 2 - r.x;
        if (kind === "right") dx = b.x + b.width - r.width - r.x;
        if (kind === "top") dy = b.y - r.y;
        if (kind === "middle") dy = b.y + (b.height - r.height) / 2 - r.y;
        if (kind === "bottom") dy = b.y + b.height - r.height - r.y;
        this.moveBy(el, dx, dy);
      });
    }
    this.commit("对齐与分布");
  }
  freezeContainer(parent) {
    const children = [...parent.children].filter(selectable);
    const pr =
      parent === this.doc.body
        ? { x: 0, y: 0, width: this.width, height: this.height }
        : this.rect(parent);
    const saved = children.map((el) => ({
      el,
      r: this.rect(el),
      w: el.offsetWidth || this.rect(el).width,
      h: el.offsetHeight || this.rect(el).height,
    }));
    if (this.style(parent).position === "static")
      this.setStyle(parent, "position", "relative");
    for (const [key,value] of Object.entries({
      width: (parent.offsetWidth || pr.width) + "px",
      height: (parent.offsetHeight || pr.height) + "px",
      boxSizing: "border-box",
      display: "block",
    })) this.setStyle(parent,key,value);
    parent.dataset.hsFree = "true";
    for (const { el, r, w, h } of saved)
      for (const [key,value] of Object.entries({
        position: "absolute",
        left: r.x - pr.x - parent.clientLeft + "px",
        top: r.y - pr.y - parent.clientTop + "px",
        right: "auto",
        bottom: "auto",
        width: w + "px",
        height: h + "px",
        boxSizing: "border-box",
        margin: "0",
        flex: "none",
      })) this.setStyle(el,key,value);
    for (const { el, r } of saved) {
      const after = this.rect(el);
      this.moveBy(el, r.x - after.x, r.y - after.y);
    }
  }
  requestFreeLayout(parent, after) {
    if (!parent || this.locked(parent)) return;
    modal(
      "转换为自由布局",
      `<p>将「${esc(parent === this.doc.body ? "页面" : label(parent))}」的直接子元素转换为绝对定位，并保留当前画布中的位置与尺寸。</p><p><strong>这会固定当前视口的布局，改变该容器原有的 Flex/Grid 排列与响应式行为。</strong>原有动效代码会保留，转换后请检查预览。</p><p class="source-note">可以使用撤回恢复。建议先保存工程。</p>`,
      [
        { label: "保留原布局", run: closeModal },
        {
          label: after ? "转换并组合" : "转换为自由布局",
          primary: true,
          run: () => {
            closeModal();
            this.freezeContainer(parent);
            if (after) after();
            else this.commit("转换自由布局");
          },
        },
      ],
    );
  }
  group(auto = false) {
    if (!this.editable()) return;
    const nodes = this.roots;
    if (nodes.length < 2) {
      toast("请至少选择两个元素");
      return;
    }
    const parent = nodes[0].parentElement;
    if (nodes.some((n) => n.parentElement !== parent)) {
      toast("组合需要选择同一个容器下的元素");
      return;
    }
    if (nodes.some((n) => this.style(n).position !== "absolute")) {
      this.requestFreeLayout(parent, () => this.group(auto));
      return;
    }
    const b = this.bounds(nodes),
      pr = parent === this.doc.body ? { x: 0, y: 0 } : this.rect(parent);
    const rec = nodes.map((el) => ({
      el,
      r: this.rect(el),
      w: el.offsetWidth || this.rect(el).width,
      h: el.offsetHeight || this.rect(el).height,
    }));
    const g = this.doc.createElement("div");
    g.dataset.hsId = uid();
    g.dataset.hsGroup = "true";
    g.dataset.hsName = auto ? "自动布局" : "组合";
    Object.assign(g.style, {
      position: "absolute",
      left: b.x - pr.x - parent.clientLeft + "px",
      top: b.y - pr.y - parent.clientTop + "px",
      width: b.width + "px",
      height: b.height + "px",
      boxSizing: "border-box",
    });
    const ordered = [...parent.children].filter((c) => nodes.includes(c));
    parent.insertBefore(g, ordered[0]);
    ordered.forEach((el) => g.append(el));
    for (const { el, r, w, h } of rec)
      Object.assign(el.style, {
        position: "absolute",
        left: r.x - b.x + "px",
        top: r.y - b.y + "px",
        right: "auto",
        bottom: "auto",
        width: w + "px",
        height: h + "px",
        boxSizing: "border-box",
        margin: "0",
      });
    for (const { el, r } of rec) {
      const a = this.rect(el);
      this.moveBy(el, r.x - a.x, r.y - a.y);
    }
    this.selection = [this.id(g)];
    if (auto) {
      Object.assign(g.style, {
        display: "flex",
        gap: "16px",
        height: "auto",
        width: "max-content",
      });
      [...g.children].forEach((el) =>
        Object.assign(el.style, {
          position: "relative",
          left: "auto",
          top: "auto",
          translate: "none",
          flex: "0 0 auto",
        }),
      );
    }
    this.commit(auto ? "添加自动布局" : "组合图层");
  }
  normalizeStack(parent) {
    const isLayout = ["flex", "grid"].includes(this.style(parent).display);
    [...parent.children].filter(selectable).forEach((el, index) => {
      if (isLayout || this.style(el).position !== "static") {
        el.style.zIndex = String(index + 1);
      }
    });
  }
  reorder(dir, extreme = false) {
    if (!this.editable()) return;
    const nodes = this.roots;
    const sorted = dir > 0 ? [...nodes].reverse() : nodes;
    for (const el of sorted) {
      const sibs = [...el.parentElement.children].filter(selectable);
      const i = sibs.indexOf(el);
      if (dir > 0 && i < sibs.length - 1) {
        if (extreme) sibs.at(-1).after(el);
        else sibs[i + 1].after(el);
      }
      if (dir < 0 && i > 0) {
        if (extreme) sibs[0].before(el);
        else sibs[i - 1].before(el);
      }
    }
    new Set(nodes.map((el) => el.parentElement)).forEach((parent) =>
      this.normalizeStack(parent),
    );
    this.commit("调整图层顺序");
  }
  copy() {
    if (!this.roots.length) return;
    this.clipboard = this.roots.map((el) => el.outerHTML);
    this.pasteCount = 0;
    toast("已复制图层（编辑器内部剪贴板）");
  }
  paste() {
    if (!this.clipboard || this.preview || this.isHome) return;
    const ids = [];
    const parent =
      this.nodes.length === 1 && this.nodes[0].hasAttribute("data-hs-frame")
        ? this.nodes[0]
        : this.nodes[0] === this.pageRoot ? this.pageRoot : this.nodes[0]?.parentElement || this.pageRoot;
    for (const html of this.clipboard) {
      const t = this.doc.createElement("template");
      t.innerHTML = html;
      const el = t.content.firstElementChild;
      if (!el) continue;
      this.remapClone(el);
      parent.append(el);
      this.offsetClone(el);
      ids.push(this.id(el));
    }
    this.selection = ids;
    this.commit("粘贴图层");
  }
  offsetClone(el) {
    // Flex/grid already position their in-flow items. A visual offset would
    // change the apparent gap and alignment without changing the layout slot.
    let parent = el.parentElement;
    while (parent && this.style(parent).display === "contents")
      parent = parent.parentElement;
    const display = parent && this.style(parent).display;
    const inFlow = !["absolute", "fixed"].includes(this.style(el).position);
    if (inFlow && ["flex", "inline-flex", "grid", "inline-grid"].includes(display))
      return;
    this.moveBy(el, 20, 20);
  }
  remapClone(el) {
    const tableIds = new Map();
    for (const table of [el, ...el.querySelectorAll('table[data-studio-table]')]) {
      if (table.matches('table[data-studio-table]')) {
        const old = table.dataset.studioTable;
        table.dataset.studioTable = uid(); tableIds.set(old, table.dataset.studioTable);
      }
    }
    for (const n of [el, ...el.querySelectorAll("*")]) {
      if (n.hasAttribute("data-hs-id")) n.dataset.hsId = uid();
      delete n.dataset.hsLocked;
    }
    const mapping = new Map();
    for (const n of [el, ...el.querySelectorAll("[id]")]) {
      if (n.id) {
        mapping.set(n.id, n.id + "-" + uid().slice(1, 6));
        n.id = mapping.get(n.id);
      }
    }
    for (const n of [el, ...el.querySelectorAll("*")])
      for (const attr of [...n.attributes]) {
        let v = attr.value;
        for (const [old, next] of mapping) {
          v = v.replaceAll(`url(#${old})`, `url(#${next})`);
          if (['for','aria-labelledby','aria-describedby','aria-controls','headers'].includes(attr.name))
            v = v.split(/\s+/).map(id => id === old ? next : id).join(' ');
          if (
            (attr.name === "href" || attr.name === "xlink:href") &&
            v === "#" + old
          )
            v = "#" + next;
        }
        if (v !== attr.value) n.setAttribute(attr.name, v);
      }
    for (const chart of [el, ...el.querySelectorAll('[data-studio-chart]')]) {
      if (!chart.hasAttribute('data-studio-chart')) continue;
      try { const model = JSON.parse(chart.dataset.studioChart); if (tableIds.has(model.table)) { model.table = tableIds.get(model.table); chart.dataset.studioChart = JSON.stringify(model); } } catch {}
    }
  }
  duplicate() {
    if (!this.editable() || !this.roots.length) return;
    const ids = [];
    for (const el of this.roots) {
      const copy = el.cloneNode(true);
      this.remapClone(copy);
      el.after(copy);
      this.offsetClone(copy);
      ids.push(this.id(copy));
    }
    this.selection = ids;
    this.commit("复制图层");
    if (this.doc.querySelector("script"))
      toast("已复制外观。脚本按 ID 绑定的交互需要单独验证");
  }
  remove() {
    if (!this.editable()) return;
    this.roots.forEach((el) => el.remove());
    this.selection = [];
    this.commit("删除图层");
  }
  async newDocument(html = blankHTML(), name = "未命名页面", dimensions = {}) {
    this.openVersion++;
    this.compatibility = null;
    this.finishText?.();
    if (!await this.load({
      html,
      name,
      width: 1080,
      height: 820,
      ...dimensions,
      warnings: [],
      selection: [],
    })) return false;
    this.history = [];
    this.historyIndex = -1;
    this.pushHistory("打开页面");
    this.fileHandle = null;
    this.dirty = false;
    this.fit();
    this.scheduleDraft();
  }
  setPreviewUI() {
    const scroll = $("#canvas-scroll");
    if (this.preview && !this.previewViewport) {
      this.previewViewport = { left: scroll.scrollLeft, top: scroll.scrollTop };
      hideMenu();
    }
    $("#app").classList.toggle("previewing", this.preview);
    $("#preview-frame").hidden = !this.preview;
    this.frame.hidden = this.preview;
    $("#preview-banner").hidden = !this.preview;
    $("#mode-label").textContent = this.preview ? "预览" : "设计";
    $("#preview-button").innerHTML =
      icon(this.preview ? "cursor" : "play") +
      (this.preview ? "返回编辑" : "预览");
    $("#motion-status").textContent = this.preview
      ? "动效与交互正在运行"
      : "编辑时动效已暂停";
    $("#overlay").hidden = this.preview;
    $("#undo").disabled = this.preview || this.historyIndex <= 0;
    $("#redo").disabled =
      this.preview || this.historyIndex >= this.history.length - 1;
    if (!this.preview) {
      this.leavePreviewFullscreen();
      if (this.previewViewport) {
        scroll.scrollLeft = this.previewViewport.left;
        scroll.scrollTop = this.previewViewport.top;
        this.previewViewport = null;
      }
    }
  }
  leavePreviewFullscreen() {
    if (!this.previewFullscreen) return;
    this.previewFullscreen = false;
    if (document.fullscreenElement === document.documentElement)
      document.exitFullscreen().catch(() => {});
  }
  async togglePreviewFullscreen() {
    if (!this.preview) return;
    if (document.fullscreenElement) {
      this.previewFullscreen = false;
      try { await document.exitFullscreen(); } catch { toast("无法退出全屏，请按 Esc"); }
      return;
    }
    try {
      this.previewFullscreen = true;
      await document.documentElement.requestFullscreen();
      if (!this.preview) this.leavePreviewFullscreen();
    } catch {
      this.previewFullscreen = false;
      toast("浏览器未允许全屏，已保留整窗预览");
    }
  }
  togglePreview(force) {
    if (this.loading || this.isHome) return;
    this.finishText?.();
    this.cancelPreview?.();
    this.cancelPreview = null;
    this.preview = typeof force === "boolean" ? force : !this.preview;
    this.setPreviewUI();
    if (this.preview) {
      this.previewDiagnostics = [];
      const version = this.loadVersion, generation = this.previewGeneration = (this.previewGeneration || 0) + 1;
      const onStatus = status => {
        if (!this.preview || version !== this.loadVersion || generation !== this.previewGeneration) return;
        $('#app').dataset.previewState = status.state;
        this.previewStatus = status;
        if (status.message && this.previewDiagnostics.at(-1)?.message !== status.message) {
          this.previewDiagnostics.push(status); this.previewDiagnostics = this.previewDiagnostics.slice(-12);
        }
        $('#preview-status').textContent = status.state === 'loading' ? '正在加载预览…' : status.state === 'ready' ?
          '预览中不可选中编辑，请先返回编辑' : status.state === 'slow' ? '预览加载较慢，请查看诊断或重新播放' :
          '预览可能未完整显示，请查看诊断';
        $('#motion-status').textContent = status.state === 'ready' ? '动效与交互正在运行' : status.state === 'loading' ? '正在加载预览' : '预览状态需检查';
      };
      const html = cleanDocument(this.doc, {
        exporting: true,
      }).replace(
        "</body>",
        '<script>' + (this.pages?.previewStart() || "") + 'document.addEventListener("keydown",function(e){if(e.key==="Escape")parent.postMessage({type:"html-studio-exit-preview"},"*")})<\/script></body>',
      );
      this.cancelPreview = startCanvasPreview($("#preview-frame"), html, this.assets, onStatus);
    } else {
      $("#preview-frame").srcdoc = "";
      this.frame.focus();
    }
    this.render();
  }
  async saveProject() {
    if (this.loading || this.isHome || this.savingProject) return;
    this.finishText?.();
    const data = projectData(this);
    const revision = this.revision, version = this.loadVersion;
    const current = () => revision === this.revision && version === this.loadVersion && !this.loading && !this.isHome;
    this.savingProject = true;
    try {
      const draft = saveDraft(data, this.assets).then(() => {
        if (current()) this.showSavedDraft(data.savedAt);
      }).catch(() => {
        if (current()) $('#save-indicator').textContent = '草稿保存失败';
      });
      const artifact = await createEditorArtifact(this,{format:'project',snapshot:data,missingFonts:'prompt'});
      if (artifact === null) return;
      download(artifact.content,artifact.filename,artifact.mimeType);
      await draft;
      if (current()) this.dirty = false;
      toast("工程已下载，包含图层信息、HTML 和已嵌入资源");
    } catch (e) { toast("保存失败：" + e.message); }
    finally { this.savingProject = false; }
  }
  async exportHTML() {
    if (this.loading || this.isHome || this.exportingHTML) return;
    this.finishText?.();
    this.exportingHTML = true;
    try {
      const artifact = await createEditorArtifact(this,{format:'html',missingFonts:'prompt'});
      if (artifact === null) return;
      download(artifact.content,artifact.filename,artifact.mimeType);
      toast(
        this.warnings.some((w) => w.includes("未找到"))
          ? "HTML 已导出；仍有缺失资源，请补齐后使用"
          : "HTML 已导出，原有 CSS 动画和脚本已保留",
      );
    } catch (e) { toast("导出失败：" + e.message); }
    finally { this.exportingHTML = false; }
  }
  async writeBack() {
    if (!this.fileHandle) {
      toast("请先从“导入 → 打开并关联 HTML”选择本地文件");
      return;
    }
    if (!this.fileHandle.createWritable) {
      toast("当前浏览器不支持直接写回，请使用导出 HTML");
      return;
    }
    modal(
      "保存到原 HTML 文件",
      `<p>将当前编辑结果写入 <strong>${esc(this.fileHandle.name)}</strong>，覆盖原文件。</p><p>可以先导出一份 HTML 或保存工程留作备份。</p>`,
      [
        { label: "取消", run: closeModal },
        {
          label: "写入原文件",
          primary: true,
          run: async () => {
            closeModal();
            try {
              this.finishText?.();
              const handle = this.fileHandle, revision = this.revision;
              const html = await this.portableHTML(cleanDocument(this.doc, { exporting: true }));
              if (html === null) return;
              const writable = await handle.createWritable();
              await writable.write(html);
              await writable.close();
              if (revision === this.revision) this.dirty = false;
              toast("已写回原 HTML 文件");
            } catch (e) {
              toast("写回未完成：" + e.message);
            }
          },
        },
      ],
    );
  }
  async importFiles(files) {
    if (!files.length) return;
    $("#dialog").flushData?.();
    const request = ++this.openVersion;
    if (
      this.dirty &&
      files.some((f) => /\.(htmlstudio|json|html?)$/i.test(f.name))
    ) {
      const ok = await new Promise((resolve) => {
        const dialog = $("#dialog");
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          dialog.removeEventListener("close", onClose);
          resolve(value);
        };
        const onClose = () => {
          if (!dialog.open) finish(false);
        };
        modal(
          "打开新的页面或工程",
          "<p>当前工程有修改。打开新文件会替换当前草稿，请先保存需要保留的工程。</p>",
          [
            {
              label: "取消",
              run: () => {
                finish(false);
                closeModal();
              },
            },
            { label: "先保存工程", run: () => this.saveProject() },
            {
              label: "继续打开",
              primary: true,
              run: () => {
                finish(true);
                closeModal();
              },
            },
          ],
        );
        dialog.addEventListener("close", onClose);
      });
      if (!ok || request !== this.openVersion) return;
    }
    const project =
      files.find((f) => /\.htmlstudio$/i.test(f.name)) ||
      (files.length === 1 && /\.json$/i.test(files[0].name) ? files[0] : null);
    if (project) {
      try {
        const d = JSON.parse(await project.text());
        if (request !== this.openVersion) return;
        if (
          d.format !== "html-studio" ||
          d.version !== 1 ||
          typeof d.html !== "string"
        )
          throw Error("不是支持的 HTML Studio 工程");
        this.compatibility = null;
        if (!await this.load(d)) return;
        await this.refreshCompatibility();
        if (request !== this.openVersion) return;
        this.history = [];
        this.historyIndex = -1;
        this.pushHistory("打开工程");
        this.fileHandle = null;
        this.dirty = false;
        this.fit();
        this.scheduleDraft();
        toast("工程已打开");
      } catch (e) {
        toast("打开失败：" + e.message);
      }
      return;
    }
    const pages = files.filter((f) => /\.html?$/i.test(f.name));
    if (!pages.length) {
      if (this.isHome) { toast('请先打开 HTML / 工程，或从模板新建页面'); return; }
      if (files[0].type.startsWith('video/') || /\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(files[0].name)) {
        await this.importVideo(files[0]);
        return;
      }
      if (files[0].type.startsWith("image/") || /\.svg$/i.test(files[0].name)) {
        await this.importImage(files[0]);
        return;
      }
      toast("请选择 HTML、.htmlstudio 工程、图片或视频文件");
      return;
    }
    const load = async (entry) => {
      closeModal();
      try {
        const data = await importBundle(files, entry, this.assets);
        if (request !== this.openVersion) return;
        this.compatibility = null;
        if (!await this.load({
          ...data,
          name: entry.name.replace(/\.html?$/i, ""),
          width: 1080,
          height: 820,
          selection: [],
        })) return;
        const compatibility = await this.refreshCompatibility();
        if (request !== this.openVersion || !compatibility) return;
        this.autoHeight(false);
        this.history = [];
        this.historyIndex = -1;
        this.pushHistory("导入 HTML");
        this.fileHandle = null;
        this.dirty = false;
        this.fit();
        this.scheduleDraft();
        toast(
          compatibility.issues.length
            ? "HTML 已导入，请查看兼容性提示"
            : "HTML 已导入，可以开始编辑",
        );
        if (compatibility.issues.length) this.showCompatibility(compatibility);
      } catch (e) {
        toast("导入失败：" + e.message);
      }
    };
    if (pages.length === 1) await load(pages[0]);
    else {
      const body = modal(
        "选择要编辑的 HTML",
        pages.map(
          (f, i) =>
            `<button class="file-choice" data-entry="${i}">${esc(f.webkitRelativePath || f.name)}</button>`,
        ),
        [{ label: "取消", run: closeModal }],
      );
      $$("[data-entry]", body).forEach(
        (b) => (b.onclick = () => load(pages[Number(b.dataset.entry)])),
      );
    }
  }
  async importImage(file) {
    if (this.preview) this.togglePreview(false);
    let el;
    if (/\.svg$/i.test(file.name) || file.type === "image/svg+xml") {
      const doc = new DOMParser().parseFromString(
        await file.text(),
        "image/svg+xml",
      );
      if (
        doc.querySelector("parsererror") ||
        doc.documentElement.localName !== "svg"
      ) {
        toast("SVG 格式无效");
        return;
      }
      el = this.doc.importNode(doc.documentElement, true);
      el.querySelectorAll("script,foreignObject").forEach((n) => n.remove());
      for (const n of [el, ...el.querySelectorAll("*")])
        for (const a of [...n.attributes])
          if (
            /^on/i.test(a.name) ||
            (/href$/i.test(a.name) && /^javascript:/i.test(a.value))
          )
            n.removeAttribute(a.name);
      const vb = el.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
      const w = num(el.getAttribute("width"), vb?.[2] || 160),
        h = num(el.getAttribute("height"), vb?.[3] || 120);
      if (!el.hasAttribute("viewBox"))
        el.setAttribute("viewBox", `0 0 ${w} ${h}`);
      el.style.width = Math.min(320, w) + "px";
      el.style.height = (Math.min(320, w) * h) / w + "px";
    } else {
      el = this.doc.createElement("img");
      el.src = this.assets.addFile(file);
      el.alt = file.name;
      const image = new Image();
      image.src = el.src;
      await image.decode().catch(() => {});
      el.style.width = Math.min(320, image.naturalWidth || 240) + "px";
      el.style.height =
        (Math.min(320, image.naturalWidth || 240) *
          (image.naturalHeight || 180)) /
          (image.naturalWidth || 240) +
        "px";
      el.style.objectFit = "cover";
    }
    Object.assign(el.style, {
      position: "absolute",
      left: "100px",
      top: "100px",
    });
    el.dataset.hsId = uid();
    el.dataset.hsName = file.name;
    if (this.locked(this.pageRoot)) return toast("当前页面已锁定，请先解锁");
    this.pageRoot.append(el);
    annotate(this.doc);
    this.selection = [this.id(el)];
    this.commit("导入资源");
    toast("资源已嵌入工程，导出时会保留");
  }
  autoHeight(commit = true) {
    if (this.pages?.current && !commit) return;
    const h = Math.max(
      160,
      ...$$("[data-hs-id]", this.pageRoot)
        .filter((el) => this.style(el).position !== "fixed")
        .map((el) => this.rect(el).bottom),
    );
    this.height = clamp(Math.ceil(h), 160, 24000);
    if (this.pages?.current) this.pageRoot.style.height = this.height + "px";
    this.layout();
    if (commit) this.commit("适应内容高度");
  }
}
function hexToRGB(value) {
  const c = document.createElement("canvas").getContext("2d");
  c.fillStyle = value;
  let h = c.fillStyle;
  if (h.startsWith("#"))
    return [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
  return (h.match(/[\d.]+/g) || ["0", "0", "0"]).slice(0, 3).map(Number);
}
function safeName(s) {
  return s.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 80) || "未命名页面";
}
installGrouping(Editor, { modal, closeModal, toast });
installFitContent(Editor, { modal, closeModal, toast });
installAuthoring(Editor, { modal, closeModal, toast });
installFontSupport(Editor, { modal, closeModal, toast });
installDataTools(Editor, { modal, closeModal, toast });
installSVGCharts(Editor, { modal, closeModal, toast });
installTemplateCharts(Editor, { modal, closeModal });
installHTMLBars(Editor, { modal, closeModal });
installCanvasCharts(Editor, { modal, closeModal });
const editor = new Editor();
window.htmlStudio = editor;
Object.defineProperty(window,'htmlStudioAPI',{value:createEditorOperations(editor,{download}),writable:false,configurable:false});
installAgentBridge(editor,window.htmlStudioAPI,{modal,closeModal,toast});
$("#font-status").onclick = () => editor.showFontLibrary();
function hideMenu() {
  $("#menu").hidden = true;
}
function menuAt(x, y, items) {
  const menu = $("#menu");
  menu.replaceChildren();
  for (const item of items) {
    if (!item) {
      menu.append(document.createElement("hr"));
      continue;
    }
    const b = document.createElement("button");
    b.innerHTML = `<span>${esc(item.label)}</span>${item.key ? "<kbd>" + esc(item.key) + "</kbd>" : ""}`;
    if (item.danger) b.className = "danger";
    b.disabled = !!item.disabled;
    b.onclick = () => {
      hideMenu();
      item.run();
    };
    menu.append(b);
  }
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = clamp(x, 8, window.innerWidth - r.width - 8) + "px";
  menu.style.top = clamp(y, 8, window.innerHeight - r.height - 8) + "px";
}
function contextMenu(x, y) {
  if (editor.preview || editor.loading) return;
  const no = !editor.selection.length;
  menuAt(x, y, [
    { label: "复制", key: "⌘ C", disabled: no, run: () => editor.copy() },
    {
      label: "粘贴",
      key: "⌘ V",
      disabled: !editor.clipboard,
      run: () => editor.paste(),
    },
    {
      label: "创建副本",
      key: "⌘ D",
      disabled: no,
      run: () => editor.duplicate(),
    },
    null,
    {
      label: "组合",
      key: "⌘ G",
      disabled: editor.roots.length < 2,
      run: () => editor.group(),
    },
    {
      label: "解除组合 / 拆散容器",
      key: "⌘ ⇧ G",
      disabled: !editor.roots.some((n) => editor.canUngroup(n)),
      run: () => editor.ungroup(),
    },
    {
      label: "添加自动布局",
      key: "Shift A",
      disabled: no,
      run: () => autoLayout(),
    },
    null,
    { label: "上移一层", disabled: no, run: () => editor.reorder(1) },
    { label: "下移一层", disabled: no, run: () => editor.reorder(-1) },
    {
      label: "移到最上层",
      key: "]",
      disabled: no,
      run: () => editor.reorder(1, true),
    },
    {
      label: "移到最下层",
      key: "[",
      disabled: no,
      run: () => editor.reorder(-1, true),
    },
    null,
    {
      label: "重命名",
      disabled: editor.nodes.length !== 1,
      run: () => editor.rename(editor.nodes[0]),
    },
    {
      label: "删除",
      key: "⌫",
      danger: true,
      disabled: no,
      run: () => editor.remove(),
    },
  ]);
}
function mainMenu() {
  menuAt(12, 53, [
    { label: "从模板新建 HTML…", run: () => editor.showTemplates() },
    {
      label: "打开 HTML / 工程",
      key: "⌘ O",
      run: () => $("#file-input").click(),
    },
    { label: "导入资源目录", run: () => $("#folder-input").click() },
    { label: "打开并关联 HTML", run: () => openLinked() },
    null,
    { label: "保存工程文件", key: "⌘ S", disabled: editor.isHome, run: () => editor.saveProject() },
    {
      label: "写回原 HTML 文件…",
      disabled: !editor.fileHandle,
      run: () => editor.writeBack(),
    },
    { label: "导出 HTML", key: "⌘ ⇧ E", disabled: editor.isHome, run: () => editor.exportHTML() },
    null,
    { label: "查看导出代码", disabled: editor.isHome, run: () => showSource() },
    { label: "模板字体与离线缓存…", run: () => editor.showFontLibrary() },
    { label: "使用说明与支持范围", run: () => showHelp() },
    { label: "使用许可 · 免费自用，禁止商用", run: () => showUsageLicense() },
  ]);
}
function confirmNew() { editor.showTemplates(); }
function showImport() {
  modal(
    "导入文件",
    `<button class="file-choice" id="pick-html"><strong>打开 HTML 或工程</strong><small>单文件 HTML、.htmlstudio 工程。图片与字体若在外部目录，请使用下一项。</small></button><button class="file-choice" id="pick-folder"><strong>打开 HTML 资源目录</strong><small>同时选择 HTML、CSS、图片和字体，常见本地资源会嵌入导出的 HTML。</small></button><button class="file-choice" id="pick-linked"><strong>打开并关联本地 HTML</strong><small>Chrome / Edge 支持，授权后可通过文件菜单写回原文件。</small></button><p class="source-note">文件内容在浏览器内处理。导入页面的远程资源会按原链接加载。</p>`,
    [{ label: "取消", run: closeModal }],
  );
  $("#pick-html").onclick = () => {
    closeModal();
    $("#file-input").click();
  };
  $("#pick-folder").onclick = () => {
    closeModal();
    $("#folder-input").click();
  };
  $("#pick-linked").onclick = () => {
    closeModal();
    openLinked();
  };
}
async function openLinked() {
  if (!window.showOpenFilePicker) {
    toast("当前浏览器不支持文件关联，改用普通文件导入");
    $("#file-input").click();
    return;
  }
  try {
    const [handle] = await showOpenFilePicker({
      types: [
        {
          description: "HTML 页面",
          accept: { "text/html": [".html", ".htm"] },
        },
      ],
      multiple: false,
    });
    await editor.importFiles([await handle.getFile()]);
    editor.fileHandle = handle;
    toast("已关联本地 HTML；可从文件菜单写回原文件");
  } catch (e) {
    if (e.name !== "AbortError") toast("文件关联失败：" + e.message);
  }
}
async function showSource() {
  editor.finishText?.();
  const source = await editor.portableHTML(cleanDocument(editor.doc, { exporting: true }));
  if (source === null) return;
  modal(
    "导出 HTML 代码",
    `<p class="source-note">包含原始样式、动画和脚本；已移除编辑器标记。此处用于查看，修改请在画布中完成。</p><textarea class="code-view" id="source-code" spellcheck="false" readonly aria-label="导出 HTML 代码">${esc(source)}</textarea>`,
    [
      { label: "关闭", run: closeModal },
      {
        label: "复制代码",
        run: async () => {
          try {
            await navigator.clipboard.writeText($("#source-code").value);
            toast("HTML 代码已复制");
          } catch {
            $("#source-code").select();
            toast("已选中代码，请按 ⌘ / Ctrl C 复制");
          }
        },
      },
      { label: "导出 HTML", primary: true, run: () => editor.exportHTML() },
    ],
  );
}
function showUsageLicense() {
  modal("个人非商业使用许可", $("#usage-license-content").innerHTML,
    [{ label: "关闭", primary: true, run: closeModal }]);
}
function showHelp() {
  modal(
    "开始使用 HTML Studio",
    `<p>一个面向静态 HTML、CSS 动效和轻量 JavaScript 交互的可视化编辑器。</p><h3>常用操作</h3><ul><li>点击选择；Shift 点击多选；空白处拖动框选。⌘ / Ctrl 点击可穿透组合选择内部元素。</li><li>双击文字直接编辑，支持中文输入。选中元素后可调整右侧属性。</li><li>V 选择，H 抓手，R 矩形，O 椭圆，T 文本，F 容器，L 线条。空格拖动平移。</li><li>方向键移动 1 px，Shift + 方向键移动 10 px。⌘ / Ctrl Z 撤回，⌘ / Ctrl Shift Z 重做。</li><li>⌘ / Ctrl G 组合，⌘ / Ctrl Shift G 解绑；组合要求同一父容器下的绝对定位元素。</li><li>将容器转换为自由布局前会再次提示。转换会固定当前视口，改变原有响应式行为。</li></ul><h3>工程、草稿与 HTML</h3><p><strong>保存工程</strong>下载 .htmlstudio 文件，保留图层名、锁定状态和 HTML。<strong>导出 HTML</strong>生成可运行页面。浏览器自动草稿不代替工程备份，撤回历史仅保留当前会话。</p><p>从资源目录导入时，会嵌入常见 CSS、图片、字体与经典脚本。缺失资源会列在页面属性中；远程资源可能仍需联网。</p><h3>初版支持边界</h3><p>支持基础形状与 SVG 整体编辑，不含钢笔或路径节点。支持常见 CSS animation、transition、hover，以及点击切换、显示隐藏等轻量脚本预览。编辑时 CSS 动效暂停，脚本不执行。入场动画中初始透明的元素会临时显示，导出时保留其原始透明度。</p><p>预览在隔离页面中运行。依赖登录、存储、后端、跨页面跳转、动态模块导入的应用不保证可运行。JavaScript 动态生成的元素不会出现在静态编辑图层中。复制元素不会自动复制事件监听器绑定。</p><p>组合与解绑作用于当前布局。普通 HTML 容器可通过左侧图层标题旁的「图层操作」菜单、图层右键菜单或 ⌘ / Ctrl Shift G 拆散，支持二维旋转和缩放。拆散会移除容器自身的背景、描边与阴影；涉及响应式布局时先确认转换。三维变换、隐藏图层、直接文字及锁定内容会给出具体提示。嵌套变换、复杂选择器、滚动联动和特殊 CSS 仍需逐页检查导出结果。</p><h3>动效检查</h3><p>点击顶部「预览」运行页面，点击「重新播放」从初始状态运行。返回编辑不会把动画的瞬时状态写入工程。导出后请在浏览器打开一次，检查资源与交互。</p><p class="source-note">建议使用电脑上的最新版 Chrome / Edge。Windows 使用 Ctrl 替代 ⌘。</p>`,
    [{ label: "开始编辑", primary: true, run: closeModal }],
  );
}
function autoLayout() {
  if (editor.roots.length > 1) editor.group(true);
  else if (
    editor.nodes.length === 1 &&
    !isText(editor.nodes[0]) &&
    editor.nodes[0].namespaceURI !== svgNS
  )
    editor.property("display", "flex");
  else toast("选择一个容器或多个同级元素，再添加自动布局");
}
const actions = {
  "fit-content": () => editor.fitContent(),
  "edit-data": () => editor.openDataEditor(),
  "edit-chart-data": () => editor.openChartDataEditor(),
  "free-layout": () => editor.requestFreeLayout(editor.nodes[0]),
  "edit-text": () => {
    if (editor.nodes.length === 1) editor.startText(editor.nodes[0]);
  },
  "no-fill": () => {
    if (!editor.editable()) return;
    editor.roots.forEach((el) => {
      if (el.namespaceURI === svgNS) {
        editor.setStyle(el, "fill", "none");
        el.querySelectorAll(
          "path,rect,circle,ellipse,polygon,polyline,text",
        ).forEach((c) => {
          if (!c.closest("defs,clipPath,mask")) editor.setStyle(c, "fill", "none");
        });
      } else editor.setStyle(el, "background", "transparent");
    });
    editor.commit("移除填充");
  },
  "no-shadow": () => {
    if (!editor.editable()) return;
    editor.roots.forEach((el) => editor.setStyle(el, "boxShadow", "none"));
    editor.commit("移除阴影");
  },
  "auto-height": () => editor.autoHeight(),
};
$("#inspector").addEventListener("change", (e) => {
  const videoProp = e.target.dataset.videoProp;
  if (videoProp && ['controls','loop','muted','autoplay'].includes(videoProp)) {
    if (!editor.editable()) return;
    for (const el of editor.nodes.filter(n => n.tagName === 'VIDEO')) {
      el.toggleAttribute(videoProp, e.target.checked);
      if (videoProp === 'autoplay' && e.target.checked) el.setAttribute('muted', '');
      el.pause();
    }
    editor.commit('修改视频播放'); return;
  }
  const prop = e.target.dataset.prop;
  if (prop === "fontFamily" && e.target.value === "__custom_font__") {
    editor.customFont();
    return;
  }
  if (prop) editor.property(prop, e.target.value);
});
$("#inspector").addEventListener("input", (e) => {
  if (e.target.type === "range" || e.target.type === "color")
    editor.property(e.target.dataset.prop, e.target.value, { live: true });
});
$("#inspector").addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action) actions[action]?.();
  const align = e.target.closest("[data-align]")?.dataset.align;
  if (align) editor.align(align);
  const textAlign = e.target.closest("[data-text-align]")?.dataset.textAlign;
  if (textAlign) editor.property("textAlign", textAlign);
});
$("#document-name").addEventListener("change", (e) => {
  editor.name = e.target.value.trim() || "未命名页面";
  editor.commit("重命名文档");
});
$("#layer-search").oninput = () => editor.renderLayers();
$("#layer-actions").onclick = (event) => {
  const r = event.currentTarget.getBoundingClientRect();
  contextMenu(r.left, r.bottom + 4);
};
$("#page-select").onchange = (e) => editor.switchPage(e.target.value);
$("#page-previous").onclick = () => editor.switchPage(editor.pages.index - 1);
$("#page-next").onclick = () => editor.switchPage(editor.pages.index + 1);
$("#manage-pages").onclick = () => editor.showPageManager();
$("#undo").onclick = () => editor.undo();
$("#redo").onclick = () => editor.redo();
$("#main-menu-button").onclick = (e) => {
  e.stopPropagation();
  $("#menu").hidden ? mainMenu() : hideMenu();
};
$("#import-button").onclick = showImport;
$("#start-import-button").onclick = showImport;
$("#start-template-button").onclick = () => editor.showTemplates();
$("#restore-draft-button").onclick = () => editor.restoreDraft();
$("#save-button").onclick = () => editor.saveProject();
$("#export-button").onclick = () => editor.exportHTML();
$("#preview-button").onclick = () => editor.togglePreview();
$("#compatibility-button").onclick = async () => {
  const button = $("#compatibility-button");
  button.disabled = true;
  try {
    const report = await editor.refreshCompatibility();
    if (report) editor.showCompatibility(report);
  } finally { button.disabled = false; }
};
$("#exit-preview").onclick = () => editor.togglePreview(false);
$("#restart-preview").onclick = () => editor.togglePreview(true);
$("#preview-fullscreen").hidden = !document.fullscreenEnabled;
$("#preview-fullscreen").onclick = () => editor.togglePreviewFullscreen();
document.addEventListener("fullscreenchange", () => {
  const active = !!document.fullscreenElement;
  $("#preview-fullscreen").textContent = active ? "退出全屏" : "全屏显示";
  $("#preview-fullscreen").setAttribute("aria-pressed", String(active));
  if (!active && editor.previewFullscreen) {
    editor.previewFullscreen = false;
    if (editor.preview) editor.togglePreview(false);
  }
});
$("#preview-details").onclick = async () => {
  const session=editor.cancelPreview;
  const inspected=await session?.inspect?.();
  if(!editor.preview||session!==editor.cancelPreview)return;
  const messages = editor.previewDiagnostics || [];
  const frame = $('#preview-frame'), box = frame.getBoundingClientRect();
  const ancestors=[];
  for(let el=frame;el&&ancestors.length<10;el=el.parentElement){
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    ancestors.push({element:el.localName+(el.id?'#'+el.id:''),width:Math.round(r.width),height:Math.round(r.height),
      x:Math.round(r.x),y:Math.round(r.y),display:s.display,visibility:s.visibility,opacity:s.opacity,
      transform:s.transform,contentVisibility:s.contentVisibility,hidden:el.hasAttribute('hidden')});
  }
  const details = {editor:'0.4.0',diagnosticVersion:2,browser:navigator.userAgent,editPage:editor.pages?.current ? editor.pages.index + 1 : null,
    state:editor.previewStatus?.state,frame:{width:frame.clientWidth,height:frame.clientHeight,screenWidth:Math.round(box.width),screenHeight:Math.round(box.height)},
    host:{viewport:[innerWidth,innerHeight],devicePixelRatio,visibilityState:document.visibilityState,ancestors},
    freshInspection:!!inspected,runtime:inspected||editor.previewStatus?.details||null,messages:messages.map(s=>s.message)};
  const text = JSON.stringify(details,null,2);
  modal('预览诊断', `<p>当前编辑页：${details.editPage || '完整页面'}。预览会运行原 HTML 的脚本，支持的演示接口会从当前编辑页开始播放。</p>${messages.length ? '<ul>' + messages.map(s=>'<li>'+esc(s.message)+'</li>').join('') + '</ul>' : '<p>暂未收到加载或脚本错误；如画面仍空白，请下载诊断信息用于排查。</p>'}<details open><summary>加载方式、播放脚本与页面尺寸</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:260px;overflow:auto">${esc(text)}</pre></details><p>返回编辑不会丢失修改。预览中的临时交互状态不会写回工程。</p>`, [
    {label:'下载诊断',run:()=>download(text,'HTML-Studio-预览诊断.txt','text/plain;charset=utf-8')},
    {label:'关闭',run:closeModal},
  ]);
};
$("#source-button").onclick = showSource;
$("#help-button").onclick = showHelp;
$("#usage-license-button").onclick = showUsageLicense;
$("#new-template-button").onclick = () => confirmNew();
$("#dialog-close").onclick = closeModal;
$("#dialog").addEventListener("click", (e) => {
  if (e.target === $("#dialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeModal();
  }
});
$("#zoom-out").onclick = () => editor.zoomTo(editor.zoom / 1.2);
$("#zoom-in").onclick = () => editor.zoomTo(editor.zoom * 1.2);
$("#zoom-label").onclick = () => editor.fit();
$("#desktop-size").onclick = () => {
  editor.width = 1080;
  editor.height = 820;
  editor.layout();
  editor.commit("桌面视口");
  editor.fit();
};
$("#mobile-size").onclick = () => {
  editor.width = 390;
  editor.height = 1200;
  editor.layout();
  editor.commit("手机视口");
  editor.fit();
};
$$("[data-tool]").forEach(
  (b) => (b.onclick = () => editor.setTool(b.dataset.tool)),
);
function leftTab(name) {
  $$("[data-left-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.leftTab === name),
  );
  $("#layers-pane").hidden = name !== "layers";
  $("#layer-actions").hidden = name !== "layers";
  $("#insert-pane").hidden = name !== "insert";
}
$$("[data-left-tab]").forEach(
  (b) => (b.onclick = () => leftTab(b.dataset.leftTab)),
);
$("#more-insert").onclick = () => leftTab("insert");
$("#insert-grid").innerHTML = [
  "text",
  "frame",
  "rect",
  "ellipse",
  "line",
  "triangle",
  "star",
]
  .map(
    (t) =>
      `<button class="insert-card" data-insert="${t}">${icon(t)}<span>${titles[t]}</span></button>`,
  )
  .join("");
$$("[data-insert]").forEach(
  (b) => (b.onclick = () => editor.setTool(b.dataset.insert)),
);
$("#insert-image").onclick = () => $("#image-input").click();
$("#insert-svg").onclick = () => $("#svg-input").click();
$("#insert-video").onclick = () => $("#video-input").click();
$("#video-input").onchange = async event => {
  if (event.target.files[0]) await editor.importVideo(event.target.files[0]);
  event.target.value = '';
};
$$('[data-insert-data]').forEach(b => b.onclick = () => editor.insertDataElement(b.dataset.insertData));
for (const name of ["file", "folder"])
  $("#" + name + "-input").onchange = async (e) => {
    await editor.importFiles([...e.target.files]);
    e.target.value = "";
  };
for (const name of ["image", "svg"])
  $("#" + name + "-input").onchange = async (e) => {
    if (e.target.files[0]) await editor.importImage(e.target.files[0]);
    e.target.value = "";
  };
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#menu,#main-menu-button")) hideMenu();
});
document.addEventListener("contextmenu", (e) => {
  const row = e.target.closest('#layer-list .layer-row[data-id]');
  if (row && !editor.loading && !editor.preview) {
    e.preventDefault();
    if (!editor.selection.includes(row.dataset.id)) editor.select([row.dataset.id]);
    contextMenu(e.clientX, e.clientY);
  } else if (e.target.closest(".canvas-scroll")) {
    e.preventDefault();
    contextMenu(e.clientX, e.clientY);
  }
});
$("#canvas-scroll").addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest(".resize-handle")) return;
  if (editor.tool === "hand" || editor.space) {
    e.preventDefault();
    editor.startPan(e);
  } else if (
    e.target.id === "surface-shell" ||
    e.target.id === "surface" ||
    e.target.id === "canvas-scroll"
  )
    editor.select([]);
});
$("#canvas-scroll").addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      editor.zoomTo(editor.zoom * (e.deltaY > 0 ? 0.95 : 1.05));
    }
  },
  { passive: false },
);
function handleKey(e) {
  const target = e.target;
  const typing =
    target.matches?.('input,textarea,select,[contenteditable="true"]') ||
    target.closest?.('[contenteditable="true"]');
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === "Escape") {
    if (editor.finishText) {
      e.preventDefault();
      editor.finishText();
      return;
    }
    if ($("#dialog").open) return;
    if (editor.preview) editor.togglePreview(false);
    else {
      hideMenu();
      editor.setTool("select");
      editor.select([]);
    }
    return;
  }
  if (typing || $("#dialog").open) return;
  if (editor.preview) return;
  if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    editor.saveProject();
    return;
  }
  if (mod && e.key.toLowerCase() === "o") {
    e.preventDefault();
    $("#file-input").click();
    return;
  }
  if (editor.isHome) return;
  if (mod && e.shiftKey && e.key.toLowerCase() === "e") {
    e.preventDefault();
    editor.exportHTML();
    return;
  }
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? editor.redo() : editor.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    editor.redo();
    return;
  }
  if (mod && e.key.toLowerCase() === "a") {
    e.preventDefault();
    editor.select(
      [...editor.pageRoot.children]
        .filter(selectable)
        .map((el) => editor.id(el)),
    );
    return;
  }
  if (mod && e.key.toLowerCase() === "g") {
    e.preventDefault();
    e.shiftKey ? editor.ungroup() : editor.group();
    return;
  }
  if (mod && e.key.toLowerCase() === "d") {
    e.preventDefault();
    editor.duplicate();
    return;
  }
  if (mod && e.key.toLowerCase() === "c") {
    e.preventDefault();
    editor.copy();
    return;
  }
  if (mod && e.key.toLowerCase() === "x") {
    e.preventDefault();
    editor.copy();
    editor.remove();
    return;
  }
  if (mod && e.key.toLowerCase() === "v") {
    e.preventDefault();
    editor.paste();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    editor.space = true;
    $("#canvas-scroll").classList.add("hand");
    return;
  }
  if (e.shiftKey && e.key === "!") {
    e.preventDefault();
    editor.fit();
    return;
  }
  if (e.shiftKey && e.code === "Digit1") {
    e.preventDefault();
    editor.fit();
    return;
  }
  if (e.shiftKey && e.key.toLowerCase() === "a") {
    e.preventDefault();
    autoLayout();
    return;
  }
  if (["Backspace", "Delete"].includes(e.key)) {
    e.preventDefault();
    editor.remove();
    return;
  }
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    if (editor.editable()) {
      const step = e.shiftKey ? 10 : 1;
      editor.roots.forEach((el) =>
        editor.moveBy(
          el,
          e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
          e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
        ),
      );
      editor.commit("微调位置");
    }
    return;
  }
  if (e.key === "[" || e.key === "]") {
    e.preventDefault();
    editor.reorder(e.key === "]" ? 1 : -1, e.shiftKey);
    return;
  }
  if (
    e.key === "Enter" &&
    editor.nodes.length === 1 &&
    isText(editor.nodes[0])
  ) {
    e.preventDefault();
    editor.startText(editor.nodes[0]);
    return;
  }
  const tools = {
    v: "select",
    h: "hand",
    r: "rect",
    o: "ellipse",
    t: "text",
    f: "frame",
    l: "line",
  };
  if (!mod && tools[e.key.toLowerCase()]) {
    e.preventDefault();
    editor.setTool(tools[e.key.toLowerCase()]);
  }
}
document.addEventListener("keydown", handleKey);
document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    editor.space = false;
    $("#canvas-scroll").classList.remove("hand");
  }
});
window.addEventListener("blur", () => {
  editor.space = false;
});
window.addEventListener("resize", () => editor.draw());
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    dragDepth++;
    $("#drop-overlay").hidden = false;
  }
});
document.addEventListener("dragleave", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    dragDepth--;
    if (dragDepth <= 0) $("#drop-overlay").hidden = true;
  }
});
document.addEventListener("dragover", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
});
document.addEventListener("drop", async (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    e.preventDefault();
    $("#drop-overlay").hidden = true;
    dragDepth = 0;
    await editor.importFiles([...e.dataTransfer.files]);
  }
});
window.addEventListener("beforeunload", (e) => {
  if (editor.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

window.addEventListener("message", (e) => {
  if (
    e.source === $("#preview-frame").contentWindow &&
    e.data?.type === "html-studio-exit-preview" &&
    editor.preview
  )
    editor.togglePreview(false);
});
