import {pathToFileURL as nativeFileURL} from 'node:url';
import path from 'node:path';
// Serve generated QA artifacts over localhost when running the HTTP regression.
// No existing browser profile or user file:// tab is accessed by these tests.
export function pathToFileURL(file) {
  if(!process.env.TEST_ARTIFACT_URL)return nativeFileURL(file);
  const root=path.resolve('qa'),relative=path.relative(root,path.resolve(file));
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Test artifact must be inside qa/');
  return new URL(relative.split(path.sep).map(encodeURIComponent).join('/'),process.env.TEST_ARTIFACT_URL.replace(/\/?$/,'/'));
}
