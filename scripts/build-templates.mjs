import {templateNavigation} from './template-adapters/navigation.js';
import {chromium} from 'playwright';
import {adaptTemplateCharts} from './template-adapters/charts.js';
import {bindTemplateCanvases,templateCanvasMotion} from './template-adapters/canvas.js';
import {renderTemplateChart,templateChartMotion} from '../dist/template-charts-core.js';
import {chartJSDataRuntime} from '../dist/canvas-charts.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceTemplateFontLinks } from '../dist/template-fonts.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(root, '../downloads/beautiful-html-templates-34');
const license = await fs.readFile(path.join(source, 'LICENSE'), 'utf8');
const library = [],chartInventory=[];
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
await page.addScriptTag({content:`window.adaptTemplateCharts=${adaptTemplateCharts};window.renderTemplateChart=${renderTemplateChart};window.bindTemplateCanvases=${bindTemplateCanvases};`});
for (const slug of (await fs.readdir(path.join(source, 'templates'), {withFileTypes:true})).filter(e => e.isDirectory()).map(e => e.name).sort()) {
  const folder = path.join(source, 'templates', slug);
  const metadata = JSON.parse(await fs.readFile(path.join(folder, 'template.json'), 'utf8'));
  let html = await fs.readFile(path.join(folder, 'template.html'), 'utf8');
  html = replaceTemplateFontLinks(html);
  if (slug === 'daisy-days') {
    const navigation = await fs.readFile(path.join(root, 'scripts/template-adapters/daisy-days.js'), 'utf8');
    html = html.replace(/<script>\s*const container=document\.getElementById\('slideContainer'\);[\s\S]*?<\/script>/, () => `<script>${navigation}</script>`);
  }
  const count = [...html.matchAll(/<(?:section|div)\b[^>]*class=["']([^"']*)["'][^>]*>/gi)].filter(m => m[1].split(/\s+/).includes('slide')).length;
  if (count) metadata.slide_count = count;
  // The supplied library has local classic scripts; inline them for file:// use.
  for (const match of [...html.matchAll(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi)]) {
    const chart = /^https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js(?:@[^/]+)?(?:\/.*)?$/.test(match[2]);
    if (!chart && /^(https?:|\/\/|data:)/i.test(match[2])) continue;
    const filename = chart ? path.join(root, 'dist/vendor/chart.umd.js') : path.resolve(folder, match[2]);
    if (!chart && !filename.startsWith(folder + path.sep)) throw Error('Invalid local template reference');
    const code = await fs.readFile(filename, 'utf8');
    html = html.replace(match[0], () => `<script${match[1]}${match[3]}>${code.replace(/<\/script/gi, '<\\/script')}</script>`);
  }
  if(['grove','broadside','monochrome','signal','studio','mat','vellum'].includes(slug))html=html.replace(/function goTo\(index(?:, instant)?\) \{/,m=>`window.presentation={slides,showSlide:index=>{${['broadside','monochrome'].includes(slug)?'isAnimating=false;':''}goTo(index,true)}};\n        ${m}`);
  if(slug==='8-bit-orbit')html=html.replaceAll("'#barChart .chart-bar'","'#barChart .chart-bar:not([data-studio-tc-key])'").replaceAll("'#barChart .chart-value'","'#barChart .chart-value:not([data-studio-tc-key])'").replaceAll("'#hbarChart .hbar-fill'","'#hbarChart .hbar-fill:not([data-studio-tc-key])'");
  const adapted=await page.evaluate(({html,slug})=>{const doc=new DOMParser().parseFromString(html,'text/html');const charts=window.adaptTemplateCharts(doc,slug,window.renderTemplateChart),canvases=window.bindTemplateCanvases(doc,slug);return{html:'<!doctype html>\n'+doc.documentElement.outerHTML,charts:[...charts,...canvases],canvas:canvases.length};},{html,slug});
  html=adapted.html.replace('</body>',()=>`<script data-studio-template-navigation="1">(${templateNavigation})();</script></body>`);chartInventory.push({slug,charts:adapted.charts});
  if(adapted.canvas)html=html.replace(/<head[^>]*>/i,m=>m+`<script data-studio-chartjs-runtime="1">(${chartJSDataRuntime})({});</script>`);
  if(adapted.charts.length)html=html.replace('</body>',()=>`<script data-studio-template-motion-runtime="1">(${templateChartMotion})(${renderTemplateChart});${adapted.canvas?`(${templateCanvasMotion})();`:''}</script></body>`);
  html = html.replace(/<head[^>]*>/i, m => `${m}\n<!-- beautiful-html-templates\n${license}\n-->`);
  library.push({ ...metadata, slug, html, online: /https?:\/\//i.test(html.replace(/<!--[\s\S]*?-->/g, '')) });
}
await browser.close();
await fs.mkdir(path.join(root,'qa/template-chart-inventory'),{recursive:true});
await fs.writeFile(path.join(root,'qa/template-chart-inventory/bound.json'),JSON.stringify(chartInventory,null,2));
if (library.length !== 34) throw Error(`Expected 34 templates, found ${library.length}`);
await fs.writeFile(path.join(root, 'dist/templates.js'), `// Generated from the user-supplied MIT template library.\nexport const templateLibrary = ${JSON.stringify(library)};\n`);
console.log(`Bundled ${library.length} templates (${Buffer.byteLength(JSON.stringify(library))} bytes).`);
