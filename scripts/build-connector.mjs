import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from '../connector/node_modules/esbuild/lib/main.js';
import {editorOperationSchema} from '../dist/operations.js';
const root=fileURLToPath(new URL('../',import.meta.url));
await fs.writeFile(path.join(root,'connector/command-schema.json'),JSON.stringify(editorOperationSchema(),null,2)+'\n');
await build({entryPoints:[path.join(root,'connector/cli.mjs')],bundle:true,platform:'node',format:'cjs',target:'node24',outfile:path.join(root,'connector/connector.cjs'),minify:true,legalComments:'eof',external:['bufferutil','utf-8-validate']});
console.log('Built local connector');
