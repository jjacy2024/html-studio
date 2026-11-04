"""Fetch the exact webfont stylesheets declared by the supplied template library.

All Unicode subsets are retained, including CJK; no text-only subsetting. Files
are content-checked and cached locally so normal editor builds never use a network.
"""
import concurrent.futures
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT.parent / 'downloads/beautiful-html-templates-34/templates'
DEST = ROOT / 'dist/vendor/fonts'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
for directory in ['files', 'stylesheets', 'licenses']:
    (DEST / directory).mkdir(parents=True, exist_ok=True)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def download(url, destination):
    if destination.exists():
        return destination.read_bytes()
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(request, timeout=25) as response:
                data = response.read()
            temp = destination.with_suffix(destination.suffix + '.part')
            temp.write_bytes(data)
            temp.replace(destination)
            return data
        except urllib.error.HTTPError as error:
            if error.code == 404 or attempt == 2:
                raise
        except Exception:
            if attempt == 2:
                raise
        time.sleep(attempt + 1)

class FontLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []
    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        href = attrs.get('href', '')
        if tag == 'link' and attrs.get('rel') == 'stylesheet' and 'fonts.googleapis.com/' in href:
            self.urls.append(href)

templates = {}
for filename in sorted(SOURCE.glob('*/template.html')):
    source = filename.read_text()
    parser = FontLinks()
    parser.feed(source)
    imports = re.findall(r'@import\s+(?:url\(\s*)?[\'"]([^\'"]+)', source)
    templates[filename.parent.name] = sorted(set(parser.urls + [html.unescape(u) for u in imports if 'fonts.googleapis.com/' in u]))
urls = sorted({u for sources in templates.values() for u in sources})

def stylesheet(url):
    filename = 'stylesheets/' + sha(url.encode()) + '.css'
    data = download(url, DEST / filename)
    text = data.decode('utf-8')
    if '@font-face' not in text or '<html' in text:
        raise ValueError('Invalid font stylesheet: ' + url)
    sources = sorted(set(re.findall(r'url\((https://fonts\.gstatic\.com/[^)]+)\)', text)))
    if not sources:
        raise ValueError('Font stylesheet has no downloadable files: ' + url)
    return {'url': url, 'file': filename, 'sha256': sha(data), 'fontURLs': sources}

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    sheets = list(pool.map(stylesheet, urls))
font_urls = sorted({u for sheet in sheets for u in sheet['fontURLs']})
families = sorted({f.split(':')[0] for u in urls for f in urllib.parse.parse_qs(urllib.parse.urlsplit(u).query).get('family', [])})
print(f'{len(templates)} templates; {len(sheets)} stylesheets; {len(families)} families; {len(font_urls)} font files', flush=True)

def font_file(url):
    filename = 'files/' + sha(url.encode()) + '.woff2'
    data = download(url, DEST / filename)
    if data[:4] != b'wOF2':
        raise ValueError('Expected WOFF2 font: ' + url)
    return {'url': url, 'file': filename, 'sha256': sha(data), 'bytes': len(data)}

fonts = []
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    for record in pool.map(font_file, font_urls):
        fonts.append(record)
        if len(fonts) % 50 == 0:
            print(f'Downloaded/verified {len(fonts)}/{len(font_urls)} font files', flush=True)

def license_file(family):
    slug = re.sub('[^a-z0-9]', '', family.lower())
    filename = 'licenses/' + slug + '.txt'
    # Fredoka One is still served by the CSS API but was delisted from main.
    # This is the verified parent of its removal commit e49bba3794b8c48d3cc706577d7aa3f31388e82f.
    revision = 'be2838a23fd2918408e22b25c54135da76525ff6' if family == 'Fredoka One' else 'main'
    for directory, name in [('ofl', 'OFL.txt'), ('apache', 'LICENSE.txt'), ('ufl', 'UFL.txt')]:
        url = f'https://raw.githubusercontent.com/google/fonts/{revision}/{directory}/{slug}/{name}'
        try:
            data = download(url, DEST / filename)
            if b'License' not in data and b'LICENSE' not in data:
                raise ValueError('Invalid license: ' + family)
            return {'family': family, 'url': url, 'file': filename, 'sha256': sha(data)}
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
    raise ValueError('License not found: ' + family)

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    licenses = list(pool.map(license_file, families))
manifest = {'schema': 1, 'templates': templates, 'stylesheets': sheets, 'fonts': fonts, 'licenses': licenses,
            'families': families, 'bytes': sum(f['bytes'] for f in fonts), 'userAgent': UA}
(DEST / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'Complete: {len(fonts)} font files, {manifest["bytes"]:,} bytes; {len(licenses)} licenses', flush=True)
