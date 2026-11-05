import {escapeHTML} from './document.js';

export const validChartColor = value => typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value);
export function chartColorHex(value) {
  if(validChartColor(value))return value.toLowerCase();
  const rgb=String(value).match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/);
  return rgb?'#'+rgb.slice(1,4).map(n=>Math.max(0,Math.min(255,Number(n))).toString(16).padStart(2,'0')).join(''):'#7951df';
}

// The panel is shared by every renderer. Callers own transactions and rendering.
export function mountChartPaints(body,{items,valid,change}) {
  body.querySelector('.chart-paints')?.remove();
  const panel=document.createElement('details');panel.className='chart-paints';
  panel.innerHTML='<summary>单个数据元素颜色</summary><p class="source-note">每项独立设置；原渐变保留到你主动改色。设置纯色会替换该项填充，恢复原色可还原。折线无填充时使用数据点或线段颜色。</p><div class="chart-paint-list"></div><p class="chart-paint-status" role="status"></p>';
  body.append(panel);let busy=false;
  const draw=()=>{panel.querySelector('.chart-paint-list').innerHTML=items().map((item,i)=>`<label class="chart-paint-row"><span>${escapeHTML(item.name)}</span><input type="color" data-chart-paint="${i}" value="${chartColorHex(item.color)}" aria-label="${escapeHTML(item.name)}填充颜色"><input data-chart-paint-hex="${i}" value="${chartColorHex(item.color)}" aria-label="${escapeHTML(item.name)}颜色值" maxlength="7" spellcheck="false"><button type="button" class="text-button" data-chart-paint-reset="${i}">恢复原色</button></label>`).join('');};
  const apply=async(index,value)=>{
    if(busy||!valid())return;
    const item=items()[index];if(!item)return;
    if(value!==null&&!validChartColor(value)){panel.querySelector('.chart-paint-status').textContent='请输入 #RRGGBB 格式，例如 #7C4DFF。';return;}
    busy=true;panel.querySelector('.chart-paint-list').inert=true;
    try{await change(item,value?.toLowerCase()??null);if(valid()){draw();panel.querySelector('.chart-paint-status').textContent=value===null?'已恢复该项原色':'已更新该项颜色，可撤回';}}
    catch(error){panel.querySelector('.chart-paint-status').textContent=error.message;}
    finally{busy=false;panel.querySelector('.chart-paint-list').inert=false;}
  };
  panel.addEventListener('change',event=>{const input=event.target;const index=input.dataset.chartPaint??input.dataset.chartPaintHex;if(index!==undefined)void apply(Number(index),input.value);});
  panel.addEventListener('click',event=>{const button=event.target.closest('[data-chart-paint-reset]');if(button)void apply(Number(button.dataset.chartPaintReset),null);});
  draw();return {refresh:draw};
}

export function setChartNodePaint(node,color,property) {
  const prop=property||(node.namespaceURI==='http://www.w3.org/2000/svg'?'fill':'background-color');
  if(!['fill','stroke','background-color'].includes(prop)||color!==null&&!validChartColor(color))throw Error('图表颜色无效');
  const key='data-studio-original-paint',properties=prop==='background-color'?['background-color','background-image']:[prop];
  let original;try{original=JSON.parse(node.getAttribute(key));}catch{}
  if(!original){original={};for(const p of properties)original[p]=[node.style.getPropertyValue(p),node.style.getPropertyPriority(p)];}
  if(color===null){for(const p of properties){const pair=original[p];if(Array.isArray(pair)&&typeof pair[0]==='string'&&pair[0].length<50000&&['','important'].includes(pair[1])){if(pair[0])node.style.setProperty(p,pair[0],pair[1]);else node.style.removeProperty(p);}}node.removeAttribute(key);return;}
  node.setAttribute(key,JSON.stringify(original));
  node.style.setProperty(prop,color,'important');
  if(prop==='background-color')node.style.setProperty('background-image','none','important');
}

export function mountDOMChartPaints(body,editor,root,{items,flush,preview,afterPaint}) {
  const version=editor.loadVersion;
  const valid=()=>root.isConnected&&root.ownerDocument===editor.doc&&version===editor.loadVersion&&!editor.preview&&!editor.locked(root);
  return mountChartPaints(body,{valid,items:()=>items().map(item=>({...item,color:editor.style(item.node).getPropertyValue(item.property||(item.node.namespaceURI==='http://www.w3.org/2000/svg'?'fill':'background-color'))})),change(item,color){
    if(!valid()||editor.locked(item.node)||item.node.querySelector('[data-hs-locked="true"]')||(item.swatches||[]).some(n=>editor.locked(n)))throw Error('此数据元素已锁定或不在当前工程中');
    flush?.();setChartNodePaint(item.node,color,item.property);for(const swatch of item.swatches||[])setChartNodePaint(swatch,color,item.property);
    afterPaint?.(item,color);editor.commit(color===null?'恢复图表元素原色':'修改图表元素颜色');preview?.();editor.draw();
  }});
}
