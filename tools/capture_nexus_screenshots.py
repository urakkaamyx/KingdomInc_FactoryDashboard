"""Capture the current dashboard against the live game in an isolated browser."""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.request import urlopen
import zipfile
from playwright.async_api import async_playwright

PROJECT = Path(__file__).resolve().parents[1]
OUT = PROJECT / 'Releases/Nexus/Screenshots'
ADDRESS = 'http://127.0.0.1:17841'

async def main():
    with urlopen('http://127.0.0.1:17840/api/v1/snapshot?sections=session,factory', timeout=5) as response:
        snapshot = json.load(response)
    assert snapshot['sections']['session']['data']['loaded'], 'Load a kingdom first.'
    OUT.mkdir(parents=True, exist_ok=True)
    errors, captures = [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width':1920, 'height':1080}, device_scale_factor=1, timezone_id='America/New_York')
        page = await context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(ADDRESS)
        await page.wait_for_function("document.querySelector('#connection').textContent.includes('Kingdom connected')")

        async def capture(filename, caption):
            await page.evaluate('document.fonts.ready')
            await page.locator('#toast').wait_for(state='hidden')
            await page.mouse.move(1900, 12)
            await page.screenshot(path=str(OUT / filename), animations='disabled')
            captures.append({'file':filename, 'caption':caption, 'width':1920, 'height':1080})

        # These goals exist only in this disposable browser context.
        await page.locator('.add-production').click()
        await page.locator('[data-item="iron_sword"]').click()
        await page.locator('#new-rate').fill('0.5')
        await page.locator('#create-goal').click()
        await page.locator('.add-production').click()
        await page.locator('#production-kind').select_option('objective')
        await page.locator('[data-item="WarEffort"]').click()
        await page.locator('#create-goal').click()
        await page.locator('#add-objective-input').select_option('conscript')
        await page.locator('[data-feed-rate]').fill('0.25')
        await page.locator('[data-feed-rate]').press('Tab')
        await page.locator('[data-add-stage]').select_option('outfit:iron_sword')
        await page.locator('[data-add-stage]').select_option('training')
        assert not await page.locator('.plan-issues').count()
        await page.evaluate('window.scrollTo(0,0)')
        await capture('02-production-and-preparation.png', 'Set an objective input rate, then outfit and train its incoming Conscripts in the selected order.')

        await page.locator('[data-action="generate-layout"]').click()
        await page.locator('.layout-svg').wait_for()
        await page.locator('[data-layout-fullscreen]').click()
        await page.locator('[data-layout-machines]').click()
        await page.locator('[data-layout-zoom="fit"]').click()
        await capture('03-individual-machine-flow.png', 'Expand shows every individual machine and physical pipe. Fullscreen fits the complete flow to the window.')
        outfitter = page.locator('.layout-node[data-layout-node]').filter(has_text='Outfitter').first
        await outfitter.press('Enter')
        assert await page.locator('.layout-node.is-related').count() > 0
        await page.locator('[data-layout-inspect]').click()
        await page.locator('#detail-dialog').wait_for()
        await capture('04-node-modifiers.png', 'Inspect the selected machine for its equipment, preparation modifiers, settings and input/output connections.')
        await page.keyboard.press('Escape')
        await page.locator('[data-layout-clear]').click()
        await page.locator('[data-layout-machines]').click()
        await page.locator('[data-layout-zoom="fit"]').click()
        await capture('08-compact-generated-layout.png', 'A compact grouped build guide keeps production, utility routing and ordered preparation in one fullscreen overview.')
        await page.keyboard.press('Escape')

        await page.locator('.tabs [data-view="overview"]').click()
        for summary in await page.locator('.floor-containers > details[open] > summary').all():
            await summary.click()
        await page.wait_for_function("document.querySelector('[data-treasury-net=Gold] .money-rate')")
        await page.evaluate('window.scrollTo(0,0)')
        await capture('01-factory-overview.png', 'Live factory overview with current progress, coin balances, observed profit/deficit and workshop Containers.')

        await page.locator('.tabs [data-view="factory"]').click()
        await page.evaluate('window.scrollTo(0,0)')
        await capture('05-container-register.png', 'The building register groups your actual workshop by Container, with final products, measured delivery rates and scoped revenue/profit.')

        await page.locator('.tabs [data-view="resources"]').click()
        await page.evaluate('window.scrollTo(0,0)')
        await capture('06-resource-ledger.png', 'Compare shared kingdom quotas, live demand, spare supply and the extra demand from your production plans.')

        await page.locator('.tabs [data-view="research"]').click()
        await page.evaluate('window.scrollTo(0,0)')
        await capture('07-research-ledger.png', 'Research availability follows the running kingdom; inspect requirements as new technologies become available.')
        assert not errors, errors
        await browser.close()

    captures.sort(key=lambda c: c['file'])
    readme = 'NEXUS SCREENSHOTS - Kingdom Inc. Factory Planner 0.1.3\n\n'
    readme += 'Actual dashboard screenshots against the running kingdom; no simulated API data.\n'
    readme += 'Each PNG is 1920 x 1080. Suggested lead image: 01-factory-overview.png.\n'
    readme += 'Production targets were created only in an isolated browser session.\n'
    readme += 'The game and your normal browser plans were not modified.\n\n'
    readme += '\n\n'.join(c['file'] + '\n' + c['caption'] for c in captures) + '\n'
    (OUT / 'CAPTIONS.txt').write_text(readme, encoding='utf-8')
    report = {'capturedAtUtc':datetime.now(timezone.utc).isoformat(), 'realApi':True, 'simulatedData':False,
              'gameMutations':False, 'normalBrowserStorageModified':False, 'pageErrors':errors, 'screenshots':captures}
    (OUT / 'screenshots.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    archive = OUT.parent / 'KingdomInc-FactoryPlanner-0.1.3-screenshots.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
        for path in sorted(OUT.iterdir()):
            if path.is_file(): output.write(path, path.name)
    print(json.dumps({'screenshots':len(captures), 'archive':archive.name, 'bytes':archive.stat().st_size, 'realApi':True, 'pageErrors':errors}, indent=2))

if __name__ == '__main__':asyncio.run(main())
