// Source inspection only: never execute imported code or fetch remote dependencies.
export async function inspectCompatibility(doc, assets, warnings = []) {
  const issues = [];
  const describe = el => {
    const name = el.id ? `#${el.id}` : el.getAttribute('aria-label') || el.getAttribute('title') || '';
    return (el.localName + (name ? ' · ' + name : '')).slice(0, 100);
  };
  const add = (code, title, nodes, editing, preview, examples) => {
    if (!nodes.length) return;
    issues.push({code, title, count:nodes.length, editing, preview,
      examples:(examples || nodes.map(describe)).slice(0, 3)});
  };
  const query = selector => [...doc.querySelectorAll(selector)].filter(el => !el.closest('[data-hs-runtime]'));
  add('canvas', 'Canvas / 绘制图形', query('canvas'),
    '可通过“编辑图表数据…”绑定 Chart.js 3/4 普通柱状图，保留样式修改数值。其他 Canvas 只能调整整体外框；绑定前或不支持时通常为空白区域。',
    '需要原脚本成功运行才能绘制。WebGL、外部数据或资源依赖可能使图形无法显示。');
  add('embedded', '嵌入页面或外部对象', query('iframe,object,embed'),
    '不支持编辑嵌入内容内部的元素；iframe 可选择并调整整体外框。可能显示原内容、空白或加载错误。',
    '取决于资源是否可用、网站是否允许嵌入及脚本权限。复杂旋转和透明度下也可能有显示差异，请核对导出。');
  const custom = query('body *').filter(el => el.localName.includes('-') || el.hasAttribute('is'));
  const shadow = query('template[shadowrootmode]');
  add('components', '自定义组件 / Shadow DOM', [...custom, ...shadow],
    '仅源 HTML 中已有的普通节点可编辑；组件内部和脚本生成的结构不会自动成为图层，可能只显示占位内容或空白。',
    '需要组件脚本及依赖成功加载，不保证与原网站一致。');
  const scripts = query('script').filter(el => {
    const type = (el.getAttribute('type') || '').trim().toLowerCase().split(';')[0];
    return !type || type === 'module' || /^(text|application)\/(x-)?(java|ecma)script$/.test(type);
  });
  const moduleScripts = scripts.filter(el => el.getAttribute('type')?.trim().toLowerCase() === 'module');
  add('modules', '模块脚本', moduleScripts,
    '编辑时不运行模块；由模块生成的内容不会出现为可编辑图层。',
    '相对模块导入、构建环境和跨域要求可能导致模块无法启动。');
  // Bound scanning cost even for bundled libraries and huge data URLs.
  let remaining = 2 * 1024 * 1024, partial = false;
  const dynamic = [], context = [], network = [], unread = [];
  for (const script of scripts) {
    const limit = Math.min(256 * 1024, remaining);
    let code = '';
    const src = script.getAttribute('src');
    if (src) {
      const blob = assets?.entries.get(src)?.blob;
      if (blob && limit > 0) {
        code = await blob.slice(0, limit).text();
        if (blob.size > limit) partial = true;
      } else { unread.push(script); partial = true; }
    } else {
      const text = script.textContent || '';
      code = text.slice(0, limit);
      if (text.length > limit) partial = true;
    }
    remaining = Math.max(0, remaining - code.length);
    if (/\b(?:createElement|insertAdjacentHTML)\s*\(|\.innerHTML\s*=|\bdocument\s*\.\s*write\s*\(|\b(?:createRoot|createApp)\s*\(|\bReactDOM\s*\.|\bnew\s+Vue\b/.test(code)) dynamic.push(script);
    if (/\b(?:localStorage|sessionStorage|indexedDB)\b|\bdocument\s*\.\s*cookie\b|\bhistory\s*\.\s*(?:pushState|replaceState)\b|\bwindow\s*\.\s*open\s*\(|\b(?:location|top)\s*\.\s*(?:href|assign|replace)\b/.test(code)) context.push(script);
    if (/\b(?:fetch|WebSocket|EventSource)\s*\(|\bXMLHttpRequest\b/.test(code)) network.push(script);
  }
  add('dynamic', '可能由脚本生成的内容', dynamic,
    '检测到创建或替换页面内容的代码。运行后才生成的列表、图表等不在静态图层中；原 HTML 留下的结构仍可编辑。',
    '仅在预览时运行这些脚本；是否能显示还取决于资源和运行环境。');
  add('browser-context', '依赖存储、导航或弹窗的脚本', context,
    '只能编辑原 HTML 中已有的静态内容。',
    '隔离预览不提供原网站的登录和存储环境，部分存储、导航和弹窗操作会被限制，相关功能可能不可用。');
  add('network', '可能依赖接口或外部数据', network,
    '请求后生成的数据不会自动成为可编辑图层。',
    '接口、登录、网络或跨域条件不满足时，列表或图表可能空白。');
  if (scripts.length && !dynamic.length && !context.length && !network.length && !moduleScripts.length) {
    add('scripts', '脚本交互需核对', scripts,
      '编辑时脚本暂停。若内容由脚本生成，会暂时缺失；已有静态内容仍可编辑。',
      '支持常见轻量交互，但静态检测无法确认脚本是否运行成功，请打开预览检查。');
  }
  add('motion-pages', '动态加载的局部页面', query('[data-motion-src]'),
    '编辑态不加载脚本引入的子页面，区域可能显示原占位内容或空白。',
    '未自动打包子页面内部依赖，预览和导出可能缺少局部内容。');
  const pseudo = query('style').filter(el => /::?(?:before|after)\b/i.test(el.textContent));
  add('pseudo', 'CSS 生成的装饰或文字', pseudo,
    '伪元素随原样式显示，但不是独立图层；不能直接选中修改其内容。',
    '通常能按原 CSS 显示；修改宿主或样式关系后请核对。');
  const missing = warnings.filter(w => /^未找到(?:资源|样式)：/.test(w));
  add('missing-resources', '缺少配套资源', missing,
    '图片、字体、样式或脚本未能随文件导入，可能出现破图、替代字体、无样式内容或空白。',
    '缺少的资源可能同样影响预览与导出。请通过“导入 HTML 资源目录”重新选择包含配套文件的目录。', missing.map(w => w.slice(0, 160)));
  const remote = query('[src],[href],[poster],[data-hs-pending-stylesheet]').filter(el => {
    if (el.matches('a,area,base')) return false;
    return ['src','href','poster','data-hs-pending-stylesheet'].some(a => /^(?:https?:)?\/\//i.test(el.getAttribute(a) || ''));
  });
  const remoteStyles = query('style,[style]').filter(el => /(?:url\(\s*["']?|@import\s*["'])(?:https?:)?\/\//i.test(el.localName === 'style' ? el.textContent : el.getAttribute('style')));
  add('remote-resources', '依赖在线资源', [...remote, ...remoteStyles],
    '离线、资源失效或跨域受限时，图片、字体和样式可能不完整。',
    '预览和导出仍可能需要联网；本次检测不会请求这些地址来确认可用性。');
  const srcset = query('[srcset]');
  add('responsive-images', '响应式图片资源', srcset,
    '已导入常见 src 资源，但 srcset 中的备选图片未自动打包。',
    '浏览器切换图片尺寸时可能选到缺失资源，请核对不同画布尺寸。');
  const delayedStyles = warnings.filter(w => w.includes('外部样式加载超时'));
  add('styles-timeout', '样式加载超时', delayedStyles,
    '当前画布暂用已加载样式，布局可能与原页面不同。',
    '原始样式引用会保留；可联网或补齐资源后重新导入检查。', ['外部样式未在等待时间内完成']);
  if (partial) issues.push({code:'partial-scan',title:'部分脚本未完整检查',count:unread.length,
    editing:'远程或未打包的脚本没有读取；大体积脚本只扫描了部分代码，可能还有未识别的动态内容。',
    preview:'这是源文件兼容性提示，不是实际运行验证；请预览并检查导出文件。',examples:unread.slice(0,3).map(describe)});
  return {issues, partial, checkedAt:new Date().toISOString()};
}
