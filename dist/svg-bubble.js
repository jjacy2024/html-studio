import {focusStructureChange,mountChartStructure,structureTransaction,structureClone,structureText,structureNumber,updateKnownChartMotion} from './chart-structure.js';
import {bindDataPaste,pasteNumber} from './data-paste.js';
// Bind explicit three-dimensional data to existing circles. Geometry verifies the
// binding; it is never used to invent missing business values.
export function createSVGBubbleAdapter(api) {
  const {number,format,display,style,attribute,untransformed,textLeaf,mark,setNumber,markAttr,chartAttr,escapeHTML}=api;
  const dimensions=['x','y','size'],permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e12;
  const near=(a,b,t=.8)=>Math.abs(a-b)<=t;
  const formatOK=f=>f&&typeof f.comma==='boolean'&&Number.isInteger(f.decimals)&&f.decimals>=0&&f.decimals<=8&&['','%','％'].includes(f.suffix);
  const clean=s=>s.trim().replace(/^[\s,，;；|:：]+|[\s,，;；|:：]+$/g,'');

  function triple(text) {
    if(!text||text.length>2000)return null;
    // A product name may itself contain digits (e.g. 316L). Try the complete
    // text and its first colon suffix; preserve the original text in either case.
    const colon=text.search(/[:：]/),starts=[0,...(colon>=0?[colon+1]:[])];
    for(const start of starts){
      const raw=text.slice(start),matches=[...raw.matchAll(/[+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[%％]?/g)];
      if(matches.length!==3)continue;
      const slots=matches.map((m,i)=>{
        const previous=i?matches[i-1].index+matches[i-1][0].length:0;
        const lead=raw.slice(previous,m.index),segment=lead.split(/[,，;；|\n]/).at(-1),key=clean(segment).split(/[:：]/).map(clean).filter(Boolean).at(-1)||'';
        const after=raw.slice(m.index+m[0].length,i<2?matches[i+1].index:raw.length);
        const unit=format(m[0]).suffix||(after.match(/^\s*([\p{L}$€¥/²³]{1,16})(?=\s*[,，;；|\n]|\s*$)/u)?.[1]||'');
        return {start:start+m.index,end:start+m.index+m[0].length,raw:m[0],value:number(m[0]),format:format(m[0]),key,unit};
      });
      if(slots.some(s=>!s.key||s.key.length>100||s.value===null||Math.abs(s.value)>1e12||s.format.decimals>8)||new Set(slots.map(s=>s.key)).size!==3)continue;
      return {text,slots};
    }
    return null;
  }
  const roundedNear=(a,b,decimals)=>Math.abs(a-b)<=.50001*10**-decimals+1e-7;
  function axisGroups(dimension,texts,lines) {
    const x=dimension==='x',groups=[];
    for(const l of lines){
      if(x?!near(l.x1,l.x2,.1):!near(l.y1,l.y2,.1))continue;
      const start=x?Math.min(l.y1,l.y2):Math.min(l.x1,l.x2),end=x?Math.max(l.y1,l.y2):Math.max(l.x1,l.x2),pos=x?l.x1:l.y1;
      if(end-start<60)continue;
      const labels=texts.filter(t=>t.value!==null&&(x?t.y>end+3&&t.y-end<100&&Math.abs(t.x-pos)<Math.max(4,t.size*.4):t.x<start-3&&start-t.x<160&&Math.abs(t.y-pos)<Math.max(10,t.size*.7)));
      if(labels.length!==1)continue;
      let g=groups.find(g=>near(g[0].start,start)&&near(g[0].end,end));if(!g)groups.push(g=[]);
      g.push({line:l,label:labels[0],start,end,pos,value:labels[0].value});
    }
    return groups.flatMap(ticks=>{
      ticks.sort((a,b)=>a.value-b.value);
      if(ticks.length<3||ticks.length>30||new Set(ticks.map(t=>t.value)).size!==ticks.length)return [];
      const a=ticks[0],b=ticks.at(-1),scale=(b.pos-a.pos)/(b.value-a.value),offset=a.pos-a.value*scale,suffix=format(a.label.text).suffix;
      if(!Number.isFinite(scale)||(x?scale<=0:scale>=0)||ticks.some(t=>!near(t.pos,offset+t.value*scale)||format(t.label.text).suffix!==suffix))return [];
      return [{dimension,ticks,scale,offset,start:a.start,end:a.end,suffix}];
    });
  }
  function mappedTemplate(parsed,order) {
    return parsed?{text:parsed.text,slots:parsed.slots.map((s,i)=>({...s,dimension:dimensions[order.indexOf(i)]}))}:null;
  }
  function analyze(svg,texts,rects,lines) {
    if(!svg.querySelector('circle'))return [];
    if(svg.querySelector('path,polyline,polygon,ellipse,image,svg')||svg.querySelectorAll('circle').length>200)return [];
    const circles=[...svg.querySelectorAll('circle')].map(el=>({el,cx:attribute(el,'cx'),cy:attribute(el,'cy'),r:attribute(el,'r')}));
    if(circles.some(c=>!untransformed(c.el,svg)||[c.cx,c.cy,c.r].some(n=>n===null)||c.r<0||['cx','cy','r'].some(p=>Math.abs(parseFloat(style(c.el)[p])-c[p])>.5)))return [];
    const candidates=[];
    for(const ax of axisGroups('x',texts,lines))for(const ay of axisGroups('y',texts,lines)){
      const bounds={left:ay.start,right:ay.end,top:ax.start,bottom:ax.end};
      const axes={x:{...ax,min:(bounds.left-ax.offset)/ax.scale,max:(bounds.right-ax.offset)/ax.scale},y:{...ay,min:(bounds.bottom-ay.offset)/ay.scale,max:(bounds.top-ay.offset)/ay.scale}};
      if(Object.values(axes).some(a=>!finite(a.min)||!finite(a.max)||a.max<=a.min))continue;
      const inside=c=>c.cx>=bounds.left-.8&&c.cx<=bounds.right+.8&&c.cy>=bounds.top-.8&&c.cy<=bounds.bottom+.8;
      const plot=circles.filter(inside);if(plot.length<2||plot.length>100)continue;
      if(circles.some(c=>!inside(c)&&(c.el.hasAttribute('data-x')||triple(c.el.querySelector('title')?.textContent)||triple(c.el.getAttribute('aria-label')))))continue;
      const ticks=[...ax.ticks,...ay.ticks],used=new Set(ticks.map(t=>t.label.el)),grid=new Set(ticks.map(t=>t.line.el)),points=[];let invalid=false;
      // Background rectangles must cover a full horizontal or vertical plot band.
      // Other rectangles may be a second chart, which must not be partially bound.
      if(rects.some(r=>!(near(r.x,bounds.left)&&near(r.width,bounds.right-bounds.left)&&r.y>=bounds.top-.8&&r.y+r.height<=bounds.bottom+.8)&&!(near(r.y,bounds.top)&&near(r.height,bounds.bottom-bounds.top)&&r.x>=bounds.left-.8&&r.x+r.width<=bounds.right+.8)))continue;
      for(const c of plot){
        const title=triple(c.el.querySelector('title')?.textContent),aria=triple(c.el.getAttribute('aria-label'));
        const explicit=dimensions.some(d=>c.el.hasAttribute('data-'+d));
        const data=explicit?dimensions.map(d=>number(c.el.getAttribute('data-'+d)??'')):null;
        if(explicit&&data.some(v=>v===null||Math.abs(v)>1e12)){invalid=true;break;}
        const source=title||aria;
        if(!source&&!explicit){invalid=true;break;}
        const matches=[];
        for(const order of source?permutations:[[0,1,2]]){
          const values=explicit?data:order.map(i=>source.slots[i].value),formats=source?order.map(i=>source.slots[i].format):dimensions.map(d=>format(c.el.getAttribute('data-'+d)));
          if(values[2]<0||(values[2]===0?!near(c.r,0,.01):c.r<=0))continue;
          if(!['x','y'].every((d,i)=>Math.abs(c[d==='x'?'cx':'cy']-(axes[d].offset+values[i]*axes[d].scale))<=Math.abs(axes[d].scale)*.50001*10**-formats[i].decimals+.75))continue;
          if(source&&order.some((index,i)=>!roundedNear(values[i],source.slots[index].value,source.slots[index].format.decimals)))continue;
          let ariaOrder=order;
          if(title&&aria){
            let options=permutations.filter(p=>p.every((idx,i)=>roundedNear(values[i],aria.slots[idx].value,aria.slots[idx].format.decimals)));
            const named=options.filter(p=>p.every((idx,i)=>aria.slots[idx].key===title.slots[order[i]].key));if(named.length)options=named;
            if(options.length!==1)continue;ariaOrder=options[0];
          }
          matches.push({values,formats,title:mappedTemplate(title,order),aria:mappedTemplate(aria,ariaOrder),fields:source?order.map(i=>({name:source.slots[i].key,unit:source.slots[i].unit})):dimensions.map(d=>({name:d==='size'?'面积数值':d.toUpperCase(),unit:''}))});
        }
        if(!matches.length){invalid=true;break;}
        const linked=lines.filter(l=>!grid.has(l.el)&&(near(l.x1,c.cx)&&near(l.y1,c.cy)||near(l.x2,c.cx)&&near(l.y2,c.cy)));
        if(linked.length>1){invalid=true;break;}
        let label=null,leader=null;
        if(linked.length){const l=linked[0],end=near(l.x1,c.cx)&&near(l.y1,c.cy)?1:2,other=end===1?2:1;
          const labels=texts.filter(t=>!used.has(t.el)&&t.value===null&&near(t.x,l['x'+other],Math.max(8,t.size*.4))&&near(t.y,l['y'+other],Math.max(18,t.size)));
          if(labels.length!==1){invalid=true;break;}label=labels[0];leader={el:l.el,end};grid.add(l.el);
        }else{
          const labelName=c.el.getAttribute('data-label')||source?.text.split(/[:：]/)[0]||'';
          const nearby=texts.filter(t=>!used.has(t.el)&&t.value===null&&Math.hypot(t.x-c.cx,t.y-c.cy)<c.r+70&&(labelName.includes(t.text)||t.text.includes(labelName)&&labelName));
          if(nearby.length>1){invalid=true;break;}label=nearby[0]||null;
        }
        if(label)used.add(label.el);
        const name=label?.text||c.el.getAttribute('data-label')||source?.text.split(/[:：]/)[0]||`数据点 ${points.length+1}`;
        if(name.length>500){invalid=true;break;}
        points.push({...c,name,label,leader,explicit,options:matches});
      }
      if(invalid||points.length!==plot.length)continue;
      // Unmatched leaders or point-value labels would become stale after editing.
      if(lines.some(l=>!grid.has(l.el))||texts.some(t=>!used.has(t.el)&&t.x>bounds.left&&t.x<bounds.right&&t.y>bounds.top&&t.y<bounds.bottom&&(t.value!==null||triple(t.text))))continue;
      const maxRadius=Math.min(bounds.right-bounds.left,bounds.bottom-bounds.top)/2;
      if(points.some(p=>p.r>maxRadius))continue;
      // Resolve field order across the entire chart. A single point with equal
      // or nearly equal X/Y values must not create a false ambiguity.
      for(const first of points[0].options){
        const chosen=points.map(p=>p.options.filter(o=>o.fields.every((f,i)=>f.name===first.fields[i].name&&f.unit===first.fields[i].unit)));
        if(chosen.some(a=>a.length!==1))continue;
        const resolved=points.map((p,i)=>({...p,...chosen[i][0]})),areaUnits=resolved.filter(p=>p.values[2]>0).map(p=>p.r*p.r/p.values[2]);
        if(!areaUnits.length)continue;const areaUnit=areaUnits[0];
        if(!Number.isFinite(areaUnit)||areaUnit<=0||areaUnits.some(v=>Math.abs(v/areaUnit-1)>.01))continue;
        candidates.push({kind:'bubble',axes,bounds,areaUnit,maxRadius,points:resolved,fields:first.fields});
      }
    }
    return candidates;
  }
  function bind(svg,a) {
    svg.querySelectorAll(`[${markAttr}]`).forEach(el=>el.removeAttribute(markAttr));
    const m={version:4,kind:'bubble',bounds:a.bounds,areaUnit:a.areaUnit,maxRadius:a.maxRadius,fields:a.fields,axes:{},points:[]};
    for(const d of ['x','y']){const v=a.axes[d];m.axes[d]={scale:v.scale,offset:v.offset,min:v.min,max:v.max,ticks:v.ticks.map((t,i)=>{const key=`bubble-${d}-tick-${i}`,lineKey=`bubble-${d}-grid-${i}`;t.label.el.setAttribute(markAttr,key);t.line.el.setAttribute(markAttr,lineKey);return{key,lineKey};})};}
    a.points.forEach((p,i)=>{
      const key=`bubble-${i}`,labelKey=p.label?`bubble-label-${i}`:null,leaderKey=p.leader?`bubble-leader-${i}`:null;
      p.el.setAttribute(markAttr,key);p.label?.el.setAttribute(markAttr,labelKey);p.leader?.el.setAttribute(markAttr,leaderKey);
      const values=Object.fromEntries(dimensions.map((d,j)=>[d,p.values[j]]));
      m.points.push({key,labelKey,leaderKey,leaderEnd:p.leader?.end||null,name:p.name,...values,origin:{...values,cx:p.cx,cy:p.cy,r:p.r,labelX:p.label?.x??null,labelY:p.label?.y??null},title:p.title,aria:p.aria,explicit:p.explicit});
    });svg.setAttribute(chartAttr,JSON.stringify(m));return m;
  }
  function read(svg,m) {
    const fail=()=>{throw Error('气泡图数据绑定或结构已改变，请重新识别');};
    if(m?.version!==4||m.kind!=='bubble'||!m.bounds||!['left','right','top','bottom'].every(k=>finite(m.bounds[k]))||m.bounds.right<=m.bounds.left||m.bounds.bottom<=m.bounds.top||!finite(m.areaUnit)||m.areaUnit<=0||!finite(m.maxRadius)||m.maxRadius<=0||m.maxRadius>Math.min(m.bounds.right-m.bounds.left,m.bounds.bottom-m.bounds.top)/2+1||!Array.isArray(m.points)||m.points.length<1||m.points.length>100||!Array.isArray(m.fields)||m.fields.length!==3||m.fields.some(f=>!f||typeof f.name!=='string'||f.name.length>100||typeof f.unit!=='string'||f.unit.length>16))fail();
    const keys=new Set();const ref=(key,tag)=>{if(keys.has(key))fail();keys.add(key);const n=mark(svg,key,tag);if(!untransformed(n,svg)||(tag==='text'&&!textLeaf(n)))fail();return n;};
    for(const d of ['x','y']){const a=m.axes?.[d];if(!a||!['scale','offset','min','max'].every(k=>finite(a[k]))||(d==='x'?a.scale<=0:a.scale>=0)||a.max<=a.min||!Array.isArray(a.ticks)||a.ticks.length<3||a.ticks.length>30)fail();if(!near(a.offset+a.min*a.scale,m.bounds[d==='x'?'left':'bottom'])||!near(a.offset+a.max*a.scale,m.bounds[d==='x'?'right':'top']))fail();for(const t of a.ticks){ref(t.key,'text');ref(t.lineKey,'line');}}
    const template=t=>{if(t===null)return; if(!t||typeof t.text!=='string'||t.text.length>2000||!Array.isArray(t.slots)||t.slots.length!==3||new Set(t.slots.map(s=>s?.dimension)).size!==3)fail();let last=0;for(const s of t.slots){if(!s||!dimensions.includes(s.dimension)||!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start<last||s.end<=s.start||s.end>t.text.length||!formatOK(s.format)||!finite(s.value)||typeof s.raw!=='string'||s.raw!==t.text.slice(s.start,s.end)||number(s.raw)!==s.value)fail();last=s.end;}};
    for(const p of m.points){
      const n=ref(p.key,'circle');if(p.labelKey!==null)ref(p.labelKey,'text');if(p.leaderKey!==null){ref(p.leaderKey,'line');if(![1,2].includes(p.leaderEnd))fail();}
      if(typeof p.name!=='string'||p.name.length>500||typeof p.explicit!=='boolean'||!p.origin||!['x','y','size','cx','cy','r'].every(k=>finite(p.origin[k]))||p.origin.size<0||p.origin.r<0||p.labelKey!==null&&(!finite(p.origin.labelX)||!finite(p.origin.labelY))||!dimensions.every(d=>finite(p[d])))fail();
      template(p.title);template(p.aria);if(p.title&&!n.querySelector('title'))fail();
      for(const d of ['x','y'])if(p[d]<m.axes[d].min-1e-8||p[d]>m.axes[d].max+1e-8)throw Error(`${d.toUpperCase()} 须在原坐标范围 ${range(m.axes[d])} 内；此次输入未应用。`);
      if(p.size<0||Math.sqrt(p.size*m.areaUnit)>m.maxRadius+.0001)throw Error(`面积数值须在 0 至 ${display(Math.min(1e12,m.maxRadius*m.maxRadius/m.areaUnit),{comma:true,decimals:0,suffix:''})} 之间；此次输入未应用。`);
    }return m;
  }
  const range=a=>[a.min,a.max].map(n=>display(Number(n.toFixed(6)),{comma:true,decimals:0,suffix:''})).join(' ～ ');
  function renderTemplate(t,p) {
    let out='',last=0;for(const s of t.slots){out+=t.text.slice(last,s.start);out+=p[s.dimension]===p.origin[s.dimension]?t.text.slice(s.start,s.end):(s.raw?.startsWith('+')&&p[s.dimension]>=0?'+':'')+display(p[s.dimension],s.format).replace(/^-/,s.raw?.startsWith('−')?'−':'-');last=s.end;}return out+t.text.slice(last);
  }
  function update(svg,m) {
    read(svg,m); // Validate every point and reference before touching any element.
    for(const p of m.points){
      const cx=p.x===p.origin.x?p.origin.cx:m.axes.x.offset+p.x*m.axes.x.scale,cy=p.y===p.origin.y?p.origin.cy:m.axes.y.offset+p.y*m.axes.y.scale,r=p.size===p.origin.size?p.origin.r:Math.sqrt(p.size*m.areaUnit);
      const circle=mark(svg,p.key,'circle');setNumber(circle,'cx',cx);setNumber(circle,'cy',cy);setNumber(circle,'r',r);
      if(p.leaderKey){const line=mark(svg,p.leaderKey,'line');setNumber(line,'x'+p.leaderEnd,cx);setNumber(line,'y'+p.leaderEnd,cy);}
      else if(p.labelKey){const label=mark(svg,p.labelKey,'text');setNumber(label,'x',p.origin.labelX+cx-p.origin.cx);setNumber(label,'y',p.origin.labelY+cy-p.origin.cy);}
      if(p.title)circle.querySelector('title').textContent=renderTemplate(p.title,p);
      if(p.aria)circle.setAttribute('aria-label',renderTemplate(p.aria,p));
      if(p.explicit)for(const d of dimensions)circle.setAttribute('data-'+d,String(p[d]));
    }svg.setAttribute(chartAttr,JSON.stringify(m));
  }
  function changePointStructure(editor,svg,model,{operation,index,name}) {
    const m=structuredClone(model);if(!m.points[index])throw Error('请先选择数据点');
    if(operation==='delete'&&m.points.length<=1)throw Error('至少保留一个数据点');
    if(operation==='add'&&m.points.length>=100)throw Error('最多支持 100 个数据点');
    return structureTransaction(svg,()=>{
      let p=m.points[index];
      const cloneKey=key=>{if(!key)return null;const old=svg.querySelector(`[${markAttr}="${key}"]`),copy=structureClone(old,editor),next='point-'+crypto.randomUUID();copy.setAttribute(markAttr,next);old.parentElement.append(copy);return next;};
      if(operation==='delete'){
        for(const key of [p.key,p.labelKey,p.leaderKey])if(key)svg.querySelector(`[${markAttr}="${key}"]`).remove();m.points.splice(index,1);
      }else{
        if(operation==='add'){
          p=structuredClone(p);
          // Keep leader immediately before its circle for authored entrance motion.
          p.leaderKey=cloneKey(p.leaderKey);p.key=cloneKey(p.key);p.labelKey=cloneKey(p.labelKey);p.size=0;
          if(p.labelKey){const label=mark(svg,p.labelKey,'text'),dy=28;structureNumber(label,'y',Number(label.getAttribute('y'))+dy);p.origin.labelY+=dy;if(p.leaderKey){const leader=mark(svg,p.leaderKey,'line'),other=p.leaderEnd===1?2:1;structureNumber(leader,'y'+other,Number(leader.getAttribute('y'+other))+dy);}}
          m.points.splice(index+1,0,p);
        }
        p.name=name;if(p.labelKey)structureText(mark(svg,p.labelKey,'text'),name);
        mark(svg,p.key,'circle').setAttribute('data-label',name);
        for(const t of [p.title,p.aria])if(t){const colon=t.text.search(/[:：]/);if(colon>=0&&colon<t.slots[0].start){const delta=name.length-colon;t.text=name+t.text.slice(colon);t.slots.forEach(slot=>{slot.start+=delta;slot.end+=delta;});}}
      }
      update(svg,m);updateKnownChartMotion(editor.doc);return m;
    });
  }
  function open(editor,svg,clicked,{analysis,model,bindingError,modal,closeModal}) {
    const q=s=>document.querySelector(s),version=editor.loadVersion,valid=()=>svg.isConnected&&svg.ownerDocument===editor.doc&&version===editor.loadVersion&&!editor.locked(svg);
    const headings=fields=>fields.map((f,i)=>`${['X','Y','面积'][i]} · ${f.name}${f.unit?'（'+f.unit+'）':''}`);
    if(!model){
      modal('识别气泡图数据 · 保留原样式',`${bindingError?'<p>原绑定已失效，已重新识别；请核对后恢复绑定。</p>':''}<p>识别到 ${analysis.points.length} 个气泡。X / Y 对应位置，第三项按面积比例控制大小。请核对数值与含义；绑定不会重绘原图。</p><div class="data-grid-scroll"><table class="data-grid"><thead><tr><th>名称</th>${headings(analysis.fields).map(s=>'<th>'+escapeHTML(s)+'</th>').join('')}</tr></thead><tbody>${analysis.points.map(p=>`<tr><th>${escapeHTML(p.name)}</th>${p.values.map((v,i)=>`<td style="padding:10px">${escapeHTML(display(v,p.formats[i]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="source-note">依据原提示信息或 data-x / data-y / data-size，与线性坐标及面积比例交叉核对。原配色、背景分区、坐标范围和标签排布保留；图表外的表格、标题和说明不会自动联动。</p>`,[{label:'取消',run:closeModal},{label:'绑定并编辑数据',primary:true,run:()=>{if(!valid())return;bind(svg,analysis);editor.commit('绑定 SVG 气泡图数据');editor.openSVGChartEditor(svg,clicked);}}]);
      q('#dialog').dataset.kind='svg-chart-bind';q('#dialog').dataset.chartKind='bubble';return true;
    }
    const clickedKey=clicked?.closest(`[${markAttr}]`)?.getAttribute(markAttr),chosen=model.points.find(p=>[p.key,p.labelKey,p.leaderKey].includes(clickedKey));
    const body=modal('编辑 SVG 气泡图数据 · 保留样式',`<p>修改 X / Y 移动气泡，修改面积数值调整大小；原填色、渐变、描边和字体保留。有引线的标签保持原位置，引线随气泡移动；无引线的标签随气泡平移。</p><div class="data-editor-workspace with-chart"><div class="data-grid-scroll"><table class="data-grid" id="svg-bubble-grid"><thead><tr><th>名称</th>${headings(model.fields).map(s=>'<th>'+escapeHTML(s)+'</th>').join('')}</tr></thead><tbody>${model.points.map(p=>`<tr><th>${escapeHTML(p.name)}</th>${dimensions.map((d,i)=>`<td><input data-svg-point="${p.key}" data-field="${d}" value="${p[d]}" aria-label="${escapeHTML(p.name+' · '+headings(model.fields)[i])}" inputmode="decimal" spellcheck="false"></td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="data-live-preview"><span>原图实时预览</span><div id="svg-chart-preview"></div></div></div><p id="svg-chart-status" aria-live="polite"></p><p class="source-note">沿用原坐标范围：X ${range(model.axes.x)}，Y ${range(model.axes.y)}（单位见列标题，百分比直接输入 10 表示 10%）。超出范围不会应用；面积数值须非负。可增删数据点、修改名称；X / Y / 面积为固定维度，气泡可能重叠。独立表格、标题、比例和台账需另行编辑。</p>`,[{label:'完成',primary:true,run:closeModal}]);
    q('#dialog').dataset.kind='svg-chart-data';q('#dialog').dataset.chartKind='bubble';
    let pending=false;const flush=()=>{if(pending&&valid()){pending=false;editor.commit('修改 SVG 气泡图数据');}};
    const preview=()=>{const container=q('#svg-chart-preview');if(!container)return;container.replaceChildren(api.preview(svg));for(let n=svg;n;n=n.parentElement){const color=style(n).backgroundColor;if(color&&color!=='rgba(0, 0, 0, 0)'&&color!=='transparent'){container.style.backgroundColor=color;break;}}};
    q('#dialog').flushData=flush;
    bindDataPaste(body.querySelector('#svg-bubble-grid'),{
      valid,rowNames:()=>model.points.map(p=>p.name),columnNames:()=>headings(model.fields),
      apply:changes=>{
        const next=structuredClone(model);
        for(const cell of changes)next.points[cell.row][dimensions[cell.column]]=pasteNumber(cell.raw,{negative:cell.column<2});
        read(svg,next);flush();update(svg,next);model=next;
        for(const input of body.querySelectorAll('[data-svg-point]')){input.value=model.points.find(p=>p.key===input.dataset.svgPoint)[input.dataset.field];input.removeAttribute('aria-invalid');}
        preview();editor.commit('批量粘贴 SVG 气泡图数据');q('#svg-chart-status').textContent='位置、面积与提示信息已同步更新。';
      }
    });
    body.querySelector('#svg-bubble-grid').addEventListener('input',event=>{
      const input=event.target;if(!input.matches('[data-svg-point]')||!valid())return;
      const value=number(input.value);if(value===null||Math.abs(value)>1e12||/[%％]/.test(input.value)){input.setAttribute('aria-invalid','true');q('#svg-chart-status').textContent='请输入有效数值（百分比无需输入 %）；此次输入未应用。';return;}
      const next=JSON.parse(JSON.stringify(model)),p=next.points.find(p=>p.key===input.dataset.svgPoint);p[input.dataset.field]=value;
      try{update(svg,next);model=next;pending=true;input.removeAttribute('aria-invalid');preview();editor.draw();q('#svg-chart-status').textContent=`已更新 · ${p.name}的位置、面积与提示信息已同步`;}
      catch(error){input.setAttribute('aria-invalid','true');q('#svg-chart-status').textContent=error.message;}
    });
    body.querySelector('#svg-bubble-grid').addEventListener('change',flush);q('#dialog').addEventListener('cancel',flush);q('#dialog').addEventListener('close',()=>{flush();q('#dialog').removeEventListener('cancel',flush);if(q('#dialog').flushData===flush)delete q('#dialog').flushData;},{once:true});
    mountChartStructure(body,{rows:model.points.map(p=>p.name),rowLabel:'数据点',columnHint:'X、Y、面积是气泡图的固定维度；新增行可添加数据点。',valid,change:change=>{if(!valid())return;flush();model=changePointStructure(editor,svg,model,change);editor.commit('调整气泡图数据点');closeModal();editor.openSVGChartEditor(svg);focusStructureChange(change);}});
    preview();if(chosen){const input=body.querySelector(`[data-svg-point="${chosen.key}"]`);input?.focus();input?.select();}return true;
  }
  return {analyze,bind,read,update,open,changeStructure:changePointStructure};
}
