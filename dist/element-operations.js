import {selectable,isText,label,annotate} from './document.js';
import {structureTransaction} from './chart-structure.js';
import {snapshotStyles,restoreChangedStyles} from './grouping.js';

// JSON-only, allowlisted editing commands shared by the browser and MCP schema.
const eoString={type:'string',minLength:1,maxLength:300};
const eoNumber=(minimum=0,maximum=24000)=>({type:'number',minimum,maximum});
const eoEnum=(...values)=>({type:'string',enum:values});
const eoObject=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const eoIds={type:'array',minItems:1,maxItems:100,items:eoString};
const eoText={type:'string',maxLength:20000};
const eoCSS={type:'string',minLength:1,maxLength:500};
const EO_STYLES=eoObject({fontFamily:eoCSS,fontSize:eoNumber(1,1000),fontWeight:eoEnum('100','200','300','400','500','600','700','800','900','normal','bold'),fontStyle:eoEnum('normal','italic','oblique'),color:eoCSS,lineHeight:eoNumber(0,2000),letterSpacing:eoNumber(-100,1000),textAlign:eoEnum('left','center','right','justify','start','end'),textDecoration:eoEnum('none','underline','line-through','overline'),fill:eoCSS,background:eoCSS,stroke:eoCSS,strokeWidth:eoNumber(0,1000),strokeStyle:eoEnum('none','solid','dashed','dotted','double'),radius:eoNumber(),opacity:eoNumber(0,100),boxShadow:eoCSS,rotate:eoNumber(-36000,36000)});
const EO_GEOMETRY=eoObject({x:eoNumber(-100000,100000),y:eoNumber(-100000,100000),width:eoNumber(1),height:eoNumber(1),fitContent:{type:'boolean'}});
export const ELEMENT_COMMANDS={
  'elements.read':{summary:'读取当前页元素详情、文字片段、计算样式与画布坐标；样式只作用于目标元素，SVG 填色/描边作用于其图形',parameters:eoObject({ids:eoIds},['ids'])},
  'elements.select':{summary:'选中当前页图层，联动定位左侧列表',write:true,parameters:eoObject({ids:eoIds},['ids'])},
  'elements.text':{summary:'批量修改文字。每项使用 text 或 runs 二选一；富文本多片段必须按 elements.read 返回的 runs.index 修改，保留标签样式。表格/图表数据使用 charts 工具',write:true,parameters:eoObject({edits:{type:'array',minItems:1,maxItems:100,items:eoObject({id:eoString,text:eoText,runs:{type:'array',minItems:1,maxItems:300,items:eoObject({index:{type:'integer',minimum:0,maximum:9999},text:eoText},['index','text'])}},['id'])}},['edits'])},
  'elements.style':{summary:'批量设置字体、颜色、填充、描边、阴影、透明度等。尺寸单位 px；opacity 为 0–100；rotate 为角度；background 支持无外链的简单渐变',write:true,parameters:eoObject({ids:eoIds,styles:EO_STYLES},['ids','styles'])},
  'elements.geometry':{summary:'批量设置位置和尺寸。x/y 为画布坐标，width/height 为局部边框尺寸 px。geometry:{fitContent:true} 将容器宽高贴合内容、移除四周空白和内边距、保留内部尺寸间距；不能与 x/y/width/height 混用。如返回 CONFIRMATION_REQUIRED，须先获用户同意再传 acceptLayoutChange:true。流式元素自由移动须先转换容器布局',write:true,parameters:eoObject({ids:eoIds,geometry:EO_GEOMETRY,acceptLayoutChange:{type:'boolean'}},['ids','geometry'])},
  'elements.layout':{summary:'设置 HTML 容器的 Flex/Grid/自由布局及间距内边距。转换 free 固定当前视口、改变响应式行为，必须先向用户说明并获同意后传 acceptLayoutChange:true',write:true,parameters:eoObject({id:eoString,layout:eoObject({mode:eoEnum('flex','grid','free'),direction:eoEnum('row','column','row-reverse','column-reverse'),gap:eoNumber(0,2000),padding:eoNumber(0,2000),align:eoEnum('stretch','flex-start','center','flex-end','baseline'),justify:eoEnum('flex-start','center','flex-end','space-between','space-around','space-evenly'),wrap:eoEnum('nowrap','wrap','wrap-reverse'),columns:{type:'integer',minimum:1,maximum:24}}),acceptLayoutChange:{type:'boolean'}},['id','layout'])},
  'elements.create':{summary:'在指定容器新建 text/frame/基础 SVG 形状。默认融入容器正常排版；position:absolute 时 x/y 是父容器局部坐标。只接受纯文字和白名单样式，不执行 HTML',write:true,parameters:eoObject({parentId:eoString,kind:eoEnum('text','frame','rect','ellipse','line','triangle','star'),name:eoString,text:eoText,position:eoEnum('flow','absolute'),x:eoNumber(-100000,100000),y:eoNumber(-100000,100000),width:eoNumber(1),height:eoNumber(1),styles:EO_STYLES},['parentId','kind'])},
  'elements.align':{summary:'对齐/均匀分布自由定位元素；单个元素相对父容器，多选相对合并范围；分布至少三个元素',write:true,parameters:eoObject({ids:eoIds,alignment:eoEnum('left','center','right','top','middle','bottom','distributeX','distributeY')},['ids','alignment'])},
  'elements.duplicate':{summary:'复制图层并重映射 ID；Flex/Grid 内保持原有间距和排列',write:true,parameters:eoObject({ids:eoIds},['ids'])},
  'elements.delete':{summary:'删除图层，支持一次撤回；不能删除整页或包含锁定子图层的容器',write:true,parameters:eoObject({ids:eoIds},['ids'])},
  'elements.metadata':{summary:'批量重命名、锁定/解锁、显示/隐藏图层。hidden 使用 visibility，保留布局占位',write:true,parameters:eoObject({ids:eoIds,name:eoString,locked:{type:'boolean'},hidden:{type:'boolean'}},['ids'])},
  'elements.reorder':{summary:'调整同父图层的前后顺序；流式容器内也会改变排版顺序',write:true,parameters:eoObject({ids:eoIds,order:eoEnum('forward','backward','front','back')},['ids','order'])},
  'elements.group':{summary:'组合同父的自由定位元素并保留样式。流式元素须先由用户确认 elements.layout 转为 free，不会静默改变响应式布局',write:true,parameters:eoObject({ids:eoIds,name:eoString},['ids'])},
  'elements.ungroup':{summary:'解绑组合/拆散 HTML 容器。若会改变响应式布局或丢失容器底色/描边/阴影/裁剪，返回 CONFIRMATION_REQUIRED；必须先向用户说明并获同意，再传 acceptLayoutChange:true',write:true,parameters:eoObject({ids:eoIds,acceptLayoutChange:{type:'boolean'}},['ids'])},
};
function eoAssert(condition,code,message,details){if(!condition)throw Object.assign(Error(message),{code,details});}
const eoManaged='table,[data-studio-chart],[data-studio-svg-chart],[data-studio-html-chart],[data-studio-chartjs]';
const eoContainer=n=>n.namespaceURI!=='http://www.w3.org/2000/svg'&&/^(BODY|DIV|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|NAV|MAIN|FIGURE|FIGCAPTION)$/.test(n.tagName);
const eoIsText=n=>isText(n)&&[...n.querySelectorAll('*')].every(c=>c.matches('span,br,b,strong,i,em,u,s,small,a,sub,sup,mark'));
function eoRuns(n){const walker=n.ownerDocument.createTreeWalker(n,4),runs=[];while(walker.nextNode())runs.push(walker.currentNode);return runs;}
function eoNonempty(o){eoAssert(Object.keys(o).length,'INVALID_ARGUMENT','至少提供一个要修改的属性');}
function eoSafeCSS(styles,nodes=[]){
  eoNonempty(styles);
  const property={fill:'color',stroke:'color',background:'background',boxShadow:'box-shadow',fontFamily:'font-family'};
  for(const [key,value] of Object.entries(styles))if(typeof value==='string'){
    eoAssert(!/[\\;{}<>@]|url\s*\(|var\s*\(|env\s*\(|image\s*\(|image-set\s*\(|element\s*\(|paint\s*\(|\/\*/i.test(value),'INVALID_ARGUMENT','样式不接受外链、变量引用或代码');
    const css=property[key]||key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
    if(key!=='strokeStyle')eoAssert(CSS.supports(css,value),'INVALID_ARGUMENT',`${key} 不是有效的样式值`);
    if(key==='background')eoAssert(!nodes.some(n=>n.namespaceURI==='http://www.w3.org/2000/svg'),'UNSUPPORTED','SVG 背景渐变请保留原渐变；可用 fill 设置纯色');
  }
}
function eoApplyStyles(editor,styles){
  for(const [key,value] of Object.entries(styles)){
    if(key==='lineHeight')for(const n of editor.roots)editor.setStyle(n,key,value+'px');
    else if(['fontStyle','textDecoration','background','boxShadow'].includes(key))for(const n of editor.roots)editor.setStyle(n,key,value);
    else editor.property(key,value,{live:true});
  }
}
function eoRead(editor,n){
  const s=editor.style(n),text=eoIsText(n),managed=n.closest(eoManaged),page=editor.pages.pages.find(p=>p.contains(n));
  const styles={};for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','color','lineHeight','letterSpacing','textAlign','textDecoration','backgroundColor','backgroundImage','fill','stroke','strokeWidth','borderColor','borderWidth','borderStyle','borderRadius','opacity','boxShadow','rotate'])styles[key]=s[key];
  return {id:editor.id(n),parentId:editor.id(n.parentElement),children:[...n.children].filter(selectable).map(c=>editor.id(c)),pageId:editor.id(page||editor.doc.body),tag:n.tagName.toLowerCase(),name:label(n),locked:editor.locked(n),hidden:s.visibility==='hidden'||s.display==='none',bounds:editor.rect(n),styles,layout:{display:s.display,position:s.position,direction:s.flexDirection,gap:s.gap,padding:s.padding,align:s.alignItems,justify:s.justifyContent,wrap:s.flexWrap,columns:s.gridTemplateColumns},...(text?{text:n.textContent,runs:eoRuns(n).map((r,index)=>({index,text:r.textContent,parentTag:r.parentElement.tagName.toLowerCase()}))}:{}),capabilities:{text:text&&!managed,container:eoContainer(n)&&!managed,freePosition:['absolute','fixed'].includes(s.position),ungroup:editor.canUngroup(n)&&!managed},...(managed?{dataTargetId:editor.id(managed)}:{})};
}
function eoTransaction(editor,action,work){
  const saved={history:editor.history,historyIndex:editor.historyIndex,revision:editor.revision,dirty:editor.dirty,selection:[...editor.selection],width:editor.width,height:editor.height};
  const nav=editor.pages,parentId=editor.id(nav.parent),pageIds=nav.pages.map(n=>editor.id(n)),index=nav.index,commit=editor.commit,schedule=editor.scheduleDraft;
  const scripts=[editor.doc.querySelector('#qiwu-chart-motion'),editor.doc.querySelector('script[data-studio-chartjs-runtime]')];
  try{return structureTransaction(editor.doc.body,()=>{
    editor.commit=()=>{};editor.scheduleDraft=()=>{};
    try{const result=work();editor.commit=commit;commit.call(editor,action);editor.scheduleDraft=schedule;if(editor.revision!==saved.revision)schedule.call(editor);return result;}
    finally{editor.commit=commit;editor.scheduleDraft=schedule;}
  },scripts);}
  catch(error){
    Object.assign(editor,saved);nav.parent=parentId?editor.get(parentId):undefined;nav.pages=pageIds.map(id=>editor.get(id)).filter(Boolean);nav.show(index);
    if(!scripts[1])editor.doc.querySelector('script[data-studio-chartjs-runtime]')?.remove();
    editor.render();throw error;
  }
}
export function executeElementCommand(editor,command,p){
  const node=id=>{const n=editor.get(id);eoAssert(n&&selectable(n),'NOT_FOUND','未找到可编辑图层',{id});eoAssert(editor.inCurrentPage(n),'PAGE_NOT_ACTIVE','请先切换到目标所在页面',{id});return n;};
  const ids=p.ids||p.edits?.map(e=>e.id)||[p.id||p.parentId];
  eoAssert(new Set(ids).size===ids.length,'INVALID_ARGUMENT','不能重复指定同一图层');
  const nodes=ids.map(node);
  if(command==='elements.read')return nodes.map(n=>eoRead(editor,n));
  eoAssert(!editor.preview,'PREVIEW_ACTIVE','请先退出预览');
  if(command==='elements.select'){editor.select(ids);return {ids};}
  const protect=()=>nodes.forEach(n=>eoAssert(n!==editor.doc.body&&n!==editor.pageRoot&&!editor.pages.pages.some(page=>n.contains(page)),'PROTECTED_PAGE','请通过页面功能操作整页，不能当普通图层移动/删除/组合'));
  if(['elements.geometry','elements.align','elements.duplicate','elements.delete','elements.reorder','elements.group','elements.ungroup'].includes(command))protect();
  const unlocking=command==='elements.metadata'&&p.locked===false&&Object.keys(p).every(k=>['ids','locked'].includes(k));
  for(const n of nodes){
    eoAssert(unlocking?!editor.locked(n.parentElement):!editor.locked(n),'LOCKED','图层或祖先已锁定',{id:editor.id(n)});
    eoAssert(!n.querySelector('[data-hs-locked="true"]')||command==='elements.metadata'&&Object.keys(p).every(k=>['ids','locked','name'].includes(k)),'LOCKED','包含锁定的子图层，请先解锁',{id:editor.id(n)});
    eoAssert(!n.parentElement?.closest(eoManaged),'DATA_TARGET','表格/图表内部结构请使用 charts 工具',{id:editor.id(n)});
  }
  eoAssert(!nodes.some(n=>nodes.some(other=>other!==n&&other.contains(n))),'INVALID_ARGUMENT','同一次操作不能同时包含祖先和子图层');
  const container=n=>eoAssert(eoContainer(n)&&!n.closest(eoManaged)&&!n.querySelector('[data-studio-pages]')&&!editor.pages.pages.some(page=>page!==n&&n.contains(page)),'UNSUPPORTED','请选择普通 HTML 容器');
  const free=()=>nodes.forEach(n=>eoAssert(['absolute','fixed'].includes(editor.style(n).position),'LAYOUT_CONVERSION_REQUIRED','流式布局不能直接自由移动或组合。先说明响应式影响并由用户确认，将父容器转换为 free',{parentId:editor.id(n.parentElement)}));
  const visible=n=>eoAssert(n.getClientRects().length&&editor.rect(n).width>0&&editor.rect(n).height>0,'NOT_VISIBLE','请先显示元素并恢复非零尺寸');
  let textChanges;
  if(command==='elements.text'){
    textChanges=p.edits.map((edit,i)=>{
      const n=nodes[i],runs=eoRuns(n);eoAssert(eoIsText(n)&&!n.closest(eoManaged),'UNSUPPORTED','请选择纯文字或行内富文本元素；脚本和复杂容器不通过文字接口修改，表格/图表数据通过 charts 修改');
      eoAssert(Object.hasOwn(edit,'text')!==Object.hasOwn(edit,'runs'),'INVALID_ARGUMENT','text 和 runs 必须且只能提供一个');
      if(edit.runs){eoAssert(new Set(edit.runs.map(r=>r.index)).size===edit.runs.length,'INVALID_ARGUMENT','文字片段索引重复');return edit.runs.map(r=>{eoAssert(runs[r.index],'INVALID_ARGUMENT','文字片段索引越界');return {node:runs[r.index],text:r.text};});}
      eoAssert(runs.length<=1&&!n.querySelector('br'),'RICH_TEXT_RUNS_REQUIRED','多片段富文本请先读取 runs，按索引修改以保留格式');return [{node:runs[0]||n,text:edit.text}];
    }).flat();
  }
  if(p.styles)eoSafeCSS(p.styles,command==='elements.create'?[]:nodes);
  if(command==='elements.geometry'){
    eoNonempty(p.geometry);protect();
    if('fitContent'in p.geometry){eoAssert(p.geometry.fitContent===true&&Object.keys(p.geometry).length===1,'INVALID_ARGUMENT','fitContent 必须为 true，且不能和位置、宽高混用');nodes.forEach(n=>eoAssert(editor.canFitContent(n),'UNSUPPORTED','请选择 HTML 容器或组合'));}
    else {eoAssert(p.acceptLayoutChange===undefined,'INVALID_ARGUMENT','acceptLayoutChange 仅用于适应内容尺寸');if('x'in p.geometry||'y'in p.geometry){free();nodes.forEach(visible);}}
  }
  if(command==='elements.align'){protect();free();nodes.forEach(visible);eoAssert(!p.alignment.startsWith('distribute')||nodes.length>=3,'INVALID_ARGUMENT','均匀分布至少需要三个元素');}
  if(command==='elements.layout'){
    const n=nodes[0];container(n);eoNonempty(p.layout);
    const mode=p.layout.mode||editor.style(n).display;eoAssert(['flex','grid','inline-flex','inline-grid','free'].includes(mode),'INVALID_ARGUMENT','请明确指定 mode 为 flex、grid 或 free');
    if(mode==='free'){
      eoAssert(Object.keys(p.layout).length===1,'INVALID_ARGUMENT','free 转换不能同时设置 Flex/Grid 参数');
      eoAssert(p.acceptLayoutChange===true,'CONFIRMATION_REQUIRED','转换为自由布局会固定当前视口并改变响应式行为；请先征得用户同意',{id:p.id,effects:['固定当前视口中的位置尺寸','原有 Flex/Grid 响应式排列会改变']});
      [n,...n.children].filter(selectable).forEach(visible);
    }
  }
  if(command==='elements.create'){
    container(nodes[0]);eoAssert(p.kind==='text'||p.text===undefined,'INVALID_ARGUMENT','只有 text 元素可设置文字');
    eoAssert(p.position==='absolute'||p.x===undefined&&p.y===undefined,'INVALID_ARGUMENT','流式元素不能设置 x/y，使用容器布局控制位置');
    if(p.styles?.background&& !['text','frame'].includes(p.kind))eoAssert(false,'UNSUPPORTED','SVG 形状请用 fill 设置填充');
  }
  if(['elements.duplicate','elements.delete','elements.reorder','elements.group','elements.ungroup'].includes(command))protect();
  if(command==='elements.metadata')eoAssert(['name','locked','hidden'].some(k=>Object.hasOwn(p,k)),'INVALID_ARGUMENT','至少提供一个图层属性');
  if(command==='elements.group'||command==='elements.reorder')eoAssert(nodes.every(n=>n.parentElement===nodes[0].parentElement),'INVALID_ARGUMENT','请选择同父容器中的元素');
  if(['elements.group','elements.reorder','elements.ungroup'].includes(command))for(const n of nodes)eoAssert(!n.parentElement.querySelector('[data-hs-locked="true"]'),'LOCKED','父容器中有锁定图层，不能改变它的布局或层级');
  if(command==='elements.group'){eoAssert(nodes.length>=2,'INVALID_ARGUMENT','组合至少需要两个元素');free();nodes.forEach(visible);eoAssert(nodes.every(n=>editor.style(n).position==='absolute'),'UNSUPPORTED','组合暂不支持 fixed 元素');}
  if(command==='elements.ungroup')for(const n of nodes)eoAssert(editor.canUngroup(n)&&!n.closest(eoManaged),'UNSUPPORTED','无法拆散此元素，请选择普通容器或组合');
  return eoTransaction(editor,'接口：'+ELEMENT_COMMANDS[command].summary.split('。')[0],()=>{
    editor.selection=ids;
    if(command==='elements.text'){for(const change of textChanges)change.node.textContent=change.text;}
    else if(command==='elements.style')eoApplyStyles(editor,p.styles);
    else if(command==='elements.geometry'){
      if(p.geometry.fitContent)editor.fitContent({strict:true,confirmed:p.acceptLayoutChange===true,nodes});
      else for(const key of ['width','height','x','y'])if(key in p.geometry)editor.property(key,p.geometry[key],{live:true});
    }else if(command==='elements.layout'){
      const n=nodes[0],l=p.layout;
      if(l.mode==='free'){
        editor.freezeContainer(n);
        // Authored !important declarations must not silently defeat conversion.
        editor.setStyle(n,'display','block');for(const c of [...n.children].filter(selectable))editor.setStyle(c,'position','absolute');
      }else{
        if(l.mode){editor.setStyle(n,'display',l.mode);delete n.dataset.hsFree;for(const c of [...n.children].filter(selectable))if(['absolute','fixed'].includes(editor.style(c).position))for(const [k,v] of Object.entries({position:'relative',left:'auto',top:'auto',right:'auto',bottom:'auto',translate:'none',flex:'0 0 auto'}))editor.setStyle(c,k,v);}
        const map={direction:'flexDirection',gap:'gap',padding:'padding',align:'alignItems',justify:'justifyContent',wrap:'flexWrap',columns:'gridTemplateColumns'};
        for(const [k,v] of Object.entries(l))if(k!=='mode')editor.setStyle(n,map[k],k==='columns'?`repeat(${v},minmax(0,1fr))`:['gap','padding'].includes(k)?v+'px':v);
      }
    }else if(command==='elements.create'){
      const parent=nodes[0],hadFrame=parent.getAttribute('data-hs-frame'),oldPosition=parent.style.getPropertyValue('position'),positionPriority=parent.style.getPropertyPriority('position');parent.dataset.hsFrame='true';
      try{editor.insert(p.kind,{x:0,y:0});}finally{if(hadFrame===null)parent.removeAttribute('data-hs-frame');else parent.setAttribute('data-hs-frame',hadFrame);}
      const n=editor.nodes[0];eoAssert(n&&n.parentElement===parent,'OPERATION_FAILED','新建元素失败');
      if(p.name)n.dataset.hsName=p.name;if(p.kind==='text'&&p.text!==undefined)n.textContent=p.text;
      if(p.position!=='absolute'){
        if(oldPosition)parent.style.setProperty('position',oldPosition,positionPriority);else parent.style.removeProperty('position');
        for(const [k,v] of Object.entries({position:'relative',left:'auto',top:'auto',right:'auto',bottom:'auto',flexShrink:'0'}))editor.setStyle(n,k,v);
      }
      else{editor.setStyle(n,'left',(p.x||0)+'px');editor.setStyle(n,'top',(p.y||0)+'px');}
      for(const k of ['width','height'])if(k in p)editor.property(k,p[k],{live:true});if(p.styles)eoApplyStyles(editor,p.styles);
    }else if(command==='elements.align')editor.align(p.alignment);
    else if(command==='elements.duplicate')editor.duplicate();
    else if(command==='elements.delete')editor.remove();
    else if(command==='elements.metadata')for(const n of nodes){if(p.name!==undefined)n.dataset.hsName=p.name;if(p.locked!==undefined)n.dataset.hsLocked=String(p.locked);if(p.hidden!==undefined)editor.setStyle(n,'visibility',p.hidden?'hidden':'visible');}
    else if(command==='elements.reorder'){
      const parent=nodes[0].parentElement,ordered=[...parent.children].filter(n=>nodes.includes(n)),others=[...parent.children].filter(n=>selectable(n)&&!nodes.includes(n));
      editor.selection=ordered.map(n=>editor.id(n));
      if(p.order==='front'){let anchor=others.at(-1);if(anchor)for(const n of ordered){anchor.after(n);anchor=n;}}
      else if(p.order==='back'){const anchor=others[0];if(anchor)for(const n of ordered)anchor.before(n);}
      else for(const n of p.order==='forward'?[...ordered].reverse():ordered){const siblings=[...parent.children].filter(selectable),at=siblings.indexOf(n),other=siblings[at+(p.order==='forward'?1:-1)];if(other&&!nodes.includes(other)){if(p.order==='forward')other.after(n);else other.before(n);}}
      editor.normalizeStack(parent);
    }else if(command==='elements.group'){
      const styles=nodes.flatMap(n=>snapshotStyles(editor,n)),before=nodes.map(n=>({n,rect:editor.rect(n)}));
      editor.group();restoreChangedStyles(editor,styles);
      for(const {n,rect} of before){const after=editor.rect(n);editor.moveBy(n,rect.x-after.x,rect.y-after.y);}
      if(p.name)editor.nodes[0].dataset.hsName=p.name;
    }else if(command==='elements.ungroup')editor.ungroup({strict:true,confirmed:p.acceptLayoutChange===true});
    annotate(editor.doc);
    return {ids:[...editor.selection]};
  });
}
