import { bundledFontSources, bundledFontStylesheets } from './template-font-data.js';
import { fontLibrary } from './font-cache.js';

const templateFontCaches = new WeakMap();
const decodeFontURL = value => value.replace(/&amp;/g, '&');
const fontIdsByURL = new Map(Object.entries(bundledFontSources).map(([id, source]) => [source.url, id]));
const fontSourcePattern = /(?:url|local)\(\s*(["'])(studio-font:[a-f0-9]{64}|https:\/\/fonts\.gstatic\.com\/[^"']+)\1\s*\)/g;
function sourceId(value) { return value.startsWith('studio-font:') ? value.slice(12) : fontIdsByURL.get(value); }
function mapFontCSS(input, transform) {
  const css = text => text.split(/(\/\*[\s\S]*?\*\/)/g).map((part,index)=>index%2 ? part : transform(part)).join('');
  if (!/<(?:!doctype|html\b|head\b|body\b|style\b|script\b)/i.test(input)) return css(input);
  return input.split(/(<script\b[^>]*>[\s\S]*?<\/script\s*>|<!--[\s\S]*?-->)/gi)
    .map((part,index)=>index%2 ? part : part.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,(_,open,text,close)=>open+css(text)+close)).join('');
}
export function templateFontIds(html) {
  const ids = new Set();
  mapFontCSS(html, css => { for (const match of css.matchAll(fontSourcePattern)) { const id=sourceId(match[2]); if (bundledFontSources[id]) ids.add(id); } return css; });
  return [...ids];
}

// Exact, known template stylesheet URLs only. Unknown imported webfonts retain
// their original behavior instead of silently changing to a different font.
export function replaceTemplateFontLinks(html) {
  if (!html.includes('fonts.googleapis.com')) return html;
  let replaced = false;
  const protectedBlocks = /(<script\b[^>]*>[\s\S]*?<\/script\s*>|<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/)/gi;
  const parts = html.split(protectedBlocks);
  for (let index = 0; index < parts.length; index += 2) {
    parts[index] = parts[index].replace(/<link\b[^>]*>/gi, tag => {
    const url = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    const sheet = bundledFontStylesheets[decodeFontURL(url || '')];
    if (!sheet || !/\brel\s*=\s*["']stylesheet["']/i.test(tag)) return tag;
    replaced = true;
    return `<style data-studio-bundled-fonts="true">${sheet.css}</style>`;
  });
    parts[index] = parts[index].replace(/@import\s+(?:url\(\s*)?(["'])(https:\/\/fonts\.googleapis\.com\/[^"']+)\1\s*\)?\s*;/gi, (original, quote, url) => {
    const sheet = bundledFontStylesheets[decodeFontURL(url)];
    if (!sheet) return original;
    replaced = true;
    return sheet.css;
  });
  }
  if (replaced) for (let index = 0; index < parts.length; index += 2) parts[index] = parts[index].replace(/<link\b[^>]*>/gi, tag =>
    /\brel\s*=\s*["'](?:preconnect|dns-prefetch)["']/i.test(tag) &&
    /\bhref\s*=\s*["']https:\/\/fonts\.(?:googleapis|gstatic)\.com\/?["']/i.test(tag) ? '' : tag);
  return parts.join('');
}

export function localizeTemplateFonts(html, assets, replacements) {
  html = replaceTemplateFontLinks(html);
  let cache = templateFontCaches.get(assets);
  if (!cache) { cache = new Map(); templateFontCaches.set(assets, cache); }
  return mapFontCSS(html, css => css.replace(fontSourcePattern, (original, quote, source) => {
    const id = sourceId(source);
    if (!bundledFontSources[id]) return original;
    const blob = fontLibrary.blob(id);
    // A deliberately unavailable local face uses the template's fallback stack
    // without launching duplicate browser downloads outside the bounded queue.
    if (!blob) return `local("studio-font:${id}")`;
    let url = cache.get(id);
    if (!url || !assets.entries.has(url)) {
      url = assets.add(blob);
      cache.set(id, url);
    }
    const value = `url("${url}")`;
    replacements?.push([original, value]);
    return value;
  }));
}

export function onlineTemplateFonts(html) {
  return mapFontCSS(html, css => css.replace(fontSourcePattern, (original, quote, source) => {
    const id = sourceId(source);
    return bundledFontSources[id] ? `url("${bundledFontSources[id].url}")` : original;
  }));
}

export function watchTemplateFontPreview(frame, html, assets, options) {
  let localized = localizeTemplateFonts(html, assets);
  const preview = assets.preview(frame, localized, options);
  const refresh = () => {
    const pairs = [];
    localized = localizeTemplateFonts(localized, assets, pairs);
    if (pairs.length) preview.updateCSS(pairs, assets.references(pairs.map(p=>p[1]).join('')));
  };
  const unsubscribe = fontLibrary.subscribe(refresh);
  fontLibrary.request(templateFontIds(localized));
  const cancel = () => { unsubscribe(); preview(); };
  cancel.html = localized;
  cancel.inspect = preview.inspect;
  return cancel;
}
