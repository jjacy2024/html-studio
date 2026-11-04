// Artificial examples only; no report content or source scripts are copied here.
export const categories=['4月','5月','6月'];
export const values=[[1100,1020],[1350,1210],[1750,1630]];
export function chartSVG({horizontal=false,categoryColors=false}={}) {
  const zero=horizontal?120:430,far=horizontal?500:50;
  const ticks=[0,500,1000,1500,2000].map(n=>{
    const p=zero+n*(far-zero)/2000;
    return horizontal?`<line x1="${p}" x2="${p}" y1="30" y2="330" stroke="#000"/><text x="${p}" y="360" text-anchor="middle" font-size="20">${n.toLocaleString('en-US')}</text>`:`<line x1="95" x2="1075" y1="${p}" y2="${p}" stroke="#000" stroke-dasharray="5 7"/><text x="80" y="${p+7}" text-anchor="end" font-size="23">${n.toLocaleString('en-US')}</text>`;
  }).join('');
  const rows=categoryColors?values.map(row=>row.slice(0,1)):values;
  const bars=rows.map((row,r)=>row.map((n,c)=>{
    const length=n*.19,tip=horizontal?zero+length:zero-length;
    const fill=categoryColors?['#FE90E8','#C0F7FE','#99E885'][r]:c?'#FE90E8':'#FFFDF5';
    return horizontal?`<rect x="120" y="${50+r*90+c*30}" width="${length}" height="22" fill="${fill}" stroke="#000" stroke-width="3"><title>示例 ${r} ${c}</title></rect><text x="${tip+12}" y="${66+r*90+c*30}" font-size="20">${n.toLocaleString('en-US')}</text>`:`<rect x="${150+r*300+c*100}" y="${tip}" width="80" height="${length}" fill="${fill}" stroke="#000" stroke-width="3"><title>示例 ${r} ${c}</title></rect><text x="${190+r*300+c*100}" y="${tip-16}" font-size="27" font-weight="800" text-anchor="middle">${n.toLocaleString('en-US')}</text>`;
  }).join('')+(horizontal?`<text x="100" y="${(categoryColors?61:76)+r*90}" text-anchor="end" font-size="22">${categories[r]}</text>`:`<text x="${(categoryColors?190:240)+r*300}" y="480" text-anchor="middle" font-size="28">${categories[r]}</text>`)).join('');
  return `<svg id="sales-chart" viewBox="0 0 ${horizontal?'600 390':'1120 510'}" width="${horizontal?600:1120}" height="${horizontal?390:510}" role="img" aria-label="模拟数据示例">${ticks}${bars}</svg>`;
}
export const chartHTML=({horizontal=false,slides=false}={})=>`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>SVG 柱状图数据编辑示例</title><style>body{margin:0;padding:32px;background:#edf1f4;font-family:Arial,sans-serif}h1{font-size:28px}.card{padding:24px;background:#fff;border:2px solid #000;width:900px}svg{display:block;max-width:100%;height:auto}.legend{display:flex;gap:20px;margin-bottom:16px}.legend i{display:inline-block;width:14px;height:14px;border:1px solid;margin-right:6px}.slide{width:1020px;height:800px;background:#edf1f4}.slide:not(.active){display:none}</style></head><body>${slides?'<main data-deck><section class="slide active" id="page-one">':''}<h1>修改柱形数据 · 保留 SVG 样式</h1><p>此文件仅含人工模拟数据。导入 HTML Studio 后双击柱子，确认绑定，再修改数值。</p><div class="card"><div class="legend"><span><i style="background:#FFFDF5"></i>预算</span><span><i style="background:#FE90E8"></i>实际</span></div>${chartSVG({horizontal})}</div><p id="independent">独立说明与其他表格不会自动联动。</p><table id="unrelated"><tr><td>合计</td><td>3860</td></tr></table><script type="application/json" id="ledger">{"independent":3860}</script>${slides?'</section><section class="slide" id="page-two"><h1>另一页</h1></section></main>':''}</body></html>`;
