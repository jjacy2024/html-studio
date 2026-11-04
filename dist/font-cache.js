import { bundledFontFiles, bundledFontSources, bundledFontSummary } from './template-font-data.js';

// A separate database keeps the reusable library independent of document drafts.
// Only verified font bytes enter either persistent storage or a document.
class FontLibrary {
  constructor() {
    this.blobs = new Map();
    this.queue = [];
    this.pending = new Map();
    this.failures = new Set();
    this.listeners = new Set();
    this.controllers = new Set();
    this.active = 0;
    this.paused = false;
    this.networkBlocked = false;
    this.consecutiveFailures = 0;
    this.persistent = true;
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      for (const fn of this.listeners) fn();
    }, 100);
  }
  has(id) { return !!bundledFontFiles[id] || this.blobs.has(id); }
  blob(id) {
    if (!this.blobs.has(id) && bundledFontFiles[id]) {
      const data = atob(bundledFontFiles[id]);
      this.blobs.set(id, new Blob([Uint8Array.from(data, c => c.charCodeAt(0))], {type:'font/woff2'}));
    }
    return this.blobs.get(id);
  }
  async valid(id, blob) {
    if (!(blob instanceof Blob) || blob.size !== bundledFontSources[id]?.bytes) return false;
    const bytes = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('') === id;
  }
  initialize() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      try {
        this.db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('html-studio-font-library', 1);
          const timer = setTimeout(() => reject(Error('字体缓存不可用')), 2000);
          request.onupgradeneeded = () => request.result.createObjectStore('fonts', {keyPath:'id'});
          request.onerror = () => { clearTimeout(timer); reject(request.error); };
          request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
        });
        const rows = await new Promise((resolve, reject) => {
          const request = this.db.transaction('fonts').objectStore('fonts').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        for (const row of rows) {
          if (bundledFontSources[row.id] && !bundledFontFiles[row.id] && await this.valid(row.id, row.blob)) this.blobs.set(row.id, row.blob);
        }
      } catch { this.persistent = false; }
      this.initialized = true;
      this.emit();
    })();
    return this.ready;
  }
  async persist(id, blob) {
    if (!this.db || !this.persistent) return;
    try {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('fonts', 'readwrite');
        tx.objectStore('fonts').put({id, blob});
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } catch { this.persistent = false; }
  }
  async request(ids, priority = true, retry = false) {
    await this.initialize();
    const jobs = [];
    for (const id of new Set(ids)) {
      if (this.has(id) || !bundledFontSources[id]) continue;
      if (retry) this.failures.delete(id);
      if (this.failures.has(id)) continue;
      let task = this.pending.get(id);
      if (!task) {
        let resolve;
        const promise = new Promise(done => resolve = done);
        task = {id, resolve, promise};
        this.pending.set(id, task);
        if (priority) this.queue.unshift(task); else this.queue.push(task);
      } else if (priority && this.queue.includes(task)) {
        this.queue.splice(this.queue.indexOf(task), 1); this.queue.unshift(task);
      }
      jobs.push(task.promise);
    }
    this.pump(); this.emit();
    return Promise.all(jobs);
  }
  pump() {
    if (this.paused || this.networkBlocked || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    while (this.active < 2 && this.queue.length) {
      const task = this.queue.shift();
      if (this.has(task.id)) { this.pending.delete(task.id); task.resolve(true); continue; }
      this.active++;
      this.fetchFont(task).finally(() => { this.active--; this.pump(); this.emit(); });
    }
  }
  async fetchFont(task) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 8000);
    let success = false;
    try {
      const response = await fetch(bundledFontSources[task.id].url, {signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer'});
      if (!response.ok) throw Error('字体下载失败');
      const blob = new Blob([await response.arrayBuffer()], {type:'font/woff2'});
      if (!await this.valid(task.id, blob)) throw Error('字体校验失败');
      this.blobs.set(task.id, blob);
      await this.persist(task.id, blob);
      this.failures.delete(task.id);
      this.consecutiveFailures = 0;
      success = true;
    } catch {
      if (!this.paused) {
        this.failures.add(task.id);
        if (++this.consecutiveFailures >= 3) this.networkBlocked = true;
      }
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
      this.pending.delete(task.id);
      task.resolve(success);
      if (this.networkBlocked || this.paused || !navigator.onLine) {
        for (const queued of this.queue.splice(0)) { this.pending.delete(queued.id); queued.resolve(false); }
      }
    }
  }
  pause() {
    this.paused = true;
    for (const controller of this.controllers) controller.abort();
    for (const task of this.queue.splice(0)) { this.pending.delete(task.id); task.resolve(false); }
    this.emit();
  }
  resume() {
    this.paused = false; this.networkBlocked = false; this.consecutiveFailures = 0; this.failures.clear();
    this.request(Object.keys(bundledFontSources), false);
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.initialize();
    // Delay prefetch until the editor is usable; document requests jump the queue.
    this.startTimer = setTimeout(() => { if (!this.paused) this.request(Object.keys(bundledFontSources), false); }, 2500);
    window.addEventListener('online', () => { if (!this.paused) this.resume(); });
    window.addEventListener('offline', () => this.emit());
  }
  async ensure(ids, timeout = 20000) {
    await this.initialize();
    if (ids.every(id=>this.has(id))) return [];
    if (!navigator.onLine || this.paused) return ids.filter(id=>!this.has(id));
    this.networkBlocked = false; this.consecutiveFailures = 0;
    let timer;
    await Promise.race([this.request(ids, true, true), new Promise(resolve=>timer=setTimeout(resolve, timeout))]);
    clearTimeout(timer);
    return ids.filter(id=>!this.has(id));
  }
  status() {
    const ids = Object.keys(bundledFontSources), ready = ids.filter(id=>this.has(id));
    return {total:ids.length, ready:ready.length, bytes:ready.reduce((sum,id)=>sum+bundledFontSources[id].bytes,0),
      totalBytes:bundledFontSummary.bytes, embedded:bundledFontSummary.embeddedFiles,
      active:this.active, queued:this.queue.length, failed:this.failures.size, paused:this.paused,
      blocked:this.networkBlocked || !navigator.onLine, persistent:this.persistent, initialized:!!this.initialized};
  }
}
export const fontLibrary = new FontLibrary();
