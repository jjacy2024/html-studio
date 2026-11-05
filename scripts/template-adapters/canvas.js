export function bindTemplateCanvases(doc,slug) {
  const specs={
    cartesian:[['barChart','bar',['Q1','Q2','Q3','Q4'],['Revenue','Target'],[[2.4,3.1,3.8,4.5],[2.5,3,3.5,4.2]]],['lineChart','line',['2020','2021','2022','2023','2024','2025'],['Market Share','Industry Average'],[[12,18,25,34,42,51],[10,14,19,24,30,36]]]],
    coral:[['growthChart','bar',['Jan','Feb','Mar','Apr','May','Jun'],['Revenue (K)','Target (K)'],[[45,62,55,78,95,112],[50,58,65,72,85,100]]]],
    'retro-windows':[['barChart','bar',['Q1','Q2','Q3','Q4'],['Revenue ($M)'],[[1.2,1.5,1.9,2.1]]],['pieChart','doughnut',['Enterprise','Mid-Market','Small Business','Government'],['系列 1'],[[42,28,18,12]]],['lineChart','line',['Jan','Feb','Mar','Apr','May','Jun'],['Active Users (K)'],[[42,48,55,62,71,78]]]]
  };
  for(const [id,type,labels,series,values]of specs[slug]||[]){const node=doc.getElementById(id);if(!node)throw Error('Missing canvas '+slug+'/'+id);node.setAttribute('data-studio-chartjs',JSON.stringify({version:1,type,labels,series,values,rowSources:labels.map((_,i)=>i),seriesSources:series.map((_,i)=>i)}));node.setAttribute('data-studio-template-motion','1');}
  return (specs[slug]||[]).map(([id,type,labels,series])=>({kind:'chartjs-'+type,items:labels.length*series.length,relative:false,id}));
}
export function templateCanvasMotion(){
  const states=new WeakMap(),timer=setInterval(()=>{if(document.hidden)return;for(const canvas of document.querySelectorAll('canvas[data-studio-template-motion]')){const chart=window.Chart?.getChart?.(canvas);if(!chart)continue;const r=canvas.getBoundingClientRect();let on=r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;for(let n=canvas;on&&n;n=n.parentElement){const s=getComputedStyle(n);if(s.visibility==='hidden'||s.display==='none'||Number(s.opacity)===0)on=false;}if(on&&!states.get(canvas)){chart.stop();chart.options.animation=matchMedia('(prefers-reduced-motion: reduce)').matches?false:{duration:900};chart.resize();chart.reset();chart.update();}states.set(canvas,on);}},120);
  addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
