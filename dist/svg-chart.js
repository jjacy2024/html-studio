import {focusStructureChange,mountChartStructure,changeSVGStructure} from './chart-structure.js';
import {bindDataPaste,pasteNumber} from './data-paste.js';
import {createSVGWaterfallAdapter} from './svg-waterfall.js';
import {createSVGBubbleAdapter} from './svg-bubble.js';
import {htmlBarTarget} from './html-bars.js';
import {escapeHTML} from './document.js';

const SVG_CHART_ATTR = 'data-studio-svg-chart';
const SVG_MARK_ATTR = 'data-studio-svg-key';
const svgChartNumber = text => {
  const raw=String(text).trim().replaceAll('−','-').replaceAll('，',',');
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:%|％)?$/.test(raw)) return null;
  const value=Number(raw.replaceAll(',','').replace(/[%％]$/,''));
  return Number.isFinite(value) ? value : null;
};
const svgChartFormat = text => ({comma:String(text).includes(','),decimals:(String(text).match(/\.(\d+)/)?.[1]||'').length,suffix:String(text).match(/[%％]$/)?.[0]||''});
const svgChartDisplay = (value,format) => {
  const decimals=Math.min(8,Math.max(format.decimals,Math.min(6,(String(Number(value.toFixed(6))).split('.')[1]||'').length)));
  return value.toLocaleString('en-US',{useGrouping:format.comma,minimumFractionDigits:format.decimals,maximumFractionDigits:decimals})+format.suffix;
};
function svgChartAttribute(el,name) {
  const raw=el.getAttribute(name);
  return raw !== null && /^[-+\d.eE]+$/.test(raw.trim()) && Number.isFinite(Number(raw)) ? Number(raw) : null;
}
function svgChartUntransformed(el,root) {
  for(let node=el;node&&node!==root;node=node.parentElement) {
    if(node.hasAttribute('transform'))return false;
    const style=root.ownerDocument.defaultView?.getComputedStyle(node);
    if(style && (style.transform!=='none'||style.rotate!=='none'||style.scale!=='none'||style.translate!=='none'))return false;
  }
  return true;
}
const svgChartStyle = el => el.ownerDocument.defaultView.getComputedStyle(el);
function svgChartTextLeaf(el) {
  const leaves=[],walker=el.ownerDocument.createTreeWalker(el,4);
  while(walker.nextNode())if(walker.currentNode.textContent.trim())leaves.push(walker.currentNode);
  // Keep styled tspans intact; split, separately positioned digits are ambiguous.
  return leaves.length===1&&!el.querySelector('tspan[x],tspan[y],tspan[dx],tspan[dy],textPath')?leaves[0]:null;
}
function svgChartTexts(svg) {
  return [...svg.querySelectorAll('text')].filter(el=>svgChartUntransformed(el,svg)&&svgChartTextLeaf(el)).map(el=>({el,x:svgChartAttribute(el,'x'),y:svgChartAttribute(el,'y'),
    text:el.textContent.trim(),size:parseFloat(svgChartStyle(el).fontSize)||16,value:svgChartNumber(el.textContent)})).filter(t=>t.x!==null&&t.y!==null&&t.text);
}
function svgChartLegend(svg) {
  for(let parent=svg.parentElement,depth=0;parent&&depth<3;parent=parent.parentElement,depth++) {
    const legend=parent.querySelector('.legend,[class*="chart-legend"]');
    if(!legend)continue;
    return [...legend.children].map(item=>{
      const swatch=item.querySelector('i,span,rect');
      if(!swatch)return null;
      const s=svgChartStyle(swatch);return{color:swatch.tagName.toLowerCase()==='rect'?s.fill:s.backgroundColor,name:item.textContent.trim().slice(0,80)};
    }).filter(Boolean);
  }
  return [];
}
function detectSVGChartDirection(svg,orientation,texts,rects,lines) {
  const vertical=orientation==='vertical';
  const axes=[];
  for(const line of lines) {
    const parallel=vertical?Math.abs(line.y1-line.y2)<.1:Math.abs(line.x1-line.x2)<.1;
    if(!parallel)continue;
    const start=vertical?Math.min(line.x1,line.x2):Math.min(line.y1,line.y2),end=vertical?Math.max(line.x1,line.x2):Math.max(line.y1,line.y2),pos=vertical?line.y1:line.x1;
    if(end-start<60)continue;
    const labels=texts.filter(t=>t.value!==null&&t.value>=0&&(vertical ? t.x<start&&start-t.x<100&&Math.abs(t.y-pos)<Math.max(10,t.size*.8) : t.y>end&&t.y-end<80&&Math.abs(t.x-pos)<Math.max(10,t.size*.5)));
    if(labels.length!==1)continue;
    axes.push({line:line.el,label:labels[0],start,end,pos,value:labels[0].value});
  }
  const axisGroups=[];
  for(const axis of axes){let group=axisGroups.find(g=>Math.abs(g[0].start-axis.start)<1&&Math.abs(g[0].end-axis.end)<1);if(!group)axisGroups.push(group=[]);group.push(axis);}
  const candidates=[];
  for(const ticks of axisGroups) {
    ticks.sort((a,b)=>a.value-b.value);
    if(ticks.length<3||ticks.length>30||ticks[0].value!==0||new Set(ticks.map(t=>t.value)).size!==ticks.length)continue;
    const zero=ticks[0].pos,originalMax=ticks.at(-1).value,far=ticks.at(-1).pos,scale=(far-zero)/originalMax;
    if(originalMax<=0||originalMax>1e12||ticks.some(t=>svgChartFormat(t.label.text).suffix!==svgChartFormat(ticks[0].label.text).suffix) || (vertical?scale>=0:scale<=0))continue;
    if(ticks.some(t=>Math.abs(t.pos-(zero+t.value*scale))>1.2))continue;
    const plotStart=ticks[0].start,plotEnd=ticks[0].end;
    const bars=[];const used=new Set(ticks.map(t=>t.label.el));
    for(const r of rects) {
      const baseline=vertical?r.y+r.height:r.x,center=vertical?r.x+r.width/2:r.y+r.height/2,tip=vertical?r.y:r.x+r.width,length=vertical?r.height:r.width;
      if(Math.abs(baseline-zero)>1 || center<plotStart || center>plotEnd || length<=0)continue;
      const labels=texts.filter(t=>!used.has(t.el)&&t.value!==null&&t.value>0&&(vertical ? Math.abs(t.x-center)<Math.max(2,r.width*.12)&&t.y<tip&&tip-t.y<Math.max(40,t.size*1.7) : t.x>tip&&t.x-tip<Math.max(50,t.size*2)&&Math.abs(t.y-center)<Math.max(10,t.size*.7)));
      if(labels.length!==1)continue;
      const label=labels[0];
      if(Math.abs(length-Math.abs(scale)*label.value)>Math.max(1.2,length*.005))continue;
      const geometry=svgChartStyle(r.el);
      // Styles that override SVG geometry need a different adapter.
      if(['x','y','width','height'].some(p=>Math.abs(parseFloat(geometry[p])-r[p])>.5))continue;
      used.add(label.el);bars.push({...r,label,value:label.value,center,tip,color:geometry.fill});
    }
    if(!bars.length||bars.length>200)continue;
    // Reject unlabeled or stacked rectangles in the plot instead of editing a subset.
    const inPlot=rects.filter(r=>{
      const center=vertical?r.x+r.width/2:r.y+r.height/2,mid=vertical?r.y+r.height/2:r.x+r.width/2;
      return center>plotStart&&center<plotEnd&&mid>Math.min(zero,far)&&mid<Math.max(zero,far)&&r.width>2&&r.height>2;
    });
    if(inPlot.some(r=>!bars.some(b=>b.el===r.el)))continue;
    const labels=texts.filter(t=>!used.has(t.el)&&(vertical?t.y>zero+5&&t.y-zero<Math.max(100,Math.abs(far-zero)*.4)&&t.x>plotStart&&t.x<plotEnd:t.x<zero-5&&zero-t.x<180&&t.y>plotStart&&t.y<plotEnd));
    const labelRows=[];
    for(const label of labels){const coord=vertical?label.y:label.x;let row=labelRows.find(row=>Math.abs((vertical?row[0].y:row[0].x)-coord)<2);if(!row)labelRows.push(row=[]);row.push(label);}
    const layouts=[];
    for(const row of labelRows) {
      row.sort((a,b)=>(vertical?a.x-b.x:a.y-b.y));
      if(row.length>100)continue;
      const groups=row.map(label=>({label,bars:[]}));
      for(const bar of bars){let closest=0;row.forEach((label,i)=>{if(Math.abs((vertical?label.x:label.y)-bar.center)<Math.abs((vertical?row[closest].x:row[closest].y)-bar.center))closest=i;});groups[closest].bars.push(bar);}
      const count=groups[0]?.bars.length;
      if(!count||count>12||groups.some(group=>group.bars.length!==count))continue;
      groups.forEach(group=>group.bars.sort((a,b)=>a.center-b.center));
      // Single-series charts may color each category independently. Color consistency
      // only helps identify corresponding series when a category has multiple bars.
      if(count>1&&groups.some(group=>group.bars.some((bar,i)=>bar.color!==groups[0].bars[i].color)))continue;
      // Categories must sit within the bar cluster they name.
      if(groups.some(group=>{const c=vertical?group.label.x:group.label.y;return Math.abs(c-(group.bars[0].center+group.bars.at(-1).center)/2)>Math.max(25,(group.bars.at(-1).center-group.bars[0].center)*.3);} ))continue;
      layouts.push(groups);
    }
    if(layouts.length!==1)continue;
    const groups=layouts[0],legend=svgChartLegend(svg),series=groups[0].bars.map((bar,i)=>legend.find(item=>item.color===bar.color)?.name || `系列 ${i+1}`);
    candidates.push({orientation,zero,far,originalMax,ticks,groups,series,bars});
  }
  return candidates;
}

// Stacks are identified by contiguous rectangles and independently readable values,
// never by a file name or by estimating data from pixel lengths alone.
function svgStackValueText(text) {
  const raw=String(text).trim(),match=raw.match(/(?:^|[^\d.,])([+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([^\d\s]{0,12})$/u);
  if(!match)return null;
  const number=match[1],at=raw.lastIndexOf(number),value=svgChartNumber(number);
  return value===null?null:{value,format:svgChartFormat(number),before:raw.slice(0,at),after:raw.slice(at+number.length)};
}
function svgStackSeriesText(parsed,category) {
  if(!parsed||!parsed.before.includes(category))return '';
  return parsed.before.replace(category,'').replace(/^[\s·:：|/—–\-]+|[\s·:：|/—–\-]+$/g,'').trim().slice(0,150);
}
function svgStackAxes(orientation,texts,lines) {
  const vertical=orientation==='vertical',groups=[];
  for(const line of lines){
    if(vertical?Math.abs(line.y1-line.y2)>.1:Math.abs(line.x1-line.x2)>.1)continue;
    const start=vertical?Math.min(line.x1,line.x2):Math.min(line.y1,line.y2),end=vertical?Math.max(line.x1,line.x2):Math.max(line.y1,line.y2),pos=vertical?line.y1:line.x1;
    if(end-start<60)continue;
    const labels=texts.filter(t=>t.value!==null&&t.value>=0&&(vertical?t.x<start&&start-t.x<100&&Math.abs(t.y-pos)<Math.max(10,t.size*.8):t.y>end&&t.y-end<80&&Math.abs(t.x-pos)<Math.max(10,t.size*.5)));
    if(labels.length!==1)continue;
    let group=groups.find(g=>Math.abs(g[0].start-start)<1&&Math.abs(g[0].end-end)<1);if(!group)groups.push(group=[]);
    group.push({line:line.el,label:labels[0],value:labels[0].value,pos,start,end});
  }
  return groups.filter(ticks=>{
    ticks.sort((a,b)=>a.value-b.value);if(ticks.length<3||ticks.length>30||ticks[0].value!==0||new Set(ticks.map(t=>t.value)).size!==ticks.length)return false;
    const zero=ticks[0].pos,max=ticks.at(-1).value,scale=(ticks.at(-1).pos-zero)/max;
    return max>0&&max<=1e12&&(vertical?scale<0:scale>0)&&ticks.every(t=>Math.abs(t.pos-zero-t.value*scale)<1.2&&svgChartFormat(t.label.text).suffix===svgChartFormat(ticks[0].label.text).suffix);
  });
}
function detectSVGStacks(svg,orientation,texts,rects,lines) {
  const vertical=orientation==='vertical',results=[];
  if([...svg.querySelectorAll('text')].some(el=>svgStackValueText(el.textContent)&&!texts.some(t=>t.el===el)))return [];
  const numericTexts=texts.map(t=>{const template=svgStackValueText(t.text);return {...t,template,value:t.value??template?.value??null};});
  for(const ticks of svgStackAxes(orientation,texts,lines)){
    const zero=ticks[0].pos,far=ticks.at(-1).pos,originalMax=ticks.at(-1).value,scale=(far-zero)/originalMax,unit=Math.abs(scale),start=ticks[0].start,end=ticks[0].end;
    const groups=[],used=new Set(ticks.map(t=>t.label.el));let invalid=false;
    // Every data-sized rectangle in this plot must belong to a stack. Reject gaps,
    // backgrounds and unexplained extra marks instead of silently editing a subset.
    const swatches=rects.flatMap(r=>{
      if(r.width<=0||r.height<=0||r.width>40||r.height>40||r.el.hasAttribute('data-value')||svgStackValueText(r.el.querySelector('title')?.textContent||'')||svgStackValueText(r.el.getAttribute('aria-label')||''))return [];
      const labels=texts.filter(t=>t.value===null&&t.x>r.x+r.width&&t.x-r.x-r.width<30&&Math.abs(t.y-r.y-r.height/2)<Math.max(12,t.size*.7));
      return labels.length===1?[{r,label:labels[0]}]:[];
    });
    const plot=rects.filter(r=>{const c=vertical?r.x+r.width/2:r.y+r.height/2;return c>start&&c<end&&(vertical?r.width:r.height)>2&&!swatches.some(s=>s.r===r);});
    if(plot.some(r=>vertical?r.y+r.height>zero+1:r.x<zero-1))continue;
    if(plot.length<2||plot.length>200)continue;
    for(const r of plot){
      const base=vertical?r.y+r.height:r.x,length=vertical?r.height:r.width,cross=vertical?r.x:r.y,thickness=vertical?r.width:r.height;
      if(length<0||['x','y','width','height'].some(p=>Math.abs(parseFloat(svgChartStyle(r.el)[p])-r[p])>.5)){invalid=true;break;}
      let group=groups.find(g=>Math.abs(g.cross-cross)<.5&&Math.abs(g.thickness-thickness)<.5);
      if(!group)groups.push(group={cross,thickness,center:cross+thickness/2,bars:[]});
      group.bars.push({...r,base,length,tip:vertical?r.y:r.x+r.width,color:svgChartStyle(r.el).fill});
    }
    if(invalid||groups.length>100)continue;
    groups.sort((a,b)=>a.cross-b.cross);
    const count=groups[0].bars.length;if(count<2||count>12||groups.some(g=>g.bars.length!==count))continue;
    for(const group of groups){
      group.bars.sort((a,b)=>Math.abs(a.base-zero)-Math.abs(b.base-zero)||a.length-b.length);
      let boundary=zero;
      for(const bar of group.bars){if(Math.abs(bar.base-boundary)>1){invalid=true;break;}boundary=bar.tip;}
      if(invalid)break;
      let categories=texts.filter(t=>!used.has(t.el)&&(vertical?t.y>zero+5&&t.y-zero<120&&Math.abs(t.x-group.center)<Math.max(12,group.thickness*.3):t.x<zero-5&&zero-t.x<180&&Math.abs(t.y-group.center)<Math.max(10,t.size*.6)));
      if(categories.length){const nearest=vertical?Math.min(...categories.map(t=>t.y)):Math.max(...categories.map(t=>t.x));categories=categories.filter(t=>Math.abs((vertical?t.y:t.x)-nearest)<2);}
      if(categories.length!==1){invalid=true;break;}group.label=categories[0];used.add(group.label.el);
      for(const bar of group.bars){
        const inside=numericTexts.filter(t=>!used.has(t.el)&&t.value!==null&&(vertical?Math.abs(t.x-group.center)<Math.max(3,group.thickness*.3)&&t.y>bar.y&&t.y<=bar.y+bar.height:Math.abs(t.y-group.center)<Math.max(10,t.size*.65)&&t.x>bar.x&&t.x<bar.x+bar.width));
        if(inside.length>1){invalid=true;break;}
        const label=inside[0]||null,title=svgStackValueText(bar.el.querySelector('title')?.textContent||''),aria=svgStackValueText(bar.el.getAttribute('aria-label')||'');
        const data=bar.el.hasAttribute('data-value')?svgChartNumber(bar.el.getAttribute('data-value')):null;
        if(bar.el.hasAttribute('data-value')&&data===null){invalid=true;break;}
        const sources=[label?.value,title?.value,aria?.value,data].filter(v=>v!==null&&v!==undefined);
        if(!sources.length||sources.some(v=>v<0||v>1e12||Math.abs(v-sources[0])>Math.max(1e-6,Math.abs(v)*1e-8))||Math.abs(bar.length-sources[0]*unit)>Math.max(1.2,bar.length*.005)){invalid=true;break;}
        bar.value=sources[0];bar.label=label;bar.format=label?(label.template?.format||svgChartFormat(label.text)):(title||aria)?.format||svgChartFormat(String(data));bar.titleTemplate=title;bar.ariaTemplate=aria;
        bar.seriesName=bar.el.getAttribute('data-series')||svgStackSeriesText(title,group.label.text)||svgStackSeriesText(aria,group.label.text);
        if(label)used.add(label.el);
      }
      if(invalid)break;
      group.total=group.bars.reduce((n,b)=>n+b.value,0);const tip=group.bars.at(-1).tip;
      const totals=numericTexts.filter(t=>!used.has(t.el)&&t.value!==null&&(vertical?Math.abs(t.x-group.center)<Math.max(4,group.thickness*.3)&&t.y<tip&&tip-t.y<Math.max(60,t.size*2):t.x>tip&&t.x-tip<Math.max(90,t.size*3)&&Math.abs(t.y-group.center)<Math.max(10,t.size*.65)));
      if(totals.length>1||(totals.length===1&&Math.abs(totals[0].value-group.total)>Math.max(1e-6,group.total*1e-8))){invalid=true;break;}
      group.totalLabel=totals[0]||null;if(group.totalLabel)used.add(group.totalLabel.el);
    }
    if(invalid)continue;
    const legend=svgChartLegend(svg);
    for(const {r,label} of swatches)legend.push({color:svgChartStyle(r.el).fill,name:label.text});
    const series=[];
    for(let c=0;c<count;c++){
      const bars=groups.map(g=>g.bars[c]),names=bars.map(b=>b.seriesName),palette=legend.filter(l=>l.color===bars[0].color);
      const sameNames=names.every(n=>n&&n===names[0]),sameColors=bars.every(b=>b.color===bars[0].color);
      if((names.some(Boolean)&&!sameNames)||(!sameNames&&!sameColors)){invalid=true;break;}
      series.push(palette.length===1?palette[0].name:sameNames?names[0]:`系列 ${c+1}（${vertical?'自下而上':'自左向右'}）`);
    }
    if(invalid)continue;
    // Extra unbound numeric marks within a stack may be a second metric or a label
    // layout we cannot safely update. Do not leave them stale after an edit.
    if(numericTexts.some(t=>t.value!==null&&!used.has(t.el)&&groups.some(g=>vertical?Math.abs(t.x-g.center)<g.thickness/2&&t.y>g.bars.at(-1).tip-50&&t.y<zero:Math.abs(t.y-g.center)<g.thickness/2&&t.x>zero&&t.x<g.bars.at(-1).tip+80)))continue;
    results.push({kind:'stacked',orientation,zero,far,originalMax,ticks,groups,series,bars:groups.flatMap(g=>g.bars),originalLimit:Math.max(originalMax,...groups.map(g=>g.total))});
  }
  return results;
}
function bindSVGStack(svg,analysis) {
  svg.querySelectorAll(`[${SVG_MARK_ATTR}]`).forEach(el=>el.removeAttribute(SVG_MARK_ATTR));
  const model={version:2,kind:'stacked',orientation:analysis.orientation,zero:analysis.zero,far:analysis.far,originalMax:analysis.originalMax,originalLimit:analysis.originalLimit,
    categories:analysis.groups.map(g=>g.label.text),series:analysis.series,ticks:[],bars:[],totals:[]};
  const axisFormat={comma:analysis.ticks.some(t=>t.label.text.includes(',')),decimals:Math.max(...analysis.ticks.map(t=>svgChartFormat(t.label.text).decimals)),suffix:svgChartFormat(analysis.ticks[0].label.text).suffix};
  analysis.ticks.forEach((t,i)=>{const key=`tick-${i}`;t.label.el.setAttribute(SVG_MARK_ATTR,key);model.ticks.push({key,value:t.value,format:axisFormat});});
  const vertical=analysis.orientation==='vertical';
  for(const [row,group] of analysis.groups.entries()){
    if(group.totalLabel){const t=group.totalLabel,key=`total-${row}`;t.el.setAttribute(SVG_MARK_ATTR,key);model.totals.push({key,row,offset:(vertical?t.y:t.x)-group.bars.at(-1).tip,format:t.template?.format||svgChartFormat(t.text),template:t.template});}
    group.bars.forEach((b,column)=>{
      const key=`bar-${row}-${column}`,labelKey=b.label?`value-${row}-${column}`:null;b.el.setAttribute(SVG_MARK_ATTR,key);
      const record={key,labelKey,row,column,value:b.value,format:b.format,geometry:{x:b.x,y:b.y,width:b.width,height:b.height},titleTemplate:b.titleTemplate,ariaTemplate:b.ariaTemplate,dataValue:b.el.hasAttribute('data-value')};
      if(b.label){const t=b.label;t.el.setAttribute(SVG_MARK_ATTR,labelKey);const box=t.el.getBBox();Object.assign(record,{labelTemplate:t.template,labelOffset:(vertical?t.y:t.x)-(vertical?b.y+b.height/2:b.x+b.width/2),labelExtent:(vertical?box.height:box.width)+2,labelVisibility:{value:t.el.style.getPropertyValue('visibility'),priority:t.el.style.getPropertyPriority('visibility')}});}
      model.bars.push(record);
    });
  }
  svg.setAttribute(SVG_CHART_ATTR,JSON.stringify(model));return model;
}
function readSVGStack(svg,model) {
  const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e15;
  const format=f=>f&&typeof f.comma==='boolean'&&Number.isInteger(f.decimals)&&f.decimals>=0&&f.decimals<=8&&['','%','％'].includes(f.suffix);
  const names=(a,max)=>Array.isArray(a)&&a.length>0&&a.length<=max&&a.every(s=>typeof s==='string'&&s.length<=500);
  if(model.version!==2||model.kind!=='stacked'||!['vertical','horizontal'].includes(model.orientation)||!finite(model.zero)||!finite(model.far)||(model.orientation==='vertical'?model.zero<=model.far:model.zero>=model.far)||!finite(model.originalMax)||model.originalMax<=0||model.originalMax>1e12||!finite(model.originalLimit)||model.originalLimit<model.originalMax||!names(model.categories,100)||!names(model.series,12)||!Array.isArray(model.bars)||model.bars.length>200||model.bars.length!==model.categories.length*model.series.length||!Array.isArray(model.ticks)||model.ticks.length<3||model.ticks.length>30||!Array.isArray(model.totals)||model.totals.length>model.categories.length)throw Error('堆叠图绑定数据无效，请重新识别');
  const keys=new Set(),cells=new Set(),rows=new Set();
  const mark=(key,tag)=>{if(keys.has(key))throw Error('堆叠图标记重复');keys.add(key);const el=svgChartMark(svg,key,tag);if(tag==='text'&&!svgChartTextLeaf(el))throw Error('堆叠图标签结构已改变');return el;};
  const template=t=>t===null||(t&&typeof t.before==='string'&&t.before.length<=1000&&typeof t.after==='string'&&t.after.length<=100&&format(t.format));
  for(const [i,t] of model.ticks.entries()){mark(t.key,'text');if(!finite(t.value)||t.value<0||!format(t.format)||(i===0?t.value!==0:t.value<=model.ticks[i-1].value))throw Error('堆叠图坐标轴无效');}
  if(model.ticks.at(-1).value!==model.originalMax)throw Error('堆叠图量程无效');
  for(const b of model.bars){mark(b.key,'rect');if(!Number.isInteger(b.row)||b.row<0||b.row>=model.categories.length||!Number.isInteger(b.column)||b.column<0||b.column>=model.series.length||cells.has(`${b.row}:${b.column}`)||!finite(b.value)||b.value<0||b.value>1e12||!b.geometry||!['x','y','width','height'].every(k=>finite(b.geometry[k]))||b.geometry.width<0||b.geometry.height<0||!format(b.format)||!template(b.titleTemplate)||!template(b.ariaTemplate)||typeof b.dataValue!=='boolean')throw Error('堆叠分段绑定无效');cells.add(`${b.row}:${b.column}`);
    if(b.labelKey!==null){mark(b.labelKey,'text');if(!template(b.labelTemplate)||!finite(b.labelOffset)||!finite(b.labelExtent)||b.labelExtent<0||!b.labelVisibility||typeof b.labelVisibility.value!=='string'||!['','visible','hidden','collapse'].includes(b.labelVisibility.value)||!['','important'].includes(b.labelVisibility.priority))throw Error('堆叠标签绑定无效');}
  }
  for(const t of model.totals){mark(t.key,'text');if(!Number.isInteger(t.row)||t.row<0||t.row>=model.categories.length||rows.has(t.row)||!finite(t.offset)||!format(t.format)||!template(t.template))throw Error('堆叠合计绑定无效');rows.add(t.row);}
  return model;
}
function updateSVGStack(svg,model) {
  readSVGStack(svg,model);
  const sums=model.categories.map((_,row)=>model.bars.filter(b=>b.row===row).reduce((n,b)=>n+b.value,0));
  const maximum=Math.max(...sums)>model.originalLimit?svgChartNiceMax(Math.max(...sums),model.ticks.length-1):model.originalMax;
  const scale=(model.far-model.zero)/maximum,vertical=model.orientation==='vertical';
  for(let row=0;row<model.categories.length;row++){
    let cumulative=0;
    for(const b of model.bars.filter(b=>b.row===row).sort((a,b)=>a.column-b.column)){
      const rect=svgChartMark(svg,b.key,'rect'),base=model.zero+cumulative*scale,tip=model.zero+(cumulative+b.value)*scale,length=Math.abs(b.value*scale);
      svgChartSetNumber(rect,vertical?'y':'x',vertical?tip:base);svgChartSetNumber(rect,vertical?'height':'width',length);
      if(b.labelKey){const label=svgChartMark(svg,b.labelKey,'text');svgChartSetNumber(label,vertical?'y':'x',(base+tip)/2+b.labelOffset);svgChartSetText(label,b.labelTemplate?b.labelTemplate.before+svgChartDisplay(b.value,b.labelTemplate.format)+b.labelTemplate.after:svgChartDisplay(b.value,b.format));if(length<b.labelExtent)label.style.setProperty('visibility','hidden','important');else if(b.labelVisibility.value)label.style.setProperty('visibility',b.labelVisibility.value,b.labelVisibility.priority);else label.style.removeProperty('visibility');}
      for(const [template,node,attr] of [[b.titleTemplate,rect.querySelector('title'),null],[b.ariaTemplate,rect,'aria-label']])if(template&&node){const text=template.before+svgChartDisplay(b.value,template.format)+template.after;attr?node.setAttribute(attr,text):node.textContent=text;}
      if(b.dataValue)rect.setAttribute('data-value',String(b.value));cumulative+=b.value;
    }
    const total=model.totals.find(t=>t.row===row);if(total){const label=svgChartMark(svg,total.key,'text');svgChartSetNumber(label,vertical?'y':'x',model.zero+cumulative*scale+total.offset);svgChartSetText(label,total.template?total.template.before+svgChartDisplay(cumulative,total.template.format)+total.template.after:svgChartDisplay(cumulative,total.format));}
  }
  for(const t of model.ticks)svgChartSetText(svgChartMark(svg,t.key,'text'),svgChartDisplay(t.value/model.originalMax*maximum,t.format));
  model.maximum=maximum;svg.setAttribute(SVG_CHART_ATTR,JSON.stringify(model));
}

const svgWaterfall=createSVGWaterfallAdapter({number:svgChartNumber,format:svgChartFormat,display:svgChartDisplay,style:svgChartStyle,textLeaf:svgChartTextLeaf,mark:svgChartMark,setNumber:svgChartSetNumber,setText:svgChartSetText,untransformed:svgChartUntransformed,niceMax:svgChartNiceMax,markAttr:SVG_MARK_ATTR,chartAttr:SVG_CHART_ATTR});
const svgBubble=createSVGBubbleAdapter({number:svgChartNumber,format:svgChartFormat,display:svgChartDisplay,style:svgChartStyle,attribute:svgChartAttribute,textLeaf:svgChartTextLeaf,mark:svgChartMark,setNumber:svgChartSetNumber,untransformed:svgChartUntransformed,markAttr:SVG_MARK_ATTR,chartAttr:SVG_CHART_ATTR,preview:svgChartPreview,escapeHTML});

export function analyzeSVGBarChart(svg) {
  if(!svg||svg.tagName.toLowerCase()!=='svg')return{error:'请选择完整的 SVG 图表。'};
  if(svg.querySelectorAll('*').length>3000)return{error:'这张 SVG 结构过大，暂不自动建立数据绑定。'};
  if(svg.querySelector('script,foreignObject,use,animate,animateTransform,animateMotion,set'))return{error:'这张 SVG 含动态或引用结构，暂不能可靠地保留样式绑定数据。'};
  if([...svg.querySelectorAll('rect,text,line,circle')].some(el=>!svgChartUntransformed(el,svg)))return{error:'这张图内部存在变换，暂不能可靠识别数据。暂不能保留原样式编辑数据。'};
  const texts=svgChartTexts(svg);
  const rects=[...svg.querySelectorAll('rect')].filter(el=>svgChartUntransformed(el,svg)).map(el=>({el,x:svgChartAttribute(el,'x'),y:svgChartAttribute(el,'y'),width:svgChartAttribute(el,'width'),height:svgChartAttribute(el,'height')})).filter(r=>[r.x,r.y,r.width,r.height].every(n=>n!==null)&&r.width>=0&&r.height>=0);
  const lines=[...svg.querySelectorAll('line')].filter(el=>svgChartUntransformed(el,svg)).map(el=>({el,...Object.fromEntries(['x1','x2','y1','y2'].map(p=>[p,svgChartAttribute(el,p)]))})).filter(l=>[l.x1,l.x2,l.y1,l.y2].every(n=>n!==null));
  if(svg.querySelector('circle')){
    const bubbles=svgBubble.analyze(svg,texts,rects,lines);
    return bubbles.length===1?bubbles[0]:{error:'这张含圆形的图暂不能可靠绑定气泡数据。需要明确的 X、Y 和面积数值（提示文字或 data-x / data-y / data-size）、线性双坐标轴，以及一致的面积比例；缺失数值、结构复杂或比例不符时不能仅凭像素猜测数据。'};
  }
  const candidates=['vertical','horizontal'].flatMap(direction=>detectSVGChartDirection(svg,direction,texts,rects,lines));
  if(!candidates.length)candidates.push(...['vertical','horizontal'].flatMap(direction=>detectSVGStacks(svg,direction,texts,rects,lines)));
  if(!candidates.length)candidates.push(...svgWaterfall.analyze(svg,texts,rects,lines));
  if(candidates.length!==1)return{error:'未能可靠对应柱形、数值和坐标轴。支持普通矩形柱状图、连续堆叠图和具有明确累计关系及连接线的瀑布图；堆叠分段需有可读数值（标签、提示文字或 data-value）、线性刻度和一致的系列对应。缺少数据、比例不符、不受支持的负向累计或复杂路径时需确认转换。'};
  return candidates[0];
}

export function bindSVGBarChart(svg,analysis) {
  if(analysis.kind==='bubble')return svgBubble.bind(svg,analysis);
  if(analysis.kind==='waterfall')return svgWaterfall.bind(svg,analysis);
  if(analysis.kind==='stacked')return bindSVGStack(svg,analysis);
  svg.querySelectorAll(`[${SVG_MARK_ATTR}]`).forEach(el=>el.removeAttribute(SVG_MARK_ATTR));
  const model={version:1,orientation:analysis.orientation,zero:analysis.zero,far:analysis.far,originalMax:analysis.originalMax,
    categories:analysis.groups.map(g=>g.label.text),series:analysis.series,ticks:[],bars:[]};
  const axisFormat={comma:analysis.ticks.some(t=>t.label.text.includes(',')),decimals:Math.max(...analysis.ticks.map(t=>svgChartFormat(t.label.text).decimals)),suffix:svgChartFormat(analysis.ticks[0].label.text).suffix};
  analysis.ticks.forEach((tick,i)=>{
    const key=`tick-${i}`;tick.label.el.setAttribute(SVG_MARK_ATTR,key);
    model.ticks.push({key,value:tick.value,format:axisFormat});
  });
  analysis.groups.forEach((group,row)=>group.bars.forEach((bar,column)=>{
    const key=`bar-${row}-${column}`,labelKey=`value-${row}-${column}`;
    bar.el.setAttribute(SVG_MARK_ATTR,key);bar.label.el.setAttribute(SVG_MARK_ATTR,labelKey);
    model.bars.push({key,labelKey,row,column,value:bar.value,format:svgChartFormat(bar.label.text),
      labelOffset:analysis.orientation==='vertical'?bar.label.y-bar.tip:bar.label.x-bar.tip,
      geometry:{x:bar.x,y:bar.y,width:bar.width,height:bar.height},title:bar.el.querySelector('title')?.textContent || ''});
  }));
  svg.setAttribute(SVG_CHART_ATTR,JSON.stringify(model));
  return model;
}
function svgChartMark(svg,key,tag) {
  if(typeof key!=='string'||!/^[-\w]{1,80}$/.test(key))throw Error('图表绑定标记无效');
  const nodes=svg.querySelectorAll(`[${SVG_MARK_ATTR}="${key}"]`);
  if(nodes.length!==1||nodes[0].tagName.toLowerCase()!==tag)throw Error('图表结构已改变，请撤回结构修改或重新识别数据');
  return nodes[0];
}
export function readSVGBarModel(svg,model=JSON.parse(svg.getAttribute(SVG_CHART_ATTR))) {
  if(model?.version===4)return svgBubble.read(svg,model);
  if(model?.version===3)return svgWaterfall.read(svg,model);
  if(model?.version===2)return readSVGStack(svg,model);
  const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e15;
  const format=f=>f&&typeof f.comma==='boolean'&&Number.isInteger(f.decimals)&&f.decimals>=0&&f.decimals<=8&&['','%','％'].includes(f.suffix);
  const names=a=>Array.isArray(a)&&a.length>0&&a.every(n=>typeof n==='string'&&n.length<=500);
  if(model?.version!==1||!['vertical','horizontal'].includes(model.orientation)||!Number.isFinite(model.zero)||!Number.isFinite(model.far)||
    !finite(model.originalMax)||!(model.originalMax>0&&model.originalMax<=1e12)||!Number.isFinite((model.far-model.zero)/model.originalMax)||!Array.isArray(model.bars)||!model.bars.length||model.bars.length>200||
    !Array.isArray(model.ticks)||model.ticks.length<3||model.ticks.length>30||!names(model.categories)||model.categories.length>100||!names(model.series)||model.series.length>12||
    !finite(model.zero)||!finite(model.far)||(model.orientation==='vertical'?model.zero<=model.far:model.zero>=model.far)||model.bars.length!==model.categories.length*model.series.length)throw Error('图表绑定数据无效，请重新识别');
  const keys=new Set(),cells=new Set();
  const mark=(key,tag)=>{if(keys.has(key))throw Error('图表绑定标记重复');keys.add(key);const el=svgChartMark(svg,key,tag);if(tag==='text'&&!svgChartTextLeaf(el))throw Error('数字标签结构已改变，不能可靠更新');return el;};
  for(const [i,tick] of model.ticks.entries()){
    mark(tick.key,'text');
    if(!finite(tick.value)||tick.value<0||tick.value>model.originalMax||!format(tick.format)||(i===0?tick.value!==0:tick.value<=model.ticks[i-1].value))throw Error('坐标轴绑定无效');
  }
  if(model.ticks.at(-1).value!==model.originalMax)throw Error('坐标轴量程无效');
  for(const bar of model.bars){
    mark(bar.key,'rect');mark(bar.labelKey,'text');
    if(!finite(bar.value)||bar.value<0||bar.value>1e12||!finite(bar.labelOffset)||!bar.geometry||!['x','y','width','height'].every(k=>finite(bar.geometry[k]))||bar.geometry.width<=0||bar.geometry.height<=0||!format(bar.format)||!Number.isInteger(bar.row)||!Number.isInteger(bar.column)||bar.row<0||bar.row>=model.categories.length||bar.column<0||bar.column>=model.series.length||cells.has(`${bar.row}:${bar.column}`))throw Error('柱形绑定无效');
    cells.add(`${bar.row}:${bar.column}`);
  }
  return model;
}
function svgChartNiceMax(value,intervals) {
  const raw=value/intervals,power=10**Math.floor(Math.log10(raw)),unit=[1,2,2.5,5,10].find(n=>n*power>=raw)||10;
  return unit*power*intervals;
}
function svgChartSetNumber(el,name,value) {
  const clean=String(Math.round(value*1e8)/1e8);el.setAttribute(name,clean);
  // Inline geometry is changed only if the original cascade overrides the attribute.
  const computed=parseFloat(svgChartStyle(el).getPropertyValue(name));
  if(Number.isFinite(computed)&&Math.abs(computed-Number(clean))>.01)el.style.setProperty(name,clean+'px','important');
}
function svgChartSetText(el,text) {
  svgChartTextLeaf(el).textContent=text;
}
export function updateSVGBarChart(svg,model) {
  if(model?.version===4)return svgBubble.update(svg,model);
  if(model?.version===3)return svgWaterfall.update(svg,model);
  if(model?.version===2)return updateSVGStack(svg,model);
  // Validate every reference before making any changes.
  readSVGBarModel(svg,model);
  const maxValue=Math.max(...model.bars.map(b=>b.value)),maximum=maxValue>model.originalMax?svgChartNiceMax(maxValue,model.ticks.length-1):model.originalMax;
  const scale=(model.far-model.zero)/maximum,vertical=model.orientation==='vertical';
  for(const bar of model.bars){
    const rect=svgChartMark(svg,bar.key,'rect'),label=svgChartMark(svg,bar.labelKey,'text'),tip=model.zero+bar.value*scale;
    svgChartSetNumber(rect,vertical?'y':'x',vertical?tip:model.zero);
    svgChartSetNumber(rect,vertical?'height':'width',Math.abs(tip-model.zero));
    svgChartSetNumber(label,vertical?'y':'x',tip+bar.labelOffset);
    svgChartSetText(label,svgChartDisplay(bar.value,bar.format));
    const title=rect.querySelector('title');if(title)title.textContent=`${model.categories[bar.row]} · ${model.series[bar.column]}：${svgChartDisplay(bar.value,bar.format)}`;
  }
  for(const tick of model.ticks)svgChartSetText(svgChartMark(svg,tick.key,'text'),svgChartDisplay(tick.value/model.originalMax*maximum,tick.format));
  model.maximum=maximum;svg.setAttribute(SVG_CHART_ATTR,JSON.stringify(model));
}

export function changeSVGChartStructure(editor,svg,model,change) {
  return model.kind==='bubble' ? svgBubble.changeStructure(editor,svg,model,change) : changeSVGStructure(editor,svg,model,change,updateSVGBarChart);
}

let svgChartPreviewId=0;
function svgChartPreview(svg) {
  const clone=svg.cloneNode(true),originals=[svg,...svg.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
  const prefix=`svg-chart-preview-${++svgChartPreviewId}-`,ids=new Map();
  originals.forEach((node,i)=>{if(node.id)ids.set(node.id,prefix+i);});
  const localURLs=value=>value.replace(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g,(_,url)=>{const id=url.slice(url.lastIndexOf('#')+1);return ids.has(id)?`url(#${ids.get(id)})`:'none';});
  copies.forEach((node,i)=>{
    if(['script','foreignObject','use','image','animate','animateTransform','animateMotion','set','style'].includes(node.tagName)){node.remove();return;}
    for(const attr of [...node.attributes])if(/^on/i.test(attr.name)||['id','href','xlink:href',SVG_CHART_ATTR].includes(attr.name))node.removeAttribute(attr.name);
    if(originals[i].id)node.id=ids.get(originals[i].id);
    for(const attr of [...node.attributes])if(attr.value.includes('url('))node.setAttribute(attr.name,localURLs(attr.value));
    const style=svgChartStyle(originals[i]);
    for(const prop of ['font-family','font-size','font-weight','font-style','fill','stroke','stroke-width','stroke-dasharray','text-anchor','dominant-baseline','letter-spacing','opacity','color','stop-color','stop-opacity','visibility','display','clip-path','mask','filter'])node.style.setProperty(prop,localURLs(style.getPropertyValue(prop)));
  });
  clone.style.width='100%';clone.style.height='auto';clone.style.maxHeight='420px';clone.style.display='block';
  return clone;
}

export function installSVGCharts(Editor,{modal,closeModal}) {
  const q=selector=>document.querySelector(selector);
  Editor.prototype.svgChartTarget=function(){const node=this.nodes.length===1?this.nodes[0]:null;return node?.matches('svg')&&!node.closest('[data-studio-chart]')?node:null;};
  Editor.prototype.openChartDataEditor=function(){
    const source=this.nodes.length===1?this.nodes[0]:null;
    if(!source||this.loading||this.preview||this.locked(source))return false;
    const native=source.closest('[data-studio-chart],table');
    if(native)return this.openDataEditor(native);
    const boundHTML=source.closest('[data-studio-html-chart]');
    if(boundHTML)return this.openHTMLBarEditor(boundHTML,source);
    const canvases=source.matches('canvas')?[source]:source.querySelectorAll('canvas');
    if(canvases.length===1)return this.openCanvasChartEditor(canvases[0],{fallbackSource:source});
    // A selected chart card can keep its legend and container while binding its SVG.
    const children=source.matches('svg')?[]:source.querySelectorAll('svg');
    const svg=source.matches('svg')?source:children.length===1?children[0]:null;
    if(svg&&!svg.closest('[data-studio-chart]'))return this.openSVGChartEditor(svg,null,{fallbackSource:source});
    return this.openHTMLBarEditor(htmlBarTarget(source),source);
  };
  Editor.prototype.openSVGChartEditor=function(svg=this.svgChartTarget(),clicked=null,{quiet=false,fallbackSource=svg}={}){
    if(!svg||this.loading||this.preview||this.locked(svg))return false;
    this.finishText?.();
    let model,bindingError;
    if(svg.hasAttribute(SVG_CHART_ATTR)){
      try{model=readSVGBarModel(svg);}catch(error){bindingError=error;}
    }
    if(!model){
      const analysis=analyzeSVGBarChart(svg);
      if(analysis.error)return quiet&&!bindingError?false:this.convertDataChart(fallbackSource,{reason:bindingError?'原图的数据绑定已失效，重新识别也未能可靠对应数值和柱形。'+analysis.error:analysis.error});
      if(analysis.kind==='bubble')return svgBubble.open(this,svg,clicked,{analysis,bindingError,modal,closeModal});
      const version=this.loadVersion;
      modal('识别柱状图数据 · 保留原样式',`${bindingError?'<p>原数据绑定已失效，已重新识别图表。确认后可恢复绑定并保留原样式。</p>':''}<p>识别到 ${analysis.groups.length} 个分类、${analysis.series.length} 个系列${analysis.kind==='stacked'?'（堆叠柱状图）':analysis.kind==='waterfall'?'（瀑布图 / 增量桥）':''}。请确认下面的数据与原图一致，绑定不会替换原图。</p>
        <div class="data-grid-scroll"><table class="data-grid"><thead><tr><th>分类</th>${analysis.series.map(name=>`<th>${escapeHTML(name)}</th>`).join('')}</tr></thead><tbody>${analysis.groups.map(g=>`<tr><th>${escapeHTML(g.label.text)}${g.role==='total'?'（自动合计）':''}</th>${g.bars.map(bar=>`<td style="padding:10px">${escapeHTML(analysis.kind==='waterfall'?String(bar.value):bar.label?.text||svgChartDisplay(bar.value,bar.format))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="source-note">读取原图的数值标签、提示文字或数据属性；按识别到的关系更新图形、标注与合计。页面其他表格、标题比例、说明和原始台账不会自动改动。${analysis.kind==='waterfall'?'起始值和增量可编辑，终值/小计自动求和；允许负增量，累计值须保持非负。':'当前支持非负数。'}保留分类与系列数量。</p>`,[
          {label:'取消',run:closeModal},{label:'绑定并编辑数据',primary:true,run:()=>{if(version!==this.loadVersion||!svg.isConnected||this.locked(svg))return;bindSVGBarChart(svg,analysis);this.commit('绑定 SVG 图表数据');this.openSVGChartEditor(svg,clicked);}},
        ]);
      q('#dialog').dataset.kind='svg-chart-bind';return true;
    }
    if(model.kind==='bubble')return svgBubble.open(this,svg,clicked,{model,modal,closeModal});
    const editor=this,version=this.loadVersion;
    const clickedKey=clicked?.closest(`[${SVG_MARK_ATTR}]`)?.getAttribute(SVG_MARK_ATTR);
    const chosen=model.bars.find(b=>b.key===clickedKey||b.labelKey===clickedKey);
    const body=modal('编辑 SVG 图表数据 · 保留样式',`<p>${model.kind==='waterfall'?'修改起始值或正负增量，后续柱子、连接线与终值会同步更新；小计/终值自动求和。超出原范围时统一缩放。识别到明确正负配色时，变号沿用相应配色。':model.kind==='stacked'?'修改数值后，各段尺寸、堆叠位置、标签与合计同步更新。过小的分段会暂时隐藏数字，增大后恢复。':'修改数值后，柱形和标签立即更新。'}${model.kind==='waterfall'?'':'超过原范围时会扩展坐标轴，并按同一比例调整全部柱形。'}</p>
      <div class="data-editor-workspace with-chart"><div class="data-grid-scroll"><table class="data-grid" id="svg-data-grid"><thead><tr><th>分类</th>${model.series.map(name=>`<th>${escapeHTML(name)}</th>`).join('')}</tr></thead><tbody>${model.categories.map((category,row)=>`<tr><th>${escapeHTML(category)}${model.kind==='waterfall'&&model.bars[row]?.role==='total'?'<small class="chart-auto-total">自动合计</small>':''}</th>${model.series.map((series,column)=>{const bar=model.bars.find(b=>b.row===row&&b.column===column);return`<td><input data-svg-bar="${bar.key}" aria-label="${escapeHTML(category+' · '+series)}" value="${bar.value}" ${bar.role==='total'?'readonly title="自动合计：由起始值和增量计算"':''} inputmode="decimal" spellcheck="false"></td>`;}).join('')}</tr>`).join('')}</tbody></table></div><div class="data-live-preview"><span>原图实时预览</span><div id="svg-chart-preview"></div></div></div>
      <p id="svg-chart-status" aria-live="polite"></p><p class="source-note">仅修改本图；右侧表格、标题比例、其他图表和原始台账不会自动联动。${model.kind==='waterfall'?'面板显示计算值，原图标签与提示按各自的小数位显示。增量支持正负数，起始值和每一步累计值须在 0 至 1 万亿之间；自动合计不可直接输入。':'支持 0 至 1 万亿的数值，不支持负数。'}可在上方增删分类/系列并修改名称；新增项继承所选样式，可使用撤回恢复。</p>`,[{label:'完成',primary:true,run:closeModal}]);
    q('#dialog').dataset.kind='svg-chart-data';
    q('#dialog').dataset.chartKind=model.kind||'regular';
    let pending=false;
    const validTarget=()=>svg.isConnected&&svg.ownerDocument===editor.doc&&version===editor.loadVersion&&!editor.locked(svg);
    const preview=()=>{
      const container=q('#svg-chart-preview');if(!container)return;
      container.replaceChildren(svgChartPreview(svg));
      for(let node=svg;node;node=node.parentElement){const color=svgChartStyle(node).backgroundColor;if(color&&color!=='rgba(0, 0, 0, 0)'&&color!=='transparent'){container.style.backgroundColor=color;break;}}
    };
    const flush=()=>{if(pending&&validTarget()){pending=false;editor.commit('修改 SVG 图表数据');}};
    q('#dialog').flushData=flush;
    bindDataPaste(body.querySelector('#svg-data-grid'),{
      valid:validTarget,rowNames:()=>model.categories,columnNames:()=>model.series,
      skip:(row,column)=>model.bars.find(b=>b.row===row&&b.column===column)?.role==='total',
      apply:changes=>{
        const next=structuredClone(model);
        for(const cell of changes)next.bars.find(b=>b.row===cell.row&&b.column===cell.column).value=pasteNumber(cell.raw,{negative:model.kind==='waterfall'});
        // Validate against the live cascade: detached SVG nodes have empty computed transforms.
        readSVGBarModel(svg,next);
        flush();updateSVGBarChart(svg,next);model=next;
        for(const b of model.bars){const input=body.querySelector(`[data-svg-bar="${b.key}"]`);input.value=b.value;input.removeAttribute('aria-invalid');}
        preview();editor.commit('批量粘贴 SVG 图表数据');q('#svg-chart-status').textContent='整批数据已更新，保留原图样式。';
      }
    });
    body.querySelector('#svg-data-grid').addEventListener('input',event=>{
      const input=event.target;if(!input.matches('[data-svg-bar]')||input.readOnly||!validTarget())return;
      const value=svgChartNumber(input.value);
      if(value===null||(value<0&&model.kind!=='waterfall')||Math.abs(value)>1e12||/[%％]/.test(input.value)){input.setAttribute('aria-invalid','true');q('#svg-chart-status').textContent=model.kind==='waterfall'?'请输入 -1 万亿至 1 万亿的有效数值；此次无效输入未应用。':'请输入 0 至 1 万亿的有效数值；当前无效输入未应用，图表保留上一次有效结果。';return;}
      input.removeAttribute('aria-invalid');
      const next=JSON.parse(JSON.stringify(model));next.bars.find(b=>b.key===input.dataset.svgBar).value=value;
      try{updateSVGBarChart(svg,next);model=next;pending=true;for(const b of model.bars)if(b.role==='total')body.querySelector(`[data-svg-bar="${b.key}"]`).value=b.value;preview();editor.draw();q('#svg-chart-status').textContent=model.kind==='waterfall'?`已更新 · 终值 ${model.result.toLocaleString('en-US')}${model.scaled?'（已统一缩放）':''}${model.uncertainColor?' · 正负配色不明确，变号柱保留原色，请核对':''}`:`已更新 · 坐标轴上限 ${model.maximum.toLocaleString('en-US')}${model.maximum>model.originalMax?'（已自动扩展）':''}`;}
      catch(error){input.setAttribute('aria-invalid','true');q('#svg-chart-status').textContent=error.message;}
    });
    body.querySelector('#svg-data-grid').addEventListener('change',flush);
    q('#dialog').addEventListener('cancel',flush);
    q('#dialog').addEventListener('close',()=>{flush();q('#dialog').removeEventListener('cancel',flush);if(q('#dialog').flushData===flush)delete q('#dialog').flushData;},{once:true});
    mountChartStructure(body,{rows:model.categories,columns:model.kind==='waterfall'?null:model.series,rowLabel:model.kind==='waterfall'?'步骤':'分类',minRows:model.kind==='waterfall'?3:1,columnHint:'瀑布图只有一个累计数值维度；新增行会插入增量步骤，起始值和最终合计保留。',valid:validTarget,change:change=>{if(!validTarget())return;flush();model=changeSVGChartStructure(editor,svg,model,change);editor.commit('调整 SVG 图表行列');closeModal();editor.openSVGChartEditor(svg);focusStructureChange(change);}});
    preview();
    if(chosen){const input=body.querySelector(`[data-svg-bar="${chosen.key}"]`);input?.focus();input?.select();}
    return true;
  };
}
