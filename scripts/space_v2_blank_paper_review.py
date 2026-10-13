#!/usr/bin/env python3
"""Isolated blank-paper CSS visual lab. No account/content injection or App QA."""
import argparse
import json
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright


def run(html, output):
    source = html.read_text()
    if 'ISOLATED_EMPTY_ACCOUNT_COMPONENT_REVIEW' not in source:
        raise ValueError('Only the explicit empty-account component fixture is allowed')
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(source)
        page.wait_for_selector('.ai-space-page.is-layered')
        page.locator('.space-scene-hotspot.is-thought-book').click()
        page.wait_for_selector('.thought-book-page.is-native-object-focus')
        page.wait_for_timeout(300)
        for direction in ['next', 'prev']:
            for progress in [0, .25, .5, .75, 1]:
                # Only blank faces from the real CSS; do not manufacture TA text
                # or feed these DOM frames into the application's data layer.
                page.evaluate('''({direction,progress})=>{
                  const pages=document.querySelector('.thought-book-pages');
                  pages.replaceChildren();
                  const turn=document.createElement('div');
                  turn.className='thought-book-turning-page is-'+direction;
                  for (const side of ['front','back']) {
                    const face=document.createElement('div');
                    face.className='thought-book-face is-'+side; turn.append(face);
                  }
                  pages.append(turn);
                  for (const animation of turn.getAnimations({subtree:true})) {
                    animation.pause(); animation.currentTime=440*progress;
                  }
                }''', {'direction': direction, 'progress': progress})
                page.screenshot(path=str(output / f'{direction}-{round(progress * 100):03}.png'))
        assert not errors, errors
        browser.close()
    report = {'kind': 'ISOLATED_BLANK_PAPER_CSS_VISUAL_LAB', 'realAppAuthenticated': False,
              'contentSeeded': False, 'realThoughtPaginationVerified': False,
              'viewport': '390x844', 'frames': 10, 'pageErrors': errors}
    (output / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.html, args.out)
