"""UI checks use isolated API fixtures, never the user's game or browser profile."""
import asyncio, copy, json
from datetime import datetime, timezone
from pathlib import Path
from playwright.async_api import async_playwright

PROJECT=Path(__file__).resolve().parents[1]
API=PROJECT.parent/'FactoryPlannerApi'

def fixtures():
    catalog=json.loads((PROJECT/'dist/catalog.json').read_text(encoding='utf-8'))
    snapshot=json.loads((API/'Verification/runtime-snapshot.json').read_text(encoding='utf-8'))
    snapshot['instanceId']='dashboard-test';snapshot['sessionId']='dashboard-kingdom';snapshot['revision']=1
    data={k:v['data'] for k,v in snapshot['sections'].items()}
    data['session']['id']=snapshot['sessionId'];data['session']['loaded']=True
    purchased={'mine','forge','iron_ingot','blacksmith','iron_sword','supply_depot','wood_plank','shop'}
    data['research']=[]
    for tech in catalog['research']:
        required={v for v in [tech['rootId'],tech['previousId'],*tech['requirements']] if v}
        is_purchased=tech['id'] in purchased;locked=not required<=purchased
        data['research'].append({'id':tech['id'],'purchased':is_purchased,'locked':locked,'hidden':tech['developerOnly'],'available':not is_purchased and not locked and not tech['developerOnly']})
    data['unlocks']={'itemIds':['iron_ore','wood_plank','iron_ingot','iron_sword'],'recipeIds':['iron_ingot','iron_sword'],'buildingTypes':['Mine','Forge','Blacksmith','SupplyDepot','Shop']}
    data['upgrades']['availableByBuildingType']={name:['Worker','Overseer'] for name in data['unlocks']['buildingTypes']}
    data['resources']['quotas']=[{'itemId':item,'availablePerSecond':quota,'demandPerSecond':demand,'sparePerSecond':quota-demand,'shortfallPerSecond':0,'quotaMultiplier':1} for item,quota,demand in [('iron_ore',20,16),('wood_plank',20,9)]]
    flow=data['factory']['flows'][0]
    forge=next(b for b in flow['buildings'] if b['type']=='Forge')
    blacksmith=copy.deepcopy(forge);blacksmith.update(id='fixture-blacksmith',type='Blacksmith',recipeId='iron_sword',requiredTechId='blacksmith');flow['buildings'].append(blacksmith)
    for kind,count in [('Mine',5),('Forge',7),('Blacksmith',3)]:
        source=next(b for b in flow['buildings'] if b['type']==kind)
        for i in range(count-1):
            b=copy.deepcopy(source);b['id']=f'{kind}-{i}';flow['buildings'].append(b)
    data['economy']['currencies']={'Gold':'345078','Medal':'120','Requisition':'43'}
    for key,value in data.items(): snapshot['sections'][key]['data']=value
    return catalog,snapshot

async def main():
    catalog,snapshot=fixtures();control={'snapshot':snapshot,'online':True}
    errors=[]
    async def api_route(route):
        path=route.request.url.split('17840',1)[1]
        if not control['online']:
            await route.abort('connectionrefused');return
        current=control['snapshot']
        if path.startswith('/api/v1/health'):
            body={'apiVersion':'1','instanceId':current['instanceId'],'sessionId':current['sessionId'],'status':'live','stale':False,'readOnly':True,'revision':current['revision']}
        elif path.startswith('/api/v1/catalog'):body=catalog
        elif path.startswith('/api/v1/changes'):
            body={'apiVersion':'1','instanceId':current['instanceId'],'sessionId':current['sessionId'],'revision':current['revision'],'resyncRequired':False,'changes':[{'revision':current['revision'],'sections':list(current['sections'])}]}
        elif path.startswith('/api/v1/snapshot'):body=current
        else:body={}
        await route.fulfill(status=200,content_type='application/json',body=json.dumps(body),headers={'Access-Control-Allow-Origin':'*'})
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        context=await browser.new_context(viewport={'width':1440,'height':1100})
        await context.route('http://127.0.0.1:17840/**',api_route)
        page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        await page.goto('http://127.0.0.1:17841')
        await page.wait_for_function("document.querySelector('#connection').textContent.includes('Kingdom connected')")
        await page.screenshot(path=str(PROJECT/'Verification/overview-fixture-desktop.png'),full_page=True)
        assert await page.locator('.room-card').count()==4
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        await page.locator('.add-production').click()
        await page.locator('#item-search').fill('Iron Sword')
        await page.locator('[data-item="iron_sword"]').click()
        await page.locator('#new-rate').fill('2')
        await page.locator('#create-goal').click()
        assert await page.locator('#goal-list').inner_text()=='Iron Sword\n2 /sec\n›'
        assert await page.locator('.goal-total strong').inner_text()=='27'
        await page.screenshot(path=str(PROJECT/'Verification/production-fixture-desktop.png'),full_page=True)
        # Ongoing samples must not erase an in-progress rate edit.
        await page.locator('#goal-rate').fill('3.25')
        await page.wait_for_timeout(1000)
        assert await page.locator('#goal-rate').input_value()=='3.25'
        await page.locator('#goal-rate').press('Tab')
        assert '3.25 /sec' in await page.locator('#goal-list').inner_text()
        # Restore known rate, then read live speed upgrades into the estimate.
        await page.locator('#goal-rate').fill('2');await page.locator('#goal-rate').press('Tab')
        for b in control['snapshot']['sections']['factory']['data']['flows'][0]['buildings']:
            if b['type']=='Forge': b['speed']=2
        control['snapshot']['revision']+=1
        await page.wait_for_function("document.querySelector('.goal-total strong').textContent==='21'")
        await page.locator('[data-supply="iron_ingot"]').click()
        assert await page.locator('.goal-total strong').inner_text()=='9'
        await page.locator('[data-supply="iron_ingot"]').click()
        await page.reload();await page.wait_for_function("document.querySelector('#goal-count').textContent==='01'")
        await page.locator('[data-goal]').first.click()
        assert await page.locator('#goal-rate').input_value()=='2'
        # Actual resource budget readout, search, and research details.
        await page.locator('.tabs [data-view="resources"]').click()
        await page.locator('#resource-search').fill('Iron')
        assert await page.locator('tbody tr').count()==1
        await page.locator('.tabs [data-view="research"]').click()
        await page.locator('[data-tech]').first.click()
        assert await page.locator('#detail-dialog').is_visible()
        await page.keyboard.press('Escape')
        await page.locator('.tabs [data-view="factory"]').click()
        await page.locator('#factory-search').fill('Forge')
        assert await page.locator('tbody tr[data-building]').count()==7
        await page.locator('tbody tr[data-building]').first.press('Enter')
        assert 'installed upgrades' in (await page.locator('#detail-content').inner_text()).lower()
        await page.keyboard.press('Escape')
        # Real disconnect behavior: retained figures must be explicitly marked stale.
        control['online']=False
        await page.wait_for_function("document.querySelector('#connection').textContent.includes('Last known state')")
        assert 'last synced state' in await page.locator('#connection-banner').inner_text()
        control['online']=True
        await page.wait_for_function("document.querySelector('#connection').textContent.includes('Kingdom connected')")
        # Keyboard selection in the production picker.
        await page.locator('.add-production').click();await page.locator('#item-search').fill('Iron Sword')
        await page.locator('#item-search').press('ArrowDown')
        assert await page.evaluate("document.activeElement.dataset.item==='iron_sword'")
        await page.keyboard.press('Escape')
        for width,height in [(1024,900),(390,844)]:
            await page.set_viewport_size({'width':width,'height':height})
            await page.locator('.tabs [data-view="overview"]').click()
            await page.screenshot(path=str(PROJECT/f'Verification/overview-fixture-{width}.png'),full_page=True)
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'Page overflow at {width}'
            for view in ['production','resources','research','factory']:
                await page.locator(f'.tabs [data-view="{view}"]').click()
                assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'{view} overflow at {width}'
        assert not errors,errors
        report={'passed':True,'testedAtUtc':datetime.now(timezone.utc).isoformat(),'fixtureOnly':True,'desktopAndMobile':True,
                'views':5,'productionCreateAndPersist':True,'rateEditsSurviveLiveUpdates':True,'liveSpeedRecalculation':True,
                'dedicatedAndSharedSupply':True,'researchAndBuildingInspectors':True,'offlineAndReconnect':True,
                'keyboardPicker':True,'pageErrors':errors}
        (PROJECT/'Verification/browser-tests.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report,indent=2));await browser.close()

if __name__=='__main__':asyncio.run(main())
