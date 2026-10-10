#!/usr/bin/env python3
"""G0-A: render TRUE repository room-closed/cavity and E/C sprites, read-only.

Usage after `npm ci` and installing Python Playwright + Chromium on a local
machine:
    python3 scripts/g0a_full_layer_preview.py --out /tmp/eluvin-g0a

Results are independent ART REVIEW fixtures, NEVER production photos or a
logged-in app test. The actual Space TypeScript painter is transpiled with the
already-installed TypeScript compiler, not reimplemented in Python.
No network requests, server launch, npm install, app state or data mutations.
The closed G0-A art gate is checked but NOT bypassed in product code.
"""
from __future__ import annotations
import argparse
import base64
import json
import re
import subprocess
import sys
import shutil
import tempfile
from urllib.parse import urlencode
from pathlib import Path

WORLD = (941, 1672)
VIEWPORTS = ((390, 844), (390, 690), (430, 932))
STAGES = (0, 0.25, 0.5, 0.75, 1.0)
ASSETS = {
    "closed": "public/space/layered/room-content-clean-v2.webp",
    "cavity": "public/space/layered/room-content-cavity-v2.webp",
    "face": "public/space/layered/e_drawer_hq_v2.webp",
    "inner": "public/space/layered/c_drawer_inner_hq_v3.webp",
}

NODE_COMPILER = r"""
const fs=require('node:fs'), ts=require('typescript');
const paths=process.argv.slice(1);
let mesh=fs.readFileSync(paths[0],'utf8');
let composite=fs.readFileSync(paths[1],'utf8');
composite=composite.replace(/^import\s*\{\s*paintSpaceDrawerFrontMesh\s*\}\s*from\s*['"][^'"]+['"]\s*;?\s*$/m,'');
let combined=(mesh+'\n'+composite).replace(/\bexport\s+(?=(const|function|interface|type)\b)/g,'');
combined+='\nwindow.G0A={paintSpaceDrawer,spaceDrawerCavityAlpha,SPACE_DRAWER_ART_ROI};';
const js=ts.transpileModule(combined,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
process.stdout.write(js);
"""

def input_bundle(root: Path) -> tuple[str, dict[str, str]]:
    manifest = json.loads((root / 'public/space/layered/manifest.json').read_text())
    if manifest.get('enabled') or manifest.get('artApproved'):
        raise ValueError('This QA fixture requires the G0-A art gate to remain CLOSED')
    for path in ASSETS.values():
        if not (root/path).is_file():
            raise FileNotFoundError('Original repo asset missing: '+path)
    js = subprocess.check_output(
        ['node', '-e', NODE_COMPILER,
         'src/lib/spaceDrawerFaceMesh.ts', 'src/lib/spaceDrawerComposite.ts'],
        cwd=root, text=True, timeout=20,
    )
    if not ('window.G0A' in js and 'paintSpaceDrawer' in js):
        raise RuntimeError('Could not bundle the real E/C compositor')
    images = {key: 'data:image/webp;base64,'+base64.b64encode((root/path).read_bytes()).decode()
              for key,path in ASSETS.items()}
    return js, images

def make_html(js: str, images: dict[str, str]) -> str:
    asset_json = json.dumps(images, ensure_ascii=True)
    # `imageSmoothingEnabled` matches the browser 2D compositor's default;
    # drawImage at exactly the same covered 941×1672 world coordinates.
    scene_script = r"""
const W=941,H=1672,ROIS=[427,1309,514,363];
const assets=__ASSETS__;
const load=src=>new Promise((resolve,reject)=>{
  const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('image load'));img.src=src;
});
window.qaReady=false;
Promise.all(['closed','cavity','face','inner'].map(k=>load(assets[k]))).then(values=>{
  const imgs=Object.fromEntries(['closed','cavity','face','inner'].map((k,i)=>[k,values[i]]));
  window.drawFrame=(progress,width,height)=>{
    const p=Math.min(1,Math.max(0,Number(progress)||0));
    const scene=document.createElement('canvas');scene.width=W;scene.height=H;
    const ctx=scene.getContext('2d');
    ctx.drawImage(imgs.closed,0,0,W,H);
    ctx.save();
    ctx.beginPath();ctx.moveTo(W*.520723,H*.856459);ctx.lineTo(W,H*.907919);
    ctx.lineTo(W,H*.958732);ctx.lineTo(W*.520723,H*.898923);ctx.closePath();ctx.clip();
    ctx.globalAlpha=window.G0A.spaceDrawerCavityAlpha(p);
    ctx.drawImage(imgs.cavity,0,0,W,H);
    ctx.restore();
    const c=document.createElement('canvas');c.width=514;c.height=363;
    window.G0A.paintSpaceDrawer(c.getContext('2d'),{face:imgs.face,interior:imgs.inner},p);
    ctx.drawImage(c,427,1309);
    const shot=document.createElement('canvas');
    shot.width=width;shot.height=height;
    const scale=Math.max(width/W,height/H);
    const sctx=shot.getContext('2d');
    sctx.drawImage(scene,(width-W*scale)/2,(height-H*scale)/2,W*scale,H*scale);
    return {png:shot.toDataURL('image/png'),worldPng:scene.toDataURL('image/png')};
  };
  window.qaReady=true;
}).catch(err=>{window.qaError=String(err)});
"""
    scene_script = scene_script.replace('__ASSETS__', asset_json)
    return ('<!DOCTYPE html><html><head><meta charset="utf-8"></head>'
            '<body><script>'+js+'</script><script>'+scene_script+'</script></body></html>')

def run(root: Path, output: Path) -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('BLOCKED: Python Playwright unavailable; install it in a QA-only environment',file=sys.stderr)
        return 2
    js, assets = input_bundle(root)
    html = make_html(js, assets)
    output.mkdir(parents=True,exist_ok=True)
    report = {'kind':'G0A_TRUE_REPO_ART_PREVIEW_NOT_APPROVED',
              'sourceFiles':ASSETS,'viewports':[], 'stages':STAGES,
              'manifestArtApproval':False,'browserErrors':[]}
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        try:
            page=browser.new_page(viewport={'width':1100,'height':850})
            errors=[]
            page.on('pageerror',lambda err:errors.append(str(err)))
            page.set_content(html,wait_until='domcontentloaded',timeout=30000)
            page.wait_for_function('window.qaReady === true || window.qaError',timeout=20000)
            if page.evaluate('window.qaError || null'):
                raise RuntimeError(page.evaluate('window.qaError'))
            for width,height in VIEWPORTS:
                for p in STAGES:
                    result=page.evaluate('([p,w,h])=>window.drawFrame(p,w,h)',[p,width,height])
                    label=f'{width}x{height}_{round(100*p):03}'
                    (output/f'{label}.png').write_bytes(base64.b64decode(result['png'].split(',',1)[1]))
                    if (width,height)==VIEWPORTS[0]:
                        (output/f'world_{round(100*p):03}.png').write_bytes(
                            base64.b64decode(result['worldPng'].split(',',1)[1]))
                report['viewports'].append(f'{width}x{height}')
            report['browserErrors']=errors
        finally:
            browser.close()
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False))
    return 1 if report['browserErrors'] else 0

# Headless Chrome CLI backend. Python Playwright is optional, so GitHub Actions
# can produce real repository art previews without installing any packages.
CHROME_CAPTURE = r"""
const q=new URLSearchParams(location.search);
const p=Number(q.get('p')),w=Number(q.get('w')),h=Number(q.get('h'));
(function waitForArt(){
 if(window.qaError){document.body.textContent='G0A_CLI_ERROR_'+window.qaError;return;}
 if(!window.qaReady){setTimeout(waitForArt,12);return;}
 try {
  const frame=window.drawFrame(p,w,h);
  const output=frame.png.split(',')[1];
  // PNG data is kept inside local Chrome; only screenshot bytes leave the
  // temporary QA HTML. No login, user photo or remote URL is ever read.
  document.body.textContent='G0A_CLI_START|'+output+'|G0A_CLI_END';
 } catch(e) {document.body.textContent='G0A_CLI_ERROR_'+String(e);}
})();
"""

def run_chrome_cli(root: Path, output: Path) -> int:
    chrome=next((p for key in ('CHROME_BIN',) for p in [__import__('os').environ.get(key)] if p),None)
    if not chrome:
        chrome=next((shutil.which(name) for name in ('google-chrome','chromium','chromium-browser')
                     if shutil.which(name)),None)
    if not chrome:
        print('BLOCKED: Chrome/Chromium CLI unavailable',file=sys.stderr)
        return 2
    js, assets=input_bundle(root)
    html=make_html(js,assets).replace('</body>','<script>'+CHROME_CAPTURE+'</script></body>')
    output.mkdir(parents=True,exist_ok=True)
    report={
      'kind':'G0A_TRUE_REPO_ART_PREVIEW_NOT_APPROVED',
      'renderEngine':'chrome-cli',
      'sourceFiles':ASSETS,'viewports':[],'stages':STAGES,
      'manifestArtApproval':False,'browserErrors':[],
    }
    with tempfile.TemporaryDirectory(prefix='eluvin-g0a-') as temporary:
        page=Path(temporary)/'scene.html'
        page.write_text(html,encoding='utf-8')
        for width,height in [*VIEWPORTS, WORLD]:
            for p in STAGES:
                target=page.as_uri()+'?'+urlencode({'w':width,'h':height,'p':p})
                args=[
                    chrome,'--headless=new','--no-sandbox','--disable-dev-shm-usage',
                    '--disable-gpu','--no-first-run','--disable-extensions',
                    '--disable-background-networking','--dump-dom',
                    '--virtual-time-budget=6000',target,
                ]
                label=(f'world_{round(p*100):03}' if (width,height)==WORLD
                       else f'{width}x{height}_{round(p*100):03}')
                result=subprocess.run(args,text=True,capture_output=True,timeout=30)
                if result.returncode:
                    raise RuntimeError(label+' Chrome exited '+str(result.returncode)
                                       +': '+result.stderr[-350:])
                match=re.search(r'G0A_CLI_START\|([A-Za-z0-9+/=]+)\|G0A_CLI_END',
                                result.stdout)
                if not match:
                    raise RuntimeError(label+' no screenshot ('+result.stdout[-180:]+')')
                data=base64.b64decode(match.group(1),validate=True)
                if not data.startswith(b'\x89PNG\r\n\x1a\n'):
                    raise RuntimeError(label+' invalid PNG')
                actual=(int.from_bytes(data[16:20],'big'),int.from_bytes(data[20:24],'big'))
                if actual!=(width,height):
                    raise RuntimeError(label+f' PNG dimensions {actual} != {(width,height)}')
                (output/(label+'.png')).write_bytes(data)
                print('[G0-A]',label,len(data),'bytes',flush=True)
            if (width,height)!=WORLD:
                report['viewports'].append(f'{width}x{height}')
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False))
    return 0

def main()->int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--engine',choices=('playwright','chrome-cli'),default='playwright')
    args=parser.parse_args()
    if args.engine=='chrome-cli':
        return run_chrome_cli(args.repo.resolve(),args.out.resolve())
    return run(args.repo.resolve(),args.out.resolve())

if __name__=='__main__':
    sys.exit(main())
