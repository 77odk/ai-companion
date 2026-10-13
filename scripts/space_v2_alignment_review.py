"""Local synthetic component QA, never authenticated App/real-phone signoff."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import argparse
import json
import threading
import shutil
from playwright.sync_api import sync_playwright

args = argparse.ArgumentParser()
args.add_argument('--out', required=True)
out = Path(args.parse_args().out).resolve()
root = Path.cwd()


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.split('?')[0] == '/fixture.html':
            return str(out / 'fixture.html')
        return str(root / 'public' / path.split('?')[0].lstrip('/'))

    def log_message(self, *_):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 5173), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'source': 'software Chromium, synthetic disposable component data',
          'realDevice': False, 'authenticatedApp': False, 'rows': [], 'photoCountCases': []}
# Independently measured landmarks on the immutable content-clean baseplate.
# Photo wall is a placement frame; individual visible photo bounds also recorded.
landmarks = {'photos': [291, 150, 612, 720], 'jar': [207, 800, 240, 296],
             'book': [218, 1094, 715, 304], 'player': [528, 890, 304, 212],
             'weekly': [490, 1430, 451, 170]}
selectors = {'photos': 'photo-wall', 'jar': 'star-jar', 'book': 'thought-book',
             'player': 'player', 'weekly': 'weekly-letter'}
shells = {'photos': 'photo-board', 'jar': 'jar', 'book': 'book', 'player': 'player'}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=shutil.which('chromium'),
                                     args=['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'])
        for mode in ['enabled', 'gate-off', 'asset-failure', 'cutout-failure']:
            context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1,
                                          is_mobile=True, has_touch=True)
            page = context.new_page()
            errors, console_errors = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)

            def route_manifest(route):
                manifest = json.loads((root / 'public/space/layered/manifest.json').read_text())
                if mode in ['gate-off', 'cutout-failure']:
                    manifest['enabled'] = manifest['artApproved'] = False
                route.fulfill(status=200, content_type='application/json', body=json.dumps(manifest))

            context.route('**/space/layered/manifest.json', route_manifest)
            if mode == 'asset-failure':
                context.route('**/space/layered/origami_purple.png', lambda route: route.fulfill(status=200, content_type='image/png', body='decode failure'))
            if mode == 'cutout-failure':
                context.route('**/space/cutouts/*.png', lambda route: route.fulfill(status=200, content_type='image/png', body='decode failure'))
                for name in ['open_book.png', 'tablet_player.png']:
                    context.route('**/space/layered/' + name, lambda route: route.fulfill(status=200, content_type='image/png', body='decode failure'))
            page.goto('http://127.0.0.1:5173/fixture.html')
            page.wait_for_selector('.ai-space-page')
            page.wait_for_timeout(1600)
            layered = page.locator('.ai-space-page').evaluate('(e)=>e.classList.contains("is-layered")')
            assert layered == (mode == 'enabled'), mode
            assert page.locator('.space-live-photo').count() == 1
            assert page.locator('.space-live-star').count() == 12
            assert page.locator('.space-player-content').inner_text().strip() == '隔离验收音乐'
            rows = []
            plane = page.locator('.space-scene-shell').bounding_box()
            for kind, selector in selectors.items():
                hotspot = page.locator('.space-scene-hotspot.is-' + selector)
                box = hotspot.bounding_box()
                x, y, w, h = landmarks[kind]
                projected = {'x': plane['x'] + x / 941 * plane['width'],
                             'y': plane['y'] + y / 1672 * plane['height'],
                             'width': w / 941 * plane['width'], 'height': h / 1672 * plane['height']}
                if kind == 'photos':
                    projected = page.locator('.space-live-photo').bounding_box()
                delta = max(abs(box['x'] - projected['x']), abs(box['y'] - projected['y']),
                            abs(box['x'] + box['width'] - projected['x'] - projected['width']),
                            abs(box['y'] + box['height'] - projected['y'] - projected['height']))
                assert delta <= 4, (kind, box, projected)
                shell = page.locator('.space-live-' + shells[kind]) if kind in shells else None
                shell_box = shell.bounding_box() if shell else None
                hidden_style = shell.evaluate('(e)=>{const s=getComputedStyle(e);return {display:s.display,background:s.backgroundColor,border:s.borderWidth,shadow:s.boxShadow}}') if shell else None
                if (layered or kind == 'photos') and shell:
                    assert shell_box is None, (mode, kind, 'visible shell')
                    assert hidden_style == {'display':'none','background':'rgba(0, 0, 0, 0)','border':'0px','shadow':'none'}, hidden_style
                if shell_box:
                    assert max(abs(shell_box[key] - box[key]) for key in box) <= 4
                rows.append({'object': kind, 'visibleLandmark': projected, 'hotspot': box,
                             'substitute': shell_box, 'substituteStyle': hidden_style, 'maxEdgeDelta': delta,
                             'landmarkKind': 'actual visible photo union' if kind == 'photos' else 'baseplate object bounds' if layered else 'fallback cutout slot'})
            page.screenshot(path=str(out / f'390x844-{mode}.png'))
            # Content stays outside the hidden shells and inside object bounds.
            content = page.evaluate('''()=>[...document.querySelectorAll('.space-live-photo,.space-live-star,.space-live-jar-glint,.space-player-content')].map(e=>{
              const r=e.getBoundingClientRect(), p=e.closest('.space-scene-hotspot').getBoundingClientRect(),s=getComputedStyle(e);
              return {class:e.className,rect:{x:r.x,y:r.y,width:r.width,height:r.height},within:r.left>=p.left-4&&r.top>=p.top-4&&r.right<=p.right+4&&r.bottom<=p.bottom+4,display:s.display,opacity:s.opacity};})''')
            assert all(item['within'] and item['display'] != 'none' and float(item['opacity']) > 0 for item in content), content
            # Live star animation and glass glint survive the hidden shell.
            star_before = page.locator('.space-live-star').first.evaluate('(e)=>getComputedStyle(e).transform')
            page.wait_for_timeout(500)
            star_after = page.locator('.space-live-star').first.evaluate('(e)=>getComputedStyle(e).transform')
            glint_animation = page.locator('.space-live-jar-glint').evaluate('(e)=>getComputedStyle(e).animationName')
            assert star_before != star_after and glint_animation == 'space-jar-glint'
            page.emulate_media(reduced_motion='reduce')
            page.wait_for_timeout(50)
            assert page.locator('.space-live-star').first.evaluate('(e)=>getComputedStyle(e).animationName') == 'none'
            assert page.locator('.space-live-jar-glint').evaluate('(e)=>getComputedStyle(e).animationName') == 'none'
            page.emulate_media(reduced_motion='no-preference')
            motion_check = {'starsMoved': star_before != star_after, 'glintAnimation': glint_animation, 'reducedMotionLiveChange': True}
            # Real audio instance drives the progress strip; seek is not a mock snapshot.
            page.wait_for_function('window.__alignmentReview.snapshot().duration > 0')
            before = page.locator('.space-live-player-track > i').evaluate('(e)=>getComputedStyle(e).transform')
            page.evaluate('window.__alignmentReview.seek("", 12)')
            page.wait_for_timeout(250)
            after = page.locator('.space-live-player-track > i').evaluate('(e)=>getComputedStyle(e).transform')
            assert before != after
            # Existing saved-photo pointer handler and persistence, no substitute drag.
            photo = page.locator('.space-live-photo')
            initial = photo.bounding_box()
            x, y = initial['x'] + initial['width'] / 2, initial['y'] + initial['height'] / 2
            page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 18, y + 16, steps=5); page.mouse.up()
            page.wait_for_timeout(250)
            moved = photo.bounding_box()
            assert moved['x'] > initial['x'] + 10 and moved['y'] > initial['y'] + 8
            persisted = page.evaluate('JSON.parse(localStorage.getItem("ai_space_photos_global"))[0].scenePlacement')
            assert persisted is not None
            interactions = [{'kind': 'photo drag', 'before': initial, 'after': moved, 'persisted': persisted}]
            for kind, selector in selectors.items():
                hotspot = page.locator('.space-scene-hotspot.is-' + selector)
                box = hotspot.bounding_box()
                x, y = min(380, box['x'] + box['width'] * .5), box['y'] + box['height'] * .5
                if kind == 'weekly':
                    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x, y + box['height'] * .42 * .3, steps=5)
                    page.mouse.up(); page.wait_for_timeout(700)
                    assert page.locator('.ai-space-page').get_attribute('data-space-focus') == 'space'
                    interactions.append({'kind': 'short drawer pull', 'result': 'spring back'})
                    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x, y + box['height'] * .65, steps=10); page.mouse.up()
                else:
                    page.mouse.click(x, y)
                page.wait_for_timeout(1300)
                actual = page.locator('.ai-space-page').get_attribute('data-space-focus') if kind == 'photos' or layered else page.evaluate('window.__alignmentReview.view')
                assert actual == kind, (mode, kind, actual)
                page.screenshot(path=str(out / f'390x844-{mode}-{kind}.png'))
                interactions.append({'kind': kind, 'result': actual})
                if kind == 'photos':
                    if layered: page.get_by_role('button', name='返回上一层', exact=True).click(position={'x': 8, 'y': 8})
                    else: page.locator('.photo-archive-back').click()
                else:
                    if layered: page.get_by_role('button', name='返回上一层', exact=True).click(position={'x': 8, 'y': 8})
                    else: page.locator('.space-object-back,.detail-back').first.click()
                page.wait_for_timeout(1000)
            overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth')
            report['rows'].append({'mode': mode, 'rectangles': rows, 'liveContent': content,
                                   'audioProgressChanged': before != after, 'interactions': interactions,
                                   'pageerrors': errors, 'consoleErrors': console_errors, 'overflow': overflow, 'motionCheck': motion_check})
            assert not errors and not overflow, (mode, errors, overflow)
            context.close()
        for count in [0, 8]:
            context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, reduced_motion='reduce')
            page = context.new_page()
            case_errors = []
            page.on('pageerror', lambda error: case_errors.append(str(error)))
            page.goto(f'http://127.0.0.1:5173/fixture.html?photos={count}')
            page.wait_for_selector('.ai-space-page.is-layered')
            page.wait_for_timeout(500)
            assert page.locator('.space-live-photo').count() == count
            hit = page.locator('.space-scene-hotspot.is-photo-wall').bounding_box()
            rects = page.locator('.space-live-photo').evaluate_all('(es)=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})')
            if rects:
                left=min(r['x'] for r in rects); top=min(r['y'] for r in rects)
                right=max(r['x']+r['width'] for r in rects); bottom=max(r['y']+r['height'] for r in rects)
                assert max(abs(hit['x']-left),abs(hit['y']-top),abs(hit['x']+hit['width']-right),abs(hit['y']+hit['height']-bottom)) <= 4
                assert left >= -4 and right <= 394
            page.locator('.space-scene-hotspot.is-photo-wall').click()
            page.wait_for_timeout(500)
            assert page.locator('.photo-archive-page').is_visible()
            assert not case_errors
            report['photoCountCases'].append({'count':count,'hotspot':hit,'visiblePhotos':rects,'archiveOpened':True,'pageerrors':case_errors})
            context.close()
        browser.close()
finally:
    server.shutdown()
    (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps({'modes': len(report['rows']), 'result': 'PASS', 'realDevice': False}))
