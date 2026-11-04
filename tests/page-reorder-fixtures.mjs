export function reorderFixture(count = 6) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>页面排序测试</title><style>
  body{margin:0;font:24px system-ui;background:#eae6f1}.slide{position:absolute;width:960px;height:540px;display:none;padding:60px;box-sizing:border-box;background:#f7f1ff;border:5px solid #252031}.slide.active{display:block}h1{color:#6943a0}button{font:inherit}
  </style></head><body><main data-deck><aside id="before">页面排序示例</aside>${Array.from({length:count},(_,i)=>`<section class="slide ${i===0?'active':''}" id="page-${i+1}" data-title="示例页面 ${i+1}"><h1>页面 ${i+1}</h1><p>每一页的内容和样式在排序后保持不变。</p><svg width="160" height="80"><defs><linearGradient id="g${i+1}"><stop stop-color="#a887e8"/><stop offset="1" stop-color="#fa9ba8"/></linearGradient></defs><rect width="160" height="80" fill="url(#g${i+1})"/></svg></section>${i===1?'<aside id="between" hidden>非页面节点</aside>':''}`).join('')}<aside id="after" hidden>末尾节点</aside></main><script>
  window.deck={slides:[...document.querySelectorAll('.slide')],index:0,show(index){this.index=Math.max(0,Math.min(this.slides.length-1,index));this.slides.forEach((s,i)=>s.classList.toggle('active',i===this.index))}};
  document.addEventListener('keydown',e=>{if(e.key==='ArrowRight')deck.show(deck.index+1);if(e.key==='ArrowLeft')deck.show(deck.index-1)});deck.show(0);
  </script></body></html>`;
}
