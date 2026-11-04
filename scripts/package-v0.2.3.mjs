import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.2-20261029');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.3-20261029');
const qa=path.join(root,'qa/templates-grouping-v0.2.3');
const report=JSON.parse(await fs.readFile(path.join(root,'qa/latest/all-results.json'),'utf8'));
if(report.failedSuites || !report.suites.find(s=>s.name==='templates-grouping'&&s.cases.length===12&&s.pass)) throw Error('Current full regression has not passed');
await fs.mkdir(folder); // Never overwrite an existing release.
await fs.mkdir(path.join(folder,'示例文件'));
await fs.copyFile(path.join(root,'HTML Studio.html'),path.join(folder,'HTML Studio.html'));
for(const name of ['02-测试反馈.txt','04-第三方许可.txt']) await fs.copyFile(path.join(previous,name),path.join(folder,name));
const feedback=await fs.readFile(path.join(folder,'02-测试反馈.txt'),'utf8');
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),feedback.replace(/v0\.2\.\d+/g,'v0.2.3')+'\n本轮重点：顶部从模板新建入口；模板列表封面和右侧预览；已有组合、普通导入容器、导出再导入容器的拆散；取消确认和撤回恢复。\n');
for(const name of ['01-静态页面与动效.html','02-三页演示稿.html','03-表格公式与关联图表.html'])
  await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
const originalIntro=await fs.readFile(path.join(previous,'01-开始使用.txt'),'utf8');
await fs.writeFile(path.join(folder,'01-开始使用.txt'),originalIntro.replaceAll('v0.2.2','v0.2.3').replaceAll('8.6 MB','9.2 MB')+`

v0.2.3 新增入口
- 从模板新建：顶部“导入”左侧；弹窗左侧显示每个模板的第 1 页封面，点击封面可预览并创建。
- 解除组合：选中组合或普通 HTML 容器，在右侧图层区点击“解除组合 / 拆散容器”，也可在图层或画布中右键操作，或按 Command/Ctrl + Shift + G。
- 拆散普通容器、带底色等外观的组合、或文档流布局时，会先说明影响。父容器转换为自由布局后响应式行为会改变；容器自身装饰和裁剪会移除，可撤回恢复。
- 含直接文字、隐藏直接子图层、锁定后代或三维变换的容器会提示原因，不直接拆散。表格、图表、整页和 SVG 内部结构保留。
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.2.3 · 模板封面与容器拆散

1. 顶部导入左侧增加“从模板新建”入口，原左下角和文件菜单入口仍保留。
2. 模板列表加入全部 34 个模板第一页的封面缩略图。图片总计约 424 KB，直接内嵌，无需网络；列表不运行多个网页预览。右侧实时预览仍可能在字体下载完成前使用系统替代字体。
3. 解除组合现在支持普通 HTML 容器，也支持导出再导入后没有编辑器组合标记的容器。可从属性面板、右键菜单或快捷键操作；支持多容器、二维旋转缩放、SVG 整体子元素，尽量保持位置、尺寸、文字样式和层序。支持撤回及重做。

影响提示：普通文档流、Flex/Grid 会转换为自由布局。容器自身的底色、描边、阴影、裁剪和伪元素会移除；透明度分配可能改变重叠区域。依赖旧容器结构、选择器或 ID 的交互与动效请核对预览。
受保护内容：直接文字、隐藏直接子图层、锁定后代、三维变换、透视、CSS zoom 会说明原因并保持结构；不通过此功能拆散整页、表格、数据图表及 SVG 内部路径。

测试：macOS Chrome 下，包含述职报告和 merchant 文件的完整回归共 ${report.passed} 项通过，0 个失败测试组。本次专项 12 项通过，覆盖 1280px 顶部入口、全部封面、按钮/右键/快捷键操作、布局转换、样式继承、二维变换与 SVG、导出重开、撤回、多选和受保护结构。
这不代表所有 HTML、全部动态脚本、Windows、Safari 或每个视觉细节都通过。此前旋转半透明嵌套 iframe 的预览差异不在此次修复范围。

编辑器单文件约 9.2 MB，继续采用 3 套必要字体内置、其余字体后台下载缓存的方案。原模板和私人 HTML 未修改，包内无私人文件、QA 导出、截图或草稿。
`);
const oldLicenses=await fs.readFile(path.join(previous,'05-字体许可.txt'),'utf8');
await fs.writeFile(path.join(folder,'05-字体许可.txt'),oldLicenses.replaceAll('v0.2.2','v0.2.3'));
const archive=folder+'.zip';
execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]); a=pathlib.Path(str(p)+'.zip')
assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==9
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const bytes=await fs.readFile(path.join(root,'HTML Studio.html'));
const previousBytes=(await fs.stat(path.join(previous,'HTML Studio.html'))).size;
const archiveBytes=await fs.readFile(archive);
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const summary={version:'0.2.3',date:new Date().toISOString(),environment:'macOS Chrome',passed:report.passed,failedSuites:report.failedSuites,
  standalone:{path:path.join(root,'HTML Studio.html'),bytes:bytes.length,sha256:sha(bytes),previousBytes,addedBytes:bytes.length-previousBytes},
  archive:{path:archive,bytes:archiveBytes.length,sha256:sha(archiveBytes),files:9,crcVerified:true,editorMatchesStandalone:true}};
await fs.copyFile(path.join(root,'qa/latest/all-results.json'),path.join(qa,'full-regression-results.json'));
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
