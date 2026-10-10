#!/usr/bin/env python3
"""G1: read-only mobile smoke for a locally running Eluvin dev/preview server.

No seeded users, no app data writes, no fake photos, no npm dependencies.
Requires an existing *test-account* Playwright storage-state JSON; never
commit that file. This does NOT substitute a real-device visual review.
Examples:
  python scripts/g1_space_mobile_smoke.py --url http://127.0.0.1:4173 --storage-state /tmp/test-user-state.json
  python scripts/g1_space_mobile_smoke.py --url http://localhost:5173
Exit codes: 0 = fallback smoke passed or gated (NOT G1 visual approval),
1 = actual runtime defect, 2 = no authenticated session / not reachable.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

VIEWPORTS = ((390, 844), (390, 690), (430, 932))


def origin_is_safe(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}


def run(url: str, storage_state: str | None, screenshots: Path | None) -> int:
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as BrowserTimeout
    except ImportError:
        print("BLOCKED: Python Playwright is not installed in this QA environment", file=sys.stderr)
        return 2

    results = []
    blocked = False
    failed = False
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])
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
                context = browser.new_context(**context_args)
                page = context.new_page()
                errors: list[str] = []
                page.on("pageerror", lambda exception: errors.append(str(exception)))
                page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
                record = {"viewport": f"{width}x{height}", "status": "UNKNOWN"}
                try:
                    response = page.goto(url, wait_until="domcontentloaded", timeout=15000)
                    if not response or response.status >= 400:
                        raise RuntimeError("app did not return HTTP 2xx/3xx")
                    # Login / consent are intentionally never bypassed.
                    nav = page.locator(".app-nav button.nav-btn").filter(has_text="空间")
                    try:
                        nav.wait_for(state="visible", timeout=7500)
                    except BrowserTimeout:
                        record["status"] = "BLOCKED_AUTH_OR_CONSENT"
                        blocked = True
                        results.append(record)
                        continue
                    nav.click()
                    root = page.locator(".ai-space-page")
                    root.wait_for(state="visible", timeout=10000)
                    page.wait_for_timeout(1200)
                    layout = page.evaluate("""() => {
                        const root=document.querySelector('.ai-space-page');
                        const scene=root?.querySelector('.space-scene-shell');
                        const drawer=root?.querySelector('.space-scene-hotspot.is-weekly-letter');
                        const backplates=[...root.querySelectorAll('.space-scene-backplate')];
                        const sceneRect=scene?.getBoundingClientRect();
                        const drawerRect=drawer?.getBoundingClientRect();
                        const intersect=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))
                            *Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
                        const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
                        return {
                            viewportWidth:innerWidth, documentWidth:document.documentElement.scrollWidth,
                            layered:root.classList.contains('is-layered'),
                            sceneRatio:sceneRect ? sceneRect.width/sceneRect.height : null,
                            drawerPresent:!!drawer, drawerVisibleArea:drawerRect ? intersect(drawerRect,viewport):0,
                            brokenBackplates:backplates.filter(x=>!x.complete || x.naturalWidth===0).length,
                            scenePresent:!!scene
                        };
                    }""")
                    record.update(layout)
                    if not layout["scenePresent"] or not layout["drawerPresent"]:
                        errors.append("scene / weekly-letter hit area is missing")
                    if layout["brokenBackplates"]:
                        errors.append("one or more space backplates failed to load")
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
                    context.close()
        finally:
            browser.close()
    print(json.dumps({"check": "G1_BROWSER_PREFLIGHT_NOT_VISUAL_SIGNOFF",
                      "manifestArtGateNotBypassed": True,
                      "screenshotsOptIn": bool(screenshots), "results": results}, ensure_ascii=False, indent=2))
    return 1 if failed else (2 if blocked else 0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173")
    parser.add_argument("--storage-state", help="Local test-account state, never commit to repo")
    parser.add_argument("--screenshots", type=Path, help="Opt-in PRIVATE local screenshot directory")
    args = parser.parse_args()
    if not origin_is_safe(args.url):
        parser.error("G1 preflight only accepts local HTTP preview URLs, never production")
    if args.storage_state and not Path(args.storage_state).is_file():
        parser.error("storage-state file not found (do not fabricate a logged-in account)")
    return run(args.url, args.storage_state, args.screenshots)


if __name__ == "__main__":
    sys.exit(main())
