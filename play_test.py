"""Interactive playtest: click Play, walk forward, shoot, reload, then report state.
The VM's swiftshader renders at ~1 FPS, so inputs are HELD (a quick click falls
between frames) and the reload is awaited with a poll instead of a fixed sleep."""
import sys
import time
from playwright.sync_api import sync_playwright

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
        page.goto(BASE + '/', wait_until='commit')
        time.sleep(3)
        state0 = page.evaluate('window.__duskline.state')
        print('start:', state0)
        page.click('#play')
        time.sleep(0.5)
        page.click('#buy-close')
        time.sleep(0.5)
        # Walk forward: hold W for 10 real seconds (~1.5 sim seconds at 1 FPS).
        page.keyboard.down('w')
        time.sleep(10)
        page.keyboard.up('w')
        state1 = page.evaluate('window.__duskline.state')
        print('after walk:', state1)
        # Shoot 3 times, holding the button down each time so a frame sees it.
        for _ in range(3):
            page.mouse.move(640, 360)
            page.mouse.down()
            time.sleep(0.6)
            page.mouse.up()
            time.sleep(0.4)
        state2 = page.evaluate('window.__duskline.state')
        print('after shots:', state2)
        # Reload, then wait (up to 40 s) for the magazine to refill.
        page.keyboard.press('r')
        try:
            page.wait_for_function('window.__duskline.state.mag === 12', timeout=40000)
        except Exception as exc:
            print('reload wait timed out:', exc)
        state3 = page.evaluate('window.__duskline.state')
        print('after reload:', state3)
        browser.close()
    problems = []
    if not (state1['position'][2] < state0['position'][2] - 3):
        problems.append(f"did not walk north: z {state0['position'][2]} -> {state1['position'][2]}")
    if not (state2['mag'] < state0['mag']):
        problems.append(f"ammo did not drop after shooting: {state0['mag']} -> {state2['mag']}")
    if not (state3['mag'] == 12):
        problems.append(f"reload did not refill mag: {state3['mag']}")
    if errors:
        problems.extend(errors)
    if problems:
        print('PROBLEMS:')
        for x in problems:
            print(' -', x)
        return 1
    print('interactive playtest OK: walked, shot, reloaded, no errors')
    return 0

if __name__ == '__main__':
    sys.exit(main())
