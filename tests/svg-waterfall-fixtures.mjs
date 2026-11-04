// Synthetic bridge charts. Values do not come from the user's sales report.
export function waterfallSVG({horizontal=false,subtotal=false,gradient=false,ticks=false,labels=true,titles=true,data=false,reverse=false,initialZero=false,values=null,labelDecimals=1,titleDecimals=labelDecimals,totalDecimals=titleDecimals}={}) {
 const rows=[{name:'期初',role:'start',value:initialZero?0:200},{name:'业务A',role:'change',value:80},{name:'业务B',role:'change',value:-30},{name:'业务C',role:'change',value:50}];
 if(values)rows.forEach((b,i)=>b.value=values[i]);
 if(subtotal)rows.splice(3,0,{name:'中途小计',role:'total',value:0});rows.push({name:'期末',role:'total',value:0});
 const colors={start:'#a6e3f5',total:'#a6e3f5',positive:gradient?'url(#up-gradient)':'#9bdb80',negative:'#ed8acb'},parts=[];let sum=0;
 rows.forEach((b,i)=>{const previous=sum;if(b.role==='start')sum=b.value;else if(b.role==='change')sum+=b.value;else b.value=sum;
   const a=b.role==='change'?previous:0,z=sum,length=Math.abs(z-a),cross=100+i*145,fill=colors[b.role==='change'?(b.value>=0?'positive':'negative'):b.role],x=horizontal?100+Math.min(a,z):cross,y=horizontal?cross:450-Math.max(a,z),w=horizontal?length:70,h=horizontal?55:length;
   const formatted=decimals=>(b.value>=0&&b.role==='change'?'+':'')+b.value.toFixed(decimals),value=formatted(labelDecimals),titleValue=formatted(b.role==='total'?totalDecimals:titleDecimals);
   const category=horizontal?`<text x="80" y="${cross+35}" font-size="18" text-anchor="end">${b.name}</text>`:`<text x="${cross+35}" y="490" font-size="18" text-anchor="middle">${b.name}</text>`;
   const label=labels?`<text id="wf-label-${i}" x="${horizontal?x+w+10:cross+35}" y="${horizontal?cross+35:y-15}" font-size="20" font-weight="700" text-anchor="${horizontal?'start':'middle'}">${value}</text>`:'';
   parts.push(`<rect id="wf-bar-${i}" x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="#121212" stroke-width="2" ${data?`data-value="${b.value}" data-waterfall-role="${b.role}"`:''}>${titles?`<title>${b.name}：${titleValue}万元</title>`:''}</rect>${label}${category}`);
   if(i<rows.length-1)parts.push(horizontal?`<line id="wf-line-${i}" x1="${100+sum}" x2="${100+sum}" y1="${cross+55}" y2="${cross+145}" stroke="#121212" stroke-width="2" stroke-dasharray="4 5"/>`:`<line id="wf-line-${i}" x1="${cross+70}" x2="${cross+145}" y1="${450-sum}" y2="${450-sum}" stroke="#121212" stroke-width="2" stroke-dasharray="4 5"/>`);
 });
 const crossEnd=100+(rows.length-1)*145+70;
 const baseline=horizontal?`<line x1="100" x2="100" y1="80" y2="${crossEnd+20}" stroke="black"/>`:`<line x1="80" x2="${crossEnd+20}" y1="450" y2="450" stroke="black"/>`;
 const grid=ticks?[100,200,300,400].map(v=>horizontal?`<line x1="${100+v}" x2="${100+v}" y1="80" y2="${crossEnd+20}" stroke="#ccc"/><text x="${100+v}" y="${crossEnd+50}" text-anchor="middle" font-size="16">${v}</text>`:`<line x1="80" x2="${crossEnd+20}" y1="${450-v}" y2="${450-v}" stroke="#ccc"/><text x="60" y="${457-v}" text-anchor="end" font-size="16">${v}</text>`).join(''):'';
 if(reverse)parts.reverse();
 return `<svg id="waterfall" viewBox="0 0 ${horizontal?`680 ${crossEnd+80}`:`${crossEnd+50} 540`}" width="${horizontal?680:crossEnd+50}" height="${horizontal?crossEnd+80:540}" role="img" aria-label="人工增量桥"><defs><linearGradient id="up-gradient"><stop stop-color="#63b98b"/><stop offset="1" stop-color="#b6ec9f"/></linearGradient></defs>${baseline}${grid}${parts.join('')}</svg>`;
}
export function waterfallHTML(options={}) {return `<!doctype html><html><meta charset="utf-8"><title>SVG 瀑布图示例</title><style>body{margin:28px;background:#f6f3e9;font:16px Arial}svg{max-width:100%;height:auto;display:block;background:white;border:2px solid #111}h1{font-size:24px}</style><h1>SVG 瀑布图：起始值 + 正负增量 = 终值</h1><p>人工示例。双击柱子确认绑定，修改数据后观察后续柱形、连接线和终值。</p>${waterfallSVG(options)}<p id="independent">独立说明与其他表格不会自动改动。</p></html>`;}
