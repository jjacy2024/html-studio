import { templateLibrary } from './templates.js';
import { templateCovers } from './template-covers.js';
import { annotate, uid, escapeHTML } from './document.js';
import { AssetStore } from './assets.js';
import { localizeTemplateFonts, watchTemplateFontPreview } from './template-fonts.js';
import { bindPageOrder } from './page-order.js';

export function installAuthoring(Editor, ui) {
  const { modal, closeModal, toast } = ui;
  const q = s => document.querySelector(s);
  const e = escapeHTML;
  Editor.prototype.createFromTemplate = async function (slug) {
    const item = templateLibrary.find(t => t.slug === slug);
    if (!item || this.loading) return false;
    const doc = new DOMParser().parseFromString(item.html, 'text/html');
    const groups = new Map();
    for (const slide of doc.querySelectorAll('.slide,deck-stage > section')) {
      if (slide.parentElement.closest('.slide')) continue;
      const parent = slide.parentElement;
      groups.set(parent, (groups.get(parent) || 0) + 1);
    }
    const parent = [...groups].sort((a,b)=>b[1]-a[1])[0]?.[0];
    if (parent) parent.setAttribute('data-studio-pages','true');
    await this.newDocument('<!doctype html>\n'+doc.documentElement.outerHTML, item.name, {width:1280,height:720});
    return true;
  };
  Editor.prototype.showTemplates = function () {
    if (this.loading) return;
    this.finishText?.();
    const editor = this;
    const previewAssets = new AssetStore();
    let cancelTemplatePreview;
    let chosen = templateLibrary[0];
    const body = modal('从模板新建 HTML', `
      <p>选择模板，预览后创建。共 ${templateLibrary.length} 个模板，来自 beautiful-html-templates。</p>
      <div class="template-browser"><div class="template-sidebar"><input id="template-search" class="dialog-input" aria-label="搜索模板" placeholder="搜索模板名称、风格"><div id="template-list"></div></div>
      <div class="template-detail"><h3 id="template-name"></h3><div class="template-preview-stage"><div class="template-preview-wrap"><iframe id="template-preview" title="模板预览" sandbox="allow-scripts"></iframe>
      <div class="template-preview-controls" role="group" aria-label="模板预览操作"><button id="template-prev" aria-label="上一页">← 上一页</button><button id="template-next" aria-label="下一页">下一页 →</button><button id="template-restart">重新播放</button><span id="template-pages"></span></div></div></div>
      <p id="template-description"></p><p class="source-note">已内置 3 套常用字体；其他模板字体在后台下载并缓存，未就绪时先用系统替代字体。脚本和 Chart.js 已内置。新建会替换当前草稿，请先保存需要保留的工程。</p></div></div>`, [
        { label: '取消', run: closeModal },
        ...editor.isHome ? [] : [{ label: '先保存当前工程', run: () => editor.saveProject() }],
        { label: '使用此模板新建', primary: true, run: async () => {
          const item = chosen;
          closeModal();
          await editor.createFromTemplate(item.slug);
          const report = await editor.refreshCompatibility();
          if (report?.issues.length) editor.showCompatibility(report);
        } },
      ]);
    q('#dialog').dataset.kind = 'templates';
    const previewFrame = q('#template-preview');
    const previewWrap = q('.template-preview-wrap');
    // Sandboxed frames do not always propagate pointer hover to their parent.
    const previewPointer = event => {
      if (event.source !== previewFrame.contentWindow || event.data?.type !== 'studio-template-pointer') return;
      previewWrap.classList.toggle('is-pointer-over', event.data.inside === true);
    };
    const clearPreviewPointer = () => {
      if (!previewWrap.classList.contains('is-pointer-over')) return;
      previewWrap.classList.remove('is-pointer-over');
      previewFrame.contentWindow?.postMessage({ type: 'studio-template-pointer-reset' }, '*');
    };
    const outsidePreview = event => {
      if (!previewWrap.contains(event.target)) clearPreviewPointer();
    };
    window.addEventListener('message', previewPointer);
    document.addEventListener('pointermove', outsidePreview, true);
    previewWrap.addEventListener('pointerleave', clearPreviewPointer);
    const pick = item => {
      chosen = item;
      previewWrap.classList.remove('is-pointer-over');
      q('#template-name').textContent = item.name;
      q('#template-description').textContent = item.tagline || item.best_for || '';
      q('#template-pages').textContent = `${item.slide_count} 页`;
      const bridge = `<script>(()=>{
        let inside=false;
        const pointer=value=>{if(inside===value)return;inside=value;parent.postMessage({type:'studio-template-pointer',inside},'*')};
        addEventListener('message',event=>{
          if(event.source!==parent)return;
          if(event.data?.type==='studio-template-pointer-reset'){inside=false;return}
          if(event.data?.type!=='studio-template-key')return;
          const key=event.data.key;
          if(['ArrowLeft','ArrowRight'].includes(key))document.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
        });
        document.addEventListener('pointerover',()=>pointer(true),true);
        document.addEventListener('pointermove',()=>pointer(true),true);
        document.addEventListener('pointerout',event=>{if(!event.relatedTarget)pointer(false)},true);
      })();<\/script>`;
      cancelTemplatePreview?.();
      const html = localizeTemplateFonts(item.html, previewAssets).replace(/<\/body>/i, bridge + '</body>');
      previewAssets.prune(html);
      cancelTemplatePreview = watchTemplateFontPreview(q('#template-preview'), html, previewAssets);
      body.querySelectorAll('[data-template]').forEach(b => b.classList.toggle('active', b.dataset.template === item.slug));
    };
    const list = () => {
      const filter = q('#template-search').value.toLowerCase().trim();
      const items = templateLibrary.filter(t => `${t.name} ${t.slug} ${t.tagline} ${t.mood}`.toLowerCase().includes(filter));
      q('#template-list').innerHTML = items.map(t => `<button class="template-card ${t.slug === chosen.slug ? 'active' : ''}" data-template="${e(t.slug)}"><img class="template-cover" src="${templateCovers[t.slug]}" alt="${e(t.name)} · 第 1 页封面" width="480" height="270" loading="lazy" decoding="async"><strong>${e(t.name)}</strong><small>${e((t.mood || []).join(' · '))}</small><span>${t.slide_count} 页</span></button>`).join('') || '<p>未找到模板</p>';
    };
    q('#template-search').oninput = list;
    q('#template-list').onclick = event => {
      const button = event.target.closest('[data-template]');
      if (button) pick(templateLibrary.find(t => t.slug === button.dataset.template));
    };
    for (const [id, key] of [['prev', 'ArrowLeft'], ['next', 'ArrowRight']])
      q('#template-' + id).onclick = () => q('#template-preview').contentWindow.postMessage({ type: 'studio-template-key', key }, '*');
    q('#template-restart').onclick = () => pick(chosen);
    list(); pick(chosen);
    const resize = new ResizeObserver(() => { const frame = body.querySelector('#template-preview'); if (frame) frame.style.transform = `scale(${frame.parentElement.clientWidth/1280})`; });
    resize.observe(q('.template-preview-wrap'));
    // Remove a running preview on dismiss, including Escape.
    q('#dialog').addEventListener('close', () => {
      window.removeEventListener('message', previewPointer);
      document.removeEventListener('pointermove', outsidePreview, true);
      cancelTemplatePreview?.(); resize.disconnect(); previewFrame.remove(); previewAssets.prune('');
    }, { once: true });
  };

  Editor.prototype.showPageManager = function () {
    if (this.loading || this.preview || !this.pages?.pages.length) return;
    this.finishText?.();
    const editor = this, nav = this.pages;
    const body = modal('管理演示页面', `
      <p id="page-order-help">拖动左侧手柄调整单页顺序，移到列表边缘可自动滚动。也可聚焦手柄后按 Alt + ↑ / ↓ 移动。勾选页面可批量复制或删除，操作均可撤回。缩略图呈现当前静态编辑画面，动态播放请使用顶部预览。</p>
      <div class="page-manager-list" aria-label="演示页面顺序"></div>
      <div id="page-order-status" class="page-order-status" role="status" aria-live="polite">共 ${nav.pages.length} 页</div>
      <div class="authoring-toolbar"><label>插入位置 <select id="page-insert-position" aria-label="插入位置">${Array.from({length:nav.pages.length + 1}, (_, i) => `<option value="${i}">${i === 0 ? '最前面' : `第 ${i} 页之后`}</option>`).join('')}</select></label><span id="page-selection-count"></span></div>
      <p class="source-note">空白页沿用当前页的底色和尺寸；复制页保留内容与布局。排序不改页面内手写页码、目录或脚本中的固定索引，请在预览中核对跳转和备注。至少保留一页。</p>`, [
        { label: '关闭', run: closeModal },
        { label: '删除选中页', run: () => perform('delete') },
        { label: '复制选中页', run: () => perform('copy') },
        { label: '新增空白页', primary: true, run: () => perform('add') },
      ]);
    q('#dialog').dataset.kind = 'pages';
    bindPageOrder(editor, body, q('#dialog'));
    q('#page-insert-position').value = String(Math.max(0, nav.index + 1));
    const selected = () => [...body.querySelectorAll('[data-page-id]:checked')].map(n => n.dataset.pageId);
    const update = () => q('#page-selection-count').textContent = `已选 ${selected().length} 页`;
    body.querySelector('.page-manager-list').onchange = update; update();
    const perform = kind => {
      const position = Number(q('#page-insert-position').value), ids = selected();
      if (editor.pages !== nav || !nav.parent.isConnected) return;
      if (editor.changePages(kind, ids, position)) editor.showPageManager();
    };
  };
  // The destination is the final, zero-based page index. Move the original node
  // so stable IDs, descendants, bindings and the current page are retained.
  Editor.prototype.reorderPage = function (id, destination) {
    if (this.loading || this.preview || !Number.isInteger(destination)) return false;
    this.finishText?.();
    const nav = this.pages;
    if (!nav?.parent?.isConnected || nav.parent.ownerDocument !== this.doc) return false;
    nav.refresh();
    const all = [...nav.pages], page = all.find(p => this.id(p) === id), from = all.indexOf(page);
    if (!page || destination < 0 || destination >= all.length || from === destination) return false;
    if (this.locked(nav.parent) || this.locked(page)) { toast('页面或容器已锁定，请先解锁'); return false; }
    const rest = all.filter(p => p !== page);
    const anchor = rest[destination] || rest.at(-1).nextSibling;
    nav.parent.insertBefore(page, anchor);
    nav.parent.setAttribute('data-studio-pages', 'true');
    this.commit('调整页面顺序');
    toast(`已将第 ${from + 1} 页移至第 ${destination + 1} 页，可撤回`);
    return true;
  };
  Editor.prototype.changePages = function (kind, ids, position) {
    if (this.loading || this.preview || !this.pages?.pages.length) return false;
    this.finishText?.();
    const nav = this.pages, all = [...nav.pages], selected = all.filter(p => ids.includes(this.id(p)));
    if (!['add', 'copy', 'delete'].includes(kind)) return false;
    if (kind !== 'add' && !selected.length) { toast('请先勾选页面'); return false; }
    if (this.locked(nav.parent) || (kind === 'delete' && selected.some(p => this.locked(p)))) { toast('页面或容器已锁定，请先解锁'); return false; }
    if (kind === 'delete' && selected.length >= all.length) { toast('至少保留一页'); return false; }
    position = Math.max(0, Math.min(all.length, Number(position) || 0));
    const anchor = all[position] || all.at(-1).nextSibling;
    const templatePage = nav.current || all[0];
    const added = [];
    if (kind === 'delete') {
      const hasActive = selected.some(p => p.matches('.active,.is-active,.present,.visible,[data-deck-active]'));
      selected.forEach(p => p.remove());
      if (hasActive) {
        const survivor = all.find(p => p.isConnected);
        for (const name of ['active', 'is-active', 'present', 'visible']) if (selected.some(p => p.classList.contains(name))) survivor.classList.add(name);
      }
    } else {
      const sources = kind === 'copy' ? selected : [templatePage];
      for (const source of sources) {
        const clone = source.cloneNode(kind === 'copy');
        if (kind === 'add') {
          const style = this.style(source);
          Object.assign(clone.style, {background: style.backgroundColor, width: `${parseFloat(style.width) || this.width}px`, height: `${parseFloat(style.height) || this.height}px`});
          clone.dataset.title = '新页面'; clone.dataset.hsName = '新页面';
          clone.removeAttribute('aria-label');
        }
        this.remapClone(clone);
        clone.classList.remove('active', 'is-active', 'present', 'visible', 'prev', 'past', 'future');
        clone.removeAttribute('data-deck-active');
        nav.parent.insertBefore(clone, anchor);
        added.push(clone);
      }
    }
    nav.parent.setAttribute('data-studio-pages', 'true');
    annotate(this.doc); nav.refresh();
    nav.show(added.length ? nav.pages.indexOf(added[0]) : Math.max(0, nav.index));
    this.selection = []; this.commit(kind === 'delete' ? '删除页面' : kind === 'copy' ? '复制页面' : '新增页面');
    this.fit();
    toast(kind === 'delete' ? `已删除 ${selected.length} 页，可撤回` : `已${kind === 'copy' ? '复制' : '新增'} ${added.length} 页`);
    return true;
  };

  Editor.prototype.importVideo = async function (file) {
    if (this.loading) return;
    if (!file || !(/^(video\/)/i.test(file.type) || /\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(file.name))) return toast('请选择 MP4、WebM 或其他浏览器支持的视频文件');
    if (this.preview) this.togglePreview(false);
    this.finishText?.();
    const parent = this.pageRoot, version = this.loadVersion;
    if (this.locked(parent)) return toast('当前页面已锁定，请先解锁');
    const url = this.assets.addFile(file);
    const probe = document.createElement('video'); probe.preload = 'metadata';
    const result = await new Promise(resolve => {
      let timer;
      const done = ok => { clearTimeout(timer); probe.onloadedmetadata = null; probe.onerror = null; resolve({ok, width:probe.videoWidth, height:probe.videoHeight}); };
      probe.onloadedmetadata = () => done(true); probe.onerror = () => done(false);
      timer = setTimeout(() => done(false), 4000); probe.src = url;
    });
    probe.removeAttribute('src'); probe.load();
    if (version !== this.loadVersion || !parent.isConnected) return;
    const video = this.doc.createElement('video');
    video.src = url; video.controls = true; video.preload = 'metadata'; video.setAttribute('playsinline', '');
    video.dataset.hsId = uid(); video.dataset.hsName = file.name;
    const width = Math.min(640, this.width * 0.7);
    Object.assign(video.style, {position:'absolute', left:'60px', top:'60px', width:`${width}px`, height:`${width * (result.height || 360) / (result.width || 640)}px`, objectFit:'contain', background:'#18181b'});
    if (parent !== this.doc.body && this.style(parent).position === 'static') parent.style.position = 'relative';
    parent.append(video); this.selection = [this.id(video)]; this.commit('插入视频');
    toast(result.ok ? '视频已嵌入；点击预览播放，保存与导出会携带视频' : '视频已插入，但当前浏览器未能读取视频信息；请预览检查编码，推荐 MP4（H.264）或 WebM');
  };
}
