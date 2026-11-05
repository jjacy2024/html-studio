import {mountChartPaints,validChartColor} from './chart-paints.js';
import {detectTableHeatmap,refreshTableHeatmap,resizeTableColumns,updateKnownChartMotion} from './chart-structure.js';
import {bindDataPaste} from './data-paste.js';
import { annotate, escapeHTML, uid } from './document.js';
import {tableCellSlot,tableCellText,tableNumber,writeTableCellText,rememberTableNumberFormat,formatTableValue,putTableCell,clearTableCell,inspectTableTotals,applyTableTotals,ensureTableTotals} from './table-editing.js';

export const DATA_LIMITS = { rows: 200, columns: 26 };
export function columnName(index) {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
function cellAddress(address) {
  const m = /^([A-Z]+)([1-9]\d*)$/i.exec(address);
  if (!m) throw Error('#REF!');
  return [Number(m[2]) - 1, [...m[1].toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1];
}
// A bounded expression parser. Imported formulas never become JavaScript.
export function evaluateGrid(grid) {
  const cache = new Map(), visiting = new Set();
  const value = (r, c) => {
    if (r < 0 || c < 0 || r >= grid.length || c >= (grid[r]?.length || 0)) throw Error('#REF!');
    const key = `${r}:${c}`;
    if (cache.has(key)) { const v = cache.get(key); if (typeof v === 'string' && v.startsWith('#')) throw Error(v); return v; }
    if (visiting.has(key)) throw Error('#CYCLE!');
    if (visiting.size >= 128) throw Error('#LIMIT!');
    visiting.add(key);
    let result = String(grid[r][c] ?? '').trim();
    try {
      if (result.startsWith('=')) result = expression(result.slice(1));
      else if (tableNumber(result)!==null) result=tableNumber(result);
      else if (result !== '' && Number.isFinite(Number(result))) result = Number(result);
      cache.set(key, result); return result;
    } catch (error) { cache.set(key, error.message); throw error; }
    finally { visiting.delete(key); }
  };
  const number = x => { if (x === '') return 0; if (typeof x !== 'number' || !Number.isFinite(x)) throw Error('#VALUE!'); return x; };
  const expression = source => {
    if (source.length > 500) throw Error('#LIMIT!');
    const tokens = source.toUpperCase().match(/#REF!|[A-Z]+[1-9]\d*|[A-Z]+|(?:\d+(?:\.\d*)?|\.\d+)|[+\-*/():,]|\S/g) || [];
    let at = 0, depth = 0;
    const take = token => { if (tokens[at] === token) { at++; return true; } return false; };
    const need = token => { if (!take(token)) throw Error('#FORMULA!'); };
    const primary = () => {
      if (++depth > 40) throw Error('#LIMIT!');
      try {
        if (take('+')) return number(primary());
        if (take('-')) return -number(primary());
        if (take('(')) { const x = sum(); need(')'); return x; }
        const t = tokens[at++];
        if (!t) throw Error('#FORMULA!');
        if (t === '#REF!') throw Error('#REF!');
        if (/^(?:\d|\.)/.test(t)) return Number(t);
        if (/^[A-Z]+\d+$/.test(t)) return value(...cellAddress(t));
        if (!['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'].includes(t)) throw Error('#FORMULA!');
        need('('); const values = [];
        if (tokens[at] !== ')') do {
          if (/^[A-Z]+\d+$/.test(tokens[at] || '') && tokens[at + 1] === ':') {
            const [r1,c1] = cellAddress(tokens[at]); at += 2;
            const [r2,c2] = cellAddress(tokens[at++]);
            if (Math.max(r1,r2) >= grid.length || Math.max(c1,c2) >= grid[0].length) throw Error('#REF!');
            for (let r = Math.min(r1,r2); r <= Math.max(r1,r2); r++) for (let c = Math.min(c1,c2); c <= Math.max(c1,c2); c++) values.push(value(r,c));
          } else values.push(sum());
        } while (take(','));
        need(')'); const nums = values.filter(v => typeof v === 'number');
        if (t === 'COUNT') return nums.length;
        if (t === 'SUM') return nums.reduce((a,b) => a+b, 0);
        if (!nums.length) return t === 'AVERAGE' ? (() => { throw Error('#DIV/0!'); })() : 0;
        if (t === 'AVERAGE') return nums.reduce((a,b) => a+b, 0) / nums.length;
        return t === 'MIN' ? Math.min(...nums) : Math.max(...nums);
      } finally { depth--; }
    };
    const product = () => { let n = primary(); while (['*','/'].includes(tokens[at])) { const op = tokens[at++], b = number(primary()); n = number(n); if (op === '/' && b === 0) throw Error('#DIV/0!'); n = op === '*' ? n*b : n/b; } return n; };
    const sum = () => { let n = product(); while (['+','-'].includes(tokens[at])) { const op = tokens[at++], b = number(product()); n = op === '+' ? number(n)+b : number(n)-b; } return n; };
    const result = sum();
    if (at !== tokens.length || typeof result !== 'number' || !Number.isFinite(result)) throw Error('#FORMULA!');
    return Math.round(result * 1e10) / 1e10;
  };
  return grid.map((row,r) => row.map((_,c) => { try { return value(r,c); } catch (err) { return err.message; } }));
}

export function shiftFormula(formula, axis, index, deleting = false) {
  if (!String(formula).startsWith('=')) return formula;
  const coord = axis === 'row' ? 0 : 1;
  const format = p => `${columnName(p[1])}${p[0]+1}`;
  return formula.replace(/\b([A-Z]+[1-9]\d*)(?::([A-Z]+[1-9]\d*))?\b/gi, (_, first, last) => {
    const a = cellAddress(first), b = last ? cellAddress(last) : null;
    if (b) {
      const lo = Math.min(a[coord], b[coord]), hi = Math.max(a[coord], b[coord]);
      if (deleting && lo === hi && lo === index) return '#REF!';
      for (const p of [a,b]) {
        if (!deleting && p[coord] >= index) p[coord]++;
        if (deleting && p[coord] > index) p[coord]--;
      }
      if (deleting && index === hi) { if (a[coord] === hi) a[coord]--; if (b[coord] === hi) b[coord]--; }
      return `${format(a)}:${format(b)}`;
    }
    if (deleting && a[coord] === index) return '#REF!';
    if (a[coord] >= index) a[coord] += deleting ? -1 : 1;
    return format(a);
  });
}

export function tableGrid(table) {
  return [...table.rows].filter(r => r.closest('table') === table).map(r => [...r.cells].map(c => c.getAttribute('data-studio-formula') || tableCellText(c)));
}
export function tableProblem(table) {
  if (table.querySelector('table')) return '嵌套表格暂不支持数据面板，请逐个编辑文本。';
  const rows = [...table.rows];
  if (!rows.length) return '此表格没有静态数据行；脚本生成的表格暂不能自动读取。';
  if (rows.some(r => [...r.cells].some(c => c.rowSpan !== 1 || c.colSpan !== 1))) return '含合并单元格的表格暂不支持行列数据操作，以免破坏布局。';
  if (rows.some(r => r.cells.length !== rows[0].cells.length)) return '此表格每行的列数不同，暂不支持行列数据操作。';
  if (rows.length > DATA_LIMITS.rows || rows[0].cells.length > DATA_LIMITS.columns) return `数据面板单表支持最多 ${DATA_LIMITS.rows} 行、${DATA_LIMITS.columns} 列。`;
  return '';
}
function updateTable(table) {
  if (tableProblem(table)) return;
  const grid = tableGrid(table), values = evaluateGrid(grid);
  [...table.rows].forEach((row,r) => [...row.cells].forEach((cell,c) => {
    if (cell.hasAttribute('data-studio-formula')&&tableCellSlot(cell)) {
      rememberTableNumberFormat(cell);writeTableCellText(cell,formatTableValue(cell,values[r][c]));
    }
  }));
}
const chartColors = ['#7951df','#2eaaa3','#edaa45','#e7738a','#4e8bdd','#97b849','#bd75c7','#bc8556'];
export function renderDataChart(element, model, doc = element.ownerDocument) {
  const escChart = escapeHTML;
  let matrix = model.grid;
  if (model.table) {
    const table = [...doc.querySelectorAll('table[data-studio-table]')].find(t => t.dataset.studioTable === model.table);
    if (!table || tableProblem(table)) matrix = null;
    else matrix = evaluateGrid(tableGrid(table)).filter((_,i) => table.rows[i].parentElement.tagName !== 'TFOOT'&&![...table.rows[i].cells].some(c=>c.dataset.studioAutoSum==='column'));
  }
  if (!Array.isArray(matrix) || matrix.length < 2 || matrix.length > DATA_LIMITS.rows || !matrix.every(r => Array.isArray(r) && r.length >= 2 && r.length <= DATA_LIMITS.columns)) {
    element.innerHTML = '<div style="padding:32px;color:#a66b23">图表需要数据：请重新绑定至少两行、两列的表格。</div>'; return;
  }
  const values = evaluateGrid(matrix), rows = values.slice(1), series = matrix[0].slice(1);
  const pie = model.type === 'pie', pieColumn = Math.max(1, Math.min(series.length, Number(model.series) || 1));
  const invalid = rows.some(row => (pie ? [pieColumn] : series.map((_,i)=>i+1)).some(c => typeof row[c] !== 'number' || !Number.isFinite(row[c])));
  const invalidPie = pie && rows.some(row => row[pieColumn] < 0);
  const W = 640, H = 360, L = 58, R = 28, T = 60, B = 65, iw = W-L-R, ih = H-T-B;
  let marks = '', legend = '';
  if (invalid || invalidPie) marks = `<text x="30" y="155" fill="#a66b23">${invalidPie ? '饼图不支持负数，请修改数据或改用柱状图。' : '数据含非数值或公式错误，请检查数据面板。'}</text>`;
  else if (pie) {
    const total = rows.reduce((s,r) => s+r[pieColumn],0);
    let angle = -Math.PI/2;
    if (!total) marks = '<text x="60" y="175" fill="#777">总和为 0，暂无可绘制的占比。</text>';
    else rows.forEach((row, i) => {
      const fraction = row[pieColumn]/total, end = angle + fraction*2*Math.PI, radius = 105, cx = 180, cy = 195;
      const color = validChartColor(model.colors?.[`${i+1}:${pieColumn}`])?model.colors[`${i+1}:${pieColumn}`]:chartColors[i%chartColors.length];
      if (fraction >= 0.9999999) marks += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}"><title>${escChart(row[0])}: ${row[pieColumn]}</title></circle>`;
      else if (fraction > 0) marks += `<path data-value="${row[pieColumn]}" d="M${cx},${cy} L${cx+radius*Math.cos(angle)},${cy+radius*Math.sin(angle)} A${radius},${radius} 0 ${fraction>0.5?1:0} 1 ${cx+radius*Math.cos(end)},${cy+radius*Math.sin(end)} Z" fill="${color}" stroke="white" stroke-width="1"><title>${escChart(row[0])}: ${(fraction*100).toFixed(1)}%</title></path>`;
      angle = end;
      if (i < 12) legend += `<rect x="330" y="${75+i*21}" width="10" height="10" rx="2" fill="${color}"/><text x="349" y="${84+i*21}">${escChart(String(row[0]).slice(0,16))} · ${(fraction*100).toFixed(1)}%</text>`;
    });
    if (rows.length > 12) legend += '<text x="330" y="344">其余分类可在数据面板查看</text>';
  } else {
    const nums = rows.flatMap(r => r.slice(1)).filter(v => typeof v === 'number'), min = Math.min(0,...nums), max = Math.max(0,...nums), span = max-min || 1;
    const y = v => T + ih*(max-v)/span, zero = y(0), step = iw/rows.length;
    for (let i=0;i<=4;i++) { const v=min+span*i/4, yy=y(v); marks += `<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#e8e8ee"/><text x="${L-8}" y="${yy+4}" text-anchor="end">${Number(v.toFixed(2))}</text>`; }
    series.forEach((name,s) => {
      const color = chartColors[s%chartColors.length];
      if (s < 6) legend += `<rect x="${L+s*94}" y="334" width="9" height="9" fill="${color}"/><text x="${L+14+s*94}" y="343">${escChart(String(name).slice(0,9))}</text>`;
      if (model.type === 'line') marks += `<polyline data-series="${s}" points="${rows.map((r,i) => `${L+step*(i+0.5)},${y(r[s+1])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
      rows.forEach((r,i) => {
        const v=r[s+1], x=L+step*(i+0.5), yy=y(v);
        const pointColor=validChartColor(model.colors?.[`${i+1}:${s+1}`])?model.colors[`${i+1}:${s+1}`]:color;
        const title=`<title>${escChart(r[0])} · ${escChart(name)}: ${v}</title>`;
        if (model.type === 'line') marks += `<circle cx="${x}" cy="${yy}" r="3.5" fill="${pointColor}">${title}</circle>`;
        else { const width=step*0.76/series.length; marks += `<rect data-value="${v}" x="${L+step*i+step*0.12+s*width}" y="${Math.min(zero,yy)}" width="${Math.max(0.1,width-1)}" height="${Math.abs(zero-yy)}" fill="${pointColor}">${title}</rect>`; }
      });
    });
    rows.forEach((r,i) => { if (i % Math.max(1,Math.ceil(rows.length/9)) === 0) marks += `<text x="${L+step*(i+0.5)}" y="${H-B+22}" text-anchor="middle">${escChart(String(r[0]).slice(0,10))}</text>`; });
  }
  element.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escChart(model.title || '数据图表')}" style="display:block;width:100%;height:100%;font:12px system-ui,sans-serif;fill:#555"><title>${escChart(model.title || '数据图表')}</title><text x="28" y="32" style="font-size:18px;font-weight:600;fill:#252530">${escChart(model.title || '数据图表')}</text>${marks}${legend}</svg>`;
}
export function recalculateData(doc) {
  const tables = new Set([...doc.querySelectorAll('[data-studio-formula]')].map(c => c.closest('table')).filter(Boolean));
  tables.forEach(updateTable);
  doc.querySelectorAll('table[data-studio-heatmap]').forEach(t=>refreshTableHeatmap(t));
  for (const el of doc.querySelectorAll('[data-studio-chart]')) {
    try { renderDataChart(el, JSON.parse(el.dataset.studioChart), doc); }
    catch { el.textContent = '图表数据格式无效，请重新绑定数据。'; }
  }
}

// Validate the entire rectangle before touching the live document. Both the
// data panel and the operation API use the same formula and cell rules.
export function prepareDataCells(target,changes,{skipTotals=true,locked=()=>false}={}) {
  const chart=target.hasAttribute('data-studio-chart'),model=chart?JSON.parse(target.dataset.studioChart):null,grid=chart?model.grid:tableGrid(target);
  if(!chart&&tableProblem(target))throw Error(tableProblem(target));
  for(const cell of changes){
    if(!Number.isInteger(cell.row)||!Number.isInteger(cell.column)||cell.row<0||cell.column<0||cell.row>=grid.length||cell.column>=grid[0].length||typeof cell.raw!=='string'||cell.raw.length>5000)throw Error('数据单元格范围或内容无效');
    const node=chart?target:target.rows[cell.row].cells[cell.column];
    if(locked(node)||node.querySelector('[data-hs-locked="true"]'))throw Error('不能修改锁定单元格');
    if(!chart&&!tableCellSlot(node))throw Error('复杂单元格暂不能安全更新');
  }
  if(model?.table)throw Error('此图表已绑定表格，请在原表格中粘贴数据。');
  const copy=chart?null:target.cloneNode(true);if(copy)ensureTableTotals(copy);
  const next=chart?grid.map(row=>row.slice()):tableGrid(copy);let skipped=0;
  if(!skipTotals&&copy&&changes.some(cell=>copy.rows[cell.row].cells[cell.column].dataset.studioAutoSum))throw Object.assign(Error('自动合计不能直接覆盖，请修改明细数据。'),{code:'READ_ONLY_CELL'});
  const writes=changes.filter(cell=>{if(copy?.rows[cell.row].cells[cell.column].dataset.studioAutoSum){skipped++;return false;}return true;});
  if(!writes.length)throw Error('所选区域为自动合计单元格，请修改明细数据。');
  for(const cell of writes){if(copy)putTableCell(copy.rows[cell.row].cells[cell.column],cell.raw);next[cell.row][cell.column]=cell.raw;}
  const values=evaluateGrid(copy?tableGrid(copy):next),before=evaluateGrid(chart?model.grid:tableGrid(target));
  values.forEach((row,r)=>row.forEach((value,c)=>{
    if(typeof value==='string'&&/^#(?:REF|CYCLE|LIMIT|FORMULA|DIV\/0|VALUE)/.test(value)&&value!==before[r]?.[c])throw Error(`${columnName(c)}${r+1} 的公式结果为 ${value}；整批数据未应用。`);
    if(chart&&r>0&&c>0&&(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e12))throw Error(`${columnName(c)}${r+1} 需要有效数值或可计算的公式。`);
    if(chart&&model.type==='pie'&&r>0&&c===(model.series||1)&&value<0)throw Error('饼图数值不能为负数；整批数据未应用。');
  }));
  return {skipped,apply(){
    if(copy){ensureTableTotals(target);for(const cell of writes)putTableCell(target.rows[cell.row].cells[cell.column],cell.raw);}
    else target.dataset.studioChart=JSON.stringify({...model,grid:next});
  }};
}

export function installDataTools(Editor, ui) {
  const { modal, closeModal, toast } = ui, q = s => document.querySelector(s), escData = escapeHTML;
  const putCell=putTableCell;
  Editor.prototype.insertDataElement = function (type) {
    if (this.preview || this.loading || this.locked(this.pageRoot)) return;
    this.finishText?.();
    const el = this.doc.createElement(type === 'table' ? 'table' : 'figure');
    const grid = [['项目','数值 A','数值 B'],['一月','40','30'],['二月','65','45'],['三月','50','60']];
    if (type === 'table') {
      el.dataset.studioTable = uid();
      el.style.borderCollapse = 'collapse';
      el.innerHTML = grid.map((row,i) => `<${i===0?'thead':'tbody'}><tr>${row.map(t => `<${i===0?'th':'td'} style="border:1px solid #ddd;padding:12px 16px;text-align:left">${escData(t)}</${i===0?'th':'td'}>`).join('')}</tr></${i===0?'thead':'tbody'}>`).join('');
    } else el.dataset.studioChart = JSON.stringify({version:1, type, title:'数据图表', grid});
    Object.assign(el.style, {position:'absolute',left:'60px',top:'80px',width:'640px',...(type==='table'?{}:{height:'360px'}),margin:'0',background:'#fff',color:'#30303b',font:'14px system-ui,sans-serif'});
    el.dataset.hsId = uid(); el.dataset.hsName = type === 'table' ? '数据表格' : '数据图表';
    if (this.pageRoot !== this.doc.body && this.style(this.pageRoot).position === 'static') this.pageRoot.style.position = 'relative';
    this.pageRoot.append(el); this.selection = [this.id(el)]; this.commit('插入' + el.dataset.hsName); this.openDataEditor(el);
  };
  Editor.prototype.dataTarget = function () {
    if (this.nodes.length !== 1) return null;
    return this.nodes[0].closest('[data-studio-chart],table');
  };
  Editor.prototype.convertDataChart = function (source = this.nodes.length === 1 ? this.nodes[0] : null, {reason = ''} = {}) {
    if (!source || this.loading || this.preview || source.ownerDocument !== this.doc || this.locked(source)) return false;
    if (source === this.pageRoot || source.tagName === 'BODY') return toast('请选择图表元素或图表容器');
    this.finishText?.();
    const r = this.rect(source), editor = this, version = this.loadVersion;
    modal('暂无法保留原图表样式', `${reason ? `<p>${escData(reason)}</p>` : ''}<p>继续编辑会将原图转换为编辑器图表，<strong>原有样式、动画和交互无法保留</strong>，需要重新输入数据或绑定已有表格。</p><p>原元素会隐藏保留，转换可撤回；原脚本仍可能影响页面，请核对预览。取消则保持原图不变。</p>`, [
      {label:'取消',run:closeModal}, {label:'继续编辑（转换样式）',primary:true,run:()=>{
        closeModal();
        if (version !== editor.loadVersion || editor.loading || editor.preview || !source.isConnected || source.ownerDocument !== editor.doc || editor.locked(source)) return;
        const el = editor.doc.createElement('figure');
        const computed = editor.style(source);
        el.style.cssText = source.style.cssText;
        Object.assign(el.style,{width:`${Math.max(240,r.width)}px`,height:`${Math.max(180,r.height)}px`,margin:'0',background:'#fff',color:'#30303b',display:'block'});
        if (['absolute','fixed'].includes(computed.position)) Object.assign(el.style,{position:computed.position,left:computed.left,top:computed.top});
        source.before(el); source.style.setProperty('display','none','important'); source.dataset.studioReplaced = 'true';
        el.dataset.hsId = uid(); el.dataset.hsName='数据图表';
        el.dataset.studioChart = JSON.stringify({version:1,type:'bar',title:'数据图表',grid:[['项目','数值'],['项目 A','40'],['项目 B','60']]});
        editor.selection=[editor.id(el)]; editor.commit('转换数据图表'); editor.openDataEditor(el);
      }},
    ]);
    q('#dialog').dataset.kind = 'chart-conversion';
    return true;
  };
  Editor.prototype.openDataEditor = function (target = this.dataTarget()) {
    if (this.preview || this.loading || !target || this.locked(target)) return;
    this.finishText?.();
    const editor = this, chart = target.hasAttribute('data-studio-chart'),version=this.loadVersion;
    const validTarget=()=>version===editor.loadVersion&&target.isConnected&&target.ownerDocument===editor.doc&&!editor.locked(target);
    if (!chart && tableProblem(target)) return modal('此表格暂不支持数据面板', `<p>${escData(tableProblem(target))}</p>`, [{label:'知道了',run:closeModal}]);
    const heatmap=chart?null:detectTableHeatmap(target,editor.doc);
    let model;
    try { model = chart ? JSON.parse(target.dataset.studioChart) : null; } catch { return toast('图表数据格式无效'); }
    let grid = chart ? model.grid : tableGrid(target);
    if (!Array.isArray(grid) || !grid.length) grid = [['项目','数值'],['项目 A','40'],['项目 B','60']];
    let rowIndex = 0, colIndex = 0;
    const tableOptions = [...editor.doc.querySelectorAll('table')].filter(t => !tableProblem(t) && t.rows.length > 1 && t.rows[0].cells.length > 1);
    const previewChart = chart ? target : [...editor.doc.querySelectorAll('[data-studio-chart]')].find(el => {
      try { return target.dataset.studioTable && JSON.parse(el.dataset.studioChart).table === target.dataset.studioTable; } catch { return false; }
    });
    const body = modal(chart ? '编辑图表数据' : '编辑表格数据', `
      ${chart ? `<div class="authoring-toolbar"><label>图表类型 <select id="data-chart-type"><option value="bar">柱状图</option><option value="line">折线图</option><option value="pie">饼图</option></select></label><label>标题 <input id="data-chart-title" value="${escData(model.title)}"></label><label>饼图数值列 <select id="data-chart-series"></select></label></div><label class="data-source-label">数据来源 <select id="data-chart-source"><option value="">独立数据</option>${tableOptions.map((t,i) => `<option value="${i}">表格 ${i+1} · ${escData(t.caption?.textContent || t.rows[0].textContent.slice(0,40))}</option>`).join('')}</select></label>` : ''}
      <div id="data-linked-note" class="source-note"></div>
      ${chart?'':'<div class="table-total-tools"><span id="data-totals-note" class="source-note"></span><button id="data-check-totals" class="text-button">检查合计联动…</button></div>'}
      <div class="authoring-toolbar" id="data-row-tools"><button data-grid-action="row-before" class="text-button">上方插入行</button><button data-grid-action="row-after" class="text-button">下方插入行</button><button data-grid-action="row-delete" class="text-button">删除行</button><button data-grid-action="column-before" class="text-button">左侧插入列</button><button data-grid-action="column-after" class="text-button">右侧插入列</button><button data-grid-action="column-delete" class="text-button">删除列</button></div>
      <div class="data-editor-workspace ${previewChart?'with-chart':''}"><div class="data-grid-scroll"><table class="data-grid" id="data-grid"></table></div>${previewChart?'<div class="data-live-preview"><span>图表实时预览</span><div id="data-chart-preview"></div></div>':''}</div><p id="data-cell-result" aria-live="polite"></p>
      <p class="source-note">输入后立即更新画布，保留原单元格内的样式标签；含多个文本片段的单元格请在画布中编辑具体文字。明确且数值一致的末行/末列合计，会在首次修改时自动建立 SUM 联动；合计不一致时可点击上方检查。公式可直接修改或改为固定数值。支持 + − * /、括号、SUM、AVERAGE、MIN、MAX、COUNT，例如 =SUM(B2:B4) 或 =B2+C2。行列插入、删除会调整公式引用；不支持跨表引用。首行和首列作为图表名称，饼图使用所选数值列。最多 200 行、26 列。</p>`, [{label:'完成',primary:true,run:closeModal}]);
    q('#dialog').dataset.kind = 'data';
    const linkedTable = () => model?.table ? tableOptions.find(t => t.dataset.studioTable === model.table) : null;
    const currentGrid = () => linkedTable() ? tableGrid(linkedTable()) : grid;
    const updatePreview = () => {
      const preview = body.querySelector('#data-chart-preview');
      if (preview && previewChart?.isConnected) preview.innerHTML = previewChart.innerHTML;
    };
    const sync = (action, commit = true) => {
      if(!validTarget())return;
      if (chart) target.dataset.studioChart = JSON.stringify({...model,grid});
      else if(heatmap){refreshTableHeatmap(target,heatmap);updateKnownChartMotion(editor.doc);}
      recalculateData(editor.doc);
      updatePreview();
      if (commit) editor.commit(action);
    };
    const detail = () => {
      const g = currentGrid(), value = evaluateGrid(g)[rowIndex]?.[colIndex];
      q('#data-cell-result').textContent = `${columnName(colIndex)}${rowIndex+1} · 结果：${value ?? ''}`;
      body.querySelectorAll('[data-cell]').forEach(n => n.classList.toggle('active-cell', Number(n.dataset.r) === rowIndex && Number(n.dataset.c) === colIndex));
    };
    let paintPanel;
    const draw = () => {
      const g = currentGrid(), linked = !!model?.table;
      q('#data-grid').innerHTML = `<thead><tr><th></th>${g[0].map((_,c) => `<th>${columnName(c)}</th>`).join('')}</tr></thead><tbody>${g.map((row,r) => `<tr><th>${r+1}</th>${row.map((cell,c) => `<td><input data-cell data-r="${r}" data-c="${c}" aria-label="${columnName(c)}${r+1}" value="${escData(cell)}" ${linked||!chart&&(!tableCellSlot(target.rows[r].cells[c])||editor.locked(target.rows[r].cells[c])||target.rows[r].cells[c].querySelector('[data-hs-locked="true"]'))?'readonly':''} spellcheck="false"></td>`).join('')}</tr>`).join('')}</tbody>`;
      q('#data-row-tools').hidden = linked;
      q('#data-linked-note').textContent = linked ? '图表已绑定表格，修改原表格即可同步更新。这里显示表格数据；切换为“独立数据”可解除绑定。表格页脚（tfoot）不计入图表。' : '';
      totalsNote();
      if (chart) {
        q('#data-chart-series').innerHTML = g[0].slice(1).map((name,i) => `<option value="${i+1}">${columnName(i+1)} · ${escData(name)}</option>`).join('');
        q('#data-chart-series').value = String(model.series || 1);
        q('#data-chart-series').disabled = model.type !== 'pie';
      }
      rowIndex = Math.min(rowIndex,g.length-1); colIndex = Math.min(colIndex,g[0].length-1); detail();
      if(chart||heatmap)mountColors();
    };
    q('#data-grid').addEventListener('focusin', event => {
      if (!event.target.matches('[data-cell]')) return;
      rowIndex = Number(event.target.dataset.r); colIndex = Number(event.target.dataset.c); detail();
    });
    let pending = false;
    const totalsNote=()=>{if(chart)return;const count=target.querySelectorAll('[data-studio-auto-sum]').length;if(count){q('#data-totals-note').textContent=`已建立 ${count} 个合计公式，修改明细会同步更新。`;return;}const plan=inspectTableTotals(target);q('#data-totals-note').textContent=plan.matched?`已核对 ${plan.entries.length} 个合计，修改数据时将自动联动。`:plan.entries.length?'检测到合计与明细不一致，请先检查并确认计算范围。':plan.reason;};
    const flush = () => { if (pending && validTarget()) { pending=false; sync('修改数据'); } };
    q('#dialog').flushData = flush;
    bindDataPaste(body.querySelector('#data-grid'),{
      valid:validTarget,
      skip:(r,c)=>!chart&&!!target.rows[r]?.cells[c]?.dataset.studioAutoSum,
      apply:changes=>{
        const prepared=prepareDataCells(target,changes,{locked:node=>editor.locked(node)});
        flush();prepared.apply();grid=chart?JSON.parse(target.dataset.studioChart).grid:tableGrid(target);
        sync('批量粘贴数据');draw();return {skipped:prepared.skipped};
      }
    });
    q('#data-grid').addEventListener('input', event => {
      const input = event.target;
      if (!input.matches('[data-cell]') || input.readOnly || model?.table || !validTarget()) return;
      const r=Number(input.dataset.r), c=Number(input.dataset.c);
      if(!chart&&(editor.locked(target.rows[r].cells[c])||target.rows[r].cells[c].querySelector('[data-hs-locked="true"]')))return;
      if(!chart&&ensureTableTotals(target)){
        grid=tableGrid(target);
        body.querySelectorAll('[data-cell]').forEach(n=>{if(n!==input)n.value=grid[Number(n.dataset.r)][Number(n.dataset.c)];});
      }
      grid[r][c] = input.value;
      if (!chart) putCell(target.rows[r].cells[c], input.value);
      pending = true; sync('修改数据', false); editor.draw(); detail();totalsNote();
    });
    q('#data-grid').addEventListener('change', flush);
    q('#dialog').addEventListener('cancel',flush);
    q('#dialog').addEventListener('close', () => { flush();q('#dialog').removeEventListener('cancel',flush); if (q('#dialog').flushData === flush) delete q('#dialog').flushData; }, {once:true});
    if(!chart)q('#data-check-totals').onclick=()=>{
      if(!validTarget())return;flush();const plan=inspectTableTotals(target);
      if(!plan.entries.length)return toast(plan.reason);
      modal('核对表格合计联动',`<p>以下合计将使用所列公式自动计算。请确认它们确实是求和关系；只更新本表，页面其他说明和图表不会自动关联。</p><div class="data-grid-scroll"><table class="data-grid"><thead><tr><th>单元格</th><th>原数值</th><th>按明细求和</th><th>公式</th></tr></thead><tbody>${plan.entries.map(e=>`<tr><td>${escData(e.address)}</td><td>${escData(e.actual)}</td><td>${escData(formatTableValue(e.cell,e.expected))}</td><td>${escData(e.formula)}</td></tr>`).join('')}</tbody></table></div>`,[{label:'取消',run:()=>{if(validTarget())editor.openDataEditor(target);else closeModal();}},{label:'建立合计联动',primary:true,run:()=>{if(!validTarget())return;if(!applyTableTotals(plan))return toast('表格内容已变化，请重新检查合计');editor.commit('建立表格合计联动');editor.openDataEditor(target);}}]);q('#dialog').dataset.kind='table-totals';
    };
    body.querySelectorAll('[data-grid-action]').forEach(button => button.onclick = () => {
      if (model?.table||!validTarget()) return;
      flush();
      if(!chart&&target.querySelector('[data-hs-locked="true"]'))return toast('表格含锁定图层，请先解锁再调整行列');
      const [axis, mode] = button.dataset.gridAction.split('-'), deleting = mode === 'delete';
      const index = (axis==='row'?rowIndex:colIndex) + (mode === 'after' ? 1 : 0);
      const count = axis==='row'?grid.length:grid[0].length, limit = axis==='row'?DATA_LIMITS.rows:DATA_LIMITS.columns;
      if (deleting && count <= (chart ? 2 : 1)) return toast(chart ? '图表至少需要两行、两列' : '至少保留一行、一列');
      if (!deleting && count >= limit) return toast(`已达到${axis==='row'?'行':'列'}数上限 ${limit}`);
      if(!chart&&ensureTableTotals(target))grid=tableGrid(target);
      const newFormulas=[],edgeTotals=!chart&&!deleting?[...target.querySelectorAll('[data-studio-auto-sum]')].filter(cell=>cell.dataset.studioAutoSum===(axis==='row'?'column':'row')).filter(cell=>{const m=/^=SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/.exec(cell.dataset.studioFormula||'');return m&&(axis==='row'?Number(m[4])===index:cellAddress(m[3]+'1')[1]+1===index);}):[];
      if (axis === 'row') {
        if (!chart) {
          if (deleting) target.rows[index].remove();
          else {
            const ref = target.rows[Math.min(index,target.rows.length-1)], template=ref.querySelector('[data-studio-auto-sum="column"]')&&index>0?target.rows[index-1]:ref,tr=template.cloneNode(true);
            editor.remapClone(tr); [...tr.cells].forEach((c,col) => {if(c.dataset.studioAutoSum==='row')newFormulas.push({cell:c,r:index,c:col,axis:'row',formula:c.dataset.studioFormula.replace(/([A-Z]+)\d+/g,(_,letter)=>letter+(index+1))});clearTableCell(c);});
            if (index < target.rows.length) ref.before(tr); else ref.after(tr);
          }
        }
        grid.splice(index,deleting?1:0,...(deleting?[]:[grid[0].map(()=> '')]));
      } else {
        if (!chart) [...target.rows].forEach(tr => {
          if (deleting) tr.cells[index].remove();
          else { const ref=tr.cells[Math.min(index,tr.cells.length-1)],template=ref.dataset.studioAutoSum==='row'&&index>0?tr.cells[index-1]:ref,cell=template.cloneNode(true);editor.remapClone(cell);if(cell.dataset.studioAutoSum==='column')newFormulas.push({cell,r:tr.rowIndex,c:index,axis:'column',formula:cell.dataset.studioFormula.replace(/[A-Z]+(\d+)/g,(_,row)=>columnName(index)+row)});clearTableCell(cell); if(index<tr.cells.length)ref.before(cell);else ref.after(cell); }
        });
        grid.forEach(row => row.splice(index,deleting?1:0,...(deleting?[]:[''])));
      }
      if(!chart&&axis==='column')resizeTableColumns(target,index,deleting);
      if(!chart)updateKnownChartMotion(editor.doc);
      if(!chart&&target.dataset.studioTable)for(const linked of editor.doc.querySelectorAll('[data-studio-chart]')){try{const linkedModel=JSON.parse(linked.dataset.studioChart);if(linkedModel.table!==target.dataset.studioTable||!linkedModel.colors)continue;const shifted={};for(const [key,color]of Object.entries(linkedModel.colors)){const pos=key.split(':').map(Number),a=axis==='row'?0:1;if(deleting&&pos[a]===index)continue;if(pos[a]>=index)pos[a]+=deleting?-1:1;shifted[pos.join(':')]=color;}linkedModel.colors=shifted;linked.dataset.studioChart=JSON.stringify(linkedModel);}catch{}}
      if(chart&&model.colors){const next={};for(const [key,color] of Object.entries(model.colors)){const pos=key.split(':').map(Number),a=axis==='row'?0:1;if(deleting&&pos[a]===index)continue;if(pos[a]>=index)pos[a]+=deleting?-1:1;next[pos.join(':')]=color;}model.colors=next;}
      grid = grid.map(row=>row.map(raw=>shiftFormula(raw,axis,index,deleting)));
      for(const cell of edgeTotals){const r=cell.parentElement.rowIndex,c=cell.cellIndex;grid[r][c]=grid[r][c].replace(/:([A-Z]+)(\d+)\)/,(_,letter,row)=>`:${axis==='row'?letter:columnName(cellAddress(letter+'1')[1]+1)}${axis==='row'?Number(row)+1:row})`);}
      for(const item of newFormulas){grid[item.r][item.c]=item.formula;item.cell.dataset.studioAutoSum=item.axis;}
      if (!chart) [...target.rows].forEach((tr,r)=>[...tr.cells].forEach((cell,c)=>{if(grid[r][c].startsWith('=')){const auto=cell.dataset.studioAutoSum;putCell(cell,grid[r][c]);if(auto)cell.dataset.studioAutoSum=auto;}}));
      rowIndex = Math.min(rowIndex,grid.length-1);colIndex = Math.min(colIndex,grid[0].length-1);
      sync(deleting?'删除数据行列':'插入数据行列'); draw();
    });
    if (chart) {
      q('#data-chart-type').value=model.type;
      q('#data-chart-source').value=model.table ? String(tableOptions.findIndex(t=>t.dataset.studioTable===model.table)) : '';
      q('#data-chart-type').onchange=event=>{flush();model.type=event.target.value;sync('修改图表类型');draw();};
      q('#data-chart-title').oninput=event=>{model.title=event.target.value;pending=true;sync('修改图表标题',false);};
      q('#data-chart-title').onchange=flush;
      q('#data-chart-series').onchange=event=>{model.series=Number(event.target.value);sync('切换饼图数值列');draw();};
      q('#data-chart-source').onchange=event=>{
        flush();
        if(event.target.value===''){grid=currentGrid().map(row=>[...row]);delete model.table;}
        else { const table=tableOptions[Number(event.target.value)]; if(!table.dataset.studioTable)table.dataset.studioTable=uid(); model.table=table.dataset.studioTable; }
        sync('绑定图表数据');draw();
      };
    }
    function mountColors(){
      if(!chart){mountChartPaints(body,{valid:validTarget,items:()=>[...target.querySelectorAll('td > span[style*="background"]')].map(node=>({node,name:`第 ${node.closest('tr').rowIndex+1} 行 · 第 ${node.closest('td').cellIndex+1} 列`,color:editor.style(node).backgroundColor})),change(item,color){if(editor.locked(item.node))throw Error('此单元格已锁定');flush();if(color)item.node.setAttribute('data-studio-chart-color',color);else item.node.removeAttribute('data-studio-chart-color');sync('修改热力图单元格颜色');}});return;}
      paintPanel=mountChartPaints(body,{valid:validTarget,items:()=>{const g=currentGrid(),cols=model.type==='pie'?[Math.max(1,Math.min(g[0].length-1,Number(model.series)||1))]:g[0].slice(1).map((_,i)=>i+1);return g.slice(1).flatMap((row,i)=>cols.map(c=>({r:i+1,c,name:String(row[0])+' · '+g[0][c],color:model.colors?.[`${i+1}:${c}`]||chartColors[(model.type==='pie'?i:c-1)%chartColors.length]})));},change(item,color){flush();model.colors ||= {};const key=`${item.r}:${item.c}`;if(color===null)delete model.colors[key];else model.colors[key]=color;sync(color===null?'恢复图表元素原色':'修改图表元素颜色');}});
    }
    draw(); updatePreview();
  };
}
