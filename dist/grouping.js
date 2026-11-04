import {selectable} from './document.js';

const containerTags = new Set(['DIV','SECTION','ARTICLE','ASIDE','HEADER','FOOTER','NAV','MAIN','FIGURE','FIGCAPTION']);
const excludedStyle = property => /^(animation|transition)(-|$)/.test(property) || ['caret-color','cursor'].includes(property);
function linearTransform(style) {
  const rotate = style.rotate === 'none' ? [] : style.rotate.split(/\s+/);
  if (rotate.length > 1 && rotate[0] !== 'z') throw Error('暂不支持拆散含三维旋转的容器，请先移除三维变换');
  const angle = rotate.at(-1) || '0';
  const degrees = parseFloat(angle) * (angle.endsWith('grad') ? 0.9 : angle.endsWith('rad') ? 180 / Math.PI : angle.endsWith('turn') ? 360 : 1);
  const scale = style.scale === 'none' ? [1,1] : style.scale.split(/\s+/).map(Number);
  const matrix = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
  if (!matrix.is2D || scale.length > 2 || style.perspective !== 'none' || ![1,NaN].some(n=>Object.is(n,Number(style.zoom))))
    throw Error('暂不支持拆散含三维变换、透视或 CSS zoom 的容器，请先移除这些变换');
  const result = new DOMMatrix().rotate(degrees).scale(scale[0],scale[1] ?? scale[0]).multiply(matrix);
  if (Math.abs(result.a*result.d-result.b*result.c)<1e-8) throw Error('容器尺寸被缩放为零，请先恢复缩放再拆散');
  return result;
}
export function snapshotStyles(editor, root) {
  return [root,...root.querySelectorAll('*')].filter(el=>!['SCRIPT','STYLE','LINK','META'].includes(el.tagName)).map(el=>{
    const style=editor.style(el);
    return {el, properties:[...style].filter(p=>!excludedStyle(p)).map(p=>[p,style.getPropertyValue(p)])};
  });
}
function localBox(editor, el) {
  if (typeof el.offsetWidth === 'number') return {width:el.offsetWidth,height:el.offsetHeight};
  const style=editor.style(el);
  const extra=axis=>style.boxSizing==='border-box'?0:axis.reduce((sum,p)=>sum+(parseFloat(style[p])||0),0);
  return {width:parseFloat(style.width)+extra(['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth']),
    height:parseFloat(style.height)+extra(['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'])};
}
export function restoreChangedStyles(editor, records) {
  // Preserve inherited typography, CSS variables, and ancestor-dependent rules.
  // Only changed computed declarations are frozen; authored motion stays intact.
  for (const {el,properties} of records) {
    const style=editor.style(el);
    const changes=properties.filter(([p,value])=>style.getPropertyValue(p)!==value);
    for(const [p,value] of changes)el.style.setProperty(p,value,'important');
  }
}
export function installGrouping(Editor,{modal,closeModal,toast}) {
  Editor.prototype.canUngroup = function (el) {
    return !!el && el !== this.doc.body && el !== this.pageRoot && !this.pages?.pages.some(page=>el.contains(page)) &&
      !el.matches('[data-studio-chart], [data-studio-pages]') && !el.querySelector('[data-studio-pages]') &&
      (el.dataset.hsGroup || containerTags.has(el.tagName)) && [...el.children].some(selectable);
  };
  Editor.prototype.ungroup = function ({strict=false,confirmed=false}={}) {
    if (!this.editable()) return;
    this.finishText?.();
    const groups=this.roots.filter(el=>this.canUngroup(el));
    if (!groups.length) { toast('请选择包含子图层的组合或 HTML 容器；整页、表格和 SVG 请保留其结构'); return; }
    try {
      for(const group of groups) {
        if (!group.getClientRects().length || [...group.children].filter(selectable).some(el=>!el.getClientRects().length))
          throw Error('请先显示容器及其直接子图层，再拆散，以便准确保留位置和尺寸');
        if ([...group.childNodes].some(n=>n.nodeType===3 && n.textContent.trim())) throw Error('此容器含直接文字；请先将文字放入独立文本元素，再拆散容器，避免丢失文字');
        if (group.querySelector('[data-hs-locked="true"]')) throw Error('容器内含锁定图层，请先解锁再拆散');
        for(let node=group;node;node=node.parentElement)linearTransform(this.style(node));
        for(const child of [...group.children].filter(selectable))linearTransform(this.style(child));
      }
    } catch(error) { if(strict)throw error;toast(error.message); return; }
    const convertsFlow=groups.some(g=>!['absolute','fixed'].includes(this.style(g).position));
    const decorated=groups.some(g=>{
      const s=this.style(g);
      return Number(s.opacity)<1 || s.backgroundImage!=='none' || !['rgba(0, 0, 0, 0)','transparent'].includes(s.backgroundColor) ||
        s.boxShadow!=='none' || parseFloat(s.borderTopWidth)>0 || s.filter!=='none' || s.overflowX!=='visible' ||
        !['none','normal'].includes(this.doc.defaultView.getComputedStyle(g,'::before').content) ||
        !['none','normal'].includes(this.doc.defaultView.getComputedStyle(g,'::after').content);
    });
    const version=this.loadVersion;
    const apply=()=>{
      if(this.loading || this.loadVersion!==version || groups.some(g=>!g.isConnected))return;
      // Capture all child subtrees before touching parent layout or CSS ancestry.
      const records=groups.map(group=>({group, matrix:linearTransform(this.style(group)), opacity:Number(this.style(group).opacity),
        children:[...group.children].filter(selectable).map(el=>({el, rect:this.rect(el), ...localBox(this,el),
          matrix:linearTransform(this.style(el)), opacity:Number(this.style(el).opacity), styles:snapshotStyles(this,el)}))}));
      const parents=new Set(groups.filter(g=>!['absolute','fixed'].includes(this.style(g).position)).map(g=>g.parentElement));
      for(const parent of parents)this.freezeContainer(parent);
      const ids=[];
      for(const {group,matrix,opacity,children} of records) {
        const parent=group.parentElement;
        if(this.style(parent).position==='static')this.setStyle(parent,'position','relative');
        // Move every node, including inert scripts/styles/comments; never discard them.
        for(const node of [...group.childNodes])parent.insertBefore(node,group);
        group.remove();
        for(const child of children) {
          restoreChangedStyles(this,child.styles);
          const combined=matrix.multiply(child.matrix);
          const css={position:'absolute',left:'0px',top:'0px',right:'auto',bottom:'auto',width:child.width+'px',height:child.height+'px',
            minWidth:'0px',minHeight:'0px',maxWidth:'none',maxHeight:'none',boxSizing:'border-box',margin:'0',flex:'none',
            rotate:'none',scale:'none',translate:'none',transformOrigin:'0 0',
            transform:`matrix(${combined.a},${combined.b},${combined.c},${combined.d},0,0)`,opacity:String(opacity*child.opacity)};
          for(const [key,value] of Object.entries(css))this.setStyle(child.el,key,value);
          // Screen-space correction handles parent borders, scrolling and 2D transforms.
          const after=this.rect(child.el);this.moveBy(child.el,child.rect.x-after.x,child.rect.y-after.y);
          ids.push(this.id(child.el));
        }
      }
      this.selection=ids;this.commit('解除组合 / 拆散容器');
      toast('已解除组合，子图层可独立编辑；可撤回恢复');
    };
    if(convertsFlow || decorated || groups.some(g=>!g.dataset.hsGroup)) {
      if(strict&&!confirmed)throw Object.assign(Error('拆散会改用自由定位，改变响应式布局，并移除容器底色、描边、阴影、裁剪和伪元素；请先向用户说明并获得同意'),{code:'CONFIRMATION_REQUIRED',details:{convertsFlow,decorated,ids:groups.map(g=>this.id(g))}});
      if(confirmed){apply();return;}
      modal('解除组合 / 拆散容器',`<p>将 ${groups.length} 个容器的子图层移到上一层，保留当前画布中的位置、尺寸及文字样式。</p>
        <p>${convertsFlow?'该操作会先把父容器转换为自由布局，固定当前视口中各元素的位置。':'拆散后的子图层将使用自由定位。'}原有响应式布局会改变。</p>
        <p>容器自身的底色、描边、阴影、裁剪和伪元素会移除；整体透明度会分配到子图层，重叠区域可能变化。依赖容器的脚本和动效请在预览中检查。</p>
        <p class="source-note">可以撤回恢复。页面、表格、图表和 SVG 内部结构不会通过此操作拆散。</p>`,[
          {label:'取消',run:closeModal},{label:convertsFlow?'转换为自由布局并拆散':'解除组合 / 拆散',primary:true,run:()=>{closeModal();apply();}},
        ]);
    } else apply();
  };
}
