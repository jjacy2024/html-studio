import { AssetStore } from './assets.js';
import { fontLibrary } from './font-cache.js';
import { localizeTemplateFonts, templateFontIds, onlineTemplateFonts } from './template-fonts.js';

export function installFontSupport(Editor, {modal, closeModal, toast}) {
  const q = selector => document.querySelector(selector);
  Editor.prototype.refreshTemplateFontStyles = function () {
    if (!this.doc || this.loading) return;
    let changed = false;
    for (const style of this.doc.querySelectorAll('style')) {
      if (!style.textContent.includes('studio-font:')) continue;
      const text = localizeTemplateFonts(style.textContent, this.assets);
      if (text !== style.textContent) { style.textContent = text; changed = true; }
    }
    if (changed) {
      const doc = this.doc;
      doc.fonts.ready.then(() => { if (this.doc === doc && !this.loading) this.draw(); });
      this.scheduleDraft();
    }
    this.renderFontStatus();
  };
  Editor.prototype.pendingTemplateFonts = function () {
    return templateFontIds([...this.doc?.querySelectorAll('style') || []].map(style=>style.textContent).join('\n')).filter(id=>!fontLibrary.has(id));
  };
  Editor.prototype.renderFontStatus = function () {
    const button = q('#font-status');
    if (!button) return;
    const state = fontLibrary.status(), missing = this.pendingTemplateFonts().length;
    button.textContent = missing ? (state.paused || state.blocked ? '字体待下载' : '字体下载中') : '字体已就绪';
    button.classList.toggle('has-issues', missing > 0);
    button.title = missing ? `当前模板还有 ${missing} 个字体分片未就绪，暂用系统替代字体；点击管理下载` : `当前文档的模板字体已就绪；字体库 ${state.ready}/${state.total}，点击管理`;
    this.updateFontDialog?.();
  };
  Editor.prototype.showFontLibrary = function () {
    const body = modal('模板字体与离线缓存', `
      <p>内置 Inter、Space Grotesk、JetBrains Mono。其余模板字体在后台下载，当前模板优先；下载完成后自动更新显示，不打断编辑。</p>
      <p id="font-library-state" aria-live="polite"></p><progress id="font-library-progress" style="width:100%"></progress>
      <p id="font-document-state"></p><p id="font-cache-state" class="source-note"></p>
      <div class="authoring-toolbar"><button class="text-button" id="font-resume">继续下载 / 重试</button><button class="text-button" id="font-pause">暂停下载</button></div>
      <p class="source-note">首次下载需要能访问 Google Fonts 文件服务。未下载时沿用模板的系统替代字体，排版可能暂时变化。缓存属于当前浏览器；换浏览器、清理网站数据或使用隐私模式可能需要重新下载。保存工程和导出 HTML 会检查并携带文档所需字体。</p>`, [{label:'关闭',run:closeModal}]);
    q('#dialog').dataset.kind = 'fonts';
    const update = () => {
      if (!body.isConnected || q('#dialog').dataset.kind !== 'fonts') return;
      const s = fontLibrary.status(), missing = this.pendingTemplateFonts().length;
      q('#font-library-state').textContent = `字体库：${s.ready} / ${s.total} 个分片已就绪 · ${(s.bytes/1e6).toFixed(1)} / ${(s.totalBytes/1e6).toFixed(1)} MB${s.paused?' · 已暂停':s.blocked?' · 下载未完成，请检查网络后重试':s.active?' · 后台下载中':''}`;
      q('#font-library-progress').max = s.total; q('#font-library-progress').value = s.ready;
      q('#font-document-state').textContent = missing ? `当前文档：${missing} 个字体分片待下载，暂用系统替代字体。` : '当前文档：模板字体已就绪，可离线保存和导出。';
      q('#font-cache-state').textContent = s.persistent ? '已下载的字体缓存在本机，下次在同一浏览器打开可离线复用。系统字体继续使用电脑已有字体。' : '浏览器持久缓存不可用：已下载字体仅在本次打开期间可用，请保存工程以携带字体。';
      q('#font-pause').disabled = s.paused;
    };
    this.updateFontDialog = update;
    q('#font-resume').onclick = () => { fontLibrary.resume(); fontLibrary.request(this.pendingTemplateFonts()); update(); };
    q('#font-pause').onclick = () => { fontLibrary.pause(); update(); };
    update();
    q('#dialog').addEventListener('close', () => { if (this.updateFontDialog === update) this.updateFontDialog = null; }, {once:true});
  };
  Editor.prototype.portableHTML = async function (html, {missingFonts='prompt'} = {}) {
    // Capture document resources before waiting: editing or switching documents
    // during a slow download cannot alter the requested export snapshot.
    html = await this.assets.embed(html);
    const assets = new AssetStore();
    try {
      const ids = templateFontIds(html);
      if (missingFonts==='prompt'&&ids.some(id=>!fontLibrary.has(id))) toast('正在准备文档字体，完成后继续保存；编辑仍可使用');
      let missing = await fontLibrary.ensure(ids);
      while (missing.length) {
        if(missingFonts==='online')break;
        if(missingFonts==='error')throw Object.assign(Error('文档字体尚未全部下载，请下载后重试，或明确选择保留在线字体。'),{code:'MISSING_FONTS',details:{missing}});
        const choice = await new Promise(resolve => {
          let settled = false;
          const dialog = q('#dialog');
          const finish = value => { if (settled) return; settled = true; dialog.removeEventListener('close', cancel); closeModal(); resolve(value); };
          const cancel = () => finish('cancel');
          modal('部分模板字体尚未下载', `<p>当前文件还有 ${missing.length} 个字体分片未就绪。完整离线文件需要这些字体。</p><p>可以联网后重试，或者继续保存并保留未下载字体的在线链接；后者在离线打开时可能使用替代字体。</p>`, [
            {label:'取消',run:()=>finish('cancel')},
            {label:'保留在线字体并继续',run:()=>finish('online')},
            {label:'重试下载',primary:true,run:()=>finish('retry')},
          ]);
          dialog.dataset.kind = 'font-export'; dialog.addEventListener('close',cancel,{once:true});
        });
        if (choice === 'cancel') return null;
        if (choice === 'online') break;
        fontLibrary.resume(); missing = await fontLibrary.ensure(ids);
      }
      return await assets.embed(onlineTemplateFonts(localizeTemplateFonts(html, assets)));
    } finally { assets.prune(''); }
  };
}
