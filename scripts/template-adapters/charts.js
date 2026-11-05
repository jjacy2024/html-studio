// Runs in an inert DOMParser document during library generation, never on user imports.
export function adaptTemplateCharts(doc,slug,render) {
  let serial=0;const key=n=>{if(!n)return null;if(!n.hasAttribute('data-studio-tc-key'))n.setAttribute('data-studio-tc-key','k'+(++serial));return n.getAttribute('data-studio-tc-key');};
  const all=(s,r=doc)=>[...r.querySelectorAll(s)],text=n=>n?.textContent.trim()||'',nvalue=n=>{const m=text(n).replace(/,/g,'').match(/[-+]?\d*\.?\d+/);return m?Number(m[0]):null;};
  const fmt=n=>{const t=text(n),m=t.match(/^(.*?)([-+]?\d[\d,]*(?:\.\d+)?)(.*)$/);return m?{prefix:m[1],suffix:m[3],decimals:(m[2].split('.')[1]||'').length,group:m[2].includes(',')}:{decimals:1};};
  const model=(kind,relative=false,max=100)=>({version:1,kind,relative,max,items:[]});
  const done=(root,m)=>{if(!root||!m.items.length)throw Error(slug+': empty chart');root.setAttribute('data-studio-template-chart',JSON.stringify(m));render(root,m);};
  function bars(root,selector,{horizontal=false,label,category,groups=1,categories,series,max,relative=false,limit,categoryOutside=false}={}) {
    if(!root)return;const nodes=all(selector,root),dimension=horizontal?'width':'height';
    const raw=nodes.map(n=>{const host=n.closest('.bar-col,.chart-bar-group,.hbar-row,.row,.chart-row,.bar-item,.s3-bar-group')||n;const l=typeof label==='function'?label(n):label?(n.querySelector(label)||host.querySelector(label)):null;const c=category?(host.querySelector(category)||n.parentElement.querySelector(category)):null;return{n,l,c,value:l?.hasAttribute('data-value')?Number(l.dataset.value):nvalue(l),size:parseFloat(n.style[dimension])||Number(n.dataset[horizontal?'width':'height'])||0,unit:n.style[dimension].match(/[a-z%]+$/)?.[0]||'%'};});
    const missing=relative||raw.some(r=>r.value===null);if(max===undefined)max=missing?100:Math.max(...raw.map(r=>r.value));
    const maxSize=limit??Math.max(...raw.map(r=>r.size)),scale=raw[0]?.unit==='%'&&max===100?1:maxSize/max;
    const m=model('bar',missing,max);m.items=raw.map((r,i)=>{const categoryName=categories?.[Math.floor(i/groups)]||text(r.c)||`项目 ${Math.floor(i/groups)+1}`,name=groups>1?`${categoryName} · ${series?.[i%groups]||`系列 ${i%groups+1}`}`:categoryName;return{name,value:r.value??Math.round(r.size/(maxSize||1)*10000)/100,actions:[{key:key(r.n),style:dimension,scale,unit:r.unit}],labels:r.l?[{key:key(r.l),format:fmt(r.l)}]:[],paints:[{key:key(r.n),property:'background-color'}],nameKeys:groups===1&&r.c?[key(r.c)]:[]};});
    if(missing&&raw.every(r=>r.value===null))m.items.forEach((item,i)=>{item.value=raw[i].unit==='%'?raw[i].size:Math.round(raw[i].size/(maxSize||1)*10000)/100;item.actions[0].scale=raw[i].unit==='%'?1:maxSize/100;});
    // Remove the old zero-state triggers only for the two charts with their own counter animation.
    if(slug==='8-bit-orbit')for(const r of raw){r.n.removeAttribute('data-height');r.n.removeAttribute('data-width');r.l?.removeAttribute('data-value');}
    if(groups===1){const rows=raw.map(r=>r.n.closest('.bar-col,.chart-bar-group,.hbar-row,.row,.chart-row,.bar-item,.s3-bar-group')||r.n);if(rows.every(r=>r!==root&&root.contains(r)&&r.parentElement===rows[0].parentElement)&&new Set(rows).size===rows.length){m.structure={type:'html-rows'};m.items.forEach((item,i)=>item.rowKey=key(rows[i]));}}
    m.axes=all('.yaxis span,.y-axis span,.chart-yaxis span',root).map(n=>({key:key(n),value:nvalue(n)})).filter(a=>a.value!==null);
    done(root,m);
  }
  // Common slide-kit HTML column charts.
  for(const root of all('.chart-wrapper'))if(root.querySelector('.bar-col .bar-fill'))bars(root,'.bar-col .bar-fill',{label:'.bar-val',category:'.bar-x-label'});
  const configs={
    '8-bit-orbit':[['#barChart','.chart-bar',{label:'.chart-value',category:'.chart-bar-label',max:100,limit:100}],['#hbarChart','.hbar-fill',{horizontal:true,label:'.hbar-value',category:'.hbar-label',max:100,limit:100}]],
    'biennale-yellow':[['.chart','.bar',{horizontal:true,label:'.val',category:'.yr',limit:86}]],
    'blue-professional':[['.bars-container','.bar-fill',{horizontal:true,label:'.bar-pct',category:'.bar-label',max:100}]],
    'capsule':[['.chart-container','.chart-bar-fill',{horizontal:true,label:n=>n,category:'.chart-label',max:100}]],
    'creative-mode':[['.chart','.bar',{label:'.v',category:'.x',max:100}]],
    'editorial-forest':[['.chart','.bar',{label:'.val',groups:2,categories:['Q1','Q2','Q3','Q4','YTD'],series:['A','B'],max:100}]],
    'emerald-editorial':[['.chart-card','.chart-bars .bar',{label:'.v',groups:2,categories:['Q2·24','Q3·24','Q4·24','Q1·25','Q2·25','Q3·25'],series:['COMMITTED','DELIVERED'],max:120,limit:100}]],
    'neo-grid-bold':[['.s-chart .pane-r','.bars .bar>div',{groups:2,categories:['NA','EU','LATAM','APAC','MENA','SSA'],series:['FY24','FY25'],relative:true,max:100}]],
    'playful':[['.chart-area','.bar-group .bar',{groups:2,categories:['Q1','Q2','Q3','Q4','Q5'],series:['A','B'],max:100,relative:true}]],
    'raw-grid':[['.s3-chart-area','.s3-bar-fill',{horizontal:true,label:n=>n,category:'.s3-bar-label',max:10,limit:100}]],
  };
  for(const [root,s,options]of configs[slug]||[])bars(doc.querySelector(root),s,options);
  // Pixel-stack bars are quantified as 0–100 relative values, including partial cells.
  for(const root of all(slug==='cobalt-grid'?'.s-data .chart':slug==='sakura-chroma'?'.eq':'__none__')){
    const m=model('pixel-bar',true),labels=all('.ticklab',root);m.items=all('.stack,.bcol',root).map((column,i)=>({name:text(labels[i])||`项目 ${i+1}`,value:column.querySelectorAll('.on').length/column.children.length*100,cells:[...column.children].map(key),nameKeys:[key(labels[i])].filter(Boolean),paints:[]}));done(root,m);
  }
  // CSS conic-gradient donuts retain the donut hole, legend and all surrounding CSS.
  for(const root of all('.pie-row')){const circle=root.querySelector('.pie-donut');if(!circle)continue;const legends=all('.pie-item',root),m=model('donut'),pie={type:'conic',key:key(circle),rows:[],colors:[],percentLabels:[]};m.pies=[pie];
    legends.forEach((el,i)=>{const sw=el.querySelector('.pie-swatch'),label=el.querySelector('.pie-item-label'),value=el.querySelector('.pie-item-val');m.items.push({name:text(label),value:nvalue(value),nameKeys:[key(label)],paints:[{key:key(sw),property:'background-color'}]});pie.rows.push(i);pie.colors.push(sw.style.backgroundColor||sw.style.background);pie.percentLabels.push(key(value));});done(root,m);
  }
  // Plain SVG columns and grouped columns.
  if(['block-frame','daisy-days','scatterbrain'].includes(slug))for(const svg of all('svg').filter(s=>s.querySelectorAll('rect[height]').length>=4&&s.querySelectorAll('text').length>=4)){
    const base=slug==='block-frame'?280:slug==='daisy-days'?250:200,rects=all('rect',svg).filter(n=>+n.getAttribute('height')>20&&+n.getAttribute('width')>20),labels=all('text',svg).filter(n=>+n.getAttribute('y')>base+10);if(!rects.length)continue;
    const maximum=slug==='block-frame'?130:slug==='daisy-days'?100:80,scale=slug==='block-frame'?2:slug==='daisy-days'?2:180/80,m=model('bar',slug==='block-frame',maximum);
    m.items=rects.map((n,i)=>{const center=+n.getAttribute('x')+(+n.getAttribute('width'))/2,l=all('text',svg).find(t=>Math.abs(+t.getAttribute('x')-center)<2&&+t.getAttribute('y')<base&&nvalue(t)!==null),category=labels[slug==='block-frame'?i%5:i],v=l?nvalue(l):+n.getAttribute('height')/scale;return{name:text(category)+(slug==='block-frame'?' · '+['Revenue','Users','Retention'][Math.floor(i/5)]:''),value:v,actions:[{key:key(n),attr:'height',scale},{key:key(n),attr:'y',scale:-scale,base},...(l?[{key:key(l),attr:'y',scale:-scale,base:base-8}]:[])],labels:l?[{key:key(l),format:fmt(l)}]:[],paints:[{key:key(n)}]};});
    m.axes=all('text',svg).filter(t=>+t.getAttribute('x')<70&&nvalue(t)!==null).map(t=>({key:key(t),value:nvalue(t)}));done(svg,m);
  }
  // Ring segments, with numerical legends taking precedence over approximate geometry.
  if(['daisy-days','raw-grid'].includes(slug))for(const svg of all('svg').filter(s=>s.querySelector('circle[stroke-dasharray]'))){
    const root=svg.closest('.donut-wrap,.s7-left')||svg,circles=all('circle[stroke-dasharray]',svg),m=model('donut',slug==='raw-grid'),pie={type:'ring',radius:80,rows:[],keys:[],percentLabels:[]};m.pies=[pie];
    const legends=all(slug==='daisy-days'?'.d-legend-item':'.s7-legend-item',root);
    circles.forEach((c,i)=>{const l=legends[i],sw=l?.querySelector('span,div');let label=text(l),value;if(slug==='daisy-days'){value=nvalue(l);label=label.replace(/\s*-\s*[\d.]+%/,'');const t=doc.createElement('span');t.textContent=value+'%';for(const node of [...l.childNodes])if(node.nodeType===3)node.textContent=label+' - ';l.append(t);pie.percentLabels.push(key(t));}else value=parseFloat(c.getAttribute('stroke-dasharray'));
      m.items.push({name:label,value,paints:[{key:key(c),property:'stroke'},...(sw?[{key:key(sw),property:'background-color'}]:[])]});pie.keys.push(key(c));pie.rows.push(i);});
    if(slug==='daisy-days')pie.center=key(all('text',svg).at(-1));else{pie.center=key(root.querySelector('.s7-donut-value'));pie.centerRow=0;const sum=m.items.reduce((s,i)=>s+i.value,0),remain=37; m.items[0].value=63;const other=sum-314;m.items.slice(1).forEach(i=>i.value=i.value/other*remain);}
    done(root,m);
  }
  if(slug==='scatterbrain')for(const svg of all('svg').filter(s=>s.querySelector('path[d*="A80"]'))){
    const background=svg.querySelector('circle'),newPath=doc.createElementNS(svg.namespaceURI,'path');for(const a of background.attributes)newPath.setAttribute(a.name,a.value);for(const a of ['cx','cy','r'])newPath.removeAttribute(a);background.replaceWith(newPath);
    const paths=all('path',svg),rects=all('rect',svg),labels=all('text',svg).slice(1),m=model('donut',true);m.pies=[{type:'sector',start:0.75,cx:100,cy:100,radius:80,keys:paths.map(key),rows:paths.map((_,i)=>i)}];m.items=paths.map((n,i)=>({name:text(labels[i]),value:[25,25,16.74,16.52,16.74][i],paints:[{key:key(n)},{key:key(rects[i])}]}));done(svg,m);
  }
  // Explicit polylines retain every original sample, including unlabelled intermediate points.
  for(const svg of all('.s-chart svg').filter(s=>s.querySelector('polyline'))){
    const m=model('line',true,slug==='pink-script'?200:100),base=slug==='pink-script'?400:100,scale=base/m.max,lines=all('polyline',svg),slide=svg.closest('.slide'),labels=all('.xticks span,.xax span',slide),series=all('.legend .li',slide).map(text);
    lines.forEach((line,c)=>{const points=line.getAttribute('points').trim().split(/\s+/).map(p=>p.split(',').map(Number)),rows=[];points.forEach(([x,y],r)=>{rows.push(m.items.length);m.items.push({name:(labels[r]?text(labels[r]):`采样点 ${r+1}`)+' · '+(series[slug==='pink-script'?1-c:c]||`系列 ${c+1}`),value:(base-y)/scale,paints:[]});});m.paths??=[];m.paths.push({keys:[key(line)],xs:points.map(p=>p[0]),rows,baseline:base,scale});
      if(slug==='pink-script'&&c===1){const row=rows[8];for(const circle of all('circle',svg)){m.items[row].actions??=[];m.items[row].actions.push({key:key(circle),attr:'cy',base,scale:-scale});if(circle.getAttribute('fill')!=='none')m.items[row].paints.push({key:key(circle)});}const marker=svg.querySelector('line');m.items[row].actions.push({key:key(marker),attr:'y1',base,scale:-scale});}
    });done(svg,m);
  }
  if(slug==='editorial-tri-tone'){
    const svg=doc.querySelector('svg.chart'),m=model('mixed',true,40),scale=8.5,base=380,paths=all('path',svg),xs=[60,180,300,420,540,660];
    function series(name,ys,keys,{curve,area,pointsX=xs}={}){const rows=ys.map((y,i)=>{const row=m.items.length;m.items.push({name:`${name} · ${i+1}`,value:(base-y)/scale,paints:[]});return row;});m.paths??=[];m.paths.push({keys:keys.map(key),rows,xs:pointsX,baseline:base,scale,curve,area:area?key(area):undefined});return rows;}
    series('Series A',[230,180,145,120,100,80],[paths[0],paths[1]],{curve:0.6,area:paths[0]});
    const b=series('Series B',[280,250,235,215,200,175],[paths[2]],{pointsX:[90,200,310,420,530,640]});all('circle',svg).forEach((n,i)=>{m.items[b[i]].actions=[{key:key(n),attr:'cy',base,scale:-scale}];m.items[b[i]].paints=[{key:key(n)}];});
    all('rect',svg).forEach((n,i)=>m.items.push({name:`Series C · ${i+1}`,value:+n.getAttribute('height')/scale,actions:[{key:key(n),attr:'height',scale},{key:key(n),attr:'y',base,scale:-scale}],paints:[{key:key(n)}]}));
    series('Series D',[350,345,348,338,340,332],[paths[3]],{pointsX:[90,200,310,420,530,640]});m.axes=all('text',svg).map(n=>({key:key(n),value:nvalue(n)}));done(svg,m);
    const fills=all('span.bar > i');if(fills.length){const root=fills[0].parentElement.parentElement.parentElement;bars(root,'span.bar > i',{horizontal:true,max:100,label:'.val',category:'.lbl'});}
  }
  return all('[data-studio-template-chart]').map(root=>{const m=JSON.parse(root.getAttribute('data-studio-template-chart'));return{kind:m.kind,relative:m.relative,items:m.items.length};});
}
