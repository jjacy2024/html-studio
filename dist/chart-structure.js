import {escapeHTML} from './document.js';

// Shared controls use the chart's semantic dimensions: a bubble's X/Y/area
// and a waterfall's cumulative value are not interchangeable data series.
export function mountChartStructure(body, config) {
  const host=document.createElement('div');host.className='chart-structure-tools';
  const make=(axis,names,label,min,max)=>`<div class="chart-structure-row"><label>${label}<select data-structure-select="${axis}" aria-label="选择${label}">${names.map((n,i)=>`<option value="${i}">${escapeHTML(n)}</option>`).join('')}</select></label><input data-structure-name="${axis}" aria-label="${label}名称" maxlength="100" value="${escapeHTML(names[0]||'')}"><button class="text-button" data-structure-action="${axis}-rename">修改名称</button><button class="text-button" data-structure-action="${axis}-add" ${names.length>=max?'disabled':''}>＋ 新增${axis==='row'?'行':'列'}</button><button class="text-button" data-structure-action="${axis}-delete" ${names.length<=min?'disabled':''}>删除${axis==='row'?'行':'列'}</button></div>`;
  host.innerHTML=make('row',config.rows,config.rowLabel||'分类',config.minRows||1,config.maxRows||100)+(config.columns?make('column',config.columns,'系列',config.minColumns||1,config.maxColumns||12):`<p class="source-note">${escapeHTML(config.columnHint||'此图只有一个数值维度，可增删分类。')}</p>`)+`<p class="chart-structure-status" role="status">新增项沿用所选项的样式，初始数值为 0；可撤回。${escapeHTML(config.hint||'')}</p>`;
  body.querySelector('.data-editor-workspace').before(host);
  for(const select of host.querySelectorAll('select'))select.onchange=()=>{const axis=select.dataset.structureSelect;host.querySelector(`[data-structure-name="${axis}"]`).value=(axis==='row'?config.rows:config.columns)[Number(select.value)];};
  let busy=false;
  host.addEventListener('click',async event=>{
    const button=event.target.closest('[data-structure-action]');if(!button||busy||!config.valid())return;
    const [axis,operation]=button.dataset.structureAction.split('-'),index=Number(host.querySelector(`[data-structure-select="${axis}"]`).value),names=axis==='row'?config.rows:config.columns;
    let name=host.querySelector(`[data-structure-name="${axis}"]`).value.trim();
    const status=host.querySelector('.chart-structure-status');
    try {
      if(operation==='add'){let i=names.length+1;do{name=`新${axis==='column'?'系列':config.rowLabel||'分类'} ${i++}`;}while(names.includes(name));}
      if(!name||name.length>100)throw Error('名称须为 1 至 100 个字符。');
      if(operation==='rename'&&names.some((n,i)=>i!==index&&n===name))throw Error('此名称已存在，请使用不同的名称。');
      busy=true;host.inert=true;await config.change({axis,operation,index,name});
    }catch(e){status.textContent=e.message;status.dataset.error='true';}
    finally{busy=false;host.inert=false;}
  });
  return host;
}

export function focusStructureChange(change) {
  const select=document.querySelector(`[data-structure-select="${change.axis}"]`);if(!select)return;
  const options=[...select.options],found=options.findIndex(o=>o.textContent===change.name);
  select.selectedIndex=change.operation==='delete'?Math.min(change.index,options.length-1):Math.max(0,found);
  select.dispatchEvent(new Event('change'));
  const name=document.querySelector(`[data-structure-name="${change.axis}"]`);name?.focus();name?.select();
}
function localSVGPaint(value,doc) {
  // Computed SVG paint can include the editor iframe URL. Keep definitions
  // belonging to this document as portable fragment references in exports.
  return value.replace(/url\(["']?[^#)]*#([^"')]+)["']?\)/g,(full,id)=>doc.getElementById(id)?`url(#${id})`:full);
}
export function structureTransaction(root, change, extras=[]) {
  const nodes=[root,...extras.filter(Boolean)],backups=nodes.map(n=>({node:n,clone:n.cloneNode(true)}));
  try{return change();}catch(e){
    for(const {node,clone} of backups){for(const a of [...node.attributes])node.removeAttribute(a.name);for(const a of clone.attributes)node.setAttribute(a.name,a.value);node.replaceChildren(...[...clone.childNodes].map(n=>n.cloneNode(true)));}
    throw e;
  }
}
export function structureClone(node, editor) {
  const copy=node.cloneNode(true);editor.remapClone(copy);return copy;
}
export function structureText(node,text) {
  const walker=node.ownerDocument.createTreeWalker(node,4),leaves=[];
  while(walker.nextNode())if(walker.currentNode.textContent.trim())leaves.push(walker.currentNode);
  if(!leaves.length)node.append(node.ownerDocument.createTextNode(text));
  else {leaves[0].textContent=text;leaves.slice(1).forEach(n=>n.textContent='');}
}
export function structureNumber(node,prop,value) {
  const old=Number(node.getAttribute(prop)),next=Number(value.toFixed(7));node.setAttribute(prop,String(next));
  // Coordinate-bearing tspans must move with their text element.
  if(node.tagName.toLowerCase()==='text'&&['x','y'].includes(prop))for(const t of node.querySelectorAll(`tspan[${prop}]`)){const v=Number(t.getAttribute(prop));if(Number.isFinite(v))t.setAttribute(prop,String(v+next-old));}
  const style=node.ownerDocument.defaultView?.getComputedStyle(node),computed=parseFloat(style?.getPropertyValue(prop));
  if(Number.isFinite(computed)&&Math.abs(computed-next)>.01)node.style.setProperty(prop,next+'px','important');
}
export function updateKnownChartMotion(doc) {
  // This authored controller discovers SVG marks on every replay. Its two
  // non-SVG collectors originally used fixed counts/widths, so broaden those
  // exact signatures to discover the edited structures too. Other scripts
  // are left untouched.
  const script=doc.querySelector('script#qiwu-chart-motion');if(!script||!script.textContent.includes('CHART ENTRANCE MOTION'))return;
  script.textContent=script.textContent
    .replace(/s\.background=(v>=350\?[^;]+);/,"s.background=tile.getAttribute('data-studio-chart-color')||($1);")
    .replace('if (tiles.length !== 24) continue;',"if (tiles.length !== 24 && !table.hasAttribute('data-studio-heatmap')) continue;")
    .replace("for (const first of document.querySelectorAll('.slide div[style*=\"width:81.865%\"]')) {\n    const root=first.parentElement, parts=[...root.children]; if(parts.length!==2)continue;","for (const root of new Set([...document.querySelectorAll('.slide div[style*=\"width:81.865%\"]')].map(n=>n.parentElement).concat([...document.querySelectorAll('[data-studio-html-chart]')].filter(n=>{try{return JSON.parse(n.getAttribute('data-studio-html-chart')).kind==='share'}catch{return false}})))) {\n    const parts=[...root.children]; if(!parts.length)continue;");
}

const SK='data-studio-svg-key',SM='data-studio-svg-chart';
const sk=(svg,key)=>{if(typeof key!=='string'||!/^[-\w]{1,80}$/.test(key))throw Error('图表结构标记无效');const nodes=svg.querySelectorAll(`[${SK}="${key}"]`);if(nodes.length!==1)throw Error('图表结构已变化，请重新打开或撤回后重试');return nodes[0];};
const numberAttr=(n,p)=>Number(n.getAttribute(p)||0);
const newKey=()=>`structure-${crypto.randomUUID()}`;
function cloneMark(svg,key,editor){if(!key)return null;const old=sk(svg,key),n=structureClone(old,editor),id=newKey();n.setAttribute(SK,id);old.parentElement.append(n);return id;}
function cloneBar(svg,b,editor){const next=structuredClone(b);next.key=cloneMark(svg,b.key,editor);next.labelKey=cloneMark(svg,b.labelKey,editor);return next;}
function removeMark(svg,key){if(key)sk(svg,key).remove();}
function nearbyLegend(svg,names) {
  for(let p=svg.parentElement,depth=0;p&&depth<3;depth++,p=p.parentElement){
    const legends=[...p.querySelectorAll('.legend,[class*="chart-legend"]')];
    for(const legend of legends){const items=[...legend.children];if(items.length===names.length&&items.every((item,i)=>item.textContent.trim()===names[i]))return legend;}
    if(p.querySelectorAll('svg').length>1)break;
  }
  return null;
}
function renameTemplates(record,oldName,name) {
  for(const field of ['titleTemplate','ariaTemplate','labelTemplate']){
    const t=record[field];if(t?.before?.includes(oldName))t.before=t.before.replace(oldName,name);
    if(t?.after?.includes(oldName))t.after=t.after.replace(oldName,name);
  }
}
function ensureSVGStructure(svg,m) {
  const vertical=m.orientation==='vertical',cross=vertical?'x':'y',size=vertical?'width':'height';
  const centers=m.categories.map((_,row)=>{const bars=m.bars.filter(b=>b.row===row).map(b=>sk(svg,b.key));return (Math.min(...bars.map(n=>numberAttr(n,cross)))+Math.max(...bars.map(n=>numberAttr(n,cross)+numberAttr(n,size))))/2;});
  if(m.structure){
    const s=m.structure;if(s.version!==1||!Array.isArray(s.categories)||s.categories.length!==m.categories.length||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<=s.start||!Number.isFinite(s.fill)||s.fill<=0||s.fill>1||!Number.isFinite(s.gap)||s.gap<0||s.gap>3)throw Error('分类布局绑定无效');
    s.categories.forEach(keys=>{if(!Array.isArray(keys)||!keys.length||keys.length>5)throw Error('分类标签绑定无效');keys.forEach(k=>sk(svg,k));});return s;
  }
  const texts=[...svg.querySelectorAll(`text:not([${SK}])`)];
  const categories=m.categories.map((name,row)=>{
    const matches=texts.filter(n=>Math.abs(numberAttr(n,cross)-centers[row])<Math.max(28,(row?Math.abs(centers[row]-centers[row-1]):50)*.12)&&(vertical?numberAttr(n,'y')>m.zero+3:numberAttr(n,'x')<m.zero-3));
    matches.sort((a,b)=>vertical?numberAttr(a,'y')-numberAttr(b,'y'):numberAttr(a,'x')-numberAttr(b,'x'));
    const exact=matches.filter(n=>n.textContent.trim()===name),chosen=exact.length===1?exact:matches;
    if(!chosen.length||chosen.length>5||chosen.map(n=>n.textContent.trim()).join(' · ')!==name)throw Error('无法可靠对应分类标签，暂不能增删结构；已有数值仍可编辑。');
    return chosen.map(n=>{const key=newKey();n.setAttribute(SK,key);return key;});
  });
  const bars=m.bars.map(b=>sk(svg,b.key)),startBar=Math.min(...bars.map(n=>numberAttr(n,cross))),endBar=Math.max(...bars.map(n=>numberAttr(n,cross)+numberAttr(n,size)));
  const baseline=[...svg.querySelectorAll('line')].filter(n=>vertical?Math.abs(numberAttr(n,'y1')-m.zero)<1&&Math.abs(numberAttr(n,'y2')-m.zero)<1:Math.abs(numberAttr(n,'x1')-m.zero)<1&&Math.abs(numberAttr(n,'x2')-m.zero)<1).filter(n=>Math.min(numberAttr(n,cross+'1'),numberAttr(n,cross+'2'))<=startBar&&Math.max(numberAttr(n,cross+'1'),numberAttr(n,cross+'2'))>=endBar).sort((a,b)=>Math.abs(numberAttr(b,cross+'2')-numberAttr(b,cross+'1'))-Math.abs(numberAttr(a,cross+'2')-numberAttr(a,cross+'1')))[0];
  const step=centers.length>1?(centers.at(-1)-centers[0])/(centers.length-1):Math.max(40,endBar-startBar)*1.5;
  const start=baseline?Math.min(numberAttr(baseline,cross+'1'),numberAttr(baseline,cross+'2')):centers[0]-step/2,end=baseline?Math.max(numberAttr(baseline,cross+'1'),numberAttr(baseline,cross+'2')):centers.at(-1)+step/2;
  const first=m.bars.filter(b=>b.row===0).map(b=>sk(svg,b.key)),span=Math.max(...first.map(n=>numberAttr(n,cross)+numberAttr(n,size)))-Math.min(...first.map(n=>numberAttr(n,cross)));
  const gap=m.kind==='stacked'||first.length<2?0:Math.max(0,(numberAttr(first[1],cross)-numberAttr(first[0],cross)-numberAttr(first[0],size))/numberAttr(first[0],size));
  return m.structure={version:1,categories,start,end,fill:Math.max(.15,Math.min(.85,span/step)),gap:Math.min(2,gap)};
}
function captureSVGSeriesLegend(svg,m) {
  if(m.structure.legend!==undefined)return m.structure.legend;
  const items=m.series.map(name=>{
    const texts=[...svg.querySelectorAll(`text:not([${SK}])`)].filter(n=>n.textContent.trim()===name);if(texts.length!==1)return null;
    const text=texts[0],x=numberAttr(text,'x'),y=numberAttr(text,'y'),size=parseFloat(svg.ownerDocument.defaultView.getComputedStyle(text).fontSize)||16;
    const shapes=[...svg.querySelectorAll(`rect:not([${SK}])`)].filter(n=>numberAttr(n,'width')>0&&numberAttr(n,'width')<=40&&numberAttr(n,'height')>0&&numberAttr(n,'height')<=40&&x>numberAttr(n,'x')+numberAttr(n,'width')&&x-numberAttr(n,'x')-numberAttr(n,'width')<32&&Math.abs(y-numberAttr(n,'y')-numberAttr(n,'height')/2)<Math.max(12,size*.7));
    return shapes.length===1?{text,shape:shapes[0]}:null;
  });
  if(items.some(n=>!n))return m.structure.legend=null;
  const horizontal=items.every(n=>Math.abs(numberAttr(n.shape,'y')-numberAttr(items[0].shape,'y'))<2),vertical=items.every(n=>Math.abs(numberAttr(n.shape,'x')-numberAttr(items[0].shape,'x'))<2);
  if(!horizontal&&!vertical)throw Error('此图例排布较复杂，暂不能可靠增删系列；已有数值仍可编辑。');
  return m.structure.legend={horizontal,start:Math.min(...items.map(n=>numberAttr(n.shape,horizontal?'x':'y'))),items:items.map(({text,shape})=>{const textKey=newKey(),shapeKey=newKey();text.setAttribute(SK,textKey);shape.setAttribute(SK,shapeKey);return{textKey,shapeKey};})};
}
function updateSVGSeriesLegend(svg,m,change,editor) {
  const legend=m.structure.legend;if(!legend||change.axis!=='column')return;
  const {operation,index,name}=change,items=legend.items;
  if(operation==='add'){const source=items[index];items.splice(index+1,0,{textKey:cloneMark(svg,source.textKey,editor),shapeKey:cloneMark(svg,source.shapeKey,editor)});structureText(sk(svg,items[index+1].textKey),name);}
  else if(operation==='delete'){removeMark(svg,items[index].textKey);removeMark(svg,items[index].shapeKey);items.splice(index,1);}
  else structureText(sk(svg,items[index].textKey),name);
  const cross=legend.horizontal?'x':'y',end=svg.viewBox.baseVal[legend.horizontal?'width':'height']-16,step=(end-legend.start)/items.length;
  for(const [i,item] of items.entries()){
    const text=sk(svg,item.textKey),shape=sk(svg,item.shapeKey),offset=numberAttr(text,cross)-numberAttr(shape,cross),pos=legend.start+step*i;
    structureNumber(shape,cross,pos);structureNumber(text,cross,pos+offset);
    if(legend.horizontal){text.removeAttribute('textLength');text.removeAttribute('lengthAdjust');const max=step-offset-8;if(max<18)throw Error('图例空间不足，请先扩大图表或减少系列。');if(text.getBBox().width>max){text.setAttribute('textLength',String(max));text.setAttribute('lengthAdjust','spacingAndGlyphs');}}
  }
}
function layoutSVGStructure(svg,m) {
  const s=m.structure,vertical=m.orientation==='vertical',cross=vertical?'x':'y',size=vertical?'width':'height',step=(s.end-s.start)/m.categories.length,cluster=step*s.fill;
  for(let row=0;row<m.categories.length;row++){
    const center=s.start+step*(row+.5),bars=m.bars.filter(b=>b.row===row).sort((a,b)=>a.column-b.column),width=m.kind==='stacked'?cluster:cluster/(bars.length+s.gap*(bars.length-1));
    if(width<2)throw Error('分类或系列过多，柱形将过窄；请扩大图表或减少项目。');
    bars.forEach((b,c)=>{const rect=sk(svg,b.key),oldCenter=numberAttr(rect,cross)+numberAttr(rect,size)/2,offset=b.labelKey?numberAttr(sk(svg,b.labelKey),cross)-oldCenter:0,pos=m.kind==='stacked'?center-width/2:center-cluster/2+c*width*(1+s.gap);
      structureNumber(rect,cross,pos);structureNumber(rect,size,width);if(b.geometry){b.geometry[cross]=pos;b.geometry[size]=width;}
      if(b.labelKey)structureNumber(sk(svg,b.labelKey),cross,pos+width/2+offset);
    });
    for(const key of s.categories[row])structureNumber(sk(svg,key),cross,center);
    const total=m.totals?.find(t=>t.row===row);if(total)structureNumber(sk(svg,total.key),cross,center);
  }
  if(m.kind==='waterfall')for(const c of m.connectors){const line=sk(svg,c.key),a=sk(svg,m.bars[c.row].key),b=sk(svg,m.bars[c.row+1].key);structureNumber(line,cross+'1',numberAttr(a,cross)+numberAttr(a,size));structureNumber(line,cross+'2',numberAttr(b,cross));}
}
export function changeSVGStructure(editor,svg,model,change,update) {
  const m=structuredClone(model),{axis,operation,index,name}=change,waterfall=m.kind==='waterfall',names=axis==='row'?m.categories:m.series;
  if(!Number.isInteger(index)||index<0||index>=names.length)throw Error('请先选择要操作的分类或系列。');
  if(axis==='column'&&waterfall)throw Error('瀑布图使用单一累计数值，请通过新增步骤扩展。');
  if(operation==='delete'&&names.length<=(waterfall?3:1))throw Error('请保留必要的图表数据。');
  if(operation==='add'&&(names.length>=(axis==='row'?100:12)||(m.categories.length+(axis==='row'?1:0))*(m.series.length+(axis==='column'?1:0))>200))throw Error('已达到图表容量上限（100 个分类、12 个系列、200 根柱形）。');
  if(waterfall&&operation==='delete'&&(index===0||index===names.length-1))throw Error('起始值和最终合计须保留，可删除中间步骤。');
  const legend=nearbyLegend(svg,axis==='column'?m.series:m.series.length===1?m.categories:[]);
  return structureTransaction(svg,()=>{
    const s=ensureSVGStructure(svg,m),oldName=names[index];
    if(axis==='column')captureSVGSeriesLegend(svg,m);
    if(operation==='rename'){
      names[index]=name;
      if(axis==='row')s.categories[index].forEach((k,i)=>structureText(sk(svg,k),i===0?name:''));
      for(const b of m.bars.filter(b=>axis==='row'?b.row===index:b.column===index))renameTemplates(b,oldName,name);
      if(legend)structureText(legend.children[index],name);
    }else if(axis==='row'){
      if(operation==='add'){
        const at=waterfall?Math.min(index+1,names.length-1):index+1,sourceRow=waterfall?(m.bars[index].role==='change'?index:m.bars.find(b=>b.role==='change').row):index;
        const clones=m.bars.filter(b=>b.row===sourceRow).map(b=>{const n=cloneBar(svg,b,editor);n.row=at;n.value=0;renameTemplates(n,m.categories[sourceRow],name);return n;});
        m.bars.forEach(b=>{if(b.row>=at)b.row++;});m.bars.push(...clones);
        const keys=s.categories[sourceRow].map(k=>cloneMark(svg,k,editor));keys.forEach((k,i)=>structureText(sk(svg,k),i===0?name:''));s.categories.splice(at,0,keys);names.splice(at,0,name);
        if(m.totals){const template=m.totals.find(t=>t.row===sourceRow);const copy=template?{...structuredClone(template),key:cloneMark(svg,template.key,editor),row:at}:null;m.totals.forEach(t=>{if(t.row>=at)t.row++;});if(copy)m.totals.push(copy);}
        if(legend){const n=structureClone(legend.children[index],editor);structureText(n,name);legend.children[index].after(n);}
      }else{
        m.bars.filter(b=>b.row===index).forEach(b=>{removeMark(svg,b.key);removeMark(svg,b.labelKey);});m.bars=m.bars.filter(b=>b.row!==index);m.bars.forEach(b=>{if(b.row>index)b.row--;});s.categories[index].forEach(k=>removeMark(svg,k));s.categories.splice(index,1);names.splice(index,1);
        if(m.totals){m.totals.filter(t=>t.row===index).forEach(t=>removeMark(svg,t.key));m.totals=m.totals.filter(t=>t.row!==index);m.totals.forEach(t=>{if(t.row>index)t.row--;});}legend?.children[index].remove();
      }
    }else{
      if(operation==='add'){
        const clones=m.bars.filter(b=>b.column===index).map(b=>{const n=cloneBar(svg,b,editor);n.column=index+1;n.value=0;renameTemplates(n,oldName,name);return n;});m.bars.forEach(b=>{if(b.column>index)b.column++;});m.bars.push(...clones);names.splice(index+1,0,name);
        if(legend){const n=structureClone(legend.children[index],editor);structureText(n,name);legend.children[index].after(n);}
      }else{m.bars.filter(b=>b.column===index).forEach(b=>{removeMark(svg,b.key);removeMark(svg,b.labelKey);});m.bars=m.bars.filter(b=>b.column!==index);m.bars.forEach(b=>{if(b.column>index)b.column--;});names.splice(index,1);legend?.children[index].remove();}
    }
    m.bars.sort((a,b)=>a.row-b.row||a.column-b.column);
    if(waterfall){while(m.connectors.length<m.bars.length-1)m.connectors.push({key:cloneMark(svg,m.connectors.at(-1).key,editor),row:m.connectors.length});while(m.connectors.length>m.bars.length-1)removeMark(svg,m.connectors.pop().key);m.connectors.forEach((c,i)=>c.row=i);}
    if(axis==='column')updateSVGSeriesLegend(svg,m,change,editor);
    if(operation!=='rename')layoutSVGStructure(svg,m);
    update(svg,m);
    if(axis==='column'&&operation==='add'&&!legend&&!m.structure.legend&&m.series.length>1&&svg.parentElement.namespaceURI==='http://www.w3.org/1999/xhtml'){
      const legend=svg.ownerDocument.createElement('div');legend.className='legend';legend.dataset.studioStructuralLegend='true';legend.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:10px 0;font-size:14px';
      for(const [c,name] of m.series.entries()){
        const item=svg.ownerDocument.createElement('span'),sample=sk(svg,m.bars.find(b=>b.column===c).key),paint=svg.ownerDocument.defaultView.getComputedStyle(sample);
        const mini=svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg','svg'),rect=svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg','rect');mini.setAttribute('viewBox','0 0 16 16');mini.style.cssText='display:inline-block;width:16px;height:16px;vertical-align:middle;margin-right:6px';
        for(const [key,value] of Object.entries({x:1,y:1,width:14,height:14,fill:localSVGPaint(paint.fill,svg.ownerDocument),stroke:localSVGPaint(paint.stroke,svg.ownerDocument),'stroke-width':Math.min(2,parseFloat(paint.strokeWidth)||0)}))rect.setAttribute(key,value);
        mini.append(rect);item.append(mini,svg.ownerDocument.createTextNode(name));legend.append(item);
      }
      svg.after(legend);
    }
    // A short accessible summary must follow the edited categories, rather
    // than retain the original report's fixed amounts.
    svg.setAttribute('aria-label',`${waterfall?'瀑布图 / 利润桥':m.kind==='stacked'?'堆叠柱状图':'柱状图'}：`+m.categories.map((n,r)=>n+' '+m.bars.filter(b=>b.row===r).map(b=>m.series[b.column]+' '+b.value).join('，')).join('；'));
    updateKnownChartMotion(editor.doc);return m;
  },[legend]);
}

// Heatmap thresholds can only be retained when authored explicitly. The
// report's motion controller supplies its threshold/color expression; do not
// infer financial buckets from a handful of colored sample cells.
export function detectTableHeatmap(table,doc) {
  try{const model=JSON.parse(table.getAttribute('data-studio-heatmap'));if(validHeatmap(model))return model;}catch{}
  const script=doc.querySelector('script#qiwu-chart-motion');if(!script?.textContent.includes('CHART ENTRANCE MOTION'))return null;
  const match=script.textContent.match(/s\.background\s*=\s*((?:v\s*>=\s*[\d.]+\s*\?\s*'[^']+'\s*:\s*)+)'([^']+)'/);if(!match)return null;
  const branches=[...match[1].matchAll(/v\s*>=\s*([\d.]+)\s*\?\s*'([^']+)'/g)],model={version:1,thresholds:branches.map(m=>Number(m[1])),colors:[...branches.map(m=>m[2]),match[2]]};
  if(!validHeatmap(model))return null;
  const tiles=[...table.querySelectorAll('td > span[style*="background"]')],value=n=>Number(n.textContent.trim().replaceAll(',',''));
  if(tiles.length<4||tiles.some(n=>!n.textContent.trim()||!Number.isFinite(value(n))||n.style.background!==heatColor(model,value(n))))return null;
  return model;
}
function validHeatmap(m){return m?.version===1&&Array.isArray(m.thresholds)&&m.thresholds.length>0&&m.thresholds.length<=12&&m.thresholds.every((n,i)=>Number.isFinite(n)&&(!i||n<m.thresholds[i-1]))&&Array.isArray(m.colors)&&m.colors.length===m.thresholds.length+1&&m.colors.every(c=>typeof c==='string'&&c.length<100&&/^(?:#[\da-f]{3,8}|var\(--[\w-]+\)|[a-z]+|rgba?\([\d.,%\s]+\))$/i.test(c));}
function heatColor(m,v){const i=m.thresholds.findIndex(n=>v>=n);return m.colors[i<0?m.colors.length-1:i];}
export function refreshTableHeatmap(table,model) {
  if(!model){try{model=JSON.parse(table.getAttribute('data-studio-heatmap'));}catch{return;}}
  if(!validHeatmap(model))return;
  for(const tile of table.querySelectorAll('td > span[style*="background"]')){const raw=tile.textContent.trim().replaceAll(',',''),value=Number(raw);if(raw&&Number.isFinite(value))tile.style.background=/^#[0-9a-f]{6}$/i.test(tile.getAttribute('data-studio-chart-color')||'')?tile.getAttribute('data-studio-chart-color'):heatColor(model,value);}
  table.setAttribute('data-studio-heatmap',JSON.stringify(model));
}
export function resizeTableColumns(table,index,deleting) {
  const groups=[...table.querySelectorAll(':scope > colgroup')];if(groups.length!==1)return;
  const group=groups[0],cols=[...group.children];if(!cols.length||cols.some(c=>c.tagName!=='COL'||c.span!==1))return;
  const before=table.rows[0].cells.length+(deleting?1:-1);if(cols.length!==before)return;
  if(deleting)cols[index]?.remove();else {const ref=cols[Math.min(index,cols.length-1)],copy=ref.cloneNode(false);copy.removeAttribute('id');copy.removeAttribute('data-hs-id');if(index<cols.length)ref.before(copy);else ref.after(copy);}
  const next=[...group.children],sizes=next.map(n=>/^([\d.]+)%$/.exec(n.style.width));if(sizes.every(Boolean)){const total=sizes.reduce((n,m)=>n+Number(m[1]),0);if(total>0)next.forEach((n,i)=>n.style.width=Number((Number(sizes[i][1])/total*100).toFixed(7))+'%');}
}
