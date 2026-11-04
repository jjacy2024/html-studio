import { escapeHTML } from './document.js';
import { bindPageThumbnails } from './page-thumbnails.js';

// Pointer events work for mouse, pen and touch, including in the file:// build.
// Only handles initiate a drag; the checkbox label keeps its original behavior.
export function bindPageOrder(editor, body, dialog) {
  const nav = editor.pages, version = editor.loadVersion;
  const list = body.querySelector('.page-manager-list');
  const status = body.querySelector('#page-order-status');
  const controller = new AbortController(), signal = controller.signal;
  let drag = null, frame = 0, disposed = false;
  const valid = () => !disposed && dialog.open && dialog.dataset.kind === 'pages' &&
    editor.pages === nav && editor.loadVersion === version && !editor.loading && !editor.preview &&
    nav.parent?.isConnected && nav.parent.ownerDocument === editor.doc;
  const thumbnails = bindPageThumbnails(editor,list,valid);
  const render = (checked = new Set([editor.id(nav.current)])) => {
    const scroll = list.scrollTop;
    list.innerHTML = nav.pages.map((p, i) => {
      const id = escapeHTML(editor.id(p)), title = escapeHTML(nav.title(p, i));
      const locked = editor.locked(nav.parent) || editor.locked(p);
      return `<div class="page-manager-row" data-order-id="${id}">
        <button type="button" class="page-drag-handle" aria-label="移动第 ${i + 1} 页：${title}" aria-describedby="page-order-help" title="${locked ? '页面已锁定，请先解锁' : '拖动调整顺序；Alt + ↑ / ↓ 移动'}" ${locked || nav.pages.length < 2 ? 'disabled' : ''}>⠿</button>
        <label><input type="checkbox" data-page-id="${id}" ${checked.has(editor.id(p)) ? 'checked' : ''}><span class="page-thumbnail" data-state="idle" aria-hidden="true"><span class="page-thumbnail-note">页面预览</span></span><span>${String(i + 1).padStart(2, '0')}</span><strong>${title}</strong>${p === nav.current ? '<small>当前页</small>' : ''}</label></div>`;
    }).join('');
    list.scrollTop = scroll;
    thumbnails.refresh();
  };
  const clearIndicators = () => list.querySelectorAll('.drop-before,.drop-after').forEach(r => r.classList.remove('drop-before', 'drop-after'));
  const stop = () => {
    const old = drag; drag = null;
    cancelAnimationFrame(frame); frame = 0;
    list.classList.remove('is-dragging'); clearIndicators();
    old?.row.classList.remove('is-drag-source');
    if (old?.handle.hasPointerCapture(old.pointerId)) old.handle.releasePointerCapture(old.pointerId);
    return old;
  };
  const move = (id, to, keyboard = false) => {
    if (!valid()) return false;
    const checked = new Set([...list.querySelectorAll('input:checked')].map(n => n.dataset.pageId));
    if (!editor.reorderPage(id, to)) return false;
    render(checked);
    const row = [...list.children].find(r => r.dataset.orderId === id);
    row?.querySelector('button').focus({preventScroll:true});
    row?.scrollIntoView({block:'nearest'});
    status.textContent = `已移到第 ${to + 1} 页，共 ${nav.pages.length} 页${keyboard ? '' : '。可继续拖动排序'}`;
    return true;
  };
  const locate = () => {
    clearIndicators();
    if (!drag?.active) return;
    const bounds = list.getBoundingClientRect();
    const inside = drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom;
    drag.to = null;
    if (!inside) { status.textContent = '移回列表放置；松开或按 Esc 取消本次拖动'; return; }
    const rows = [...list.children].filter(r => r !== drag.row);
    let to = rows.findIndex(r => {const b = r.getBoundingClientRect(); return drag.y < b.top + b.height / 2;});
    if (to < 0) to = rows.length;
    drag.to = to;
    if (to === drag.from) { status.textContent = `第 ${drag.from + 1} 页：位置未改变`; return; }
    const anchor = rows[to] || rows.at(-1);
    anchor?.classList.add(rows[to] ? 'drop-before' : 'drop-after');
    status.textContent = `松开移到第 ${to + 1} 页；Esc 取消`;
  };
  const tick = () => {
    if (!drag?.active) return;
    if (!valid()) { stop(); return; }
    const b = list.getBoundingClientRect();
    if (drag.x >= b.left && drag.x <= b.right && drag.y >= b.top && drag.y <= b.bottom) {
      const edge = Math.min(44, b.height / 4);
      const delta = drag.y < b.top + edge ? -Math.min(12, (b.top + edge - drag.y) / 3) :
        drag.y > b.bottom - edge ? Math.min(12, (drag.y - b.bottom + edge) / 3) : 0;
      if (delta) list.scrollTop += delta;
    }
    locate(); frame = requestAnimationFrame(tick);
  };
  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.page-drag-handle');
    if (!handle || handle.disabled || event.button !== 0 || !event.isPrimary || drag || !valid()) return;
    event.preventDefault(); handle.focus({preventScroll:true});
    const row = handle.closest('.page-manager-row');
    drag = {handle, row, id:row.dataset.orderId, pointerId:event.pointerId, from:[...list.children].indexOf(row),
      startX:event.clientX, startY:event.clientY, x:event.clientX, y:event.clientY, to:null, active:false};
    handle.setPointerCapture(event.pointerId);
  }, {signal});
  list.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 5) {
      drag.active = true; drag.row.classList.add('is-drag-source'); list.classList.add('is-dragging'); tick();
    }
    if (drag.active) {event.preventDefault(); locate();}
  }, {signal});
  list.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY; locate();
    const old = stop();
    if (old.active && old.to !== null && move(old.id, old.to)) return;
    status.textContent = old.active ? '页序未改变' : `共 ${nav.pages.length} 页`;
  }, {signal});
  const cancel = () => {if (drag) {stop(); status.textContent = '已取消拖动，页序未改变';}};
  list.addEventListener('pointercancel', cancel, {signal});
  list.addEventListener('lostpointercapture', cancel, {signal});
  window.addEventListener('blur', cancel, {signal});
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) {event.preventDefault(); event.stopPropagation(); cancel(); return;}
    const handle = event.target.closest('.page-drag-handle');
    if (drag || !handle || handle.disabled || !event.altKey || !['ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const row = handle.closest('.page-manager-row'), from = [...list.children].indexOf(row);
    move(row.dataset.orderId, from + (event.key === 'ArrowUp' ? -1 : 1), true);
  }, {signal,capture:true});
  const dispose = () => {
    disposed = true; stop(); controller.abort(); thumbnails.dispose();
    if (dialog.disposeContent === dispose) delete dialog.disposeContent;
  };
  dialog.disposeContent = dispose;
  dialog.addEventListener('close', dispose, {signal});
  render();
}
