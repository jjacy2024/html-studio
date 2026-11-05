// Style-preserving bridge charts. Recognition verifies values, cumulative geometry
// and every connector; a staircase silhouette alone is never treated as data.
export function createSVGWaterfallAdapter(api) {
  const {number,format,display,style,textLeaf,mark,setNumber,setText,markAttr,chartAttr}=api;
  const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e15;
  const formatOK=f=>f&&typeof f.comma==='boolean'&&Number.isInteger(f.decimals)&&f.decimals>=0&&f.decimals<=8&&['','%','％'].includes(f.suffix);
  function token(text) {
    const raw=String(text).trim(),m=raw.match(/(?:^|[^\d.,])([+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([^\d\s]{0,12})$/u);
    if(!m)return null;const at=raw.lastIndexOf(m[1]),value=number(m[1]),f=format(m[1]);
    if(value===null||Math.abs(value)>1e12||f.decimals>8||/\d[eE]$/.test(raw.slice(0,at)))return null;
    return {value,format:f,before:raw.slice(0,at),after:raw.slice(at+m[1].length),plus:m[1].startsWith('+'),minus:m[1].startsWith('−')?'−':'-',rounded:true};
  }
  const templateOK=t=>t===null||(t&&typeof t.before==='string'&&t.before.length<=1000&&typeof t.after==='string'&&t.after.length<=100&&formatOK(t.format)&&typeof t.plus==='boolean'&&['-','−'].includes(t.minus)&&(t.rounded===undefined||typeof t.rounded==='boolean'));
  const valueText=(value,t,forcePlus=false)=>t.before+(value>=0&&(t.plus||forcePlus)?'+':'')+(t.rounded?value.toLocaleString('en-US',{useGrouping:t.format.comma,minimumFractionDigits:t.format.decimals,maximumFractionDigits:t.format.decimals}):display(value,t.format)).replace(/^-/,t.minus)+t.after;
  const epsilon=(a,b)=>Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b))*8;
  // A tooltip may carry 303.84 while the visible label rounds it to 303.8.
  // Prefer explicit data, otherwise the most precise text; every other source
  // must agree within its own half rounding step, never a broad relative margin.
  const matchesSources=(value,templates,data)=>templates.every(t=>Math.abs(value-t.value)<=.5*10**-t.format.decimals+epsilon(value,t.value))&&
    (data===null||Math.abs(value-data)<=epsilon(value,data));
  // Add the decimal values as authored, avoiding 110.10000000000005 in totals.
  // Scientific notation here is Number's representation, not accepted user code.
  const add=(a,b)=>{
    const parts=v=>{const [mantissa,exponent='0']=String(v).split('e'),[integer,fraction='']=mantissa.split('.');return {digits:BigInt(integer+fraction),scale:fraction.length-Number(exponent)};};
    const x=parts(a),y=parts(b),scale=Math.max(0,x.scale,y.scale);
    return Number(`${x.digits*10n**BigInt(scale-x.scale)+y.digits*10n**BigInt(scale-y.scale)}e-${scale}`);
  };
  const near=(a,b)=>Math.abs(a-b)<=Math.max(.75,Math.abs(b)*.00001);
  function paint(rect,svg) {
    return style(rect).fill.replace(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g,(whole,url)=>{
      const id=url.slice(url.lastIndexOf('#')+1);return [...svg.querySelectorAll('[id]')].some(n=>n.id===id)?`url(#${id})`:whole;
    });
  }
  function detectDirection(svg,orientation,texts,rects,lines) {
    const vertical=orientation==='vertical',numeric=texts.map(t=>({...t,template:token(t.text)})).filter(t=>t.template),bars=[];
    for(const r of rects){
      if((vertical?r.width:r.height)<=2)continue;
      const cross=vertical?r.x+r.width/2:r.y+r.height/2,edge=vertical?r.y:r.x+r.width;
      const labels=numeric.filter(t=>vertical?Math.abs(t.x-cross)<Math.max(3,r.width*.3)&&t.y<edge&&edge-t.y<Math.max(60,t.size*2):Math.abs(t.y-cross)<Math.max(10,t.size*.7)&&t.x>edge&&t.x-edge<Math.max(90,t.size*3));
      const titleTemplate=token(r.el.querySelector('title')?.textContent||''),ariaTemplate=token(r.el.getAttribute('aria-label')||'');
      if(labels.length>1)return null;
      const label=labels[0]||null,dataValue=r.el.hasAttribute('data-value'),rawData=dataValue?number(r.el.getAttribute('data-value')):null;
      if(dataValue&&rawData===null)return null;
      const templates=[label?.template,titleTemplate,ariaTemplate].filter(Boolean);
      if(!templates.length&&rawData===null)continue;
      const value=rawData??[...templates].sort((a,b)=>b.format.decimals-a.format.decimals)[0].value;
      if(Math.abs(value)>1e12||!matchesSources(value,templates,rawData))return null;
      if(['x','y','width','height'].some(p=>Math.abs(parseFloat(style(r.el)[p])-r[p])>.5))return null;
      bars.push({...r,cross,value,label,titleTemplate,ariaTemplate,dataValue,templates,rawData,paint:paint(r.el,svg)});
    }
    if(bars.length<3||bars.length>100)return null;
    bars.sort((a,b)=>a.cross-b.cross);
    for(let i=1;i<bars.length;i++)if(vertical?bars[i].x<=bars[i-1].x+bars[i-1].width:bars[i].y<=bars[i-1].y+bars[i-1].height)return null;
    const first=bars[0],last=bars.at(-1);if(first.value<0||last.value<0)return null;
    const zero=vertical?first.y+first.height:first.x,from=vertical?first.x:first.y,to=vertical?last.x+last.width:last.y+last.height;
    const baselines=lines.filter(l=>vertical?near(l.y1,zero)&&near(l.y2,zero)&&Math.min(l.x1,l.x2)<=from&&Math.max(l.x1,l.x2)>=to:near(l.x1,zero)&&near(l.x2,zero)&&Math.min(l.y1,l.y2)<=from&&Math.max(l.y1,l.y2)>=to);
    if(baselines.length!==1)return null;
    const unitBar=first.value>0?first:last.value>0?last:bars.find(b=>b.value!==0);
    if(!unitBar)return null;
    const unit=(vertical?unitBar.height:unitBar.width)/Math.abs(unitBar.value);if(!Number.isFinite(unit)||unit<=0)return null;
    const direction=vertical?-1:1,position=v=>zero+v*unit*direction;
    const geometryMatches=(bar,a,b)=>near(vertical?bar.y:bar.x,Math.min(position(a),position(b)))&&near(vertical?bar.height:bar.width,Math.abs(b-a)*unit);
    if(!geometryMatches(first,0,first.value))return null;
    const used=new Set(),connectors=[],groups=[];let cumulative=first.value,changes=0,originalCapacity=first.value;
    for(const [i,b] of bars.entries()){
      const explicit=b.el.getAttribute('data-waterfall-role')||'';
      if(explicit&&!['start','change','total','subtotal'].includes(explicit))return null;
      let role;
      if(i===0){role='start';if(explicit&&explicit!=='start')return null;}
      else if(i===bars.length-1){role='total';if(explicit&&!['total','subtotal'].includes(explicit))return null;if(!matchesSources(cumulative,b.templates,b.rawData)||!geometryMatches(b,0,cumulative))return null;}
      else {
        const next=add(cumulative,b.value),change=next>=0&&geometryMatches(b,cumulative,next),total=matchesSources(cumulative,b.templates,b.rawData)&&geometryMatches(b,0,cumulative);
        if(explicit){role=explicit==='subtotal'?'total':explicit;if(role==='start'||(role==='change'?!change:!total))return null;}
        else if(change!==total)role=change?'change':'total';
        else if(change&&[b.label?.template,b.titleTemplate,b.ariaTemplate].some(t=>t?.plus))role='change';
        else return null;
        if(role==='change'){cumulative=next;changes++;}
      }
      if(role==='total')b.value=cumulative;
      b.role=role;b.cumulative=cumulative;originalCapacity=Math.max(originalCapacity,cumulative);
      if(b.label){if(used.has(b.label.el))return null;used.add(b.label.el);}
      const categories=texts.filter(t=>!used.has(t.el)&&(vertical?t.y>zero+5&&t.y-zero<140&&Math.abs(t.x-b.cross)<Math.max(8,b.width*.3):t.x<zero-5&&zero-t.x<200&&Math.abs(t.y-b.cross)<Math.max(12,t.size*1.7)));
      categories.sort((a,b)=>vertical?a.y-b.y:a.x-b.x);
      if(!categories.length||categories.length>3)return null;
      categories.forEach(t=>used.add(t.el));const category=categories.map(t=>t.text).join(' · ');if(category.length>500)return null;b.category=category;
      groups.push({label:{text:category},role,bars:[{...b,format:(b.label?.template||b.titleTemplate||b.ariaTemplate)?.format||format(String(b.value))}]});
      if(i<bars.length-1){const next=bars[i+1],end=position(cumulative),a=vertical?b.x+b.width:b.y+b.height,z=vertical?next.x:next.y;
        const matches=lines.filter(l=>l!==baselines[0]&&(vertical?near(l.y1,end)&&near(l.y2,end)&&near(Math.min(l.x1,l.x2),a)&&near(Math.max(l.x1,l.x2),z):near(l.x1,end)&&near(l.x2,end)&&near(Math.min(l.y1,l.y2),a)&&near(Math.max(l.y1,l.y2),z)));
        if(matches.length!==1||connectors.some(c=>c.el===matches[0].el))return null;
        connectors.push({el:matches[0].el,row:i});
      }
    }
    if(!changes||originalCapacity<=0)return null;
    // No omitted segments or unknown numeric labels between the bridge endpoints.
    if(rects.some(r=>!bars.some(b=>b.el===r.el)&&(vertical?r.x+r.width>from&&r.x<to&&r.y<zero:r.y+r.height>from&&r.y<to&&r.x+r.width>zero)))return null;
    if(numeric.some(t=>!used.has(t.el)&&(vertical?t.x>=from&&t.x<=to&&t.y<zero:t.y>=from&&t.y<=to&&t.x>zero)))return null;
    const ticks=[];
    for(const line of lines.filter(l=>l!==baselines[0]&&!connectors.some(c=>c.el===l.el))){
      const parallel=vertical?near(line.y1,line.y2):near(line.x1,line.x2),pos=vertical?line.y1:line.x1;
      if(!parallel)continue;
      const span=vertical?Math.max(line.x1,line.x2)-Math.min(line.x1,line.x2):Math.max(line.y1,line.y2)-Math.min(line.y1,line.y2);
      if(span<(to-from)*.8)continue;
      const candidates=texts.filter(t=>t.value!==null&&t.value>=0&&(vertical?t.x<from&&from-t.x<160&&Math.abs(t.y-pos)<Math.max(10,t.size*.8):t.y>to&&t.y-to<90&&Math.abs(t.x-pos)<Math.max(10,t.size*.7)));
      if(candidates.length!==1||!near(pos,position(candidates[0].value)))return null;
      ticks.push({label:candidates[0],value:candidates[0].value});
    }
    ticks.sort((a,b)=>a.value-b.value);if(ticks.length>30||new Set(ticks.map(t=>t.value)).size!==ticks.length)return null;
    originalCapacity=Math.max(originalCapacity,...ticks.map(t=>t.value));
    const palette={};for(const [name,sign] of [['positive',1],['negative',-1]]){const paints=[...new Set(bars.filter(b=>b.role==='change'&&Math.sign(b.value)===sign).map(b=>b.paint))];if(paints.length===1)palette[name]=paints[0];}
    return {kind:'waterfall',orientation,zero,unit,originalCapacity,groups,series:['数值'],bars,connectors,ticks,palette:palette.positive&&palette.negative&&palette.positive!==palette.negative?palette:null,showPositiveSign:bars.some(b=>b.role==='change'&&b.value>0&&b.label?.template.plus)};
  }
  function analyze(svg,texts,rects,lines) {
    if([...svg.querySelectorAll('text')].some(el=>token(el.textContent)&&!texts.some(t=>t.el===el)))return [];
    return ['vertical','horizontal'].map(d=>detectDirection(svg,d,texts,rects,lines)).filter(Boolean);
  }
  function bind(svg,a) {
    svg.querySelectorAll(`[${markAttr}]`).forEach(el=>el.removeAttribute(markAttr));
    const m={version:3,kind:'waterfall',orientation:a.orientation,zero:a.zero,unit:a.unit,originalCapacity:a.originalCapacity,palette:a.palette,showPositiveSign:a.showPositiveSign,categories:a.groups.map(g=>g.label.text),series:a.series,bars:[],connectors:[],ticks:[]};
    for(const [row,b] of a.bars.entries()){
      const key=`bar-${row}-0`,labelKey=b.label?`value-${row}-0`:null;b.el.setAttribute(markAttr,key);
      if(b.label)b.label.el.setAttribute(markAttr,labelKey);
      m.bars.push({key,labelKey,row,column:0,role:b.role,value:b.value,originalSign:Math.sign(b.value),paintSign:Math.sign(b.value),paintOverride:null,labelOffset:b.label?(a.orientation==='vertical'?b.label.y-b.y:b.label.x-b.x-b.width):0,labelTemplate:b.label?.template||null,titleTemplate:b.titleTemplate,ariaTemplate:b.ariaTemplate,dataValue:b.dataValue,originalFill:{value:b.el.style.getPropertyValue('fill'),priority:b.el.style.getPropertyPriority('fill')}});
    }
    a.connectors.forEach((c,i)=>{const key=`connector-${i}`;c.el.setAttribute(markAttr,key);m.connectors.push({key,row:c.row});});
    a.ticks.forEach((t,i)=>{const key=`tick-${i}`;t.label.el.setAttribute(markAttr,key);m.ticks.push({key,value:t.value,format:format(t.label.text)});});
    svg.setAttribute(chartAttr,JSON.stringify(m));return m;
  }
  function read(svg,m) {
    if(m?.version!==3||m.kind!=='waterfall'||!['vertical','horizontal'].includes(m.orientation)||!finite(m.zero)||!finite(m.unit)||m.unit<=0||!finite(m.originalCapacity)||m.originalCapacity<=0||m.unit*m.originalCapacity>1e7||!Array.isArray(m.bars)||m.bars.length<3||m.bars.length>100||!Array.isArray(m.categories)||m.categories.length!==m.bars.length||m.categories.some(s=>typeof s!=='string'||s.length>500)||!Array.isArray(m.series)||m.series.length!==1||typeof m.series[0]!=='string'||!Array.isArray(m.connectors)||m.connectors.length!==m.bars.length-1||!Array.isArray(m.ticks)||m.ticks.length>30||typeof m.showPositiveSign!=='boolean'||(m.palette!==null&&(!m.palette||['positive','negative'].some(k=>typeof m.palette[k]!=='string'||m.palette[k].length>500))))throw Error('瀑布图数据绑定无效，请重新识别');
    const keys=new Set();let sum=0,changes=0;
    const ref=(key,tag)=>{if(keys.has(key))throw Error('瀑布图绑定标记重复');keys.add(key);const n=mark(svg,key,tag);if(tag==='text'&&!textLeaf(n))throw Error('瀑布图标签结构已改变');if(!api.untransformed(n,svg))throw Error('瀑布图内部已发生变换，请撤回后重试');return n;};
    for(const [i,b] of m.bars.entries()){
      ref(b.key,'rect');if(b.labelKey!==null)ref(b.labelKey,'text');
      if(b.row!==i||b.column!==0||!['start','change','total'].includes(b.role)||(i===0?b.role!=='start':b.role==='start')||(i===m.bars.length-1&&b.role!=='total')||!finite(b.value)||Math.abs(b.value)>1e12||![-1,0,1].includes(b.originalSign)||![-1,0,1].includes(b.paintSign)||(b.paintOverride!==null&&(typeof b.paintOverride!=='string'||b.paintOverride.length>500))||!finite(b.labelOffset)||!templateOK(b.labelTemplate)||!templateOK(b.titleTemplate)||!templateOK(b.ariaTemplate)||(b.labelKey!==null&&!b.labelTemplate)||typeof b.dataValue!=='boolean'||!b.originalFill||typeof b.originalFill.value!=='string'||b.originalFill.value.length>500||!['','important'].includes(b.originalFill.priority))throw Error('瀑布图柱形绑定无效');
      if(b.role==='start')sum=b.value;else if(b.role==='change'){sum=add(sum,b.value);changes++;}
      if(sum<0)throw Error('本图支持正负增量，但累计值不能小于 0；此次输入未应用。');
      if(sum>1e12)throw Error('累计值不能超过 1 万亿；此次输入未应用。');
    }
    if(!changes)throw Error('未找到可编辑的瀑布增量');
    m.connectors.forEach((c,i)=>{ref(c.key,'line');if(c.row!==i)throw Error('瀑布连接线绑定无效');});
    m.ticks.forEach((t,i)=>{ref(t.key,'text');if(!finite(t.value)||t.value<0||!formatOK(t.format)||(i>0&&t.value<=m.ticks[i-1].value))throw Error('瀑布图刻度绑定无效');});
    return m;
  }
  function update(svg,m) {
    read(svg,m);let sum=0;const cumulative=m.bars.map(b=>{if(b.role==='start')sum=b.value;else if(b.role==='change')sum=add(sum,b.value);return sum;});
    const highest=Math.max(...cumulative),axisTop=m.ticks.at(-1)?.value||m.originalCapacity,target=highest>m.originalCapacity?(m.ticks.length>2?api.niceMax(highest,m.ticks.length-1):highest):axisTop,factor=highest>m.originalCapacity?axisTop/target:1,vertical=m.orientation==='vertical',position=v=>m.zero+v*m.unit*factor*(vertical?-1:1);
    sum=0;let uncertainColor=false;
    for(const b of m.bars){
      const from=b.role==='change'?sum:0,to=b.role==='change'?add(sum,b.value):b.role==='start'?b.value:sum;
      if(b.role==='total')b.value=sum;else sum=to;
      const rect=mark(svg,b.key,'rect'),start=position(from),end=position(to);
      setNumber(rect,vertical?'y':'x',Math.min(start,end));setNumber(rect,vertical?'height':'width',Math.abs(end-start));
      if(b.labelKey){const n=mark(svg,b.labelKey,'text');setNumber(n,vertical?'y':'x',(vertical?Math.min(start,end):Math.max(start,end))+b.labelOffset);setText(n,valueText(b.value,b.labelTemplate,b.role==='change'&&m.showPositiveSign));}
      for(const [t,node,attr] of [[b.titleTemplate,rect.querySelector('title'),null],[b.ariaTemplate,rect,'aria-label']])if(t&&node){const text=valueText(b.value,t,b.role==='change'&&m.showPositiveSign);attr?node.setAttribute(attr,text):node.textContent=text;}
      if(b.dataValue)rect.setAttribute('data-value',String(b.value));
      const sign=Math.sign(b.value),swapped=b.role==='change'&&sign!==0&&sign!==b.originalSign;
      if(b.role==='change'&&sign!==0&&sign!==b.paintSign&&m.palette&&!rect.hasAttribute('data-studio-original-paint')){
        const owned=b.paintOverride!==null&&rect.style.getPropertyValue('fill')===b.paintOverride&&rect.style.getPropertyPriority('fill')==='important';
        if(sign===b.originalSign&&owned){if(b.originalFill.value)rect.style.setProperty('fill',b.originalFill.value,b.originalFill.priority);else rect.style.removeProperty('fill');b.paintOverride=null;}
        else {if(!owned)b.originalFill={value:rect.style.getPropertyValue('fill'),priority:rect.style.getPropertyPriority('fill')};rect.style.setProperty('fill',m.palette[sign>0?'positive':'negative'],'important');b.paintOverride=rect.style.getPropertyValue('fill');}
      }
      if(b.role==='change'&&sign!==0&&!rect.hasAttribute('data-studio-original-paint'))b.paintSign=sign;
      if(swapped&&!m.palette)uncertainColor=true;
    }
    for(const c of m.connectors){const line=mark(svg,c.key,'line'),p=position(cumulative[c.row]);setNumber(line,vertical?'y1':'x1',p);setNumber(line,vertical?'y2':'x2',p);}
    for(const t of m.ticks)setText(mark(svg,t.key,'text'),display(t.value/factor,t.format));
    m.result=sum;m.scaled=factor<1;m.uncertainColor=uncertainColor;svg.setAttribute(chartAttr,JSON.stringify(m));
  }
  return {analyze,bind,read,update};
}
