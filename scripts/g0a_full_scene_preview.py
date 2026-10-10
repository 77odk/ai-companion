#!/usr/bin/env python3
"""G0-A full desk ART preflight, no fabricated photos or user content.

Uses the existing real-E/C compositor and current CSS-measured world boxes
for jar, book, tablet, wired earphones. Unlike an app smoke test, this is a
static no-account scene: real user photos, personal memories and live music
data are never fabricated, fetched or copied into review artifacts.

Needs only the dependencies already used by g0a_full_layer_preview.py in CI.
"""
from __future__ import annotations
import argparse
import base64
import json
from pathlib import Path
import g0a_full_layer_preview as drawer

OBJECTS = {
    "book": "public/space/layered/open_book.png",
    "jar": "public/space/layered/glass_memory_jar.png",
    "player": "public/space/layered/tablet_player.png",
    "earphones": "public/space/layered/wired_earphones.png",
}
# Same percentage rectangles as src/styles/space.css, in 941×1672 space.
# Image box sizes are not the painted alpha bounds, so this visual preflight
# must not be represented as an end-user runtime screenshot.
BOXES = {
    "book": (14, 66, 73, 19),
    "jar": (19, 47, 27, 19),
    "player": (54, 51.5, 40, 15),
    "earphones": (69, 60, 24, 10),
}

def run(root: Path, output: Path) -> int:
    orig_input, orig_html, orig_stages = drawer.input_bundle, drawer.make_html, drawer.STAGES
    def with_objects(path: Path):
        script, base = orig_input(path)
        for name, filename in OBJECTS.items():
            raw=(path/filename).read_bytes()
            if not raw.startswith(b'\x89PNG\r\n\x1a\n'):
                raise ValueError('Not a real PNG: '+filename)
            base[name]='data:image/png;base64,'+base64.b64encode(raw).decode('ascii')
        return script,base
    def with_painter(script: str, base: dict[str,str]) -> str:
        html=orig_html(script,base)
        # Extend the ORIGINAL scene's single image Promise to cover the four
        # genuine cutouts. One ready gate, no second async clock or race.
        original="['closed','cavity','face','inner']"
        extended="['closed','cavity','face','inner','book','jar','player','earphones']"
        if html.count(original)!=2:
            raise RuntimeError('Original four-image renderer changed')
        html=html.replace(original,extended)
        helper = """
const objectBoxes=__BOXES__;
function drawContain(ctx,img,rect) {
  const [x,y,w,h]=rect.map((v,i)=>v/100*(i%2===0?941:1672));
  const scale=Math.min(w/img.naturalWidth,h/img.naturalHeight);
  const dw=img.naturalWidth*scale,dh=img.naturalHeight*scale;
  ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
}
""".replace('__BOXES__',json.dumps(BOXES))
        anchor='window.drawFrame=(progress,width,height)=>{'
        if html.count(anchor)!=1:
            raise RuntimeError('Original scene rendering entrypoint changed')
        html=html.replace(anchor,helper+anchor)
        after='ctx.drawImage(c,427,1309);'
        if html.count(after)!=1: raise RuntimeError('Original drawer paint changed')
        paint="""for (const k of ['book','jar','player','earphones'])
      drawContain(ctx,imgs[k],objectBoxes[k]);"""
        return html.replace(after,after+paint)
    try:
        drawer.input_bundle=with_objects
        drawer.make_html=with_painter
        drawer.STAGES=(0,0.5,1.0)
        return drawer.run_chrome_cli(root,output)
    finally:
        drawer.input_bundle,drawer.make_html,drawer.STAGES=orig_input,orig_html,orig_stages

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    p.add_argument('--out',type=Path,required=True)
    args=p.parse_args()
    raise SystemExit(run(args.repo.resolve(),args.out.resolve()))
