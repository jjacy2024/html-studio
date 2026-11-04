import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parse,stringify} from 'smol-toml';

export const codexConfigPath=()=>path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'config.toml');
const desired=({command,args})=>({command,args,startup_timeout_sec:15,tool_timeout_sec:60,enabled:true});
function parsed(text){try{return parse(text.replace(/^\uFEFF/,''));}catch{throw Error('现有 Codex 配置无法解析，未做更改。请使用连接提示词让 Agent 检查配置。');}}
const withoutTarget=value=>{const copy=structuredClone(value);if(copy.mcp_servers){delete copy.mcp_servers.html_studio;if(!Object.keys(copy.mcp_servers).length)delete copy.mcp_servers;}return copy;};
function currentEntry(doc){const servers=doc.mcp_servers;if(servers!==undefined&&(!servers||typeof servers!=='object'||Array.isArray(servers)))throw Error('现有 MCP 配置结构无法自动合并，未做更改。');return servers?.html_studio;}
function configured(entry,setup){const want=desired(setup);return !!entry&&!Object.hasOwn(entry,'url')&&Object.entries(want).every(([k,v])=>isDeepStrictEqual(entry[k]??(k==='enabled'?true:undefined),v));}
export function mergeCodexConfig(source,setup){
  const before=parsed(source),entry=currentEntry(before),want=desired(setup);
  if(configured(entry,setup))return source;
  if(entry&&(!Array.isArray(entry.args)||!entry.args.some(v=>typeof v==='string'&&/(?:^|[/\\])connector\.cjs$/.test(v))||!entry.args.includes('mcp')||Object.hasOwn(entry,'url')))throw Error('已有同名 html_studio 服务，但不是此编辑器的本地连接。未覆盖，请用连接提示词处理冲突。');
  // Replace only this service's explicit table(s), preserving every other byte.
  // A full semantic comparison below rejects ambiguous headers inside multiline
  // strings and nonstandard inline/dotted declarations instead of rewriting them.
  const headers=[...source.matchAll(/^[\t ]*\[[^\r\n]+\][\t ]*(?:#[^\r\n]*)?\r?$/gm)];
  const spans=[];
  for(let i=0;i<headers.length;i++){
    let probe;try{probe=parse(headers[i][0]+'\n__html_studio_header_probe = true\n');}catch{continue;}
    if(probe.mcp_servers&&Object.hasOwn(probe.mcp_servers,'html_studio'))spans.push([headers[i].index,i+1<headers.length?headers[i+1].index:source.length]);
  }
  if(entry&&!spans.length)throw Error('这份 Codex 配置使用内联或点号写法，未自动改写。请复制连接提示词交给 Agent 合并。');
  let kept=source;for(const [start,end] of spans.reverse())kept=kept.slice(0,start)+kept.slice(end);
  const merged={...entry,...want};
  const result=kept+(kept.endsWith('\n')?'\n':'\n\n')+stringify({mcp_servers:{html_studio:merged}});
  const after=parsed(result);
  if(!isDeepStrictEqual(withoutTarget(before),withoutTarget(after))||!isDeepStrictEqual(structuredClone(after.mcp_servers?.html_studio),structuredClone(merged)))throw Error('无法保证其他配置不受影响，未做更改。请复制连接提示词交给 Agent 合并。');
  return result;
}
async function readConfig(file){
  try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Codex 配置不是普通文件，未做更改。请让 Agent 检查配置位置。');return {source:await fs.readFile(file,'utf8'),mode:stat.mode&0o777,exists:true};}
  catch(e){if(e.code==='ENOENT')return {source:'',mode:0o600,exists:false};throw e;}
}
export async function codexConfigStatus(setup,file=codexConfigPath()){
  try{const {source}=await readConfig(file);return {configured:configured(currentEntry(parsed(source)),setup),configPath:file};}
  catch(e){return {configured:false,configPath:file,error:e.message};}
}
export async function installCodex(setup,file=codexConfigPath()){
  await fs.access(setup.command);await fs.access(setup.args[0]);
  const folder=path.dirname(file);await fs.mkdir(folder,{recursive:true,mode:0o700});
  const lockFile=file+'.html-studio-setup.lock';let lock;
  try{lock=await fs.open(lockFile,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('另一次配置操作正在进行，请稍后重试。');throw e;}
  let temporary;
  try{
    const before=await readConfig(file),updated=mergeCodexConfig(before.source,setup);
    if(updated===before.source)return {configured:true,changed:false,configPath:file,backupPath:null};
    const backupPath=before.exists?file+'.backup-html-studio-'+Date.now()+'-'+randomUUID().slice(0,8):null;
    if(backupPath)await fs.writeFile(backupPath,before.source,{flag:'wx',mode:0o600});
    temporary=file+'.html-studio-'+randomUUID()+'.tmp';
    const handle=await fs.open(temporary,'wx',before.mode);
    try{await handle.writeFile(updated);await handle.sync();}finally{await handle.close();}
    const current=await readConfig(file);if(current.source!==before.source||current.exists!==before.exists)throw Error('Codex 配置刚刚被其他程序更改，未覆盖，请重试。');
    await fs.rename(temporary,file);temporary=null;
    return {configured:true,changed:true,configPath:file,backupPath};
  }finally{if(temporary)await fs.unlink(temporary).catch(()=>{});await lock.close();await fs.unlink(lockFile).catch(()=>{});}
}
