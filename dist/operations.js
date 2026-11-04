import {label,selectable,cleanDocument,projectData} from './document.js';
import {analyzeSVGBarChart,bindSVGBarChart,readSVGBarModel,updateSVGBarChart,changeSVGChartStructure} from './svg-chart.js';
import {analyzeHTMLBars,bindHTMLBars,htmlBarElements,htmlBarTarget,updateHTMLBars,changeHTMLBarStructure} from './html-bars.js';
import {probeChartJS,prepareCanvasResult,validCanvasModel,changeCanvasChartStructure} from './canvas-charts.js';
import {tableGrid,tableProblem,evaluateGrid,prepareDataCells,shiftFormula,DATA_LIMITS} from './data-tools.js';
import {structureTransaction,detectTableHeatmap,refreshTableHeatmap,updateKnownChartMotion} from './chart-structure.js';
import {ELEMENT_COMMANDS,executeElementCommand} from './element-operations.js';

// Transport-independent JSON commands. No network listener, eval, DOM handles
// or arbitrary editor method names cross this boundary.
const OP_VERSION='1.0';
const opString={type:'string',maxLength:300},opIndex={type:'integer',minimum:0,maximum:100000};
const opObject=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const OP_CELL=opObject({row:opIndex,column:opIndex,value:{type:['number','string'],maxLength:5000}},['row','column','value']);
const OP_COMMANDS={
  ...ELEMENT_COMMANDS,
  'document.read':{summary:'读取当前工程状态',parameters:opObject({})},
  'pages.list':{summary:'列出页面及稳定元素 ID',parameters:opObject({})},
  'pages.select':{summary:'切换到指定页面',write:true,parameters:opObject({pageId:opString},['pageId'])},
  'elements.list':{summary:'分页查找图层摘要；query 按名称/文字匹配，tag 按 HTML 标签匹配，不返回源码或脚本',parameters:opObject({pageId:opString,query:opString,tag:opString,offset:opIndex,limit:{type:'integer',minimum:1,maximum:500}})},
  'charts.list':{summary:'列出图表候选与表格；候选不代表已识别',parameters:opObject({pageId:opString})},
  'charts.read':{summary:'读取图表数据与能力；Canvas 在隔离副本中识别',parameters:opObject({id:opString},['id'])},
  'charts.bind':{summary:'确认识别结果并绑定，不转换原图',write:true,parameters:opObject({id:opString,acceptDetected:{type:'boolean'},detectionId:opString},['id','acceptDetected'])},
  'charts.update':{summary:'原子修改一张图表或表格的多个单元格',write:true,parameters:opObject({id:opString,cells:{type:'array',minItems:1,maxItems:5200,items:OP_CELL}},['id','cells'])},
  'charts.structure':{summary:'增删或重命名分类、系列或数据点',write:true,parameters:opObject({id:opString,axis:{type:'string',enum:['row','column']},operation:{type:'string',enum:['add','delete','rename']},index:opIndex,name:{type:'string',minLength:1,maxLength:100}},['id','axis','operation','index'])},
  'history.undo':{summary:'撤回一个编辑事务',write:true,parameters:opObject({})},
  'history.redo':{summary:'重做一个编辑事务',write:true,parameters:opObject({})},
  'preview.start':{summary:'预览当前页，等待可见内容就绪',write:true,parameters:opObject({timeoutMs:{type:'integer',minimum:100,maximum:20000}})},
  'preview.status':{summary:'读取预览状态',parameters:opObject({})},
  'preview.stop':{summary:'退出预览',write:true,parameters:opObject({})},
  'files.create':{summary:'生成可移植工程或 HTML 副本内容，不覆盖文件',write:true,parameters:opObject({format:{type:'string',enum:['project','html']},name:{type:'string',minLength:1,maxLength:200},missingFonts:{type:'string',enum:['error','online']}},['format'])},
  'files.download':{summary:'下载工程或 HTML 副本，不覆盖关联文件',write:true,parameters:opObject({format:{type:'string',enum:['project','html']},name:{type:'string',minLength:1,maxLength:200},missingFonts:{type:'string',enum:['error','online']}},['format'])},
};
function opFailure(code,message,details) {return Object.assign(Error(message),{code,details});}
function opAssert(condition,code,message,details) {if(!condition)throw opFailure(code,message,details);}
function opValidate(value,schema,at='params') {
  const kinds=Array.isArray(schema.type)?schema.type:[schema.type];
  const kind=Array.isArray(value)?'array':value===null?'null':typeof value;
  const numeric=kind==='number'&&Number.isFinite(value);
  opAssert(kinds.includes(kind)&&(!numeric||Number.isFinite(value))||kinds.includes('integer')&&numeric&&Number.isInteger(value),'INVALID_ARGUMENT',`${at} 类型无效`);
  if(kind==='number')opAssert(numeric&&(schema.minimum===undefined||value>=schema.minimum)&&(schema.maximum===undefined||value<=schema.maximum),'INVALID_ARGUMENT',`${at} 超出范围`);
  if(schema.enum)opAssert(schema.enum.includes(value),'INVALID_ARGUMENT',`${at} 不在允许范围`);
  if(kind==='string')opAssert(value.length>=(schema.minLength||0)&&value.length<=(schema.maxLength??1000000),'INVALID_ARGUMENT',`${at} 长度无效`);
  if(kind==='object'){
    opAssert(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null,'INVALID_ARGUMENT',`${at} 必须是普通对象`);
    for(const key of Object.keys(value))opAssert(Object.hasOwn(schema.properties,key),'INVALID_ARGUMENT',`${at}.${key} 不是允许的参数`);
    for(const key of schema.required||[])opAssert(Object.hasOwn(value,key),'INVALID_ARGUMENT',`${at}.${key} 必填`);
    for(const [key,v] of Object.entries(value))opValidate(v,schema.properties[key],`${at}.${key}`);
  }
  if(kind==='array'){
    opAssert(value.length>=(schema.minItems||0)&&value.length<=(schema.maxItems||5200),'INVALID_ARGUMENT',`${at} 数量无效`);
    value.forEach((v,i)=>opValidate(v,schema.items,`${at}[${i}]`));
  }
}
const opFileName=name=>String(name).replace(/[<>:"/\\|?*\x00-\x1F]/g,'-').slice(0,80)||'未命名页面';
export const editorOperationSchema=()=>structuredClone({apiVersion:OP_VERSION,indexBase:0,expected:opObject({documentId:opString,revision:opIndex},['documentId','revision']),commands:OP_COMMANDS});
export async function createEditorArtifact(editor,{format,name,missingFonts='error',snapshot:captured}={}) {
  opAssert(['project','html'].includes(format),'INVALID_ARGUMENT','文件格式应为 project 或 html');
  const data=captured||projectData(editor),source=format==='project'?data.html:cleanDocument(editor.doc,{exporting:true});
  const title=name??data.name,html=await editor.portableHTML(source,{missingFonts});
  if(html===null)return null;
  return {filename:opFileName(title)+(format==='project'?'.htmlstudio':'.html'),mimeType:format==='project'?'application/json':'text/html;charset=utf-8',content:format==='project'?JSON.stringify({...data,name:title,html},null,2):html,warnings:[...data.warnings]};
}
function opRenderer(node) {
  if(node.hasAttribute('data-studio-chart'))return 'native';
  if(node.tagName==='TABLE')return 'table';
  if(node.tagName==='CANVAS')return 'chartjs';
  if(node.matches('svg')&&!node.closest('[data-studio-chart]'))return 'svg';
  return 'html';
}
function opBound(node,renderer) {
  return ['native','table'].includes(renderer)||node.hasAttribute(({svg:'data-studio-svg-chart',html:'data-studio-html-chart',chartjs:'data-studio-chartjs'})[renderer]);
}
function opReadModel(node,renderer) {
  try{
    if(renderer==='svg')return readSVGBarModel(node);
    if(renderer==='html'){const m=JSON.parse(node.getAttribute('data-studio-html-chart'));htmlBarElements(node,m);return m;}
    if(renderer==='chartjs'){const m=JSON.parse(node.getAttribute('data-studio-chartjs'));opAssert(validCanvasModel(m),'INVALID_BINDING','Chart.js 绑定无效');return m;}
    if(renderer==='native'){const m=JSON.parse(node.dataset.studioChart);opAssert(['bar','line','pie'].includes(m.type)&&Array.isArray(m.grid)&&m.grid.length>=2&&m.grid.length<=DATA_LIMITS.rows&&m.grid.every(r=>Array.isArray(r)&&r.length===m.grid[0].length&&r.length>=2&&r.length<=DATA_LIMITS.columns&&r.every(v=>typeof v==='string')),'INVALID_BINDING','内置图表数据无效');return m;}
    opAssert(!tableProblem(node),'UNSUPPORTED',tableProblem(node));return {grid:tableGrid(node)};
  }catch(e){if(e.code)throw e;throw opFailure('INVALID_BINDING',e.message);}
}
function opChartView(editor,node,renderer,model,bound=true) {
  let rows,columns,values,readonly=[],raw;
  const kind=renderer==='table'?'table':model.kind||model.type||'bar';
  if(renderer==='native'||renderer==='table'){
    raw=model.grid;
    if(model.table){const table=[...editor.doc.querySelectorAll('table[data-studio-table]')].find(t=>t.dataset.studioTable===model.table);opAssert(table&&!tableProblem(table),'INVALID_BINDING','图表绑定的数据表不存在或不可读取');raw=tableGrid(table).filter((_,i)=>table.rows[i].parentElement.tagName!=='TFOOT'&&![...table.rows[i].cells].some(c=>c.dataset.studioAutoSum==='column'));}
    if(renderer==='table') {rows=raw.map((_,r)=>`第 ${r+1} 行`);columns=raw[0].map((_,c)=>`第 ${c+1} 列`);values=evaluateGrid(raw);readonly=[...node.rows].flatMap((r,i)=>[...r.cells].filter(c=>c.dataset.studioAutoSum).map(c=>({row:i,column:c.cellIndex})));}
    else{rows=raw.slice(1).map(r=>r[0]);columns=raw[0].slice(1);values=evaluateGrid(raw).slice(1).map(r=>r.slice(1));}
  }else if(renderer==='chartjs') {rows=model.labels;columns=model.series;values=rows.map((_,r)=>model.values.map(v=>v[r]));}
  else if(kind==='bubble') {rows=model.points.map(p=>p.name);columns=model.fields.map((f,i)=>['X','Y','面积'][i]+' · '+f.name);values=model.points.map(p=>bound?[p.x,p.y,p.size]:p.values);}
  else if(renderer==='html') {rows=model.bars.map(b=>b.category);columns=['数值'];values=model.bars.map(b=>[b.value]);}
  else {rows=bound?model.categories:model.groups.map(g=>g.label.text);columns=model.series;values=bound?rows.map((_,r)=>columns.map((_,c)=>model.bars.find(b=>b.row===r&&b.column===c)?.value)):model.groups.map(g=>g.bars.map(b=>b.value));readonly=(bound?model.bars:model.groups.map((g,r)=>({row:r,column:0,role:g.role}))).filter(b=>b.role==='total').map(b=>({row:b.row,column:b.column}));}
  const locked=editor.locked(node)||!!node.querySelector('[data-hs-locked="true"]'),linked=!!model.table;
  return {id:editor.id(node),renderer,kind,bound,rows,columns,values,...(raw?{raw}:{}),readonly,locked,linkedTable:linked?model.table:null,
    capabilities:{bind:!bound&&!locked,update:bound&&!locked&&!linked,addRows:bound&&!locked&&!linked&&renderer!=='table',addColumns:bound&&!locked&&!linked&&!['html','table'].includes(renderer)&&!['bubble','waterfall'].includes(kind)},
    limits:kind==='bubble'?{x:[model.axes.x.min,model.axes.x.max],y:[model.axes.y.min,model.axes.y.max]}:undefined};
}
function opStructureChange(view,params) {
  const names=params.axis==='row'?view.rows:view.columns;
  opAssert(params.index<names.length,'INVALID_ARGUMENT','分类或系列索引越界');
  opAssert(params.axis==='row'?view.capabilities.addRows:view.capabilities.addColumns,'UNSUPPORTED','此维度暂不支持结构操作');
  let name=params.name?.trim();
  if(params.operation==='add'&&!name){let n=names.length+1;do{name=`新${params.axis==='row'?'分类':'系列'} ${n++}`;}while(names.includes(name));}
  if(params.operation!=='delete'){opAssert(name?.length,'INVALID_ARGUMENT','名称不能为空');opAssert(!names.some((n,i)=>i!==params.index&&n===name),'INVALID_ARGUMENT','分类或系列名称重复');}
  return {...params,name};
}
function opNativeStructure(model,change) {
  const next=structuredClone(model),g=next.grid,{axis,operation,index,name}=change,at=index+1,count=axis==='row'?g.length:g[0].length;
  if(operation==='rename'){if(axis==='row')g[at][0]=name;else g[0][at]=name;return next;}
  opAssert(operation==='add'?count<(axis==='row'?DATA_LIMITS.rows:DATA_LIMITS.columns):count>2,'LIMIT_EXCEEDED','已达到图表行列数量边界');
  const slot=operation==='add'?at+1:at,deleting=operation==='delete';
  if(axis==='row')g.splice(slot,deleting?1:0,...(deleting?[]:[[name,...g[0].slice(1).map(()=> '0')]]));
  else g.forEach((row,r)=>row.splice(slot,deleting?1:0,...(deleting?[]:[r?'0':name])));
  next.grid=g.map(row=>row.map(raw=>shiftFormula(raw,axis,slot,deleting)));
  if(axis==='column'&&next.series){if(!deleting&&next.series>=slot)next.series++;if(deleting&&next.series>slot)next.series--;next.series=Math.min(next.series,g[0].length-1);}
  return next;
}
export function createEditorOperations(editor,{download}={}) {
  const session=crypto.randomUUID(),detections=new Map();let busy=false,activeSignal=null;
  const state=()=>({apiVersion:OP_VERSION,token:{documentId:session+':'+editor.loadVersion,revision:editor.revision},name:editor.name,isHome:editor.isHome,loading:editor.loading,activePageId:editor.doc?editor.id(editor.pageRoot):null,pageCount:editor.isHome?0:Math.max(1,editor.pages?.pages.length||0),preview:editor.preview,busy});
  const same=token=>token.documentId===state().token.documentId&&token.revision===editor.revision;
  const detectionSignature=view=>JSON.stringify([view.renderer,view.kind,view.rows,view.columns,view.values,view.readonly]);
  const rememberDetection=view=>{
    if(view.bound)return view;
    for(const [id,entry] of detections)if(!same(entry.token)||performance.now()-entry.at>300000)detections.delete(id);
    while(detections.size>=64)detections.delete(detections.keys().next().value);
    const detectionId=crypto.randomUUID();detections.set(detectionId,{token:state().token,nodeId:view.id,signature:detectionSignature(view),at:performance.now()});
    return {...view,detectionId};
  };
  const acceptDetection=(p,view)=>{
    const entry=detections.get(p.detectionId);
    opAssert(entry&&entry.nodeId===view.id&&same(entry.token)&&performance.now()-entry.at<=300000,'DETECTION_REQUIRED','请先读取本图并提供返回的 detectionId');
    opAssert(entry.signature===detectionSignature(view),'DETECTION_CHANGED','图表脚本生成的数据与上次识别不一致，请重新读取核对后再绑定');
  };
  const available=()=>!activeSignal?.aborted&&!editor.loading&&!editor.isHome&&!document.querySelector('#dialog')?.open&&!editor.doc?.querySelector('[data-hs-editing]')&&!document.activeElement?.matches('#inspector input,#inspector textarea,#document-name')&&!editor.endTracking;
  const requireDocument=()=>opAssert(editor.doc&&!editor.isHome&&!editor.loading,'NO_DOCUMENT','请先打开一个工程或 HTML');
  const requireIdle=()=>opAssert(available(),'UI_BUSY','请先完成当前编辑并关闭弹窗');
  const active=node=>opAssert(editor.inCurrentPage(node),'PAGE_NOT_ACTIVE','请先切换到目标所在页面');
  const nodeFor=id=>{opAssert(typeof id==='string'&&id.length>0,'INVALID_ARGUMENT','需要元素 ID');const n=editor.get(id);opAssert(n&&n.ownerDocument===editor.doc,'NOT_FOUND','未找到指定元素');return n;};
  const pageFor=id=>id?nodeFor(id):editor.pageRoot;
  const pageRoot=id=>{const n=pageFor(id);opAssert(n===editor.doc.body||editor.pages.pages.includes(n),'INVALID_ARGUMENT','不是页面 ID');return n;};
  const getNode=p=>{const n=nodeFor(p.id);active(n);opAssert(!n.ownerSVGElement&&!n.parentElement?.closest('[data-studio-chart]'),'INVALID_ARGUMENT','请选择完整图表或表格');return n;};
  const describe=editorOperationSchema;
  const runMutation=(node,work,action)=>{
    opAssert(!activeSignal?.aborted,'CANCELLED','操作已取消');
    const history=editor.history,index=editor.historyIndex,revision=editor.revision,dirty=editor.dirty;
    const script=editor.doc.querySelector('#qiwu-chart-motion'),runtime=editor.doc.querySelector('script[data-studio-chartjs-runtime]');
    try{return structureTransaction(node.parentElement||node,()=>{const result=work();editor.commit(action);return result;},[script,runtime]);}
    catch(e){editor.history=history;editor.historyIndex=index;editor.revision=revision;editor.dirty=dirty;if(!runtime)editor.doc.querySelector('script[data-studio-chartjs-runtime]')?.remove();editor.render();throw e;}
  };
  const canvasWork=async(node,token,callback)=>{
    let probe;const signal=activeSignal,abort=()=>probe?.close();
    try{probe=probeChartJS(editor,node);signal?.addEventListener('abort',abort,{once:true});let initial;try{initial=await probe.ready;}catch(e){throw opFailure(signal?.aborted?'CANCELLED':same(token)?'UNSUPPORTED':'STALE_DOCUMENT',e.message);}opAssert(same(token)&&available()&&!editor.preview,'STALE_DOCUMENT','文档或编辑状态已变化，请重新读取');return await callback(initial,probe);}
    finally{signal?.removeEventListener('abort',abort);probe?.close();}
  };
  async function dispatch(command,p,token) {
    if(command==='document.read')return {...state(),busy:false};
    requireDocument();
    if(command==='preview.status')return {active:editor.preview,status:editor.preview?structuredClone(editor.previewStatus||{state:'loading'}):{state:'inactive'}};
    if(command==='pages.list')return (editor.pages.pages.length?editor.pages.pages:[editor.doc.body]).map((n,i)=>({id:editor.id(n),number:i+1,title:editor.pages.title(n,i),active:n===editor.pageRoot}));
    if(command==='elements.list'){
      const root=pageRoot(p.pageId),nodes=[root,...root.querySelectorAll('[data-hs-id]')].filter(selectable).filter(n=>(!p.tag||n.tagName.toLowerCase()===p.tag.toLowerCase())&&(!p.query||(label(n)+' '+n.textContent).toLocaleLowerCase().includes(p.query.toLocaleLowerCase()))),offset=p.offset||0,limit=p.limit||100;
      return {total:nodes.length,offset,items:nodes.slice(offset,offset+limit).map(n=>({id:editor.id(n),parentId:editor.id(n.parentElement),tag:n.tagName.toLowerCase(),name:label(n),locked:editor.locked(n),text:n.children.length?undefined:n.textContent.slice(0,300)}))};
    }
    if(command==='charts.list'){
      const root=pageRoot(p.pageId),candidates=new Set([...root.querySelectorAll('[data-studio-chart],[data-studio-svg-chart],[data-studio-html-chart],svg,canvas,table')]);
      for(const bar of root.querySelectorAll('[class*="bar"],[class*="fill"],[class*="column"],[style*="width"][style*="%"]')){if(bar.ownerSVGElement||bar.closest('[data-studio-chart]'))continue;const n=htmlBarTarget(bar);if(n&&n!==bar&&root.contains(n)&&n!==editor.doc.body)candidates.add(n);}
      return [...candidates].filter(n=>editor.id(n)&&!n.parentElement?.closest('[data-studio-chart],[data-studio-html-chart]')).map(n=>({id:editor.id(n),name:label(n),renderer:opRenderer(n),bound:opBound(n,opRenderer(n)),candidate:true}));
    }
    requireIdle();
    if(Object.hasOwn(ELEMENT_COMMANDS,command))return executeElementCommand(editor,command,p);
    if(command==='pages.select') {opAssert(!editor.preview,'PREVIEW_ACTIVE','请先退出预览');const n=pageRoot(p.pageId);editor.switchPage(n===editor.doc.body?-1:editor.pages.pages.indexOf(n));return {pageId:editor.id(editor.pageRoot)};}
    if(command==='history.undo'||command==='history.redo'){
      opAssert(!editor.preview,'PREVIEW_ACTIVE','请先退出预览');const undo=command==='history.undo';opAssert(undo?editor.historyIndex>0:editor.historyIndex<editor.history.length-1,'HISTORY_EMPTY','没有可撤回或重做的操作');await editor[undo?'undo':'redo']();return state();
    }
    if(command==='preview.stop'){if(editor.preview)editor.togglePreview(false);return {active:false};}
    if(command==='preview.start'){
      if(!editor.preview)editor.togglePreview(true);const generation=editor.previewGeneration,end=performance.now()+(p.timeoutMs||15000);
      while(performance.now()<end){opAssert(!activeSignal?.aborted&&same(token)&&editor.preview&&generation===editor.previewGeneration,'STALE_DOCUMENT','预览已被取消或文档已变化');if(editor.previewStatus?.state==='ready')return {active:true,status:structuredClone(editor.previewStatus)};await new Promise(r=>setTimeout(r,50));}
      throw opFailure('PREVIEW_NOT_READY','预览尚未就绪，请读取预览状态或重试',{status:structuredClone(editor.previewStatus||{})});
    }
    if(command.startsWith('files.')){
      const artifact=await createEditorArtifact(editor,p);opAssert(same(token)&&available(),'STALE_DOCUMENT','生成副本期间文档已变化，请重试');opAssert(artifact,'CANCELLED','保存已取消');
      if(command==='files.download'){opAssert(download,'UNAVAILABLE','此宿主没有下载功能');download(artifact.content,artifact.filename,artifact.mimeType);return {filename:artifact.filename,mimeType:artifact.mimeType,bytes:new Blob([artifact.content]).size,warnings:artifact.warnings};}return artifact;
    }
    opAssert(!editor.preview,'PREVIEW_ACTIVE','请先退出预览后读取或编辑图表');
    const node=getNode(p),renderer=opRenderer(node),bound=opBound(node,renderer);
    if(command==='charts.read'){
      if(renderer==='chartjs')return canvasWork(node,token,async initial=>rememberDetection(opChartView(editor,node,renderer,initial.model,bound)));
      if(bound)return opChartView(editor,node,renderer,opReadModel(node,renderer));
      const analysis=renderer==='svg'?analyzeSVGBarChart(node):analyzeHTMLBars(node);opAssert(!analysis.error,'UNSUPPORTED',analysis.error);return rememberDetection(opChartView(editor,node,renderer,analysis,false));
    }
    opAssert(!editor.locked(node)&&!node.querySelector('[data-hs-locked="true"]'),'LOCKED','图表或其中的元素已锁定');
    if(command==='charts.bind'){
      opAssert(p.acceptDetected===true,'CONFIRMATION_REQUIRED','请核对 charts.read 返回的数据后明确接受识别结果');
      if(bound)return opChartView(editor,node,renderer,opReadModel(node,renderer));
      if(renderer==='chartjs')return canvasWork(node,token,async initial=>{
        acceptDetection(p,opChartView(editor,node,renderer,initial.model,false));
        const valid=()=>same(token)&&available()&&!editor.preview&&!editor.locked(node)&&node.isConnected;
        const apply=await prepareCanvasResult(editor,node,initial,valid);opAssert(apply&&valid(),'STALE_DOCUMENT','文档已变化');
        return runMutation(node,()=>{opAssert(apply(),'STALE_DOCUMENT','文档已变化');return opChartView(editor,node,renderer,initial.model);},'接口：绑定 Chart.js 数据');
      });
      const analysis=renderer==='svg'?analyzeSVGBarChart(node):analyzeHTMLBars(node);opAssert(!analysis.error,'UNSUPPORTED',analysis.error);
      acceptDetection(p,opChartView(editor,node,renderer,analysis,false));
      return runMutation(node,()=>opChartView(editor,node,renderer,renderer==='svg'?bindSVGBarChart(node,analysis):bindHTMLBars(analysis)),'接口：绑定图表数据');
    }
    opAssert(bound,'BINDING_REQUIRED','请先读取并确认绑定图表数据');
    const original=opReadModel(node,renderer),view=opChartView(editor,node,renderer,original);
    opAssert(!view.linkedTable,'LINKED_DATA','此图表已绑定表格，请修改源表格',{tableKey:view.linkedTable});
    const structure=command==='charts.structure',change=structure?opStructureChange(view,p):null;
    if(structure)opAssert(!node.parentElement?.querySelector('[data-hs-locked="true"]'),'LOCKED','包含锁定图例或同组元素，不能修改结构');
    if(!structure){const seen=new Set();for(const cell of p.cells){const key=cell.row+':'+cell.column;opAssert(cell.row<view.rows.length&&cell.column<view.columns.length&&!seen.has(key),'INVALID_ARGUMENT','单元格索引越界或重复');seen.add(key);opAssert(!view.readonly.some(c=>c.row===cell.row&&c.column===cell.column),'READ_ONLY_CELL','自动合计不能直接修改');if(renderer!=='table')opAssert(typeof cell.value==='number'&&Number.isFinite(cell.value)&&Math.abs(cell.value)<=1e12,'INVALID_ARGUMENT','图表数值必须是 -1 万亿至 1 万亿之间的有限数字');}}
    if(renderer==='chartjs')return canvasWork(node,token,async(initial,probe)=>{
      const next=structure?changeCanvasChartStructure(initial.model,change):structuredClone(initial.model);if(!structure)for(const cell of p.cells)next.values[cell.column][cell.row]=cell.value;
      const result=await probe.update(next),valid=()=>same(token)&&available()&&!editor.preview&&!editor.locked(node)&&!node.querySelector('[data-hs-locked="true"]')&&node.isConnected;
      const apply=await prepareCanvasResult(editor,node,result,valid);opAssert(apply&&valid(),'STALE_DOCUMENT','文档已变化，此次结果未写入');
      return runMutation(node,()=>{opAssert(apply(),'STALE_DOCUMENT','文档已变化');return opChartView(editor,node,renderer,result.model);},'接口：修改 Chart.js 数据');
    });
    return runMutation(node,()=>{
      let next=structuredClone(original);
      if(structure){
        if(renderer==='svg')next=changeSVGChartStructure(editor,node,next,change);
        else if(renderer==='html')next=changeHTMLBarStructure(editor,node,next,change);
        else{next=opNativeStructure(next,change);node.dataset.studioChart=JSON.stringify(next);}
      }else if(renderer==='native'||renderer==='table'){
        const heatmap=renderer==='table'?detectTableHeatmap(node,editor.doc):null;
        const cells=p.cells.map(c=>({row:c.row+(renderer==='native'?1:0),column:c.column+(renderer==='native'?1:0),raw:String(c.value)}));
        prepareDataCells(node,cells,{skipTotals:false,locked:n=>editor.locked(n)}).apply();
        if(heatmap){refreshTableHeatmap(node,heatmap);updateKnownChartMotion(editor.doc);}next=opReadModel(node,renderer);
      }else{
        for(const c of p.cells){if(next.kind==='bubble')next.points[c.row][['x','y','size'][c.column]]=c.value;else if(renderer==='svg')next.bars.find(b=>b.row===c.row&&b.column===c.column).value=c.value;else next.bars[c.row].value=c.value;}
        if(renderer==='svg')updateSVGBarChart(node,next);else updateHTMLBars(node,next);
      }
      return opChartView(editor,node,renderer,next);
    },structure?'接口：调整图表行列':'接口：修改图表数据');
  }
  return Object.freeze({version:OP_VERSION,getState:()=>structuredClone(state()),describe,async execute(request,{signal}={}){
    let owned=false;
    try{
      opAssert(!signal?.aborted,'CANCELLED','操作已取消');
      opAssert(request&&typeof request==='object'&&!Array.isArray(request),'INVALID_ARGUMENT','请求必须是对象');
      opAssert(Object.keys(request).every(k=>['command','params','expected'].includes(k)),'INVALID_ARGUMENT','请求含未知字段');
      opAssert(Object.hasOwn(OP_COMMANDS,request.command),'UNKNOWN_COMMAND','未知操作');const spec=OP_COMMANDS[request.command],params=request.params??{};
      opValidate(params,spec.parameters);opAssert(JSON.stringify(params).length<=1000000,'LIMIT_EXCEEDED','请求内容过大');
      if(spec.write){opAssert(request.expected,'EXPECTED_REQUIRED','写操作必须提供上次读取的 token');opValidate(request.expected,describe().expected,'expected');opAssert(same(request.expected),'STALE_DOCUMENT','文档已变化，请重新读取后再操作');}
      opAssert(!busy,'BUSY','另一个接口操作尚未完成');busy=true;owned=true;activeSignal=signal;const token=state().token,result=await dispatch(request.command,structuredClone(params),token);
      return {ok:true,apiVersion:OP_VERSION,context:{...structuredClone(state()),busy:false},result:structuredClone(result)};
    }catch(e){return {ok:false,apiVersion:OP_VERSION,context:{...structuredClone(state()),busy:owned?false:busy},error:{code:e.code||'OPERATION_FAILED',message:e.message||String(e),...(e.details?{details:structuredClone(e.details)}:{})}};}
    finally{if(owned){busy=false;activeSignal=null;}}
  }});
}
