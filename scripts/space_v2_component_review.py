#!/usr/bin/env python3
"""Screenshot actual Space components in an isolated, empty-account fixture.

No storage seeding, login bypass, private data or network services. This is
NOT authenticated App acceptance. Build the fixture with the adjacent .mjs,
then pass --html and --out. Uses QA Python Playwright and system Chromium,
without changing npm dependencies or the closed product art gates.
"""
from pathlib import Path
import argparse
import json
import shutil


def run(html_path: Path, output: Path) -> int:
    from playwright.sync_api import sync_playwright
    html = html_path.read_text()
    if 'ISOLATED_EMPTY_ACCOUNT_COMPONENT_REVIEW' not in html:
        raise ValueError('Only the empty-account component review is supported')
    output.mkdir(parents=True, exist_ok=True)
    report = {'kind': 'ISOLATED_EMPTY_ACCOUNT_COMPONENT_REVIEW',
              'realAppAuthenticated': False, 'viewports': []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=shutil.which('chromium') or shutil.which('google-chrome'),
                                     args=['--no-sandbox', '--disable-dev-shm-usage'])
        for width, height in [(390, 844), (390, 690), (430, 932)]:
            page = browser.new_page(viewport={'width': width, 'height': height},
                                    reduced_motion='reduce' if height == 690 else 'no-preference')
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.set_content(html, wait_until='load')
            page.wait_for_selector('.ai-space-page.is-layered')
            page.wait_for_timeout(1500)
            label = f'{width}x{height}'
            page.screenshot(path=str(output / f'{label}-room.png'))
            layout = page.evaluate("""()=>({
              width:document.documentElement.scrollWidth, viewport:innerWidth,
              broken:[...document.images].filter(im=>!im.complete||!im.naturalWidth).length,
              photos:document.querySelectorAll('.space-live-photo').length,
              stars:document.querySelectorAll('.space-live-star').length,
              environment:document.querySelector('.ai-space-page').dataset.spaceEnvironment,
              motion:document.querySelector('.ai-space-page').dataset.spaceMotion,
              canvasSizes:[...document.querySelectorAll('.space-foliage-canvas')].map(c=>[c.width,c.height])
            })""")
            row = {'viewport': label, 'layout': layout, 'errors': errors, 'interactions': [],
                   'unverified': ['saved-photo drag/persistence', 'nonempty memories', 'nonempty thought pagination',
                                  'music playback', 'nonempty weekly letters', 'consented live weather', 'real mobile GPU']}
            # Record idle paint pacing on this desktop browser. This is not a
            # claim about a physical phone's frame rate or GPU performance.
            page.evaluate("""()=>{
              window.__reviewPaintCalls=0;
              const original=CanvasRenderingContext2D.prototype.drawImage;
              CanvasRenderingContext2D.prototype.drawImage=function(...args){window.__reviewPaintCalls++;return original.apply(this,args)};
            }""")
            page.wait_for_timeout(1100)
            row['idleCanvasDrawCalls1100ms'] = page.evaluate('window.__reviewPaintCalls')
            page.screenshot(path=str(output / f'{label}-foliage-idle.png'))
            if height == 690 and row['idleCanvasDrawCalls1100ms']:
                errors.append('reduced-motion idle canvas must stop')
            # Five true pointer-drag frames, using the product gesture and
            # product Canvas controller rather than an alternate painter.
            drawer = page.locator('.space-scene-hotspot.is-weekly-letter')
            box = drawer.bounding_box()
            x, y = min(width - 20, box['x'] + box['width'] * .35), box['y'] + box['height'] * .4
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x, y + box['height'] * .42 * .25)
            page.mouse.up()
            page.wait_for_timeout(120)
            page.screenshot(path=str(output / f'{label}-drawer-rebound.png'))
            page.wait_for_timeout(320)
            row['interactions'].append({'kind': 'short drawer pull', 'actualView': page.evaluate('window.__spaceReview.view')})
            if page.evaluate('window.__spaceReview.view') != 'space':
                errors.append('short drawer pull must spring back without navigation')
            page.mouse.move(x, y)
            page.mouse.down()
            for progress in [0, .25, .5, .75, 1]:
                page.mouse.move(x, y + box['height'] * .42 * progress)
                page.wait_for_timeout(75)
                page.screenshot(path=str(output / f'{label}-drawer-{round(progress * 100):03}.png'))
            page.mouse.up()
            page.wait_for_timeout(850)
            row['interactions'].append({'kind': 'drawer release', 'actualView': page.evaluate('window.__spaceReview.view')})
            page.get_by_role('button', name='返回', exact=False).first.click()
            page.wait_for_timeout(750)
            page.screenshot(path=str(output / f'{label}-drawer-returned.png'))
            for kind, selector in [('photos', 'is-photo-wall'), ('jar', 'is-star-jar'), ('book', 'is-thought-book'), ('player', 'is-player')]:
                page.locator('.space-scene-hotspot.' + selector).click()
                page.wait_for_timeout(600)
                if kind == 'photos':
                    actual = 'photos' if page.locator('.photo-archive-page').count() else 'space'
                else:
                    actual = page.evaluate('window.__spaceReview.view')
                row['interactions'].append({'kind': kind, 'actualView': actual})
                if actual != kind:
                    errors.append('wrong interaction destination: ' + kind)
                page.wait_for_function('Array.from(document.images).every(im=>im.complete)')
                broken = page.evaluate('Array.from(document.images).filter(im=>!im.naturalWidth).length')
                if broken:
                    errors.append(f'{kind}: {broken} broken artwork images')
                page.screenshot(path=str(output / f'{label}-{kind}.png'))
                page.get_by_role('button', name='返回', exact=False).first.click()
                page.wait_for_timeout(750)
            if layout['width'] > width or layout['broken']:
                errors.append('initial overflow or broken artwork')
            report['viewports'].append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
            page.close()
        browser.close()
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return int(any(row['errors'] for row in report['viewports']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    raise SystemExit(run(args.html, args.out))
