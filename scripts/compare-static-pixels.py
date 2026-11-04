"""Compare matched-viewport editor, preview and export captures, with recorded raster tolerance."""
from pathlib import Path
from PIL import Image,ImageChops
import json, os
root=Path(os.environ.get('STATIC_QA_DIR',str(Path(__file__).resolve().parent.parent/'qa/static-20261028')))
properties=json.loads((root/'properties-results.json').read_text())
results=[]
for case in properties['results']:
 for mode in ['preview','export']:
  a=Image.open(root/(case['id']+'-edit.png')).convert('RGB');b=Image.open(root/(case['id']+'-'+mode+'.png')).convert('RGB')
  r={'id':case['id'],'mode':mode,'size':list(a.size),'pass':False}
  if a.size==b.size:
   diff=ImageChops.difference(a,b);magnitudes=[max(p) for p in diff.getdata()];total=len(magnitudes)
   r.update(changedPixels=sum(v>0 for v in magnitudes),overTwoLevels=sum(v>2 for v in magnitudes),maxChannelDifference=max(magnitudes),pixels=total)
   # Separate browser surfaces can differ at subpixel antialiasing edges. More
   # than 0.01% pixels differing by >2/255, or any >32/255, requires review.
   r['pass']=r['overTwoLevels']/total<=.0001 and r['maxChannelDifference']<=32
  results.append(r)
report={'tolerance':{'perChannelNoise':2,'maxPixelsOverNoiseFraction':.0001,'maxChannelDifference':32},'results':results}
(root/'pixel-results.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'comparisons':len(results),'passed':sum(r['pass'] for r in results),'exact':sum(r.get('changedPixels')==0 for r in results),'maxChangedPixels':max(r.get('changedPixels',0) for r in results)}))
if not all(r['pass'] for r in results):raise SystemExit(1)
