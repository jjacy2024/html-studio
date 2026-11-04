// Spreadsheet clipboard text (TSV), including quoted tabs/newlines. No HTML,
// spreadsheet runtime, formula eval or clipboard permission is required.
export function parseDataPaste(text) {
  if (text.length > 256 * 1024 || new TextEncoder().encode(text).byteLength > 256 * 1024) throw Error('粘贴内容过大；一次最多 200 行、26 列、256 KiB 文本。');
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows = []; let row = [], cell = '', quoted = false, endedQuote = false;
  const pushCell = () => { if(cell.length > 8000)throw Error('单元格文本过长（最多 8000 字符）。');row.push(cell);cell='';endedQuote=false; };
  const pushRow = () => { pushCell(); rows.push(row); row=[];if(rows.length>201)throw Error('一次最多粘贴 200 行。'); };
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;endedQuote=true;}}else cell+=ch;continue;}
    if(ch==='\t'){pushCell();if(row.length>26)throw Error('一次最多粘贴 26 列。');}
    else if(ch==='\n')pushRow();
    else if(ch==='"'&&!cell&&!endedQuote)quoted=true;
    else {if(endedQuote)throw Error('引号后的内容无法解析，请重新从表格复制。');cell+=ch;}
  }
  if(quoted)throw Error('粘贴文本中存在未闭合的引号。');
  if(cell||row.length||!text.endsWith('\n'))pushRow();
  if(!rows.length||rows.length>200||rows[0].length>26)throw Error('一次最多粘贴 200 行、26 列。');
  if(rows.some(r=>r.length!==rows[0].length))throw Error('每行的列数不同，请复制一个完整的矩形区域。');
  return rows;
}

export function pasteNumber(raw, {negative=false}={}) {
  const text=String(raw).trim().replace(/−/g,'-');
  // Require proper thousands grouping rather than silently accepting 1,2 as 12.
  if(!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)$/.test(text))throw Error('请输入有效数值；千分位用逗号，百分比按原单位输入数字，不带 %。');
  const value=Number(text.replaceAll(',',''));
  if(!Number.isFinite(value)||Math.abs(value)>1e12||(!negative&&value<0))throw Error(negative?'数值须在 -1 万亿至 1 万亿之间。':'数值须在 0 至 1 万亿之间。');
  return value;
}

export function bindDataPaste(grid, config) {
  const dialog=grid.closest('dialog');
  const hint=document.createElement('p');hint.className='data-paste-hint';
  hint.textContent='批量粘贴：先选起始单元格，再按 Ctrl / ⌘ + V。支持从 Excel / WPS 复制多行多列；超出已有范围不会应用。';
  const status=document.createElement('p');status.className='data-paste-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  // Keep feedback outside the scrollport so large tables don't hide errors.
  const scroll=grid.parentElement,panel=document.createElement('div');panel.className='data-paste-panel';
  scroll.before(panel);panel.append(hint,scroll,status);
  let busy=false;
  const live=()=>grid.isConnected&&dialog.open&&config.valid();
  grid.addEventListener('paste',async event=>{
    const input=event.target.closest('input');if(!input||!grid.contains(input))return;
    const text=event.clipboardData?.getData('text/plain');if(!text||!/[\t\r\n]/.test(text))return;
    event.preventDefault();event.stopPropagation();
    if(busy){status.textContent='上一批数据正在更新，请稍候。';return;}
    if(!live())return;
    try {
      let matrix=parseDataPaste(text);
      const inputs=[...grid.tBodies[0].rows].map(r=>[...r.querySelectorAll('input')]);
      const r0=inputs.findIndex(r=>r.includes(input)),c0=inputs[r0]?.indexOf(input);
      if(r0<0||c0<0)throw Error('请先选中数据单元格。');
      const names=config.rowNames?.(),columns=config.columnNames?.();let heading=false,labels=false,skipped=0;
      // Strip headings/categories only on an exact match with the visible grid.
      if(columns){
        const first=matrix[0],withCorner=['分类','项目','名称',''].includes(first[0]?.trim());
        const offset=withCorner?1:0,header=first.slice(offset);
        if(header.length&&header.every((v,i)=>v.trim()===String(columns[c0+i]??'').trim())){matrix=matrix.slice(1);heading=true;}
      }
      if(names&&matrix.length&&matrix[0].length>1&&matrix.every((r,i)=>r[0].trim()===String(names[r0+i]??'').trim())){matrix=matrix.map(r=>r.slice(1));labels=true;}
      if(!matrix.length||!matrix[0].length)throw Error('没有可粘贴的数据。');
      if(r0+matrix.length>inputs.length||matrix.some((r,i)=>c0+r.length>inputs[r0+i].length))throw Error('粘贴范围超出已有行列；请调整起始位置或先新增行列。此操作不会自动新增行列。');
      const changes=[];
      matrix.forEach((row,r)=>row.forEach((raw,c)=>{
        const rr=r0+r,cc=c0+c,cell=inputs[rr][cc];
        if(config.skip?.(rr,cc)){skipped++;return;}
        if(cell.readOnly||cell.disabled)throw Error(`第 ${rr+1} 行、第 ${cc+1} 列不可编辑；整批数据未应用。`);
        changes.push({row:rr,column:cc,raw,input:cell});
      }));
      if(!changes.length)throw Error('所选区域均为自动计算或只读单元格。');
      // Each adapter validates its complete proposed model before any mutation.
      busy=true;grid.setAttribute('aria-busy','true');status.dataset.state='loading';status.textContent='正在校验并更新…';
      const result=await config.apply(changes);
      if(!live())return;
      if(result===false)throw Error('数据未应用，请检查图表状态后重试。');
      const extra=result?.skipped||0;skipped+=extra;
      status.dataset.state='success';status.textContent=`已粘贴 ${changes.length-extra} 个单元格，可单步撤回${heading||labels?'；已匹配表头／分类':''}${skipped?`；${skipped} 个合计单元格保持自动计算`:''}。`;
    }catch(error){if(live()){status.dataset.state='error';status.textContent=String(error.message||error);}}
    finally{busy=false;grid.removeAttribute('aria-busy');}
  });
}
