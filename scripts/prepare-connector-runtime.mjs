import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const version='v24.22.2',base='https://nodejs.org/dist/'+version+'/',dir=path.resolve('qa/mcp-v0.4.0/runtimes');await fs.mkdir(dir,{recursive:true});
const checks=await (await fetch(base+'SHASUMS256.txt')).text();await fs.writeFile(path.join(dir,'SHASUMS256.txt'),checks);
const variants=['darwin-arm64','darwin-x64','win-x64'];
const results=await Promise.allSettled(variants.map(async variant=>{
 const archive=`node-${version}-${variant}.${variant.startsWith('win')?'zip':'tar.gz'}`,file=path.join(dir,archive),expected=checks.split('\n').find(l=>l.endsWith('  '+archive))?.split(/\s+/)[0];if(!expected)throw Error('Missing checksum '+archive);
 let data;try{data=await fs.readFile(file);}catch{}if(!data){const response=await fetch(base+archive);if(!response.ok)throw Error('Download failed '+archive);data=Buffer.from(await response.arrayBuffer());await fs.writeFile(file,data);}
 const actual=createHash('sha256').update(data).digest('hex');if(actual!==expected)throw Error('Checksum mismatch '+archive);
 const out=path.join(dir,variant);await fs.mkdir(out,{recursive:true});
 execFileSync('python3',['-c',`import sys,tarfile,zipfile,pathlib\np=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2]);prefix=sys.argv[3]\nif p.suffix=='.zip':\n with zipfile.ZipFile(p) as z:\n  (out/'node.exe').write_bytes(z.read(prefix+'/node.exe'))\n  (out/'LICENSE').write_bytes(z.read(prefix+'/LICENSE'))\nelse:\n with tarfile.open(p) as z:\n  (out/'node').write_bytes(z.extractfile(prefix+'/bin/node').read())\n  (out/'LICENSE').write_bytes(z.extractfile(prefix+'/LICENSE').read())\n (out/'node').chmod(0o755)`,file,out,`node-${version}-${variant}`]);
 return {variant,version,archive,sha256:actual,bytes:data.length};
}));
const records=results.map(r=>{if(r.status!=='fulfilled')throw r.reason;return r.value;});await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(records,null,2));console.log(JSON.stringify(records,null,2));
