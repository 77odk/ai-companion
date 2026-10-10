#!/usr/bin/env python3
"""G1: read-only mobile smoke for a locally running Eluvin dev/preview server.

No seeded users, no app data writes, no fake photos, no npm dependencies.
An optional headed login stays in browser memory; no state export is required.
Existing local test-account storage-state remains supported, never committed.
This does NOT substitute a real-device visual review.
Examples:
  python scripts/g1_space_mobile_smoke.py --url http://localhost:5173 --interactive-login
  python scripts/g1_space_mobile_smoke.py --url http://localhost:5173 --storage-state /tmp/test-user-state.json
Exit codes: 0 = fallback smoke passed or gated (NOT G1 visual approval),
1 = actual runtime defect, 2 = no authenticated session / not reachable.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, urljoin

VIEWPORTS = ((390, 844), (390, 690), (430, 932))


def origin_is_safe(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}


def run(url: str, storage_state: str | None, screenshots: Path | None,
        interactive_login: bool = False, cdp_url: str | None = None) -> int:
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as BrowserTimeout
    except ImportError:
        print("BLOCKED: Python Playwright is not installed in this QA environment", file=sys.stderr)
        return 2

    results = []
    try:
        source_commit = subprocess.run(['git', 'rev-parse', 'HEAD'], check=True,
                                       capture_output=True, text=True, timeout=3).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        source_commit = None
    served_version = None
    blocked = False
    failed = False
    with sync_playwright() as pw:
        browser = (pw.chromium.connect_over_cdp(cdp_url) if cdp_url else
                   pw.chromium.launch(headless=not interactive_login, args=["--no-sandbox"]))
        # One ephemeral context keeps the user's normal login across all three
        # sizes. It is never exported or written to a persistent browser profile.
        shared_context = (browser.contexts[0] if cdp_url and browser.contexts else
                          browser.new_context(device_scale_factor=2, is_mobile=True,
                                              has_touch=True) if interactive_login else None)
        if cdp_url and not shared_context:
            raise RuntimeError('Local test browser has no existing context; do not fabricate authentication')
        try:
            for width, height in VIEWPORTS:
                context_args = {
                    "viewport": {"width": width, "height": height},
                    "device_scale_factor": 2,
                    "is_mobile": True,
                    "has_touch": True,
                    "reduced_motion": "reduce" if height == 690 else "no-preference",
                }
                if storage_state:
                    context_args["storage_state"] = storage_state
                context = shared_context or browser.new_context(**context_args)
                page = context.new_page()
                page.set_viewport_size({"width": width, "height": height})
                page.emulate_media(reduced_motion=context_args["reduced_motion"])
                errors: list[str] = []
                page.on("pageerror", lambda exception: errors.append(str(exception)))
                page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
                record = {"viewport": f"{width}x{height}", "status": "UNKNOWN"}
                try:
                    response = page.goto(url, wait_until="domcontentloaded", timeout=15000)
                    if not response or response.status >= 400:
                        raise RuntimeError("app did not return HTTP 2xx/3xx")
                    if served_version is None:
                        try:
                            version_response = context.request.get(urljoin(url, '/version.json'), timeout=5000)
                            value = version_response.json().get('version')
                            if version_response.ok and isinstance(value, str):
                                served_version = value
                        except Exception:
                            pass  # Dev servers may not publish a version asset.
                    # Login / consent are intentionally never bypassed.
                    nav = page.locator(".app-nav button.nav-btn").filter(has_text="空间")
                    try:
                        if interactive_login and not results:
                            print("请在本地浏览器正常登录专用测试账号并完成同意页面；无需导出登录态。", file=sys.stderr)
                        nav.wait_for(state="visible", timeout=180000 if interactive_login and not results else 7500)
                    except BrowserTimeout:
                        record["status"] = "BLOCKED_AUTH_OR_CONSENT"
                        blocked = True
                        results.append(record)
                        continue
                    nav.click()
                    root = page.locator(".ai-space-page")
                    root.wait_for(state="visible", timeout=10000)
                    page.wait_for_timeout(1200)
                    layout = page.evaluate("""async () => {
                        const root=document.querySelector('.ai-space-page');
                        const scene=root?.querySelector('.space-scene-shell');
                        const drawer=root?.querySelector('.space-scene-hotspot.is-weekly-letter');
                        const backplates=[...root.querySelectorAll('.space-scene-backplate')];
                        const images=[...root.querySelectorAll('img')].filter(image=>{
                            const style=getComputedStyle(image), rect=image.getBoundingClientRect();
                            return style.display!=='none' && style.visibility!=='hidden' && rect.width>0 && rect.height>0;
                        });
                        const decoded=await Promise.all(images.map(image=>image.decode().then(()=>true,()=>false)));
                        const sceneRect=scene?.getBoundingClientRect();
                        const drawerRect=drawer?.getBoundingClientRect();
                        const intersect=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))
                            *Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
                        const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
                        return {
                            viewportWidth:innerWidth, documentWidth:document.documentElement.scrollWidth,
                            layered:root.classList.contains('is-layered'),
                            unapprovedReviewBuild:root.dataset.spaceArtReview==='unapproved',
                            sceneRatio:sceneRect ? sceneRect.width/sceneRect.height : null,
                            drawerPresent:!!drawer, drawerVisibleArea:drawerRect ? intersect(drawerRect,viewport):0,
                            brokenBackplates:backplates.filter(x=>!x.complete || x.naturalWidth===0).length,
                            brokenVisibleImages:images.filter((x,index)=>!x.complete || x.naturalWidth===0 || !decoded[index]).length,
                            scenePresent:!!scene
                        };
                    }""")
                    record.update(layout)
                    if source_commit and served_version == source_commit:
                        record['buildMatchesCheckout'] = True
                    elif source_commit and served_version and len(served_version) == 40 and all(c in '0123456789abcdef' for c in served_version):
                        record['buildMatchesCheckout'] = False
                        errors.append('served build SHA differs from the current checkout; rebuild before review')
                    else:
                        record['buildMatchesCheckout'] = None
                    if not layout["scenePresent"] or not layout["drawerPresent"]:
                        errors.append("scene / weekly-letter hit area is missing")
                    if layout["brokenBackplates"]:
                        errors.append("one or more space backplates failed to load")
                    if layout["brokenVisibleImages"]:
                        errors.append("one or more visible space object/content images failed to load")
                    if layout["documentWidth"] > layout["viewportWidth"] + 1:
                        errors.append("horizontal overflow")
                    if layout["sceneRatio"] is None or abs(layout["sceneRatio"] - 941 / 1672) > .01:
                        errors.append("scene aspect ratio differs from 941:1672")
                    if not layout["drawerVisibleArea"]:
                        errors.append("drawer hit area is not visible at this viewport")
                    record["errorCount"] = len(errors)
                    # Do not upload screenshots: live photos and account contents
                    # may be visible. Opt-in screenshots are saved only locally.
                    if screenshots:
                        screenshots.mkdir(parents=True, exist_ok=True)
                        page.screenshot(path=str(screenshots / f"space_{width}x{height}.png"))
                    record["status"] = "FAIL" if errors else (
                        "UNAPPROVED_LAYERED_REVIEW_SMOKE_ONLY" if layout["layered"] and layout["unapprovedReviewBuild"] else
                        "LAYERED_RUNTIME_SMOKE_ONLY" if layout["layered"] else "FALLBACK_SMOKE_ONLY")
                    if errors:
                        record["errors"] = [error[:140] for error in errors[:8]]
                        failed = True
                except Exception as exc:
                    record["status"] = "FAIL"
                    record["errors"] = [str(exc)[:200]]
                    failed = True
                finally:
                    if record not in results:
                        results.append(record)
                    page.close()
                    if not shared_context:
                        context.close()
        finally:
            if shared_context and not cdp_url:
                shared_context.close()
            if not cdp_url:
                browser.close()
    print(json.dumps({"check": "G1_BROWSER_PREFLIGHT_NOT_VISUAL_SIGNOFF",
                      "sourceCommit": source_commit, "servedBuildVersion": served_version,
                      "interactiveLoginNoStateExport": interactive_login,
                      "existingLocalBrowserContext": bool(cdp_url),
                      "viewportMode": "borrowed-context-viewport-only" if cdp_url else "mobile-touch-context",
                      "manifestArtGateNotBypassed": True,
                      "screenshotsOptIn": bool(screenshots), "results": results}, ensure_ascii=False, indent=2))
    return 1 if failed else (2 if blocked else 0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:5173")
    parser.add_argument("--storage-state", help="Local test-account state, never commit to repo")
    parser.add_argument("--interactive-login", action="store_true", help="Log in normally in a local headed browser; no credential export")
    parser.add_argument("--cdp-url", help="Optional localhost HTTP debug endpoint of an already logged-in dedicated test browser; no state export")
    parser.add_argument("--screenshots", type=Path, help="Opt-in PRIVATE local screenshot directory")
    args = parser.parse_args()
    if not origin_is_safe(args.url):
        parser.error("G1 preflight only accepts local HTTP preview URLs, never production")
    if args.storage_state and not Path(args.storage_state).is_file():
        parser.error("storage-state file not found (do not fabricate a logged-in account)")
    if sum(bool(value) for value in (args.interactive_login, args.storage_state, args.cdp_url)) > 1:
        parser.error("Choose interactive login, existing local browser, or existing local state")
    if args.cdp_url and (not origin_is_safe(args.cdp_url) or urlparse(args.cdp_url).username or urlparse(args.cdp_url).password):
        parser.error("Only a localhost HTTP debug endpoint without credentials is supported")
    return run(args.url, args.storage_state, args.screenshots, args.interactive_login, args.cdp_url)


if __name__ == "__main__":
    sys.exit(main())
