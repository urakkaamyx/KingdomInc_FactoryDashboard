"""Read-only smoke check against the running dashboard and loaded kingdom."""
import asyncio,json
from datetime import datetime,timezone
from pathlib import Path
from urllib.request import urlopen
from playwright.async_api import async_playwright

PROJECT=Path(__file__).resolve().parents[1]

async def main():
    with urlopen('http://127.0.0.1:17840/api/v1/snapshot?sections=session,factory',timeout=5) as response:
        snapshot=json.load(response)
    assert snapshot['sections']['session']['data']['loaded']
    counts=sum(len(f['buildings']) for f in snapshot['sections']['factory']['data']['flows'])
    errors=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        page=await browser.new_page(viewport={'width':1440,'height':1100})
        page.on('pageerror',lambda error:errors.append(str(error)))
        await page.goto('http://127.0.0.1:17841')
        await page.wait_for_function("document.querySelector('#connection').textContent.includes('Kingdom connected')",timeout=15000)
        await page.wait_for_function("document.querySelectorAll('.room-card').length>0")
        container_count=await page.locator('[data-floor-container]').count()
        assert container_count>0
        await page.screenshot(path=str(PROJECT/'Verification/live-overview-desktop.png'),full_page=True)
        await page.locator('.tabs [data-view="factory"]').click()
        displayed=await page.locator('tr[data-building]').count()
        assert displayed>0
        ids=await page.locator('tr[data-building]').evaluate_all('rows=>rows.map(row=>row.dataset.building)')
        assert len(ids)==len(set(ids))
        assert await page.locator('[data-register-container]').count()>0
        await page.locator('tr[data-building]').first.click()
        assert await page.locator('#detail-dialog').is_visible()
        await page.keyboard.press('Escape')
        await page.locator('.tabs [data-view="research"]').click()
        assert await page.locator('.research-summary').is_visible()
        await page.locator('.tabs [data-view="resources"]').click()
        assert await page.locator('table').is_visible()
        await page.locator('.tabs [data-view="overview"]').click()
        await page.locator('.add-production').click()
        await page.locator('#production-kind').select_option('objective')
        objectives=await page.locator('#item-picker [data-item]').count()
        assert objectives>0
        assert not await page.locator('#new-rate-fields').is_visible()
        await page.screenshot(path=str(PROJECT/'Verification/live-objective-picker.png'),full_page=True)
        generated=False
        if await page.locator('[data-item="WarEffort"]').count():
            await page.locator('[data-item="WarEffort"]').click();await page.locator('#create-goal').click()
            await page.locator('#add-objective-input').select_option('conscript')
            if await page.locator('[data-add-stage] option[value="outfit:iron_sword"]').count():
                await page.locator('[data-add-stage]').select_option('outfit:iron_sword')
            await page.locator('[data-action="generate-layout"]').click()
            await page.locator('.layout-svg').wait_for()
            assert await page.locator('.layout-node').count()>1
            await page.locator('#generated-layout').screenshot(path=str(PROJECT/'Verification/live-generated-layout.png'))
            await page.locator('[data-layout-fullscreen]').click()
            assert await page.locator('#generated-layout').get_attribute('aria-modal')=='true'
            assert await page.locator('.layout-scroll').evaluate('el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1')
            if await page.locator('.layout-node.preparation').count():
                await page.locator('.layout-node.preparation').first.press('Enter')
                assert await page.locator('.layout-node.is-related').count()>0
            await page.screenshot(path=str(PROJECT/'Verification/live-generated-layout-expanded.png'))
            await page.locator('[data-layout-machines]').click()
            expected=await page.evaluate("Object.values(JSON.parse(localStorage.getItem('kingdom-dashboard:layouts')))[0].layout.nodes.reduce((s,n)=>s+Math.max(1,n.count),0)")
            assert await page.locator('.layout-node').count()==expected
            assert await page.locator('[data-layout-machines]').inner_text()=='Group machines'
            assert await page.locator('[data-layout-fullscreen]').inner_text()=='Exit fullscreen'
            assert not await page.locator('[data-layout-arrangement]').count()
            await page.locator('[data-layout-zoom="reset"]').click()
            await page.locator('.layout-node.preparation').first.press('Enter')
            await page.locator('[data-layout-machines]').hover()
            await page.screenshot(path=str(PROJECT/'Verification/live-individual-machine-flow.png'))
            await page.locator('[data-layout-inspect]').click()
            assert await page.locator('.detail-metric strong').first.inner_text()=='1'
            await page.keyboard.press('Escape')
            await page.keyboard.press('Escape')
            generated=True
        else:await page.keyboard.press('Escape')
        assert not errors,errors
        report={'passed':True,'testedAtUtc':datetime.now(timezone.utc).isoformat(),'realApi':True,'fixture':False,
                'apiBuildingCountAtStart':counts,'displayedBuildings':displayed,'connection':'live',
                'researchAndResourcesViews':True,'buildingInspector':True,'containerGroups':container_count,'registerRowsUnique':True,'objectivePicker':True,'generatedLiveBuildGuide':generated,'expandedLiveBuildGuide':generated,'individualMachineFlow':generated,'unlockedObjectiveTypes':objectives,'pageErrors':errors,'gameMutations':False}
        (PROJECT/'Verification/live-browser-tests.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report,indent=2));await browser.close()

if __name__=='__main__':asyncio.run(main())
