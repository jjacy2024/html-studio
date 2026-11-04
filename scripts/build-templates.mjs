import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceTemplateFontLinks } from '../dist/template-fonts.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(root, '../downloads/beautiful-html-templates-34');
const license = await fs.readFile(path.join(source, 'LICENSE'), 'utf8');
const library = [];
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
  html = html.replace(/<head[^>]*>/i, m => `${m}\n<!-- beautiful-html-templates\n${license}\n-->`);
  library.push({ ...metadata, slug, html, online: /https?:\/\//i.test(html.replace(/<!--[\s\S]*?-->/g, '')) });
}
if (library.length !== 34) throw Error(`Expected 34 templates, found ${library.length}`);
await fs.writeFile(path.join(root, 'dist/templates.js'), `// Generated from the user-supplied MIT template library.\nexport const templateLibrary = ${JSON.stringify(library)};\n`);
console.log(`Bundled ${library.length} templates (${Buffer.byteLength(JSON.stringify(library))} bytes).`);
