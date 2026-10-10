#!/usr/bin/env python3
"""Exercise candidate detail gates and decode failure in the empty fixture.

Never loads App, creates accounts, seeds content, exports credentials or edits
the product manifest. The injected resource failures exist only in this fixture.
"""
import argparse
import json
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright


def run(html_path, output):
    html = html_path.read_text()
    if 'ISOLATED_EMPTY_ACCOUNT_COMPONENT_REVIEW' not in html:
        raise ValueError('An isolated empty-account fixture is required')
    output.mkdir(parents=True, exist_ok=True)
    report = {'kind': 'ISOLATED_EMPTY_ACCOUNT_DETAIL_FAILURE_REVIEW', 'realAppAuthenticated': False, 'cases': []}
    injections = {
        'ResizeObserver unavailable': 'window.ResizeObserver=undefined;',
        'artwork gate closed': """(()=>{
          const fetchResource=window.fetch;
          window.fetch=async url=>{
            const response=await fetchResource(url);
            if(String(url)!=='/space/layered/manifest.json') return response;
            const manifest=await response.json(); manifest.enabled=false; manifest.artApproved=false;
            return new Response(JSON.stringify(manifest),{status:200});
          };
        })();""",
        'native room decode failed': """(()=>{
          window.__nativeDecodeFailures=0;
          const fail=element=>element.classList.contains('space-object-native-room');
          const invalid='data:image/png;base64,AAAA';
          const src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
          Object.defineProperty(HTMLImageElement.prototype,'src',{...src,set(value){
            if(fail(this)){window.__nativeDecodeFailures++;src.set.call(this,invalid)}else src.set.call(this,value);
          }});
          const attribute=Element.prototype.setAttribute;
          Element.prototype.setAttribute=function(name,value){
            if(this instanceof HTMLImageElement&&name==='src'&&fail(this)){
              window.__nativeDecodeFailures++;return attribute.call(this,name,invalid);
            }
            return attribute.call(this,name,value);
          };
        })();""",
    }
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox', '--disable-dev-shm-usage'])
        for name, injection in injections.items():
            page = browser.new_page(viewport={'width': 390, 'height': 690}, device_scale_factor=2, is_mobile=True, has_touch=True)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_content(html.replace('</script><script>', '</script><script>' + injection + '</script><script>', 1))
            page.wait_for_selector('.space-scene-hotspot.is-player')
            page.wait_for_timeout(1000)
            for kind, selector in [('jar', 'is-star-jar'), ('player', 'is-player')]:
                page.locator('.space-scene-hotspot.' + selector).tap()
                page.wait_for_timeout(1000)
                native = page.locator('.is-native-object-focus').count()
                if name == 'native room decode failed':
                    assert page.evaluate('window.__nativeDecodeFailures') > 0, 'must actually exercise the native image decode failure'
                expected_native = name == 'ResizeObserver unavailable'
                assert bool(native) == expected_native, 'art gate and decode failures must fall back; missing ResizeObserver must remain usable'
                if kind == 'player':
                    with page.expect_file_chooser():
                        page.get_by_role('button', name='去接音乐', exact=True).tap()
                    if expected_native:
                        page.set_viewport_size({'width': 430, 'height': 932})
                        page.wait_for_timeout(400)
                        with page.expect_file_chooser():
                            page.get_by_role('button', name='去接音乐', exact=True).tap()
                page.screenshot(path=str(output / f'{name.replace(" ", "-")}-{kind}.png'))
                page.get_by_role('button', name='返回', exact=False).first.tap()
                page.wait_for_timeout(1000)
                assert page.evaluate('window.__spaceReview.view') == 'space'
            assert not errors, errors
            report['cases'].append({'name': name, 'nativeFocus': name == 'ResizeObserver unavailable', 'returns': 'space', 'filePicker': True, 'pageErrors': errors})
            page.close()
        browser.close()
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.html, args.out)
