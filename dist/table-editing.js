// Preserve the original cell subtree; data editing must not remove a styled
// span, strong label, icon or other decoration around the value.
export function tableCellSlot(cell) {
  const leaves=[],all=[],walker=cell.ownerDocument.createTreeWalker(cell,4);
  while(walker.nextNode()){
    const node=walker.currentNode;
    if(node.parentElement.closest('svg,script,style,template'))continue;
    all.push(node);if(node.textContent.trim())leaves.push(node);
  }
  if(leaves.length===1)return {node:leaves[0],container:leaves[0].parentElement};
  if(leaves.length>1)return null;
  // A temporarily emptied value still has its original text node.
  if(all.length===1)return {node:all[0],container:all[0].parentElement};
  let container=cell;
  while(container.children.length===1&&!container.firstElementChild.matches('svg,img,input,video,canvas,iframe,script,style,br'))container=container.firstElementChild;
  return container.children.length===0?{node:null,container}:null;
}
export function tableCellText(cell) {
  const slot=tableCellSlot(cell);
  return slot?.node?slot.node.textContent.trim():cell.textContent.trim();
}
export function tableNumber(raw) {
  const text=String(raw).trim().replaceAll('−','-').replaceAll('，',',');
  if(!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text))return null;
  const value=Number(text.replaceAll(',',''));
  return Number.isFinite(value)?value:null;
}
export function writeTableCellText(cell,raw) {
  const slot=tableCellSlot(cell);
  if(!slot)throw Error('此单元格包含多个文本片段，请在画布中双击具体文字编辑，以保留原样式。');
  if(slot.node)slot.node.textContent=String(raw);
  else slot.container.append(cell.ownerDocument.createTextNode(String(raw)));
}
export function rememberTableNumberFormat(cell) {
  if(cell.hasAttribute('data-studio-number-format'))return;
  const text=tableCellText(cell);if(tableNumber(text)===null)return;
  const decimals=(text.match(/\.(\d+)/)?.[1]||'').length;
  if(decimals<=10)cell.dataset.studioNumberFormat=JSON.stringify({comma:/[,，]/.test(text),decimals,minus:text.includes('−')?'−':'-'});
}
export function formatTableValue(cell,value) {
  if(typeof value!=='number'||!Number.isFinite(value))return String(value);
  let f;try{f=JSON.parse(cell.dataset.studioNumberFormat);}catch{}
  if(!f||typeof f.comma!=='boolean'||!Number.isInteger(f.decimals)||f.decimals<0||f.decimals>10||!['-','−'].includes(f.minus))return String(value);
  return value.toLocaleString('en-US',{useGrouping:f.comma,minimumFractionDigits:f.decimals,maximumFractionDigits:10}).replace(/^-/,f.minus);
}
export function putTableCell(cell,raw) {
  if(!tableCellSlot(cell))throw Error('此单元格包含多个文本片段，请在画布中编辑具体文字。');
  rememberTableNumberFormat(cell);cell.removeAttribute('data-studio-auto-sum');
  if(String(raw).startsWith('='))cell.dataset.studioFormula=raw;
  else {cell.removeAttribute('data-studio-formula');writeTableCellText(cell,raw);}
}
export function clearTableCell(cell) {
  for(const attr of ['data-studio-formula','data-studio-number-format','data-studio-auto-sum'])cell.removeAttribute(attr);
  const slot=tableCellSlot(cell);
  if(slot){if(slot.node)slot.node.textContent='';return;}
  const walker=cell.ownerDocument.createTreeWalker(cell,4),nodes=[];
  while(walker.nextNode())if(!walker.currentNode.parentElement.closest('svg,script,style,template'))nodes.push(walker.currentNode);
  nodes.forEach(n=>n.textContent='');
}
const totalLabel=text=>/(?:合计|总计|汇总|总额|总数|小计|\btotal|\btotals|\bsum)$/i.test(text.trim())&&!/率|比例|占比|平均|均值|average|ratio|percent/i.test(text);
const nonAdditive=text=>/率|占比|比例|平均|均价|单价|\b(?:rate|ratio|percent|average|avg|price)\b|%|％/i.test(text);
const tableColumn=index=>{let text='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))text=String.fromCharCode(65+(n-1)%26)+text;return text;};
const tableSignature=table=>JSON.stringify([...table.rows].map(r=>[...r.cells].map(c=>[tableCellText(c),c.getAttribute('data-studio-formula')])));
export function inspectTableTotals(table) {
  const fail=reason=>({table,entries:[],matched:false,reason});
  const rows=[...table.rows],columns=rows[0]?.cells.length||0;
  if(rows.length<3||rows.length>200||columns<2||columns>26||table.querySelector('table')||rows.some(r=>r.cells.length!==columns||[...r.cells].some(c=>c.rowSpan!==1||c.colSpan!==1)))return fail('仅自动识别无合并单元格的规则表格。');
  const header=[...rows[0].cells].map(tableCellText);
  if(header.some(t=>!t)||header.slice(1).some(t=>tableNumber(t)!==null))return fail('需要明确的首行列名。');
  const rowTotals=totalLabel(header.at(-1)),columnTotals=totalLabel(tableCellText(rows.at(-1).cells[0]));
  if(!rowTotals&&!columnTotals)return fail('未找到末列或末行明确标注的合计。');
  const endRow=rows.length-(columnTotals?1:0),endColumn=columns-(rowTotals?1:0);
  if(endRow<3||endColumn<2||header.slice(1,endColumn).some(totalLabel)||header.slice(1,endColumn).some(nonAdditive)||rows.slice(1,endRow).some(r=>!tableCellText(r.cells[0])||totalLabel(tableCellText(r.cells[0]))))return fail('含多级小计、比例或非加总字段，请手动设置公式。');
  const values=rows.map(r=>[...r.cells].map(c=>tableNumber(tableCellText(c))));
  for(let r=1;r<endRow;r++)for(let c=1;c<endColumn;c++)if(values[r][c]===null||Math.abs(values[r][c])>1e12||!tableCellSlot(rows[r].cells[c]))return fail('明细需是可明确读取的普通数值，不包含单位文字、比例或多段文本。');
  const entries=[];
  const add=(r,c,expected,formula,axis)=>{
    const cell=rows[r].cells[c];if(cell.hasAttribute('data-studio-formula'))return;
    if(!tableCellSlot(cell)||cell.closest('[data-hs-locked="true"]')||cell.querySelector('[data-hs-locked="true"]')||!Number.isFinite(expected)||Math.abs(expected)>1e15)return false;
    entries.push({cell,r,c,address:`${tableColumn(c)}${r+1}`,actual:tableCellText(cell),expected,formula,axis,equal:values[r][c]!==null&&Math.abs(values[r][c]-expected)<Math.max(1e-7,Math.abs(expected)*1e-10)});return true;
  };
  const rowSums=rows.slice(1,endRow).map((_,i)=>values[i+1].slice(1,endColumn).reduce((a,b)=>a+b,0));
  if(rowTotals)for(let r=1;r<endRow;r++)if(add(r,columns-1,rowSums[r-1],`=SUM(B${r+1}:${tableColumn(endColumn-1)}${r+1})`,'row')===false)return fail('合计单元格结构复杂，无法保留格式建立公式。');
  if(columnTotals)for(let c=1;c<columns;c++){
    const expected=rowTotals&&c===columns-1?rowSums.reduce((n,sum,i)=>n+(rows[i+1].cells[c].hasAttribute('data-studio-formula')?values[i+1][c]:sum),0):values.slice(1,endRow).reduce((n,r)=>n+r[c],0);
    if(add(rows.length-1,c,expected,`=SUM(${tableColumn(c)}2:${tableColumn(c)}${endRow})`,'column')===false)return fail('合计单元格结构复杂，无法保留格式建立公式。');
  }
  return {table,entries,matched:entries.length>0&&entries.every(e=>e.equal),signature:tableSignature(table),reason:entries.length?'':'可识别的合计已包含公式。'};
}
export function applyTableTotals(plan) {
  if(!plan.entries.length||plan.signature!==tableSignature(plan.table)||plan.entries.some(e=>e.cell.closest('table')!==plan.table||!tableCellSlot(e.cell)||e.cell.closest('[data-hs-locked="true"]')||e.cell.querySelector('[data-hs-locked="true"]')))return false;
  for(const e of plan.entries){rememberTableNumberFormat(e.cell);e.cell.dataset.studioFormula=e.formula;e.cell.dataset.studioAutoSum=e.axis;}
  plan.table.dataset.studioTotals='1';return true;
}
export function ensureTableTotals(table) {
  if(!table||table.dataset.studioTotals==='1')return false;
  const plan=inspectTableTotals(table);return plan.matched&&applyTableTotals(plan);
}
