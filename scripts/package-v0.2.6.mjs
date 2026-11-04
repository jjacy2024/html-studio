import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const previous=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.5-20261030');
const folder=path.join(root,'releases/HTML-Studio-同事测试包-v0.2.6-20261030');
const qa=path.join(root,'qa/layer-ui-v0.2.6');
const report=JSON.parse(await fs.readFile(path.join(qa,'regression.json'),'utf8'));
const ui=JSON.parse(await fs.readFile(path.join(qa,'ui-verification.json'),'utf8'));
if(report.version!=='0.2.6'||report.failedSuites||report.suites.length!==5||!ui.rightLayerActionsRemoved||!ui.reorderCopyDeleteUndo||ui.errors.length)throw Error('Layer UI validation must pass');
await fs.mkdir(folder);await fs.mkdir(path.join(folder,'示例文件'));
await fs.copyFile(path.join(root,'HTML Studio.html'),path.join(folder,'HTML Studio.html'));
for(const name of ['04-第三方许可.txt','05-字体许可.txt'])await fs.copyFile(path.join(previous,name),path.join(folder,name));
for(const name of ['01-静态页面与动效.html','02-三页演示稿.html','03-表格公式与关联图表.html','04-SVG柱状图原样式数据编辑.html'])await fs.copyFile(path.join(previous,'示例文件',name),path.join(folder,'示例文件',name));
const intro=(await fs.readFile(path.join(previous,'01-开始使用.txt'),'utf8')).replaceAll('v0.2.5','v0.2.6').replace('右侧图层区或右键“解除组合 / 拆散容器”','左侧“图层”标题旁“•••”或图层右键菜单中的“解除组合 / 拆散容器”');
await fs.writeFile(path.join(folder,'01-开始使用.txt'),intro+'\n本版调整：图层管理集中到左侧。点击“图层”标题旁“•••”，或右键图层列表中的目标，进行上移/下移、置顶/置底、复制/粘贴、创建副本、删除、组合/解除组合、重命名等操作。锁定和显示/隐藏仍在图层行内。右侧移除了图层管理区和重复的菜单/组合入口，仅保留设计属性。\n');
await fs.writeFile(path.join(folder,'02-测试反馈.txt'),`HTML Studio v0.2.6 测试反馈

系统/浏览器及版本：
使用的 HTML：
操作步骤：
预期和实际结果：
编辑、预览、导出是否一致：
能否撤回、是否卡顿：
截图/录屏：

重点：所有图层管理能从左侧完成；逐层上移/下移、创建副本、删除、组合/解除组合、重命名、锁定/显隐；右侧无重复图层管理区；多选与撤回；长列表和窄窗口中的入口可用。
`);
await fs.writeFile(path.join(folder,'03-本次功能与测试说明.txt'),`HTML Studio v0.2.6 · 图层操作集中到左侧

右侧移除底部“图层”区、顶部图层操作菜单和多选“组织”区。左侧图层标题旁增加“•••”图层操作菜单，图层右键菜单补充逐层上移/下移；复制/粘贴、创建副本、删除、组合/解除组合、重命名、置顶/置底均可在左侧完成。锁定/显隐保留行内按钮。

右侧保留文字、位置尺寸、布局、填充、透明度、描边、阴影、图表数据等属性。多选和既有快捷键继续可用。图层菜单在预览时禁用，在插入面板中隐藏。

验证：macOS Chrome 相关回归 ${report.passed} 项通过，0 个失败测试组，范围为编辑器基础流程、图层自动定位、窄窗口、单文件和组合拆散；另实测左侧上移/下移、置顶、创建副本、删除、撤回和右侧重复入口移除。此次未重跑全部字体/图表专项，不把此前版本的完整回归计入本次结果。Windows 实机和 Safari 未验证。

包内仅有编辑器、说明、许可及 4 份人工示例，没有私人 HTML、QA 导出、截图或草稿。必要字体内置，其他模板字体继续后台下载缓存。
`);
execFileSync('python3',['-c',`import pathlib,zipfile,sys
p=pathlib.Path(sys.argv[1]);a=pathlib.Path(str(p)+'.zip');assert not a.exists()
with zipfile.ZipFile(a,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in sorted(p.rglob('*')):
  if f.is_file():z.write(f,f.relative_to(p.parent))
with zipfile.ZipFile(a) as z:
 assert z.testzip() is None
 assert len(z.namelist())==10
 assert z.read(p.name+'/HTML Studio.html')==(p/'HTML Studio.html').read_bytes()
`,folder]);
const file=path.join(root,'HTML Studio.html'),archive=folder+'.zip',bytes=await fs.readFile(file),zip=await fs.readFile(archive),hash=b=>createHash('sha256').update(b).digest('hex');
const summary={version:'0.2.6',date:new Date().toISOString(),passed:report.passed,failedSuites:report.failedSuites,standalone:{path:file,bytes:bytes.length,sha256:hash(bytes)},archive:{path:archive,bytes:zip.length,sha256:hash(zip),files:10,crcVerified:true,editorMatchesStandalone:true}};
await fs.writeFile(path.join(qa,'release-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
