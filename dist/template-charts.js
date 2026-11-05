import {mountChartStructure,focusStructureChange,structureTransaction} from './chart-structure.js';
import {htmlBarPreviewHTML} from './html-bars.js';
import {readTemplateChart,updateTemplateChart,changeTemplateChartStructure} from './template-charts-core.js';
import {mountChartPaints} from './chart-paints.js';
import {bindDataPaste,pasteNumber} from './data-paste.js';
import {escapeHTML} from './document.js';
export function templateChartTarget(source) {
  if(!source)return null;const parent=source.closest('[data-studio-template-chart]');if(parent)return parent;
  const charts=source.querySelectorAll('[data-studio-template-chart]');return charts.length===1?charts[0]:null;
}
export function templateChartDataTarget(root,target) {
  if(target===root||target.closest('[data-studio-tc-overlay]'))return true;
  let m;try{m=readTemplateChart(root);}catch{return false;}
  const keys=new Set(m.items.flatMap(i=>[...(i.actions||[]),...(i.labels||[]),...(i.paints||[])].map(a=>a.key).concat(i.cells||[])));
  for(const p of m.paths||[])p.keys.forEach(k=>keys.add(k));for(const p of m.pies||[])for(const k of p.keys||[p.key])keys.add(k);
  const node=target.closest('[data-studio-tc-key]');return !!node&&keys.has(node.getAttribute('data-studio-tc-key'));
}
export function installTemplateCharts(Editor,{modal,closeModal}) {
  Editor.prototype.openTemplateChartEditor=function(root){
    if(!root||this.loading||this.preview||this.locked(root))return false;this.finishText?.();
    let model;try{model=readTemplateChart(root);}catch(e){return false;}
    const editor=this,version=this.loadVersion;let disposed=false;const valid=()=>!disposed&&root.isConnected&&root.ownerDocument===editor.doc&&version===editor.loadVersion&&!editor.preview&&!editor.locked(root)&&!root.querySelector('[data-hs-locked="true"]');
    const body=modal('编辑图表数据 · 保留样式',`<p>${model.relative?'相对数值：原模板没有完整数值，已按图形比例初始化；这些数值不是原始业务数据。':'已绑定模板数据；数字与图形比例同步更新。'}${model.kind==='donut'?'环形图按各项数值之和重新计算占比。':''}</p><div class="data-editor-workspace with-chart"><div class="data-grid-scroll"><table class="data-grid" id="template-chart-grid"><thead><tr><th>数据元素</th><th>数值</th></tr></thead><tbody>${model.items.map((item,i)=>`<tr><th>${escapeHTML(item.name)}</th><td><input data-template-value="${i}" value="${item.value}" aria-label="${escapeHTML(item.name)}数值" inputmode="decimal"></td></tr>`).join('')}</tbody></table></div><div class="data-live-preview"><span>原图实时预览</span><div id="template-chart-preview"><iframe title="图表实时预览" sandbox=""></iframe></div></div></div><p id="template-chart-status" role="status"></p><p class="source-note">保留原节点、字体、边框和排布。修改立即反映到画布；进入页面时从零过渡到最新数据，导出后仍有效。${model.structure?'可增删分类并沿用所选项样式；':'此图保留现有数据元素数量；'}支持批量粘贴数值。表格及独立指标卡不会随本图变化。</p>`,[{label:'完成',primary:true,run:closeModal}]);
    document.querySelector('#dialog').dataset.kind='template-chart-data';let pending=false,previewTimer,cancelPreview;
    const preview=()=>{if(!valid())return;const p=htmlBarPreviewHTML(root),frame=body.querySelector('#template-chart-preview iframe'),holder=frame.parentElement,scale=Math.min(holder.clientWidth/p.width,340/p.height);Object.assign(frame.style,{width:p.width+'px',height:p.height+'px',transform:`scale(${scale})`,transformOrigin:'0 0',border:'0'});holder.style.height=p.height*scale+'px';holder.style.overflow='hidden';cancelPreview?.();cancelPreview=editor.assets.preview(frame,p.html);};
    const resize=new ResizeObserver(()=>{clearTimeout(previewTimer);previewTimer=setTimeout(preview,50);});resize.observe(body.querySelector('.data-live-preview'));

    const flush=()=>{if(pending&&valid()){pending=false;editor.commit('修改模板图表数据');}};
    const apply=(next,commit=false)=>{if(!valid())throw Error('图表已锁定或工程已变化');updateTemplateChart(root,next);model=next;pending=true;editor.draw();clearTimeout(previewTimer);previewTimer=setTimeout(preview,80);if(commit)flush();};
    body.querySelector('#template-chart-grid').addEventListener('input',event=>{const input=event.target;if(!input.matches('[data-template-value]'))return;try{const next=structuredClone(model);next.items[Number(input.dataset.templateValue)].value=pasteNumber(input.value);apply(next);input.removeAttribute('aria-invalid');body.querySelector('#template-chart-status').textContent='已更新画布';}catch(e){input.setAttribute('aria-invalid','true');body.querySelector('#template-chart-status').textContent=e.message;}});
    body.querySelector('#template-chart-grid').addEventListener('change',flush);
    bindDataPaste(body.querySelector('#template-chart-grid'),{valid,rowNames:()=>model.items.map(i=>i.name),columnNames:()=>['数值'],apply(changes){const next=structuredClone(model);for(const c of changes)next.items[c.row].value=pasteNumber(c.raw);flush();apply(next,true);body.querySelectorAll('[data-template-value]').forEach((input,i)=>input.value=model.items[i].value);}});
    if(model.structure)mountChartStructure(body,{rows:model.items.map(i=>i.name),valid,maxRows:100,columnHint:'单系列分类可增删；数值列为固定维度。',change:change=>{if(!valid())return;flush();model=structureTransaction(root,()=>changeTemplateChartStructure(editor,root,model,change));editor.commit('调整模板图表分类');closeModal();editor.openTemplateChartEditor(root);focusStructureChange(change);}});
    mountChartPaints(body,{valid,items:()=>model.items.map((item,index)=>{const path=model.paths?.find(p=>p.rows.includes(index));const p=item.paints?.[0]||(item.cells?{key:item.cells[0],property:'background-color'}:path?{key:path.area||path.keys[0],property:path.area?'fill':'stroke'}:null),node=p?root.querySelector(`[data-studio-tc-key="${p.key}"]`):null;return{...item,index,color:item.color||(node?editor.style(node).getPropertyValue(p.property||'fill'):null)};}),change(item,color){flush();const next=structuredClone(model);if(color)next.items[item.index].color=color;else delete next.items[item.index].color;apply(next,true);}});
    const dialog=document.querySelector('#dialog');const onClose=()=>{if(!dialog.open)dispose();};const dispose=()=>{if(disposed)return;flush();disposed=true;clearTimeout(previewTimer);cancelPreview?.();resize.disconnect();dialog.removeEventListener('close',onClose);if(dialog.flushData===flush)delete dialog.flushData;if(dialog.disposeContent===dispose)delete dialog.disposeContent;};dialog.flushData=flush;dialog.disposeContent=dispose;dialog.addEventListener('close',onClose);preview();return true;
  };
}
