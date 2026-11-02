"""Single-click node inspection retains generated modifiers and rate evidence."""
import asyncio,json
from datetime import datetime,timezone
from playwright.async_api import async_playwright
from verify_dashboard import fixtures,PROJECT

async def main():
    catalog,snapshot=fixtures();data={k:v['data'] for k,v in snapshot['sections'].items()}
    unlock=['WarEffort','Outfitter','TrainingGrounds','Engraver','Collector','Distributor','Manifold','Stockpile','Barracks']
    data['unlocks']['buildingTypes']+=unlock
    data['unlocks']['recipeIds']+=['engrave_weapon_str']
    for tech in data['research']:
        if tech['id'] in ['outfitter','outfitter_automation','training_grounds','war_effort']:tech['purchased']=True
    for flow in data['factory']['flows']:
        for b in flow['buildings']:
            if b['type']=='Forge':b.update(speed=6,stackSize=2,installedUpgrades=[{'slot':0,'type':'Worker'},{'slot':1,'type':'Overseer'}])
    goal={'id':'modifiers','kind':'objective','buildingType':'WarEffort','inputs':[{'id':'feed','itemId':'conscript','rate':1,'modifiers':[
        {'kind':'outfit','itemId':'iron_sword','enhancements':['engrave_weapon_str']},{'kind':'training'},{'kind':'training'}]}]}
    async def route_api(route):
        path=route.request.url.split('17840',1)[1]
        if 'health' in path:body={'apiVersion':'1','instanceId':snapshot['instanceId'],'sessionId':snapshot['sessionId'],'status':'live','stale':False,'readOnly':True,'revision':snapshot['revision']}
        elif 'catalog' in path:body=catalog
        elif 'changes' in path:body={'apiVersion':'1','instanceId':snapshot['instanceId'],'sessionId':snapshot['sessionId'],'revision':snapshot['revision'],'resyncRequired':False,'changes':[{'revision':snapshot['revision'],'sections':list(snapshot['sections'])}]}
        else:body=snapshot
        await route.fulfill(content_type='application/json',body=json.dumps(body),headers={'Access-Control-Allow-Origin':'*'})
    errors=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        context=await browser.new_context(viewport={'width':1440,'height':1100})
        await context.route('http://127.0.0.1:17840/**',route_api)
        await context.add_init_script('localStorage.setItem("kingdom-dashboard:goals",'+json.dumps(json.dumps([goal]))+');')
        page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        await page.goto('http://127.0.0.1:17841')
        await page.wait_for_function("document.querySelector('#connection').textContent.includes('Kingdom connected')")
        await page.locator('[data-goal="modifiers"]').click()
        await page.locator('[data-action="generate-layout"]').click()
        layout=await page.evaluate("Object.values(JSON.parse(localStorage.getItem('kingdom-dashboard:layouts')))[0].layout")
        forge=next(n for n in layout['nodes'] if n.get('type')=='Forge')
        outfitter=next(n for n in layout['nodes'] if n.get('type')=='Outfitter')
        trained=next(n for n in layout['nodes'] if n.get('type')=='TrainingGrounds' and n['settings']['pass']==2)
        destination=next(n for n in layout['nodes'] if n.get('type')=='WarEffort')
        reserve=next(n for n in layout['nodes'] if n.get('type')=='Stockpile' and n['subtitle']=='Destination reserve')
        enhancement=next(n for n in layout['nodes'] if n.get('type')=='Engraver')
        assert forge['rateBasis']['speed']==3
        assert [u['type'] for u in forge['rateBasis']['upgrades']]==['Worker','Overseer']
        assert outfitter['appliedModifiers'][0]['enhancements']==['engrave_weapon_str']
        assert [s['kind'] for s in trained['modifierStreams'][0]['steps']]==['outfit','training','training']
        assert trained['modifierStreams'][0]['steps'][-1]['halfEffectiveness']
        async def inspect(id):
            await page.locator('[data-layout-node="'+id+'"]').click()
            assert await page.locator('#detail-dialog').is_visible()
            return await page.locator('.layout-node-modifiers').inner_text()
        text=await inspect(forge['id'])
        assert '3×' in text and 'Worker' in text and 'Overseer' in text and 'normalized for stacks' in text
        await page.keyboard.press('Escape')
        text=await inspect(trained['id'])
        assert 'Equip Iron Sword' in text and 'Training pass 1' in text and 'Training pass 2 · half effectiveness' in text
        assert 'THIS NODE APPLIES' in text and 'Training slots' in text,text
        await page.screenshot(path=str(PROJECT/'Verification/node-modifiers-training.png'))
        await page.keyboard.press('Escape')
        assert 'INCOMING STREAM MODIFIERS' in await inspect(destination['id'])
        await page.keyboard.press('Escape')
        assert 'Training pass 2 · half effectiveness' in await inspect(reserve['id'])
        await page.keyboard.press('Escape')
        assert 'THIS NODE APPLIES' in await inspect(enhancement['id'])
        await page.keyboard.press('Escape')
        # Snapshot changes invalidate the plan, but its recorded speed/upgrades remain intact.
        for flow in data['factory']['flows']:
            for b in flow['buildings']:
                if b['type']=='Forge':b['speed']=12;b['installedUpgrades']=[{'slot':0,'type':'Worker'}]
        snapshot['revision']+=1
        await page.locator('.layout-stale').wait_for()
        text=await inspect(forge['id'])
        assert '3×' in text and 'Overseer' in text
        assert 'outdated' in await page.locator('#detail-content').inner_text()
        await page.keyboard.press('Escape')
        await page.locator('[data-action="generate-layout"]').click()
        text=await inspect(forge['id'])
        assert '6×' in text and 'Overseer' not in text
        await page.keyboard.press('Escape')
        # Fullscreen individual machines expose the same modifier snapshot.
        await page.locator('[data-layout-fullscreen]').click()
        await page.locator('[data-layout-machines]').click()
        await page.locator('[data-layout-zoom="reset"]').click()
        text=await inspect(trained['id']+':1')
        assert 'Training pass 2 · half effectiveness' in text and 'Equip Iron Sword' in text
        assert await page.locator('.detail-metric strong').first.inner_text()=='1'
        await page.keyboard.press('Escape')
        assert await page.locator('#generated-layout').get_attribute('aria-modal')=='true'
        await page.set_viewport_size({'width':390,'height':844})
        await inspect(trained['id']+':1')
        assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        await page.screenshot(path=str(PROJECT/'Verification/node-modifiers-mobile.png'))
        assert not errors,errors
        report={'passed':True,'testedAtUtc':datetime.now(timezone.utc).isoformat(),'singleClickInspector':True,
                'equipmentAndEnhancements':True,'orderedTrainingAndDiminishingReturns':True,'destinationAndUtilityStreams':True,
                'stackNormalizedSpeedAndSampledUpgrades':True,'savedSnapshotUntilRegeneration':True,
                'fullscreenIndividualNodes':True,'responsiveWidths':[1440,390],'pageErrors':errors}
        (PROJECT/'Verification/modifier-tests.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report,indent=2));await browser.close()

if __name__=='__main__':asyncio.run(main())
