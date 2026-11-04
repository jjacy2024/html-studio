// Conservative adapter for a single, normalized HTML/CSS composition bar.
// Text-node paths preserve nested labels and formatting instead of replacing HTML.
const SHARE_KEY='data-studio-html-key';
function shareTexts(el) {
  const out=[],walker=el.ownerDocument.createTreeWalker(el,4);
  while(walker.nextNode())if(walker.currentNode.textContent.trim())out.push(walker.currentNode);
  return out;
}
function sharePath(root,node) {
  const path=[];for(let n=node;n!==root;n=n.parentNode)path.unshift([...n.parentNode.childNodes].indexOf(n));return path;
}
function shareText(root,path) {
  if(!Array.isArray(path)||path.length>12||path.some(n=>!Number.isInteger(n)||n<0||n>1000))throw Error('占比图文本绑定无效。');
  const node=path.reduce((n,i)=>n?.childNodes[i],root);if(node?.nodeType!==3)throw Error('占比图文本结构已变化，请撤回结构修改后重试。');return node;
}
function shareAmount(node) {
  const m=node.textContent.match(/^(\s*[^\d%％]*?)([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s*(?:万元|亿元|万|亿|元|人|件|单)?\s*)$/);
  if(!m)return null;const value=Number(m[2].replaceAll(',',''));if(value<0||value>1e12)return null;
  const unit=m[3].trim().replace(/^(万|亿)元$/,'$1');
  return {node,value,unit,format:{prefix:m[1],suffix:m[3],comma:m[2].includes(','),decimals:(m[2].split('.')[1]||'').length}};
}
function sharePercent(node) {
  const m=node.textContent.match(/^(\s*)(\d+(?:\.\d+)?)(\s*[%％]\s*)$/);if(!m)return null;
  return {node,value:Number(m[2]),format:{prefix:m[1],suffix:m[3],decimals:(m[2].split('.')[1]||'').length}};
}
const shareStyleNames=['padding-left','padding-right','border-left-width','border-right-width'];
export function analyzeHTMLShares(root) {
  if(!root||!['DIV','FIGURE','SECTION','MAIN'].includes(root.tagName)||root.childElementCount<2||root.childElementCount>20)return null;
  const view=root.ownerDocument.defaultView,s=view.getComputedStyle(root),children=[...root.children];
  if(!['flex','inline-flex'].includes(s.display)||s.flexDirection!=='row'||s.flexWrap!=='nowrap'||parseFloat(s.columnGap)>0||root.querySelectorAll('*').length>300||shareTexts(root).length>100)return null;
  if([...root.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||root.querySelector('svg,canvas,table,script,iframe,button,input,a,img,video'))return null;
  const bars=[];
  for(const el of children) {
    if(el.querySelectorAll('*').length>30)return null;
    const style=view.getComputedStyle(el),rect=el.getBoundingClientRect(),texts=shareTexts(el);
    if(style.position==='absolute'||style.position==='fixed'||style.transform!=='none'||style.rotate!=='none'||style.scale!=='none'||style.translate!=='none'||parseFloat(style.marginLeft)||parseFloat(style.marginRight))return null;
    if(style.backgroundImage==='none'&&['rgba(0, 0, 0, 0)','transparent'].includes(style.backgroundColor))return null;
    const percentages=texts.map(sharePercent).filter(Boolean),amounts=texts.filter(n=>!sharePercent(n)).map(shareAmount).filter(Boolean);
    if(percentages.length!==1||amounts.length!==1||amounts[0].format.decimals>8||percentages[0].format.decimals>6)return null;
    const amount=amounts[0],percent=percentages[0],label=texts.find(n=>n!==amount.node&&n!==percent.node&&!/\d/.test(n.textContent));
    const category=amount.format.prefix.trim().replace(/[:：\s]+$/,'')||label?.textContent.trim();
    if(!category||category.length>100||percent.value>100)return null;
    const baseline={};for(const p of shareStyleNames)baseline[p]={value:el.style.getPropertyValue(p),priority:el.style.getPropertyPriority(p),pixels:parseFloat(style.getPropertyValue(p))||0};
    bars.push({el,rect,category,value:amount.value,unit:amount.unit,format:amount.format,amountPath:sharePath(el,amount.node),percentPath:sharePath(el,percent.node),percentFormat:percent.format,categoryPath:label?sharePath(el,label):null,percentage:percent.value,baseline});
  }
  const total=bars.reduce((n,b)=>n+b.value,0),width=bars.reduce((n,b)=>n+b.rect.width,0);
  if(total<=0||width<=0||new Set(bars.map(b=>b.unit)).size!==1||new Set(bars.map(b=>b.category)).size!==bars.length)return null;
  for(let i=0;i<bars.length;i++) {
    const b=bars[i],expected=b.value/total*100;
    if(Math.abs(b.percentage-expected)>.5*10**-b.percentFormat.decimals+.01||Math.abs(b.rect.width/width*100-expected)>1)return null;
    if(Math.abs(b.rect.top-bars[0].rect.top)>2||Math.abs(b.rect.height-bars[0].rect.height)>2||b.rect.height<4||(i&&Math.abs(b.rect.left-bars[i-1].rect.right)>2))return null;
  }
  return {root,kind:'share',bars};
}
export function htmlShareTarget(node) {
  // Bound ancestor walk and descendant search keep ordinary double-clicks cheap.
  for(let el=node,depth=0;el&&el.tagName!=='BODY'&&depth<6;el=el.parentElement,depth++)if(analyzeHTMLShares(el))return el;
  if(!node||node.querySelectorAll('*').length>300)return null;
  const found=[...node.querySelectorAll('div,figure,section')].filter(el=>analyzeHTMLShares(el));return found.length===1?found[0]:null;
}
export function htmlShareElements(root,model) {
  if(model?.version!==2||model.kind!=='share'||!Array.isArray(model.bars)||model.bars.length<1||model.bars.length>20)throw Error('占比图绑定无效。');
  if(root.childElementCount!==model.bars.length)throw Error('占比图分段数量已变化，请撤回结构修改后重试。');
  const seen=new Set();return model.bars.map(b=>{
    if(!/^bar-\d+$/.test(b.key)||!Number.isFinite(b.value)||b.value<0||b.value>1e12||typeof b.category!=='string'||b.category.length>100)throw Error('占比图数据无效。');
    for(const f of [b.format,b.percentFormat])if(!f||typeof f.prefix!=='string'||typeof f.suffix!=='string'||f.prefix.length>120||f.suffix.length>20||!Number.isInteger(f.decimals)||f.decimals<0||f.decimals>8)throw Error('占比图格式无效。');
    for(const p of shareStyleNames){const s=b.baseline?.[p];if(!s||typeof s.value!=='string'||s.value.length>100||!['','important'].includes(s.priority)||!Number.isFinite(s.pixels)||s.pixels<0)throw Error('占比图样式绑定无效。');}
    const nodes=root.querySelectorAll(`[${SHARE_KEY}="${b.key}"]`);if(nodes.length!==1||nodes[0].parentElement!==root||seen.has(nodes[0]))throw Error('占比图结构已变化，请撤回结构修改后重试。');
    const el=nodes[0];seen.add(el);const amount=shareText(el,b.amountPath),percent=shareText(el,b.percentPath);if(amount===percent)throw Error('占比图标签绑定无效。');return {el,label:percent.parentElement,amount,percent,b};
  });
}
export function bindHTMLShares(analysis) {
  const model={version:2,kind:'share',bars:analysis.bars.map(({category,value,format,amountPath,percentPath,percentFormat,baseline,categoryPath},i)=>({key:'bar-'+i,category,value,format,amountPath,percentPath,percentFormat,baseline,categoryPath}))};
  analysis.bars.forEach((b,i)=>b.el.setAttribute(SHARE_KEY,model.bars[i].key));
  analysis.root.setAttribute('data-studio-html-chart',JSON.stringify(model));return model;
}
export function updateHTMLShares(root,model) {
  const elements=htmlShareElements(root,model),total=model.bars.reduce((n,b)=>n+b.value,0);
  if(total<=0)throw Error('占比图合计须大于 0；保留上一次有效结果。');
  const s=root.ownerDocument.defaultView.getComputedStyle(root),available=root.clientWidth-(parseFloat(s.paddingLeft)||0)-(parseFloat(s.paddingRight)||0);
  for(const {el,amount,percent,b} of elements) {
    const ratio=b.value/total*100,px=available*ratio/100;
    el.style.setProperty('box-sizing','border-box','important');el.style.setProperty('flex',`0 0 ${ratio}%`,'important');el.style.setProperty('width',ratio+'%','important');el.style.setProperty('min-width','0','important');el.style.setProperty('max-width','none','important');el.style.setProperty('overflow','hidden','important');
    // Padding/borders can otherwise impose a minimum width on tiny/zero segments.
    // Reduce only when necessary and restore the original declarations on growth.
    const inset=shareStyleNames.reduce((n,p)=>n+b.baseline[p].pixels,0),factor=inset>px?Math.max(0,px/inset):1;
    for(const p of shareStyleNames){const original=b.baseline[p];if(factor<1)el.style.setProperty(p,original.pixels*factor+'px','important');else if(original.value)el.style.setProperty(p,original.value,original.priority);else el.style.removeProperty(p);}
    amount.textContent=b.format.prefix+b.value.toLocaleString('en-US',{useGrouping:b.format.comma,minimumFractionDigits:b.format.decimals,maximumFractionDigits:Math.max(b.format.decimals,6)})+b.format.suffix;
    percent.textContent=b.percentFormat.prefix+ratio.toFixed(b.percentFormat.decimals)+b.percentFormat.suffix;
  }
  root.setAttribute('data-studio-html-chart',JSON.stringify(model));
}
