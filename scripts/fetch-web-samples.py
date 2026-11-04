"""Mirror reviewed public HTML and static dependencies; never execute page code."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.request import Request, urlopen
from urllib.parse import urljoin, urlparse, urldefrag
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib,json,re,html,datetime,mimetypes,time
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'qa/web-corpus-20261028'
MANIFEST=json.loads((ROOT/'tests/web-samples.json').read_text())
OUT.mkdir(parents=True,exist_ok=True)
def digest(data):return hashlib.sha256(data).hexdigest()
def fetch(url):
 for attempt in range(2):
  try:
   req=Request(url,headers={'User-Agent':'HTML-Studio-local-compatibility-test/0.1'})
   with urlopen(req,timeout=25) as response:
    data=response.read(15*1024*1024+1)
    if len(data)>15*1024*1024:raise ValueError('Resource exceeded 15 MiB limit')
    return data,response.headers.get_content_type(),response.geturl()
  except Exception:
   if attempt:raise

def sample(spec):
 folder=OUT/spec['id'];bundle=folder/'bundle';assets=bundle/'assets';assets.mkdir(parents=True,exist_ok=True)
 result={**spec,'downloadedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'resources':[],'failures':[],'adaptations':[]};known={}
 def resource(ref,base,depth=0):
  if not ref or re.match(r'^(?:data:|blob:|#|about:|javascript:|mailto:)',ref,re.I):return ref
  url,fragment=urldefrag(urljoin(base,ref))
  if not url.startswith(('http://','https://')):return ref
  if url in known:return known[url]+('#'+fragment if fragment else '')
  if len(known)>=100 or depth>5:result['failures'].append({'url':url,'error':'Dependency limit'});return ref
  try:
   data,mime,final=fetch(url)
   ext=Path(urlparse(url).path).suffix
   if not ext or len(ext)>8:ext={'text/css':'.css','text/javascript':'.js','application/javascript':'.js','image/svg+xml':'.svg','text/html':'.html'}.get(mime,mimetypes.guess_extension(mime)or'.bin')
   local='assets/'+digest(url.encode())[:14]+ext;known[url]=local
   originalHash=digest(data)
   if mime=='text/css' or ext=='.css':data=css(data.decode('utf8'),url,depth+1,True).encode()
   (bundle/local).write_bytes(data)
   result['resources'].append({'url':url,'resolvedUrl':final,'path':local,'type':mime,'bytes':len(data),'sourceSha256':originalHash,'localSha256':digest(data)})
   return local+('#'+fragment if fragment else '')
  except Exception as e:
   result['failures'].append({'url':url,'error':str(e)});return ref
 def css(text,base,depth=0,in_asset=False):
  def resolve(ref):
   value=resource(ref,base,depth)
   return value.removeprefix('assets/') if in_asset and value.startswith('assets/') else value
  text=re.sub(r'url\(\s*([\'\"]?)([^)\'\"\s]+)\1\s*\)',lambda m:'url("'+resolve(m[2])+'")',text)
  text=re.sub(r'@import\s+([\'\"])([^\'\"]+)\1',lambda m:'@import "'+resolve(m[2])+'"',text)
  return text
 try:
  raw,mime,final=fetch(spec['url']);(folder/'original.html').write_bytes(raw);source=raw.decode('utf8');result.update(sourceSha256=digest(raw),sourceBytes=len(raw),resolvedUrl=final)
  class Mirror(HTMLParser):
   def __init__(self):super().__init__(convert_charrefs=False);self.parts=[];self.instyle=False
   def handle_starttag(self,tag,attrs):self.tag(tag,attrs,False)
   def handle_startendtag(self,tag,attrs):self.tag(tag,attrs,True)
   def tag(self,tag,attrs,closed):
    attr=dict(attrs);rewritten=False;out=[]
    for key,value in attrs:
     new=value
     if value and ((key=='src' and tag not in ('iframe',))or key=='poster'or(key=='href'and(tag=='image'or(tag=='link'and attr.get('rel')in('stylesheet','icon'))))):new=resource(value,final);rewritten|=new!=value
     elif key=='style'and value:new=css(value,final)
     out.append((key,new))
    # CSS URLs were mirrored; its original integrity digest no longer applies.
    if tag=='link'and rewritten and 'integrity'in attr:
     out=[(k,v)for k,v in out if k!='integrity'];result['adaptations'].append('Removed stylesheet integrity after dependency URL rewrite')
    self.parts.append('<'+tag+''.join(' '+k+('="'+html.escape(v,quote=True)+'"'if v is not None else '')for k,v in out)+('/>'if closed else '>'))
    if tag=='style':self.instyle=True
   def handle_endtag(self,tag):self.parts.append('</'+tag+'>');self.instyle=False if tag=='style'else self.instyle
   def handle_data(self,data):self.parts.append(css(data,final)if self.instyle else data)
   def handle_entityref(self,name):self.parts.append('&'+name+';')
   def handle_charref(self,name):self.parts.append('&#'+name+';')
   def handle_comment(self,data):self.parts.append('<!--'+data+'-->')
   def handle_decl(self,decl):self.parts.append('<!'+decl+'>')
  parser=Mirror();parser.feed(source);prepared=''.join(parser.parts);(bundle/'index.html').write_text(prepared)
  result['preparedSha256']=digest(prepared.encode());result['preparedPath']=str((bundle/'index.html').relative_to(ROOT));result['adaptations'].append('Rewrote static resource URLs to local files; kept HTML structure, CSS rules and script logic')
  try:license,mime,_=fetch(spec['licenseUrl']);(folder/'LICENSE-source.txt').write_bytes(license);result['licenseSha256']=digest(license)
  except Exception as e:result['failures'].append({'url':spec['licenseUrl'],'error':str(e),'licenseOnly':True})
  result['downloadOK']=True
 except Exception as e:result['downloadOK']=False;result['error']=str(e)
 (folder/'provenance.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));return result
results=[]
with ThreadPoolExecutor(max_workers=4)as pool:
 futures=[pool.submit(sample,s)for s in MANIFEST]
 for f in as_completed(futures):
  r=f.result();results.append(r);print(r['id'],'OK'if r['downloadOK']else'FAILED','resources',len(r['resources']),'failures',len(r['failures']),flush=True)
results.sort(key=lambda r:next(i for i,s in enumerate(MANIFEST)if s['id']==r['id']))
(OUT/'manifest.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
