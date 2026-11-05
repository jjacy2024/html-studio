// Declarative bindings keep the template's original nodes, CSS and geometry.
export function renderTemplateChart(root, model, progress = 1) {
  const doc=root.ownerDocument, ns='http://www.w3.org/2000/svg', nodes=new Map([...root.querySelectorAll('[data-studio-tc-key]')].map(n=>[n.getAttribute('data-studio-tc-key'),n]));
  if(root.hasAttribute('data-studio-tc-key'))nodes.set(root.getAttribute('data-studio-tc-key'),root);
  const get=k=>nodes.get(k), p=Math.max(0,Math.min(1,progress)), max=Math.max(model.max||1,...model.items.map(i=>i.value)), factor=model.fixed?1:(model.max||max)/max;
  const num=v=>Math.round(v*1e6)/1e6, val=i=>model.items[i].value*p;
  const format=(v,f={})=>(f.prefix||'')+(f.group?Number(v.toFixed(f.decimals||0)).toLocaleString('en-US',{minimumFractionDigits:f.decimals||0,maximumFractionDigits:f.decimals||0}):v.toFixed(f.decimals||0))+(f.suffix||'');
  const paint=(n,color,prop)=>{if(!n)return;const k='data-studio-tc-original-'+prop;if(color){if(!n.hasAttribute(k))n.setAttribute(k,JSON.stringify([n.style.getPropertyValue(prop),n.style.getPropertyPriority(prop)]));n.style.setProperty(prop,color,'important');if(prop==='background-color'){const bg='data-studio-tc-original-background-image';if(!n.hasAttribute(bg))n.setAttribute(bg,JSON.stringify([n.style.backgroundImage,n.style.getPropertyPriority('background-image')]));n.style.setProperty('background-image','none','important');}}else for(const name of prop==='background-color'?[prop,'background-image']:[prop]){const attr='data-studio-tc-original-'+name;if(n.hasAttribute(attr)){const old=JSON.parse(n.getAttribute(attr));old[0]?n.style.setProperty(name,old[0],old[1]):n.style.removeProperty(name);n.removeAttribute(attr);}}};
  model.items.forEach((item,i)=>{
    for(const a of item.actions||[]){const n=get(a.key);if(!n)continue;const v=num((a.base||0)+val(i)*a.scale*(a.scaled===false?1:factor));if(a.style)n.style.setProperty(a.style,v+(a.unit||''));else n.setAttribute(a.attr,String(v));}
    for(const l of item.labels||[]){const n=get(l.key);if(n)n.textContent=format(val(i),l.format);}
    for(const k of item.nameKeys||[]){const n=get(k);if(n)n.textContent=item.name;}
    for(const target of item.paints||[])paint(get(target.key),item.color,target.property||'fill');
    if(item.cells){const amount=val(i)*factor/model.max*item.cells.length;item.cells.forEach((key,c)=>{const n=get(key);if(!n)return;n.classList.toggle('on',c<Math.ceil(amount));n.style.opacity=c<Math.floor(amount)?'1':c<amount?String(amount-c):'';paint(n,item.color&&c<amount?item.color:null,'background-color');});}
  });
  for(const a of model.axes||[]){const n=get(a.key);if(n)n.textContent=format(a.value/factor,a.format);}
  for(const group of model.paths||[]){
    const ys=group.rows.map(i=>group.baseline-val(i)*group.scale*factor),xs=group.xs;
    let d='';
    if(group.curve){let control=ys[0]+(ys[1]-ys[0])*group.curve;d=`M ${xs[0]} ${num(ys[0])} Q ${(xs[0]+xs[1])/2} ${num(control)} ${xs[1]} ${num(ys[1])}`;for(let i=2;i<xs.length;i++)d+=` T ${xs[i]} ${num(ys[i])}`;}
    else d=xs.map((x,i)=>`${i?'L':'M'} ${x} ${num(ys[i])}`).join(' ');
    for(const key of group.keys){const n=get(key);if(!n)continue;if(n.tagName.toLowerCase()==='polyline')n.setAttribute('points',xs.map((x,i)=>`${x},${num(ys[i])}`).join(' '));else n.setAttribute('d',d+(key===group.area?` L ${xs.at(-1)} ${group.baseline} L ${xs[0]} ${group.baseline} Z`:''));}
    // Color clips partition an existing curve/area without replacing its shape or stroke.
    const source=get(group.area||group.keys[0]);if(!source)continue;
    const svg=source.ownerSVGElement;
    for(let i=0;i<group.rows.length;i++){
      const row=group.rows[i],item=model.items[row];
      let overlay=root.querySelector(`[data-studio-tc-overlay="${row}"]`),clip=root.querySelector(`[data-studio-tc-clip="${row}"]`);
      if(!item.color){overlay?.remove();clip?.remove();continue;}
      if(!overlay){overlay=source.cloneNode(false);overlay.removeAttribute('id');overlay.removeAttribute('data-hs-id');overlay.removeAttribute('data-hs-locked');overlay.removeAttribute('data-studio-tc-key');overlay.setAttribute('data-studio-tc-overlay',row);overlay.style.pointerEvents='none';source.after(overlay);clip=doc.createElementNS(ns,'clipPath');clip.setAttribute('data-studio-tc-clip',row);clip.append(doc.createElementNS(ns,'rect'));svg.append(clip);}
      const id=clip.id||('tc-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)));clip.id=id;clip.setAttribute('clipPathUnits','userSpaceOnUse');const rect=clip.firstElementChild,left=i?(xs[i-1]+xs[i])/2:xs[0]-100,right=i<xs.length-1?(xs[i]+xs[i+1])/2:xs.at(-1)+100;
      rect.setAttribute('x',left);rect.setAttribute('y',-1e6);rect.setAttribute('width',right-left);rect.setAttribute('height',2e6);
      overlay.setAttribute('clip-path',`url(#${id})`);overlay.setAttribute(source.hasAttribute('points')?'points':'d',source.getAttribute(source.hasAttribute('points')?'points':'d'));
      overlay.style.setProperty(group.area?'fill':'stroke',item.color,'important');
    }
  }
  for(const pie of model.pies||[]){
    const total=pie.rows.reduce((s,i)=>s+model.items[i].value,0);let offset=pie.start||0;const stops=[];
    pie.rows.forEach((row,j)=>{const item=model.items[row],share=total?item.value/total:0,start=offset,end=offset+share*p,paintNode=get(pie.keys?.[j]);
      if(pie.type==='conic')stops.push(`${item.color||pie.colors[j]} ${num(start*100)}% ${num(end*100)}%`);
      else if(pie.type==='ring'&&paintNode){const c=2*Math.PI*pie.radius;paintNode.setAttribute('stroke-dasharray',`${num(share*p*c)} ${num(c)}`);paintNode.setAttribute('stroke-dashoffset',num(-start*c));}
      else if(paintNode){const angle=t=>(t-0.25)*2*Math.PI,point=t=>[num(pie.cx+pie.radius*Math.cos(angle(t))),num(pie.cy+pie.radius*Math.sin(angle(t)))],a=point(start),b=point(end),mid=point((start+end)/2);paintNode.setAttribute('d',share*p===0?`M ${pie.cx} ${pie.cy}`:`M ${pie.cx} ${pie.cy} L ${a} A ${pie.radius} ${pie.radius} 0 ${share*p/2>0.5?1:0} 1 ${mid} A ${pie.radius} ${pie.radius} 0 0 1 ${b} Z`);}
      if(pie.percentLabels?.[j])get(pie.percentLabels[j]).textContent=format(share*100*p,{suffix:'%',decimals:pie.decimals||0});
      offset=end;
    });
    if(pie.type==='conic'){stops.push(`transparent ${num(offset*100)}% 100%`);get(pie.key).style.backgroundImage=`conic-gradient(${stops.join(',')})`;}
    if(pie.center){get(pie.center).textContent=pie.centerRow!==undefined?format((total?model.items[pie.rows[pie.centerRow]].value/total*100:0)*p,{suffix:'%'}):format((total?100:0)*p,{suffix:'%'});}
  }
}

export function readTemplateChart(root) {
  const raw=root.getAttribute('data-studio-template-chart');if(!raw||raw.length>1000000)throw Error('模板图表数据无效');
  const m=JSON.parse(raw),fail=()=>{throw Error('图表绑定无效或元素已变化，请撤回后重试');},finite=n=>Number.isFinite(n)&&Math.abs(n)<=1e12;
  if(m?.version!==1||!Array.isArray(m.items)||!m.items.length||m.items.length>1000||!finite(m.max)||m.max<=0||!m.items.every(i=>typeof i.name==='string'&&i.name.length<=200&&finite(i.value)&&i.value>=0&&(!i.color||/^#[0-9a-f]{6}$/i.test(i.color))))fail();
  const nodes=[root,...root.querySelectorAll('[data-studio-tc-key]')].filter(n=>n.hasAttribute('data-studio-tc-key')),keys=new Set(nodes.map(n=>n.getAttribute('data-studio-tc-key')));
  if(nodes.length!==keys.size)fail();const ref=k=>{if(typeof k!=='string'||!/^[-\w]{1,100}$/.test(k)||!keys.has(k))fail();},list=a=>{if(!Array.isArray(a)||a.length>1000)fail();return a;};
  for(const i of m.items){
    for(const a of list(i.actions||[])){ref(a.key);if(!finite(a.scale)||a.base!==undefined&&!finite(a.base)||a.style&&!['width','height'].includes(a.style)||!a.style&&!['x','y','cx','cy','height','width','r','x1','y1','x2','y2'].includes(a.attr)||a.unit&&!['%','px','vh','vw','rem','em'].includes(a.unit))fail();}
    for(const l of list(i.labels||[])){ref(l.key);if(l.format){const f=l.format;if(f.decimals!==undefined&&(!Number.isInteger(f.decimals)||f.decimals<0||f.decimals>8)||[f.prefix||'',f.suffix||''].some(s=>typeof s!=='string'||s.length>100))fail();}}
    for(const a of list(i.paints||[])){ref(a.key);if(a.property&&!['fill','stroke','background-color','color'].includes(a.property))fail();}
    for(const k of list(i.nameKeys||[]))ref(k);if(i.rowKey)ref(i.rowKey);if(i.cells)for(const k of list(i.cells))ref(k);
  }
  for(const a of list(m.axes||[])){ref(a.key);if(!finite(a.value))fail();}
  const rows=a=>{for(const i of list(a))if(!Number.isInteger(i)||i<0||i>=m.items.length)fail();};
  for(const g of list(m.paths||[])){rows(g.rows);if(!Array.isArray(g.xs)||g.xs.length!==g.rows.length||g.xs.length<2||!g.xs.every((x,i)=>finite(x)&&(!i||x>g.xs[i-1]))||!finite(g.baseline)||!finite(g.scale)||g.curve!==undefined&&(!finite(g.curve)||g.curve<0||g.curve>1))fail();for(const k of list(g.keys))ref(k);if(g.area)ref(g.area);}
  for(const pie of list(m.pies||[])){rows(pie.rows);if(!['ring','sector','conic'].includes(pie.type))fail();if(pie.type==='conic'){ref(pie.key);if(!Array.isArray(pie.colors)||pie.colors.length!==pie.rows.length||pie.colors.some(c=>typeof c!=='string'||c.length>500))fail();}else{if(!finite(pie.radius)||pie.radius<=0||!Array.isArray(pie.keys)||pie.keys.length!==pie.rows.length)fail();pie.keys.forEach(ref);}if(pie.center)ref(pie.center);for(const k of list(pie.percentLabels||[]))ref(k);}
  return m;
}
export function updateTemplateChart(root,model) {
  const old=root.getAttribute('data-studio-template-chart');root.setAttribute('data-studio-template-chart',JSON.stringify(model));
  try{readTemplateChart(root);renderTemplateChart(root,model);}catch(e){root.setAttribute('data-studio-template-chart',old);throw e;}
}

export function templateChartMotion(render) {
  const selector='[data-studio-template-chart]',states=new Map(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const visible=root=>{const r=root.getBoundingClientRect();if(!r.width||!r.height||r.bottom<=0||r.top>=innerHeight||r.right<=0||r.left>=innerWidth)return false;for(let n=root;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}return true;};
  const tick=()=>{if(document.hidden)return;for(const root of document.querySelectorAll(selector)){
    let state=states.get(root);if(!state){state={visible:false};states.set(root,state);}
    const on=visible(root);if(on&&!state.visible){let model;try{model=JSON.parse(root.getAttribute('data-studio-template-chart'));}catch{continue;}cancelAnimationFrame(state.raf);const start=performance.now(),step=now=>{if(!root.isConnected)return;const t=reduced.matches?1:Math.min(1,(now-start)/900);render(root,model,1-Math.pow(1-t,3));if(t<1)state.raf=requestAnimationFrame(step);};render(root,model,reduced.matches?1:0);state.raf=requestAnimationFrame(step);}
    if(!on&&state.visible)cancelAnimationFrame(state.raf);state.visible=on;
  }for(const [root,s]of states)if(!root.isConnected){cancelAnimationFrame(s.raf);states.delete(root);}};
  tick();const timer=setInterval(tick,120);addEventListener('pagehide',()=>{clearInterval(timer);for(const s of states.values())cancelAnimationFrame(s.raf);},{once:true});
}

// Clone only a declared repeated HTML row. Mixed SVG geometry keeps fixed samples.
export function changeTemplateChartStructure(editor,root,model,{axis,operation,index,name}) {
  if(axis!=='row'||model.structure?.type!=='html-rows')throw Error('此图暂不支持改变数据元素数量');
  if(!Number.isInteger(index)||index<0||index>=model.items.length)throw Error('分类索引越界');
  if(!['add','delete','rename'].includes(operation)||operation!=='delete'&&(!name?.trim()||name.length>100))throw Error('分类名称或操作无效');
  if(operation==='add'&&model.items.length>=100||operation==='delete'&&model.items.length<=1)throw Error('分类数量须为 1 至 100');
  const next=structuredClone(model),item=next.items[index],row=root.querySelector(`[data-studio-tc-key="${item.rowKey}"]`);if(!row)throw Error('原分类结构已变化');
  if(operation==='rename')item.name=name;
  else if(operation==='delete'){row.remove();next.items.splice(index,1);}
  else{const copy=row.cloneNode(true);editor.remapClone(copy);const mapping=new Map();for(const n of [copy,...copy.querySelectorAll('[data-studio-tc-key]')])if(n.hasAttribute('data-studio-tc-key')){const old=n.getAttribute('data-studio-tc-key'),key='row-'+crypto.randomUUID();mapping.set(old,key);n.setAttribute('data-studio-tc-key',key);}
    const clone=structuredClone(item);clone.name=name;clone.value=0;clone.rowKey=mapping.get(clone.rowKey);for(const list of [clone.actions,clone.labels,clone.paints])for(const a of list||[])a.key=mapping.get(a.key)||a.key;clone.nameKeys=clone.nameKeys?.map(k=>mapping.get(k)||k);row.after(copy);next.items.splice(index+1,0,clone);
  }
  updateTemplateChart(root,next);return next;
}
