"""Smoke-test DUSKLINE: serve game/, load each ?shot= capture in headless Chromium
with swiftshader WebGL, fail on any console error, save real screenshots."""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
SHOTS = json.loads((ROOT / 'shots.json').read_text())
BASE = 'http://127.0.0.1:8080'

def main() -> int:
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/home/hatch/.cache/ms-playwright/chrome-linux64/chrome', args=[
            '--enable-unsafe-swiftshader',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--no-sandbox',
        ])
        page = browser.new_page(viewport={'width': 1280, 'height': 720})
        page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        page.on('requestfailed', lambda r: errors.append(f'requestfailed: {r.url} {r.failure}'))

        # Plain page first: it must boot with no errors and show the start overlay.
        page.goto(BASE + '/', wait_until='commit')
        time.sleep(4)
        overlay_visible = page.evaluate("!document.getElementById('overlay').hidden")
        print('plain page overlay visible:', overlay_visible)
        if not overlay_visible:
            errors.append('plain page: start overlay not visible')

        for shot in SHOTS:
            url = f"{BASE}/?{shot['query'].lstrip('?')}"
            print('loading', url)
            page.goto(url, wait_until='commit')
            try:
                page.wait_for_function('window.__shotReady === true', timeout=120000)
            except Exception as exc:
                errors.append(f"{shot['name']}: __shotReady timeout ({exc})")
                continue
            out = ROOT / 'screenshots' / shot['name']
            page.screenshot(path=str(out), type='jpeg', quality=80)
            size = out.stat().st_size
            print(f"  -> {out.name} {size} bytes")
            if size > 262144:
                errors.append(f"{shot['name']}: {size} bytes > 256 KiB cap")
        browser.close()
    if errors:
        print('ERRORS:')
        for e in errors:
            print(' -', e)
        return 1
    print('all shots OK, no console errors')
    return 0

if __name__ == '__main__':
    sys.exit(main())
