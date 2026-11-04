const pixel='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#6c5ce7"/><circle cx="100" cy="50" r="30" fill="#fff"/></svg>').toString('base64');
export const types=[
{id:'margin-collapse',html:'<h1 id="target">首段外边距</h1>',css:'body{height:auto;margin:8px}#target{position:static;margin:24px 0;height:auto}'},
{id:'text',html:'<p id="target">静态文字 ABC 123</p>'},
{id:'rich-text',html:'<p id="target">文字 <strong>加粗内容</strong> <span style="color:#167d61">彩色内容</span></p>'},
{id:'inline-text',html:'<div class="host"><span id="target" class="inline">行内文字 ABC</span></div>'},
{id:'important-text',html:'<p id="target" class="forced">优先级文字</p>',css:'.forced{font-size:18px!important;color:#123456!important;opacity:1!important;width:220px!important;background:#f2f3f6!important}'},
{id:'link',html:'<div class="host"><a href="#local" id="target" class="inline">普通链接</a></div>'},
{id:'button',html:'<button id="target">操作按钮</button>'},
{id:'image',html:`<img id="target" src="${pixel}" alt="Embedded image">`},
{id:'canvas-host',html:'<canvas id="target" width="200" height="100"></canvas>'},
{id:'video-poster',html:`<video id="target" poster="${pixel}" preload="none"></video>`},
{id:'iframe-host',html:'<iframe id="target" srcdoc="<p>静态嵌入内容</p>"></iframe>'},
{id:'table',html:'<table id="target"><tbody><tr><td>第一列</td><td>第二列</td></tr></tbody></table>'},
{id:'svg',html:'<svg id="target" viewBox="0 0 200 100"><path d="M10 10H190V90H10Z" fill="#7655dd" stroke="#123456" stroke-width="2"/><circle cx="100" cy="50" r="25" fill="none" stroke="#c75a22" stroke-width="2"/></svg>'},
{id:'svg-css',html:'<svg id="target" viewBox="0 0 200 100"><path class="paint" d="M10 10H190V90H10Z"/></svg>',css:'.paint{fill:#7655dd!important;stroke:#123456!important;stroke-width:2px!important;stroke-dasharray:2 3!important}'},
{id:'shape-rect',html:'<svg id="target" data-hs-shape="rect" viewBox="0 0 200 100"><rect width="200" height="100" fill="#7655dd"/></svg>'},
{id:'shape-line',html:'<svg id="target" viewBox="0 0 200 100"><line x1="10" y1="50" x2="190" y2="50" stroke="#7655dd" stroke-width="2"/></svg>'},
{id:'container',html:'<div id="target"><div class="child">A</div><div class="child">B</div></div>'},
{id:'flex',html:'<div id="target" class="flex"><div class="child">A</div><div class="child">B</div></div>',css:'.flex{display:flex;gap:8px}'},
{id:'grid',html:'<div id="target" class="grid"><div class="child">A</div><div class="child">B</div><div class="child">C</div></div>',css:'.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}'},
{id:'transformed',html:'<div class="transform-host"><div id="target"><div class="child">变换父容器</div></div></div>',css:'.transform-host{position:absolute;left:80px;top:60px;width:600px;height:400px;transform:rotate(15deg) scale(.8);transform-origin:0 0}'},
{id:'table-cell',html:'<table class="host"><tbody><tr><td id="target" class="cell">表格单元格</td><td>另一列</td></tr></tbody></table>',css:'table.host{table-layout:fixed;width:500px;border-collapse:separate}#target.cell{position:static;width:220px;height:80px}td{border:1px solid #aaa}'},
{id:'input',html:'<input id="target" value="静态输入框">'},
{id:'textarea',html:'<textarea id="target">多行文本内容</textarea>'},
{id:'select',html:'<select id="target"><option>选项一</option><option>选项二</option></select>'},
{id:'pseudo',html:'<div id="target">带伪元素</div>',css:'#target::before{content:"★ ";color:#d45f18}#target::after{content:" 完成";font-size:12px}'},
];
export function fixture(type){return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:960px;height:720px;background:white;font:18px Arial,sans-serif}#target{position:absolute;left:120px;top:100px;width:220px;height:100px;margin:0;border:2px solid #334455;padding:6px;background:#f2f3f6;color:#223344;line-height:24px;font-weight:400;font-size:18px}#target.inline{position:static;display:inline;width:auto;height:auto;padding:0;border:0}.host{position:absolute;left:120px;top:100px;width:500px}.child{width:45px;min-height:25px;background:#adcfe7;padding:3px}.transform-host #target{left:60px;top:40px}${type.css||''}</style></head><body>${type.html}</body></html>`}
export const cssProps=['display','position','width','height','boxSizing','fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textAlign','color','backgroundColor','backgroundImage','opacity','rotate','translate','borderRadius','borderTopColor','borderTopWidth','borderTopStyle','boxShadow','fill','stroke','strokeWidth','strokeDasharray','paddingTop','gap','flexDirection','alignItems','justifyContent','flexWrap','gridTemplateColumns','visibility','overflow'];
export const visualState=(root,props)=>{const doc=root.ownerDocument,w=doc.defaultView;return[root,...root.querySelectorAll('*')].filter(el=>!el.matches('script,style,link,[data-hs-runtime]')).map(el=>{const s=w.getComputedStyle(el),r=el.getBoundingClientRect(),styles=Object.fromEntries(props.map(p=>[p,s[p]]));return{tag:el.localName,text:el.children.length?null:el.textContent,styles,rect:{x:r.x,y:r.y,width:r.width,height:r.height},before:{content:w.getComputedStyle(el,'::before').content,color:w.getComputedStyle(el,'::before').color},after:{content:w.getComputedStyle(el,'::after').content,color:w.getComputedStyle(el,'::after').color}}})};
