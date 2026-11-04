import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>fs.readFile(path.join(root,'dist',name),'utf8');
let html=await read('index.html');const css=await read('styles.css');
// Keep the full notice available offline in both the source UI and the single file.
const usageLicense=await fs.readFile(path.join(root,'LICENSE'),'utf8');
const licenseMarkup='<template id="usage-license-content"><pre class="usage-license-text">'+usageLicense.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</pre></template>';
if(!html.includes(licenseMarkup))throw Error('dist/index.html usage license must match LICENSE before building');
const modules=[];for(const name of ['icons.js','demo.js','document.js','preview-runtime.js','assets.js','pages.js','compatibility.js','template-font-data.js','font-cache.js','template-fonts.js','preview-session.js','font-ui.js','templates.js','template-covers.js','page-thumbnails.js','page-order.js','authoring.js','grouping.js','fit-content.js','table-editing.js','data-paste.js','data-tools.js','html-share.js','html-bars.js','canvas-charts.js','chart-structure.js','svg-waterfall.js','svg-bubble.js','svg-chart.js','element-operations.js','operations.js','agent-setup.js','agent-bridge.js','app.js']){let source=await read(name);source=source.replace(/^import\s+[\s\S]*?;\s*/gm,'').replace(/^export\s+/gm,'');if(name==='app.js')source='const esc = escapeHTML;\n'+source;modules.push(source)}
const code=modules.join('\n\n').replace(/<\/script/gi,'<\\/script');
html=html.replace(/<link\s+rel="stylesheet"[^>]+>/,'<style>'+css+'</style>');
html=html.replace(/<link\s+rel="icon"[^>]+>/,`<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(await read('favicon.svg')).toString('base64')}">`);
html=html.replace(/<script\s+type="module"\s+src="\.\/app.js"><\/script>/,()=>'<script type="module">\n'+code+'\n</script>');
const out=process.env.STANDALONE_OUTPUT?path.resolve(process.env.STANDALONE_OUTPUT):path.join(root,'HTML Studio.html');
if(process.env.STANDALONE_DIAGNOSTIC){const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));html=html.replaceAll(version,version+' · 诊断版 2');}
await fs.writeFile(out,html);console.log(out);
