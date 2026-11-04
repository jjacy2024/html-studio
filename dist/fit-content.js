import {selectable} from './document.js';

const fcTags=new Set(['DIV','SECTION','ARTICLE','ASIDE','HEADER','FOOTER','NAV','MAIN','FIGURE','FIGCAPTION','FORM','FIELDSET','UL','OL','LI','DL','DT','DD','BLOCKQUOTE','DETAILS']);
const fcNumber=value=>parseFloat(value)||0;
const fcError=(code,message)=>Object.assign(Error(message),{code});
const fcNear=(a,b)=>Math.abs(a-b)<.6;
function fcSize(node,style){
  const box=axis=>fcNumber(style[axis])+(style.boxSizing==='border-box'?0:(axis==='width'?['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth']:['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth']).reduce((n,key)=>n+fcNumber(style[key]),0));
  return {width:box('width')||node.offsetWidth||0,height:box('height')||node.offsetHeight||0};
}
function fcMatrix(editor,node){
  let result=new DOMMatrix();
  for(let el=node;el;el=el.parentElement){
    const s=editor.style(el),m=new DOMMatrix(s.transform==='none'?undefined:s.transform),rotation=s.rotate==='none'?['0']:s.rotate.split(/\s+/),scales=s.scale==='none'?[1,1]:s.scale.split(/\s+/).map(Number);
    if(!m.is2D||rotation.length>1&&rotation[0]!=='z'||scales.length>2||s.perspective!=='none'||!['normal','1',''].includes(s.zoom))throw fcError('UNSUPPORTED','此容器含三维变换、透视或 CSS zoom，暂不能可靠地贴合内容。');
    const angle=rotation.at(-1),degrees=fcNumber(angle)*(angle.endsWith('grad')?.9:angle.endsWith('rad')?180/Math.PI:angle.endsWith('turn')?360:1);
    const local=new DOMMatrix().rotate(degrees).scale(scales[0],scales[1]??scales[0]).multiply(m);local.e=0;local.f=0;result=local.multiply(result);
  }
  if(Math.abs(result.a*result.d-result.b*result.c)<1e-8)throw fcError('NOT_VISIBLE','请先恢复容器的非零缩放。');
  return result;
}
function fcQuad(editor,node){
  const s=editor.style(node),size=fcSize(node,s),m=fcMatrix(editor,node),r=editor.rect(node);
  const corners=[[0,0],[size.width,0],[0,size.height],[size.width,size.height]].map(([x,y])=>m.transformPoint({x,y}));
  const x=r.x-Math.min(...corners.map(p=>p.x)),y=r.y-Math.min(...corners.map(p=>p.y));
  return {m,size,origin:{x,y},points:corners.map(p=>({x:p.x+x,y:p.y+y}))};
}
function fcBounds(points){const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y)),right=Math.max(...points.map(p=>p.x)),bottom=Math.max(...points.map(p=>p.y));return {x,y,width:right-x,height:bottom-y,right,bottom};}
function fcContents(editor,root){
  const q=fcQuad(editor,root),inverse=q.m.inverse(),local=p=>inverse.transformPoint({x:p.x-q.origin.x,y:p.y-q.origin.y}),items=[];
  const walk=parent=>{
    for(const node of parent.childNodes){
      if(node.nodeType===3&&node.textContent.trim()){
        const range=editor.doc.createRange();range.selectNodeContents(node);
        // Direct text uses line boxes, including its authored line height.
        for(const r of range.getClientRects())if(r.width>0&&r.height>0){
          if(Math.abs(q.m.b)>.001||Math.abs(q.m.c)>.001){if(parent!==root)continue;throw fcError('UNSUPPORTED','含旋转的直接文字请先放入独立文本元素，再适应容器尺寸。');}
          const b=fcBounds([{x:r.left,y:r.top},{x:r.right,y:r.bottom}].map(local)),line=fcNumber(editor.style(parent).lineHeight);
          if(line>b.height){b.y-=(line-b.height)/2;b.height=line;b.bottom=b.y+line;}
          items.push({node,box:b});
        }
      }else if(node.nodeType===1&&selectable(node)){
        const s=editor.style(node);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse')continue;
        if(s.position==='fixed'||s.position==='sticky')throw fcError('UNSUPPORTED','容器内有固定或吸附定位元素，请先调整其定位后再贴合。');
        if(s.display==='contents'){walk(node);continue;}
        if(!node.getClientRects().length)continue;
        let points;
        if(s.display==='inline')points=[...node.getClientRects()].flatMap(r=>[{x:r.left,y:r.top},{x:r.right,y:r.bottom}]).map(local);
        else points=fcQuad(editor,node).points.map(local);
        if(points.length)items.push({node,box:fcBounds(points)});
        // A clipped subtree is represented by its clipping box. For visible
        // overflow include descendants, so nested overflow is not cut off.
        if(s.overflowX==='visible'&&s.overflowY==='visible'&&node.namespaceURI!=='http://www.w3.org/2000/svg')walk(node);
      }
    }
  };
  walk(root);if(!items.length)throw fcError('EMPTY_CONTAINER','容器内没有可见内容，暂时无法计算尺寸。');
  return {items,bounds:fcBounds(items.flatMap(({box:b})=>[{x:b.x,y:b.y},{x:b.right,y:b.bottom}])),q};
}
function fcSnapshot(roots){return roots.flatMap(root=>[root,...root.querySelectorAll('*')]).map(node=>({node,style:node.getAttribute('style'),free:node.getAttribute('data-hs-free')}));}
function fcRestore(records){for(const {node,style,free} of records){if(style===null)node.removeAttribute('style');else node.setAttribute('style',style);if(free===null)node.removeAttribute('data-hs-free');else node.setAttribute('data-hs-free',free);}}
function fcSameLayout(before,after){
  return before.items.length===after.items.length&&before.items.every((item,i)=>{
    const b=item.box,a=after.items[i].box;return item.node===after.items[i].node&&fcNear(a.width,b.width)&&fcNear(a.height,b.height)&&fcNear(a.x-after.bounds.x,b.x-before.bounds.x)&&fcNear(a.y-after.bounds.y,b.y-before.bounds.y);
  });
}
function fcSet(editor,node,values){for(const [key,value] of Object.entries(values))editor.setStyle(node,key,value);}
function fcFitOne(editor,root,confirmed){
  const before=fcContents(editor,root),s=editor.style(root),borders={left:fcNumber(s.borderLeftWidth),right:fcNumber(s.borderRightWidth),top:fcNumber(s.borderTopWidth),bottom:fcNumber(s.borderBottomWidth)},position=s.position;
  const children=[...root.children].filter(n=>selectable(n)&&editor.style(n).display!=='none'&&editor.style(n).visibility!=='hidden');
  const free=children.length&&children.every(n=>editor.style(n).position==='absolute'&&n.offsetParent===root);
  const directText=[...root.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
  const width=before.bounds.width+borders.left+borders.right,height=before.bounds.height+borders.top+borders.bottom;
  if(width<.1||height<.1||width>100000||height>100000)throw fcError('INVALID_SIZE','内容范围为空或过大，无法适应尺寸。');
  const saved=fcSnapshot([root]),initialChildren=children.map(node=>({node,rect:editor.rect(node),size:fcSize(node,editor.style(node))}));
  // Clear sizing constraints first, otherwise they can hide an !important
  // width/height rule from the editor's cascade-aware style setter.
  const size=()=>fcSet(editor,root,{boxSizing:'border-box',padding:'0px',minWidth:'0px',minHeight:'0px',maxWidth:'none',maxHeight:'none',flexGrow:'0',flexShrink:'0',flexBasis:'auto',aspectRatio:'auto',width:width+'px',height:height+'px'});
  const rebase=()=>{
    let current=fcContents(editor,root),dx=borders.left-current.bounds.x,dy=borders.top-current.bounds.y;
    if(!fcNear(dx,0)||!fcNear(dy,0)){
      if(directText)throw fcError('CONFIRMATION_REQUIRED','直接文字的行高或排版约束阻止无余量贴合，请先放入独立文本元素。');
      const screen=current.q.m.transformPoint({x:dx,y:dy});for(const child of children)editor.moveBy(child,screen.x,screen.y);
    }
    current=fcContents(editor,root);
    if(!fcSameLayout(before,current)||!fcNear(current.bounds.x,borders.left)||!fcNear(current.bounds.y,borders.top)||!fcNear(current.bounds.width,width-borders.left-borders.right)||!fcNear(current.bounds.height,height-borders.top-borders.bottom)||!fcNear(current.q.size.width,width)||!fcNear(current.q.size.height,height))throw fcError('CONFIRMATION_REQUIRED','原有尺寸或布局约束会改变内部元素的尺寸和排布。');
    return current;
  };
  let converted=false;
  try{
    size();
    if(free){
      // Pixel dimensions/anchors are independent of the newly cropped box.
      // Freeze only when an authored percentage/right/bottom anchor moves it.
      for(const {node,rect,size:old} of initialChildren){const now=editor.rect(node);if(!fcNear(now.width,rect.width)||!fcNear(now.height,rect.height))throw fcError('CONFIRMATION_REQUIRED','百分比尺寸会随容器缩放，需要先固定当前尺寸。');}
    }
    rebase();
  }catch(error){
    fcRestore(saved);
    if(error.code!=='CONFIRMATION_REQUIRED')throw error;
    if(!confirmed)throw error;
    if(directText)throw fcError('UNSUPPORTED','此容器含直接文字，无法在保持排版的同时自动固定布局；请先将文字放入独立文本元素。');
    // This branch is only entered after the user accepts responsive changes.
    fcSet(editor,root,{position:position==='static'?'relative':position,display:'block'});root.dataset.hsFree='true';size();
    for(const {node,rect,size:old} of initialChildren){
      fcSet(editor,node,{position:'absolute',left:'0px',top:'0px',right:'auto',bottom:'auto',boxSizing:'border-box',minWidth:'0px',minHeight:'0px',maxWidth:'none',maxHeight:'none',margin:'0px',flex:'none',width:old.width+'px',height:old.height+'px'});
      const now=editor.rect(node);editor.moveBy(node,rect.x-now.x,rect.y-now.y);
    }
    rebase();converted=true;
  }
  // Free containers can crop from every edge without moving their content on
  // the canvas. Flow containers keep their layout slot; siblings may reflow.
  if(['absolute','fixed'].includes(position)){
    const after=fcContents(editor,root),old=before.q.m.transformPoint({x:before.bounds.x,y:before.bounds.y}),now=after.q.m.transformPoint({x:after.bounds.x,y:after.bounds.y});
    editor.moveBy(root,before.q.origin.x+old.x-after.q.origin.x-now.x,before.q.origin.y+old.y-after.q.origin.y-now.y);
  }
  return {id:editor.id(root),width,height,converted};
}
export function installFitContent(Editor,{modal,closeModal,toast}){
  Editor.prototype.canFitContent=function(node){return !!node&&fcTags.has(node.tagName)&&node!==this.doc.body&&node!==this.pageRoot&&!this.pages?.pages.some(p=>node.contains(p))&&!node.closest('table,[data-studio-chart],[data-studio-svg-chart],[data-studio-html-chart],[data-studio-chartjs]');};
  Editor.prototype.fitContent=function({strict=false,confirmed=false,nodes=this.roots}={}){
    this.finishText?.();
    const roots=[...nodes],version=this.loadVersion,revision=this.revision;
    const fail=error=>{if(strict)throw error;toast(error.message);};
    try{
      if(this.loading||this.preview||this.isHome)throw fcError('BUSY','请先返回编辑画布。');
      if(!roots.length||roots.some(n=>!this.canFitContent(n)))throw fcError('UNSUPPORTED','请选择 HTML 容器或组合；整页与图表内部请使用各自的尺寸设置。');
      if(roots.some(n=>roots.some(other=>other!==n&&other.contains(n))))throw fcError('INVALID_ARGUMENT','请勿同时选择父容器和其子容器。');
      for(const root of roots){
        if(this.locked(root)||root.querySelector('[data-hs-locked="true"]'))throw fcError('LOCKED','请先解锁容器及其内部图层。');
        const s=this.style(root);if(!root.getClientRects().length||s.visibility==='hidden'||s.display==='contents')throw fcError('NOT_VISIBLE','请先显示容器，display:contents 没有可调整的独立边框。');
        if(root.querySelectorAll('*').length>4000)throw fcError('TOO_COMPLEX','此容器元素过多，请分批选择内部容器进行适应。');
        for(const pseudo of ['::before','::after'])if(!['none','normal'].includes(this.doc.defaultView.getComputedStyle(root,pseudo).content))throw fcError('UNSUPPORTED','此容器有伪元素装饰，无法可靠测量其边界；请先将装饰转换成独立元素。');
      }
      const saved=fcSnapshot(roots);let result;
      try{result=roots.map(root=>fcFitOne(this,root,confirmed));}catch(error){fcRestore(saved);throw error;}
      this.commit('适应内容尺寸');if(!strict)toast(`已将 ${result.length} 个容器贴合内容，可撤回恢复`);return {items:result};
    }catch(error){
      if(error.code==='CONFIRMATION_REQUIRED'&&!strict&&!confirmed){
        modal('适应内容尺寸',`<p>当前布局在收紧容器后会改变内部元素的尺寸或排布。</p><p>要保留目前的元素尺寸和间距，需要将选中容器固定为自由布局。<strong>这会改变原来的 Flex/Grid 或百分比响应式行为。</strong></p><p class="source-note">可撤回恢复；确认后请检查预览。</p>`,[
          {label:'保留原布局',run:closeModal},{label:'固定布局并适应内容',primary:true,run:()=>{closeModal();if(version!==this.loadVersion||revision!==this.revision||roots.some(n=>!n.isConnected)){toast('工程已变化，请重新选择容器');return;}this.fitContent({confirmed:true,nodes:roots});}},
        ]);return;
      }
      return fail(error);
    }
  };
}
