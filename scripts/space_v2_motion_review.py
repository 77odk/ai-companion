#!/usr/bin/env python3
"""Measure actual local foliage rendering in the empty-account review.

CPU throttling is desktop simulation, never physical-phone acceptance.
No account, weather, content or visibility state is fabricated.
"""
import argparse
import json
import shutil
from pathlib import Path


def run(html_path, output, record_video=False):
    from playwright.sync_api import sync_playwright
    html = html_path.read_text()
    assert 'ISOLATED_EMPTY_ACCOUNT_COMPONENT_REVIEW' in html
    output.mkdir(parents=True, exist_ok=True)
    report = {'kind': 'ISOLATED_EMPTY_ACCOUNT_MOTION_REVIEW',
              'physicalPhone': False, 'errors': [], 'samples': []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=shutil.which('chromium'),
                                     args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = browser.new_page(viewport={'width': 390, 'height': 844},
                                **({'record_video_dir': str(output / 'video'),
                                    'record_video_size': {'width': 390, 'height': 844}} if record_video else {}))
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.on('console', lambda m: report['errors'].append(m.text) if m.type == 'error' else None)
        page.set_content(html, wait_until='load')
        page.wait_for_selector('.space-foliage-canvas')
        page.wait_for_timeout(1500)
        page.evaluate('''()=>{
          window.__paintReview=[];
          const original=CanvasRenderingContext2D.prototype.clearRect;
          CanvasRenderingContext2D.prototype.clearRect=function(...args){
            if(this.canvas.matches('.space-foliage-canvas')) {
              const now=performance.now();
              this.__reviewStart=now; this.__reviewRows=0;
              this.__reviewSample={time:now,width:this.canvas.width};
              window.__paintReview.push(this.__reviewSample);
            }
            return original.apply(this,args);
          };
          const restore=CanvasRenderingContext2D.prototype.restore;
          CanvasRenderingContext2D.prototype.restore=function(...args){
            const result=restore.apply(this,args);
            if(this.canvas.matches('.space-foliage-canvas') && ++this.__reviewRows===36)
              this.__reviewSample.paintMs=performance.now()-this.__reviewStart;
            return result;
          };
        }''')
        cdp = page.context.new_cdp_session(page)

        def sample(name, duration):
            page.evaluate('window.__paintReview=[]')
            page.wait_for_timeout(duration)
            result = page.evaluate('''()=>{
              const times=window.__paintReview.filter(p=>p.width===325).map(p=>p.time);
              const intervals=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);
              const paint=window.__paintReview.filter(p=>p.width===325&&p.paintMs!=null).map(p=>p.paintMs).sort((a,b)=>a-b);
              return {frames:times.length,paintP95Ms:paint[Math.floor(paint.length*.95)]??null,intervalMedianMs:intervals[Math.floor(intervals.length*.5)]??null,
                intervalP95Ms:intervals[Math.floor(intervals.length*.95)]??null,
                motion:document.querySelector('.ai-space-page')?.dataset.spaceMotion,
                environment:document.querySelector('.ai-space-page')?.dataset.spaceEnvironment};
            }''')
            result.update(name=name, durationMs=duration)
            report['samples'].append(result)
            return result

        sample('normal idle', 2200)
        page.emulate_media(reduced_motion='reduce')
        page.wait_for_function("document.querySelector('.ai-space-page').dataset.spaceMotion==='off'")
        assert sample('runtime reduced-motion', 1200)['frames'] == 0
        page.screenshot(path=str(output / 'reduced-motion.png'))
        page.emulate_media(reduced_motion='no-preference')
        page.wait_for_timeout(150)
        assert sample('motion resumed', 1200)['frames'] > 0
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 6})
        sample('desktop CPU 6x slowdown', 3000)
        page.screenshot(path=str(output / 'cpu-slowdown.png'))
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
        # Run across the shared wind's 23.4-second cycle, without advancing
        # fake clocks or manufacturing a live weather signal.
        page.wait_for_timeout(24000)
        sample('after full wind cycle', 1200)
        page.screenshot(path=str(output / 'wind-cycle.png'))
        page.locator('.space-scene-hotspot.is-star-jar').click()
        page.wait_for_timeout(600)
        assert page.evaluate('window.__spaceReview.view') == 'jar'
        assert sample('scene unmounted', 1200)['frames'] == 0
        page.get_by_role('button', name='返回', exact=False).first.click()
        page.wait_for_timeout(1200)
        assert sample('scene remounted', 1200)['frames'] > 0
        # Ask Chromium to switch real tabs. Some headless implementations keep
        # both tabs visible; report that limitation rather than fake hidden.
        other = browser.new_page()
        other.bring_to_front()
        hidden = page.evaluate('document.hidden')
        report['backgroundTabSupported'] = hidden
        if hidden:
            assert sample('actual background tab', 1200)['frames'] == 0
        other.close()
        page.bring_to_front()
        report['finalLayout'] = page.evaluate('''()=>({width:document.documentElement.scrollWidth,
          viewport:innerWidth,broken:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length})''')
        assert report['finalLayout']['width'] <= 390
        assert report['finalLayout']['broken'] == 0
        browser.close()
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return int(bool(report['errors']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--video', action='store_true', help='Optional recording; affects measured timings')
    args = parser.parse_args()
    raise SystemExit(run(args.html, args.out, args.video))
