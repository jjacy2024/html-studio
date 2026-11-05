import {chromium} from 'playwright';import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {templateLibrary} from '../dist/templates.js';
const dir='qa/template-chart-motion';await fs.mkdir(dir,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),results=[],errors=[];
await context.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());page.on('pageerror',e=>errors.push(e.message));
try{for(const t of templateLibrary.filter(t=>!process.env.TEMPLATE_FILTER||process.env.TEMPLATE_FILTER.split(',').includes(t.slug))){let html;try{html=await fs.readFile(`qa/template-charts/${t.slug}.html`,'utf8');}catch{html=t.html;}
 const url=`http://127.0.0.1:4389/__motion__/${t.slug}`;await page.route(url,r=>r.fulfill({body:html,contentType:'text/html'}));await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.deck?.show||window.presentation?.showSlide||!document.querySelector('[data-studio-template-chart],canvas[data-studio-template-motion]'));
 const count=await page.locator('[data-studio-template-chart],canvas[data-studio-template-motion]').count();
 for(let i=0;i<count;i++){try{
  const result=await page.evaluate(async i=>{
   const root=document.querySelectorAll('[data-studio-template-chart],canvas[data-studio-template-motion]')[i],slides=[...document.querySelectorAll('.slide,deck-stage>section')],at=slides.findIndex(s=>s.contains(root));
   const navigate=n=>{if(window.deck?.show)window.deck.show(n);else if(window.presentation?.showSlide)window.presentation.showSlide(n);else throw Error('No navigation bridge');};
   if(at>=0){navigate(at?0:Math.min(1,slides.length-1));await new Promise(r=>setTimeout(r,550));}
   const m=root.hasAttribute('data-studio-template-chart')?JSON.parse(root.getAttribute('data-studio-template-chart')):null;
   function sample(){if(!m){const chart=window.Chart?.getChart(root),e=chart?.getDatasetMeta(0)?.data[0];return e?chart.config.type==='bar'?Math.abs(e.base-e.y):['pie','doughnut','polarArea'].includes(chart.config.type)?e.endAngle-e.startAngle:e.y:null;}
    const item=m.items[0],get=k=>root.querySelector(`[data-studio-tc-key="${k}"]`),a=item.actions?.[0];
    if(a){const n=get(a.key);return parseFloat(a.style?n.style.getPropertyValue(a.style):n.getAttribute(a.attr));}
    if(item.cells)return item.cells.reduce((s,k)=>{const n=get(k);return s+(n.classList.contains('on')?Number(n.style.opacity||1):0)},0);
    if(m.pies?.length){const pie=m.pies[0],n=get(pie.keys?.[0]||pie.key);return pie.type==='ring'?parseFloat(n.getAttribute('stroke-dasharray')):pie.type==='conic'?n.style.backgroundImage:n.getAttribute('d');}
    const group=m.paths.find(g=>g.rows.includes(0)),n=get(group.keys[0]);return n.getAttribute('points')||n.getAttribute('d');
   }
   if(at>=0)navigate(at);const samples=[],start=performance.now();await new Promise(resolve=>{function tick(){samples.push(sample());if(performance.now()-start<2300)requestAnimationFrame(tick);else resolve();}tick();});
   const rect=root.getBoundingClientRect();return{samples,visible:rect.width>0&&rect.height>0&&rect.top<innerHeight&&rect.bottom>0,model:m?JSON.stringify(m):null,unchanged:m?JSON.stringify(m)===root.getAttribute('data-studio-template-chart'):true};
  },i);
  assert(result.visible,'chart visible');assert(result.unchanged,'runtime never saves transient values');const unique=[...new Set(result.samples.filter(x=>x!==null))];assert(unique.length>=3,'multiple animation states: '+unique.length);assert(result.samples.slice(-5).every(x=>x===result.samples.at(-1)),'animation settles');
  results.push({slug:t.slug,index:i,pass:true,sampleCount:result.samples.length,distinctStates:unique.length,first:unique.slice(0,3),last:result.samples.at(-1)});console.log('PASS',t.slug,i,unique.length);
 }catch(e){results.push({slug:t.slug,index:i,pass:false,error:e.stack});console.error('FAIL',t.slug,i,e.message);}}
}
}finally{await fs.writeFile(dir+'/results.json',JSON.stringify({results,errors},null,2));await browser.close();console.log('TOTAL',results.length,'FAIL',results.filter(r=>!r.pass).length,'ERRORS',errors);if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;}
