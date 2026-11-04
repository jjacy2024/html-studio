#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createBroker} from './broker.mjs';
import {startStdio,failure,CONNECTOR_VERSION,tools} from './mcp.mjs';
import {installCodex} from './setup-codex.mjs';

const argv=process.argv.slice(2),mode=argv[0]||'serve';
const appHost=argv.includes('--app-host');
const hostEvent=data=>process.stdout.write(JSON.stringify(data)+'\n');
const option=(key,fallback)=>{const at=argv.indexOf(key);return at<0?fallback:argv[at+1];};
const root=path.resolve(option('--root',path.join(path.dirname(process.argv[1]),'..')));
const stateDir=path.resolve(option('--state-dir',path.join(os.homedir(),'.html-studio-connector')));
function openBrowser(url){const command=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32.exe':'xdg-open';const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];const child=spawn(command,args,{detached:true,stdio:'ignore',shell:false});child.on('error',()=>console.error('无法自动打开浏览器，请复制启动链接到 Chrome 或 Edge。'));child.unref();}
async function connection(){
  let s;try{s=JSON.parse(await fs.readFile(path.join(stateDir,'connection.json'),'utf8'));}catch{throw Error('连接器未运行，请先打开 html全能编辑器应用或安装包内的启动器');}
  const url=new URL(s.origin);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||!/^\d+$/.test(url.port)||!s.controlToken)throw Error('连接器地址无效，请重新启动');
  return s;
}
async function request(s,route,body,signal){const response=await fetch(s.origin+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+s.controlToken,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal||AbortSignal.timeout(50000)});if(!response.ok)throw Error('连接器返回 '+response.status+'，请重新启动');return response.json();}
async function main(){
  if(mode==='setup-codex'){
    const result=await installCodex({command:process.execPath,args:[path.join(root,'connector','connector.cjs'),'mcp','--state-dir',stateDir]});
    console.log(JSON.stringify({...result,next:'配置已就绪。重新加载 MCP 或重启 Codex 后，调用 studio_sessions 验证连接；尚未自动授权工程。'},null,2));return;
  }
  if(mode==='mcp'){
    const server=await startStdio(async(body,signal)=>{try{return await request(await connection(),'/api/call',body,signal);}catch(e){return failure('CONNECTOR_UNAVAILABLE',e.message==='fetch failed'?'连接器已关闭，请重新启动':e.message);}});
    process.stdin.on('end',()=>server.close().finally(()=>process.exit(0)));return;
  }
  if(mode==='self-check'){process.stdout.write(JSON.stringify({version:CONNECTOR_VERSION,node:process.version,platform:process.platform,arch:process.arch,tools:tools.length})+'\n');return;}
  if(mode!=='serve')throw Error('用法：connector.cjs serve | mcp | self-check | setup-codex');
  let existing;
  try{const s=await connection(),health=await request(s,'/api/health',undefined,AbortSignal.timeout(1500));if(health.ok&&health.instanceId===s.instanceId)existing=s;}catch{}
  if(existing){if(path.resolve(existing.root)!==root)throw Error('已有另一目录或旧版本的编辑器正在运行。请先保存工程，退出旧版应用或关闭旧版启动窗口，再打开此应用。');const {url}=await request(existing,'/api/open',{});if(appHost)hostEvent({type:'ready',url,ownsServer:false});else console.log('已使用正在运行的连接器。\n'+url);if(!argv.includes('--no-open'))openBrowser(url);return;}
  const port=Number(option('--port','43876'));if(!Number.isInteger(port)||port<0||port>65535)throw Error('端口无效');
  const exportDir=path.resolve(option('--export-dir',path.join(os.homedir(),'Downloads','html全能编辑器导出')));
  const broker=await createBroker({root,stateDir,port,exportDir});const url=broker.pairURL();
  if(appHost)hostEvent({type:'ready',url,ownsServer:true});
  else console.log(`html全能编辑器 ${CONNECTOR_VERSION}\n${url}\n\n请保持此窗口打开。关闭窗口或按 Ctrl+C 将断开 Agent。\n副本保存到：${exportDir}\n首次使用：在编辑器右上角点击“连接 AI”，选择一键配置或复制连接提示词。`);
  if(!argv.includes('--no-open'))openBrowser(url);
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await broker.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  // The app owns this process. If it crashes, reap only its own connector.
  const parentPid=Number(option('--parent-pid','0'));
  if(appHost&&parentPid>1){const monitor=setInterval(()=>{if(process.ppid!==parentPid)stop();},1000);monitor.unref();if(process.ppid!==parentPid)await stop();}
}
main().catch(e=>{const message=e.code==='EADDRINUSE'?'本地端口已被占用，请退出旧版应用或关闭旧版启动窗口后再试。':e.message;if(appHost)hostEvent({type:'error',message});else console.error(message);process.exitCode=1;});
