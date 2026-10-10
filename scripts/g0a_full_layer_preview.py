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
from pathlib import Path

WORLD = (941, 1672)
VIEWPORTS = ((390, 844), (390, 690), (430, 932))
STAGES = (0, 0.25, 0.5, 0.75, 1.0)
ASSETS = {
    "closed": "public/space/layered/room-closed.webp",
    "cavity": "public/space/layered/room-cavity.webp",
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
    ctx.beginPath();ctx.moveTo(W*.44,H*.77);ctx.lineTo(W,H*.77);
    ctx.lineTo(W,H);ctx.lineTo(W*.44,H);ctx.closePath();ctx.clip();
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

def main()->int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    return run(args.repo.resolve(),args.out.resolve())

if __name__=='__main__':
    sys.exit(main())
