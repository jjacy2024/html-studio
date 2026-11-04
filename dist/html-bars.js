import {focusStructureChange,mountChartStructure,structureTransaction,structureClone,structureText,updateKnownChartMotion} from './chart-structure.js';
import {bindDataPaste,pasteNumber} from './data-paste.js';
import {escapeHTML} from './document.js';
import {analyzeHTMLShares,htmlShareTarget,htmlShareElements,bindHTMLShares,updateHTMLShares} from './html-share.js';

const HTML_BAR_MODEL='data-studio-html-chart',HTML_BAR_KEY='data-studio-html-key';
export function htmlBarNumber(text) {
  const m=String(text).trim().replaceAll('−','-').match(/^([$¥￥€£]?\s*)([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s*(?:%|％|[kKmMbB]|万|亿|元)?)$/);
  if(!m)return null;const value=Number(m[2].replaceAll(',',''));
  if(!Number.isFinite(value)||Math.abs(value)>1e12)return null;
  return {value,format:{prefix:m[1],suffix:m[3],comma:m[2].includes(','),decimals:(m[2].split('.')[1]||'').length}};
}
function htmlBarDisplay(value,f) {return f.prefix+value.toLocaleString('en-US',{useGrouping:f.comma,minimumFractionDigits:Math.min(f.decimals,8),maximumFractionDigits:Math.min(8,Math.max(f.decimals,6))})+f.suffix;}
function htmlBarLeaf(el) {
  const leaves=[],walker=el.ownerDocument.createTreeWalker(el,4);while(walker.nextNode())if(walker.currentNode.textContent.trim())leaves.push(walker.currentNode);
  return leaves.length===1?leaves[0]:null;
}
function htmlBarSize(el,prop) {
  const data=el.getAttribute('data-'+prop),raw=data!==null?data+'%':el.style.getPropertyValue(prop);
  const m=raw?.trim().match(/^([\d.]+)(%|px|vh|vw|rem|em)$/);return m&&Number(m[1])>=0?{amount:Number(m[1]),unit:m[2],data:data!==null}:null;
}
function htmlBarCandidates(root) {
  const nodes=[root,...root.querySelectorAll('*')];
  if(nodes.length>3000)return [];
  const candidates=nodes.filter(el=>el.namespaceURI==='http://www.w3.org/1999/xhtml'&&!el.matches('script,style,input,canvas,svg')&&
    /(?:^|[-_\s])(?:bar|fill|column)(?:$|[-_\s])/.test(el.className)&&
    (htmlBarSize(el,'width')||htmlBarSize(el,'height')));
  return candidates.filter(el=>!candidates.some(other=>other!==el&&el.contains(other)));
}
export function analyzeHTMLBars(root) {
  const share=analyzeHTMLShares(root);if(share)return share;
  if(!root||root.matches('svg,canvas')||root.querySelector('svg,canvas'))return {error:'请选择只包含 HTML/CSS 柱形的图表容器。'};
  const candidates=htmlBarCandidates(root);if(candidates.length<2||candidates.length>100)return {error:'尚未识别到可对应数值的 HTML/CSS 柱形。请选择完整图表容器；当前支持带分类、数值标签和明确宽高的普通条形图。'};
  const analyses=[];
  for(const prop of ['width','height']) {
    const bars=[];
    for(const el of candidates) {
      const size=htmlBarSize(el,prop);if(!size)break;
      let row=el.parentElement,record;
      for(let depth=0;row&&depth<5&&root.contains(row);depth++,row=row.parentElement) {
        if(candidates.filter(c=>row.contains(c)).length!==1)break;
        const leaves=[el,...row.querySelectorAll('*')].filter((n,i,a)=>a.indexOf(n)===i&&!n.matches('script,style')&&htmlBarLeaf(n)&&!n.children.length);
        const names=leaves.filter(n=>n!==el&&!el.contains(n)&&/(?:label|name|category|\byr\b)/i.test(n.className));
        const category=names[0]||leaves.find(n=>n!==el&&!el.contains(n)&&!htmlBarNumber(n.textContent));
        if(!category)continue;
        const values=leaves.filter(n=>n!==category&&(n===el||/(?:val|pct|number)/i.test(n.className)||n.hasAttribute('data-value')||n.hasAttribute('data-target')));
        const direct=htmlBarNumber(el.textContent);const valueEl=direct&&htmlBarLeaf(el)?el:values.find(n=>htmlBarNumber(n.getAttribute('data-value')??n.getAttribute('data-target')??n.textContent));
        if(!valueEl)continue;
        const parsed=htmlBarNumber(valueEl.getAttribute('data-value')??valueEl.getAttribute('data-target')??valueEl.textContent);if(!parsed||parsed.value<0)continue;
        const display=htmlBarNumber(valueEl.textContent);if(display)parsed.format=display.format;
        const style=el.ownerDocument.defaultView.getComputedStyle(el),rect=el.getBoundingClientRect();
        if(style.transform!=='none'||style.rotate!=='none'||style.scale!=='none'||style.translate!=='none')break;
        record={el,row,label:valueEl,category:category.textContent.trim().slice(0,200),value:parsed.value,format:parsed.format,...size,baseline:prop==='width'?rect.left:rect.bottom};break;
      }
      if(!record)break;bars.push(record);
    }
    if(bars.length!==candidates.length)continue;
    const positive=bars.find(b=>b.amount>0&&b.value>0);if(!positive)continue;
    const unit=bars[0].unit,ratio=positive.amount/positive.value,baseline=bars[0].baseline;
    if(bars.some(b=>b.unit!==unit||b.format.suffix!==bars[0].format.suffix||Math.abs(b.amount-b.value*ratio)>Math.max(.3,b.amount*.02)||Math.abs(b.baseline-baseline)>4))continue;
    if(new Set(bars.map(b=>b.row)).size!==bars.length)continue;
    // Extra numerical labels may be an axis or a second metric. Do not silently rescale it.
    const leftovers=[...root.querySelectorAll('*')].filter(el=>!el.children.length&&htmlBarNumber(el.textContent)&&!bars.some(b=>b.row.contains(el)));
    if(leftovers.length)continue;
    const maximum=unit==='%'?100/ratio:Math.max(...bars.map(b=>b.value));
    if(bars.some(b=>b.value>maximum*1.001))continue;
    analyses.push({root,prop,unit,ratio,maximum,bars});
  }
  return analyses.length===1?analyses[0]:{error:'未能可靠对应 HTML 柱长与数值。当前支持单系列、共同零基线和统一线性比例；无数值标签、混合单位、分组/堆叠或柱长与标注不成比例时，需要确认转换后编辑。'};
}
export function htmlBarTarget(node) {
  const bound=node?.closest(`[${HTML_BAR_MODEL}]`);if(bound)return bound;
  const share=htmlShareTarget(node);if(share)return share;
  for(let el=node,depth=0;el&&el.tagName!=='BODY'&&depth<6;el=el.parentElement,depth++)if(htmlBarCandidates(el).length>=2)return el;
  return node;
}
export function htmlBarElements(root,model) {
  if(model?.kind==='share')return htmlShareElements(root,model);
  if(model?.version!==1||!['width','height'].includes(model.prop)||!['%','px','vh','vw','rem','em'].includes(model.unit)||!Number.isFinite(model.ratio)||model.ratio<=0||!Number.isFinite(model.maximum)||model.maximum<=0||!Array.isArray(model.bars)||model.bars.length<1||model.bars.length>100)throw Error('HTML 图表绑定无效，请重新导入原图识别。');
  const seen=new Set();return model.bars.map(b=>{
    if(!Number.isFinite(b.value)||b.value<0||b.value>1e12||typeof b.category!=='string'||!b.format||typeof b.format.prefix!=='string'||typeof b.format.suffix!=='string'||b.format.prefix.length>10||b.format.suffix.length>10||!Number.isInteger(b.format.decimals)||b.format.decimals<0||b.format.decimals>8)throw Error('HTML 图表数值无效。');
    const find=key=>{if(!/^[-\w]{1,50}$/.test(key))throw Error('图表标记无效');const list=root.querySelectorAll(`[${HTML_BAR_KEY}="${key}"]`);if(list.length!==1)throw Error('图表结构已变化，请撤回结构修改后重试。');return list[0];};
    const el=find(b.key),label=b.sameLabel?el:find(b.labelKey);if(seen.has(el)||!htmlBarLeaf(label))throw Error('图表结构已变化，无法安全更新。');seen.add(el);return {el,label,b};
  });
}
export function updateHTMLBars(root,model) {
  if(model?.kind==='share'){const result=updateHTMLShares(root,model);updateKnownChartMotion(root.ownerDocument);return result;}
  const elements=htmlBarElements(root,model),max=Math.max(model.maximum,...model.bars.map(b=>b.value)),factor=model.maximum/max;
  for(const {el,label,b} of elements) {
    const size=Math.round(b.value*model.ratio*factor*1e8)/1e8;
    el.style.setProperty(model.prop,size+model.unit,'important');
    if(el.hasAttribute('data-'+model.prop))el.setAttribute('data-'+model.prop,String(size));
    for(const attr of ['data-value','data-target'])if(label.hasAttribute(attr))label.setAttribute(attr,String(b.value));
    htmlBarLeaf(label).textContent=htmlBarDisplay(b.value,b.format);
  }
  model.currentMaximum=max;root.setAttribute(HTML_BAR_MODEL,JSON.stringify(model));
}
export function bindHTMLBars(analysis) {
  if(analysis.kind==='share')return bindHTMLShares(analysis);
  const {root}=analysis;const model={version:1,prop:analysis.prop,unit:analysis.unit,ratio:analysis.ratio,maximum:analysis.maximum,bars:[]};
  analysis.bars.forEach((bar,i)=>{const key='bar-'+i,labelKey='value-'+i,sameLabel=bar.el===bar.label;bar.el.setAttribute(HTML_BAR_KEY,key);if(!sameLabel)bar.label.setAttribute(HTML_BAR_KEY,labelKey);model.bars.push({key,labelKey,sameLabel,value:bar.value,category:bar.category,format:bar.format});});
  updateHTMLBars(root,model);return model;
}
export function changeHTMLBarStructure(editor,root,model,{operation,index,name}) {
  const m=structuredClone(model),share=m.kind==='share';
  if(!m.bars[index])throw Error('请先选择分类');
  if(operation==='delete'&&m.bars.length<=1)throw Error('至少保留一个分类');
  if(operation==='add'&&m.bars.length>=(share?20:100))throw Error('已达到此图的分类数量上限');
  return structureTransaction(root,()=>{
    let items=htmlBarElements(root,m),b=m.bars[index],item=items[index];
    const find=key=>root.querySelector(`[${HTML_BAR_KEY}="${key}"]`);
    if(!share){
      for(const {el,label,b} of items){
        if(b.rowKey&&b.categoryKey){if(!find(b.rowKey)||!find(b.categoryKey))throw Error('分类结构已改变，请撤回后重试');continue;}
        let row=el.parentElement,category;
        while(row&&row!==root){
          if(items.filter(i=>row.contains(i.el)).length!==1)break;
          category=[...row.querySelectorAll('*')].find(n=>!n.children.length&&n!==label&&n.textContent.trim()===b.category);
          if(row.contains(label)&&category)break;row=row.parentElement;
        }
        if(!row||row===root||!category)throw Error('无法可靠对应每个分类的完整容器，暂不能增删；已有数值仍可编辑。');
        b.rowKey='row-'+crypto.randomUUID();b.categoryKey='name-'+crypto.randomUUID();row.setAttribute(HTML_BAR_KEY,b.rowKey);category.setAttribute(HTML_BAR_KEY,b.categoryKey);
      }
      const rows=items.map(i=>find(i.b.rowKey));if(new Set(rows.map(n=>n.parentElement)).size!==1)throw Error('分类容器不在同一布局中，暂不能安全扩展。');
    }
    if(operation==='delete'){
      (share?item.el:find(b.rowKey)).remove();m.bars.splice(index,1);
    }else{
      if(operation==='add'){
        const original=share?item.el:find(b.rowKey),copy=structureClone(original,editor);original.after(copy);
        b=structuredClone(b);b.value=0;
        const keys=[...copy.querySelectorAll(`[${HTML_BAR_KEY}]`)];if(copy.hasAttribute(HTML_BAR_KEY))keys.unshift(copy);
        for(const n of keys){const old=n.getAttribute(HTML_BAR_KEY),key=share?'bar-'+(Math.max(...m.bars.map(b=>Number(b.key.slice(4))))+1):'html-'+crypto.randomUUID();n.setAttribute(HTML_BAR_KEY,key);for(const field of ['key','labelKey','rowKey','categoryKey'])if(b[field]===old)b[field]=key;}
        m.bars.splice(index+1,0,b);item={el:copy};
      }
      const oldName=b.category;b.category=name;
      if(share){
        if(b.format.prefix.includes(oldName))b.format.prefix=b.format.prefix.replace(oldName,name);
        else if(b.categoryPath){const node=b.categoryPath.reduce((n,i)=>n?.childNodes[i],find(b.key));if(node?.nodeType!==3)throw Error('分类标签无法更新');node.textContent=name;}
        else throw Error('此占比图的名称无法可靠定位，已有数值仍可编辑。');
      }else structureText(find(b.categoryKey),name);
    }
    if(!share&&m.prop==='height'&&operation!=='rename'){
      const rows=m.bars.map(b=>find(b.rowKey)),parent=rows[0].parentElement,style=parent.ownerDocument.defaultView.getComputedStyle(parent);
      if(['flex','inline-flex'].includes(style.display)&&style.flexDirection==='row'){
        parent.style.setProperty('gap',Math.min(parseFloat(style.columnGap)||0,Math.max(4,parent.clientWidth/(rows.length*8)))+'px');
        for(const row of rows){row.style.setProperty('flex','1 1 0');row.style.setProperty('min-width','0');row.style.setProperty('width','0');const bar=find(m.bars[rows.indexOf(row)].key);if(bar.parentElement!==row)bar.parentElement.style.setProperty('width','100%');}
      }
    }
    updateHTMLBars(root,m);updateKnownChartMotion(editor.doc);return m;
  });
}
function htmlBarPreviewHTML(root) {
  const clone=root.cloneNode(true),nodes=[root,...root.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
  const properties=['display','position','box-sizing','width','height','min-width','min-height','max-width','max-height','left','right','top','bottom','margin','padding','gap','row-gap','column-gap','flex-direction','flex-grow','flex-shrink','flex-basis','align-items','align-self','justify-content','grid-template-columns','grid-template-rows','background','border','border-radius','box-shadow','color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','white-space','overflow','opacity','transform','transform-origin'];
  copies.forEach((n,i)=>{const s=nodes[i].ownerDocument.defaultView.getComputedStyle(nodes[i]);for(const p of properties)n.style.setProperty(p,s.getPropertyValue(p));for(const a of [...n.attributes])if(/^on/i.test(a.name))n.removeAttribute(a.name);});
  clone.querySelectorAll('script,iframe,object,embed').forEach(n=>n.remove());Object.assign(clone.style,{position:'relative',left:'0',top:'0',right:'auto',bottom:'auto',margin:'0',transform:'none'});
  const fonts=[...root.ownerDocument.querySelectorAll('style')].map(s=>s.textContent).filter(s=>s.includes('@font-face')).join('\n');
  return {html:`<!doctype html><html><head><style>${fonts.replace(/<\/style/gi,'<\\/style')}html,body{margin:0;padding:0;overflow:hidden}</style></head><body>${clone.outerHTML}</body></html>`,width:Math.max(1,root.offsetWidth),height:Math.max(1,root.offsetHeight)};
}
export function installHTMLBars(Editor,{modal,closeModal}) {
  const q=s=>document.querySelector(s);
  Editor.prototype.openHTMLBarEditor=function(root,clicked=null,{quiet=false}={}) {
    if(!root||this.loading||this.preview||this.locked(root))return false;
    this.finishText?.();
    let model;try{if(root.hasAttribute(HTML_BAR_MODEL)){model=JSON.parse(root.getAttribute(HTML_BAR_MODEL));htmlBarElements(root,model);}}catch(e){return quiet?false:this.convertDataChart(root,{reason:e.message});}
    if(quiet&&model&&!htmlBarElements(root,model).some(({el,label})=>el.contains(clicked)||label.contains(clicked)))return false;
    if(!model) {
      const analysis=analyzeHTMLBars(root);if(analysis.error)return quiet?false:this.convertDataChart(root,{reason:analysis.error});
      if(quiet&&!analysis.bars.some(b=>b.el.contains(clicked)||b.label?.contains(clicked)))return false;
      const version=this.loadVersion;
      modal('识别 HTML/CSS 柱状图 · 保留原样式',`<p>${analysis.kind==='share'?'识别到归一化占比堆叠条。':''}识别到 ${analysis.bars.length} 个分类、1 个系列。请确认数据；绑定会保留原 HTML 节点、颜色、渐变、圆角与描边。</p><div class="data-grid-scroll"><table class="data-grid"><thead><tr><th>分类</th><th>数值</th></tr></thead><tbody>${analysis.bars.map(b=>`<tr><th>${escapeHTML(b.category)}</th><td>${escapeHTML(htmlBarDisplay(b.value,b.format))}</td></tr>`).join('')}</tbody></table></div><p class="source-note">${analysis.kind==='share'?'修改各段金额/数量后，本图所有分段宽度及占比同步按合计重新计算；保留原单位与百分比小数位。':'仅更新本图数值和柱长。'}本图以外的标题、指标和台账不自动联动；脚本重建整张图表的情况仍需核对预览。</p>`,[{label:'取消',run:closeModal},{label:'绑定并编辑数据',primary:true,run:()=>{if(version!==this.loadVersion||!root.isConnected||this.locked(root))return;bindHTMLBars(analysis);this.commit('绑定 HTML 图表数据');this.openHTMLBarEditor(root,clicked);}}]);
      q('#dialog').dataset.kind='html-chart-bind';return true;
    }
    const editor=this,version=this.loadVersion;let pending=false,cancelPreview=null,previewTimer;
    const valid=()=>version===editor.loadVersion&&root.isConnected&&root.ownerDocument===editor.doc&&!editor.locked(root);
    const body=modal('编辑 HTML/CSS 图表数据 · 保留样式',`<p>${model.kind==='share'?'修改金额/数量后，全部分段宽度、金额和占比同步变化；总宽度保持不变。过窄的分段会裁切文字，增大后恢复，完整数据始终显示在左侧。':'修改数值后，柱长与数字同步变化，保留每根柱子的颜色和渐变。超出原范围时统一缩放全部柱子。'}</p><div class="data-editor-workspace with-chart"><div class="data-grid-scroll"><table class="data-grid" id="html-bar-grid"><thead><tr><th>分类</th><th>数值（沿用原单位）</th></tr></thead><tbody>${model.bars.map((b,i)=>`<tr><th>${escapeHTML(b.category)}</th><td><input data-html-bar="${i}" aria-label="${escapeHTML(b.category)}" value="${b.value}" inputmode="decimal"></td></tr>`).join('')}</tbody></table></div><div class="data-live-preview"><span>原图实时预览</span><div id="html-bar-preview"><iframe title="HTML 图表实时预览" sandbox="allow-scripts"></iframe></div></div></div><p id="html-bar-status" aria-live="polite"></p><p class="source-note">只更新本图，页面标题和其他表格不自动联动。支持非负数${model.kind==='share'?'，合计须大于 0':''}；可在上方增删分类和修改名称，可撤回或重做。</p>`,[{label:'完成',primary:true,run:closeModal}]);
    q('#dialog').dataset.kind='html-chart-data';
    const drawPreview=()=>{if(!valid()||!body.querySelector('#html-bar-preview'))return;const p=htmlBarPreviewHTML(root),frame=body.querySelector('iframe'),holder=frame.parentElement,scale=Math.min(holder.clientWidth/p.width,320/p.height);Object.assign(frame.style,{width:p.width+'px',height:p.height+'px',transform:`scale(${scale})`,transformOrigin:'0 0',border:'0'});holder.style.height=p.height*scale+'px';holder.style.overflow='hidden';cancelPreview?.();cancelPreview=editor.assets.preview(frame,p.html);};
    const flush=()=>{if(pending&&valid()){pending=false;editor.commit('修改 HTML 图表数据');}};
    q('#dialog').flushData=flush;
    bindDataPaste(body.querySelector('#html-bar-grid'),{
      valid,rowNames:()=>model.bars.map(b=>b.category),columnNames:()=>['数值'],
      apply:changes=>{
        const next=structuredClone(model);for(const cell of changes)next.bars[cell.row].value=pasteNumber(cell.raw);
        updateHTMLBars(root.cloneNode(true),structuredClone(next));flush();updateHTMLBars(root,next);model=next;
        for(const input of body.querySelectorAll('[data-html-bar]')){input.value=model.bars[Number(input.dataset.htmlBar)].value;input.removeAttribute('aria-invalid');}
        editor.commit('批量粘贴 HTML 图表数据');clearTimeout(previewTimer);drawPreview();q('#html-bar-status').textContent='已更新';
      }
    });
    body.querySelector('#html-bar-grid').addEventListener('input',event=>{const input=event.target;if(!input.matches('[data-html-bar]')||!valid())return;const value=htmlBarNumber(input.value)?.value;if(value===undefined||value<0||value>1e12){input.setAttribute('aria-invalid','true');q('#html-bar-status').textContent='请输入 0 至 1 万亿的数值；保留上一次有效结果。';return;}try{const next=structuredClone(model);next.bars[Number(input.dataset.htmlBar)].value=value;updateHTMLBars(root,next);model=next;pending=true;input.removeAttribute('aria-invalid');editor.draw();q('#html-bar-status').textContent='已更新';clearTimeout(previewTimer);previewTimer=setTimeout(drawPreview,80);}catch(e){input.setAttribute('aria-invalid','true');q('#html-bar-status').textContent=e.message;}});
    body.querySelector('#html-bar-grid').addEventListener('change',flush);
    mountChartStructure(body,{rows:model.bars.map(b=>b.category),rowLabel:model.kind==='share'?'分段':'分类',maxRows:model.kind==='share'?20:100,columnHint:model.kind==='share'?'占比条按每个分段的数值计算百分比，可新增分段；数值列为固定维度。':'此类 HTML/CSS 图为单系列，可增删分类；多系列布局暂不自动扩展。',valid,change:change=>{if(!valid())return;flush();model=changeHTMLBarStructure(editor,root,model,change);editor.commit('调整 HTML 图表分类');closeModal();editor.openHTMLBarEditor(root);focusStructureChange(change);}});
    const resize=new ResizeObserver(drawPreview);resize.observe(body.querySelector('.data-live-preview'));
    q('#dialog').addEventListener('close',()=>{flush();clearTimeout(previewTimer);cancelPreview?.();resize.disconnect();if(q('#dialog').flushData===flush)delete q('#dialog').flushData;},{once:true});drawPreview();
    const key=clicked?.closest(`[${HTML_BAR_KEY}]`)?.getAttribute(HTML_BAR_KEY),index=model.bars.findIndex(b=>b.key===key||b.labelKey===key);if(index>=0){const input=body.querySelector(`[data-html-bar="${index}"]`);input.focus();input.select();}return true;
  };
}
