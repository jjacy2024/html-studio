import { installPreviewRuntime } from './preview-runtime.js';

// Keep binary resources outside edit/history snapshots.
export class AssetStore {
  constructor() {
    this.entries = new Map();
    this.files = new WeakMap();
    this.persisted = new Set();
    this.previewData = new WeakMap();
  }
  add(blob, id = crypto.randomUUID()) {
    const url = URL.createObjectURL(blob);
    this.entries.set(url, { id, url, blob });
    return url;
  }
  addFile(file) {
    let url = this.files.get(file);
    if (!this.entries.has(url)) {
      url = this.add(file);
      this.files.set(file, url);
    }
    return url;
  }
  urls(html) {
    return new Set(html.match(/blob:[a-zA-Z0-9:/._-]+/g) || []);
  }
  references(html) {
    return [...this.urls(html)].map((url) => this.entries.get(url)).filter(Boolean);
  }
  async compact(html) {
    if (!/data:(?:image|video|audio|font|application)\//i.test(html)) return html;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const converted = new Map();
    const resource = async (url) => {
      if (!/^data:(?:image|video|audio|font|application)\//i.test(url)) return url;
      if (!converted.has(url)) {
        try { converted.set(url, this.add(await (await fetch(url)).blob())); }
        catch { converted.set(url, url); }
      }
      return converted.get(url);
    };
    const css = async (text) => {
      const matches = [...text.matchAll(/url\(\s*(['"]?)(data:[^)'"\s]+)\1\s*\)/gi)];
      for (const m of matches) text = text.replace(m[0], `url("${await resource(m[2])}")`);
      return text;
    };
    for (const el of doc.querySelectorAll("[src],[poster],svg image[href],link[rel=icon][href],[data-studio-chartjs-image]")) {
      for (const attr of ["src", "poster", "href", "data-studio-chartjs-image"])
        if (el.hasAttribute(attr)) el.setAttribute(attr, await resource(el.getAttribute(attr)));
    }
    for (const el of doc.querySelectorAll("style")) el.textContent = await css(el.textContent);
    for (const el of doc.querySelectorAll("[style]")) el.setAttribute("style", await css(el.getAttribute("style")));
    return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  }
  restore(html, entries) {
    const urls = new Map();
    for (const entry of entries || []) {
      if (!(entry.blob instanceof Blob)) continue;
      urls.set(entry.url, this.add(entry.blob, entry.id));
      this.persisted.add(entry.id);
    }
    return html.replace(/blob:[a-zA-Z0-9:/._-]+/g, (url) => urls.get(url) || url);
  }
  async embed(html) {
    const urls = new Map();
    for (const entry of this.references(html)) {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(entry.blob);
      });
      urls.set(entry.url, data);
    }
    return html.replace(/blob:[a-zA-Z0-9:/._-]+/g, (url) => urls.get(url) || url);
  }
  preview(frame, html, {onStatus,loader:requestedLoader} = {}) {
    const token = crypto.randomUUID();
    const entries = this.references(html).map(({ url, blob }) => ({ url, blob }));
    // Native srcdoc navigation runs scripts as part of ordinary HTML parsing.
    // Bound embedding overhead; large media keeps the existing Blob transfer path.
    const occurrences = new Map();
    for(const url of html.match(/blob:[a-zA-Z0-9:/._-]+/g)||[])occurrences.set(url,(occurrences.get(url)||0)+1);
    const embeddedSize = html.length + entries.reduce((n,e)=>n+(128+Math.ceil(e.blob.size*4/3))*(occurrences.get(e.url)||0),0);
    const native = requestedLoader!=='transfer' && embeddedSize <= 16*1024*1024;
    const loader = native ? 'native' : 'transfer';
    let mounted = false, sent = false, cancelled = false, pendingPairs = [], pendingEntries = [];
    const inspections = new Map();
    const boundedDetails = value => {
      try { const text=JSON.stringify(value);if(text?.length<=16000)return JSON.parse(text); } catch {}
      return null;
    };
    const report = status => { if (!cancelled) onStatus?.({...status,details:status.details||{loader}}); };
    report({state:'loading'});
    const timeout = setTimeout(() => report({state:'slow',message:'预览加载时间较长，可以重新播放；若持续空白，请查看诊断。'}),8000);
    const flush = () => {
      if (!mounted || !pendingPairs.length) return;
      frame.contentWindow.postMessage({token,fontCSS:true,pairs:pendingPairs,entries:pendingEntries},'*');
      pendingPairs=[]; pendingEntries=[];
    };
    const ready = event => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.previewInspection === token) {
        inspections.get(event.data.request)?.(boundedDetails(event.data.details));return;
      }
      if (event.data?.previewStatus === token) {
        const state=event.data.state;
        if(!['loading','ready','slow','error','empty'].includes(state))return;
        if(state!=='loading')clearTimeout(timeout);
        // Diagnostics are displayed as text only. Bound messages from page code.
        const details=boundedDetails(event.data.details);
        report({state,message:String(event.data.message||'').slice(0,1000),details});return;
      }
      if(event.data?.previewMounted===token){mounted=true;flush();return;}
      if(native||event.data?.previewReady!==token||sent)return;
      sent=true;frame.contentWindow.postMessage({token,html,entries},'*');
    };
    window.addEventListener('message',ready);
    if(native){
      // Navigate only once, after resources are ready. A placeholder srcdoc
      // navigation can race the real document in a newly attached frame.
      (async()=>{
        const urls=new Map();
        for(const entry of entries){
          if(cancelled)return;
          let data=this.previewData.get(entry.blob);
          if(!data){
            data=new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(entry.blob);});
            this.previewData.set(entry.blob,data);
            data.catch(()=>this.previewData.delete(entry.blob));
          }
          urls.set(entry.url,await data);
        }
        if(cancelled)return;
        const content=html.replace(/blob:[a-zA-Z0-9:/._-]+/g,url=>urls.get(url)||url);
        const doc=new DOMParser().parseFromString(content,'text/html'),script=doc.createElement('script');
        script.dataset.studioPreviewRuntime='true';
        script.textContent=`(${installPreviewRuntime.toString()})(${JSON.stringify(token)},'native');`;
        doc.head.prepend(script);
        frame.srcdoc='<!DOCTYPE html>\n'+doc.documentElement.outerHTML;
      })().catch(error=>{clearTimeout(timeout);report({state:'error',message:'预览资源准备失败：'+String(error.message||error)});});
    }else{
      frame.srcdoc=`<!doctype html><script>
        (()=>{
          const token=${JSON.stringify(token)};
          const receive=event=>{
            if(event.source!==parent||event.data?.token!==token)return;
            removeEventListener('message',receive);
            try{
              const data=event.data,urls=new Map(data.entries.map(e=>[e.url,URL.createObjectURL(e.blob)]));
              const html=data.html.replace(/blob:[a-zA-Z0-9:/._-]+/g,url=>urls.get(url)||url);
              document.open();
              (${installPreviewRuntime.toString()})(token,'transfer');
              document.write(html);document.close();
            }catch(error){parent.postMessage({previewStatus:token,state:'error',message:String(error.message||error)},'*');}
          };
          addEventListener('message',receive);parent.postMessage({previewReady:token},'*');
        })();
      <\/script>`;
    }
    const cancel=()=>{cancelled=true;clearTimeout(timeout);window.removeEventListener('message',ready);for(const finish of inspections.values())finish(null);};
    cancel.inspect=()=>new Promise(resolve=>{
      if(cancelled){resolve(null);return;}
      const request=crypto.randomUUID();
      const timer=setTimeout(()=>finish(null),700);
      const finish=value=>{clearTimeout(timer);inspections.delete(request);resolve(value);};
      inspections.set(request,finish);
      frame.contentWindow.postMessage({token,inspect:request},'*');
    });
    cancel.updateCSS=(pairs,updates)=>{pendingPairs.push(...pairs);pendingEntries.push(...updates.map(({url,blob})=>({url,blob})));flush();};
    return cancel;
  }
  prune(html) {
    const keep = this.urls(html);
    for (const url of this.entries.keys()) if (!keep.has(url)) {
      URL.revokeObjectURL(url);
      this.entries.delete(url);
    }
  }
}
