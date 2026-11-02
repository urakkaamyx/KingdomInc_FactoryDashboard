"""Objective supply and preparation integration, using isolated API/browser fixtures."""
import asyncio, json
from datetime import datetime, timezone
from pathlib import Path
from playwright.async_api import async_playwright
from verify_dashboard import fixtures

PROJECT=Path(__file__).resolve().parents[1]

async def main():
    catalog,snapshot=fixtures()
    data={k:v['data'] for k,v in snapshot['sections'].items()}
    data['unlocks']['buildingTypes']+=['WarEffort','Outfitter','TrainingGrounds','Barracks','Engraver','RequisitionOffice']
    data['unlocks']['itemIds']+=['conscript','iron_armor','gold_wire']
    data['unlocks']['recipeIds']+=['iron_armor','gold_wire','engrave_weapon_str']
    for t in data['research']:
        if t['id'] in ['outfitter','outfitter_automation','training_grounds','training_grounds_slot','war_effort']:
            t.update(purchased=True,locked=False,available=False)
    data['upgrades']['availableByBuildingType'].update({k:['Worker'] for k in ['TrainingGrounds','Barracks','Engraver']})
    balances={'Gold':'9007199254740993','Requisition':'43','Medal':'120','Ring':'4','Mana':'27','Crown':'16','Ducat':'3','Ingenuity':'7','Faith':'5'}
    data['economy']['currencies']=balances
    data['economy']['requisitionItemIds']=['iron_sword']
    errors=[]
    async def route_api(route):
        path=route.request.url.split('17840',1)[1]
        if 'health' in path:body={'apiVersion':'1','instanceId':snapshot['instanceId'],'sessionId':snapshot['sessionId'],'status':'live','stale':False,'readOnly':True,'revision':snapshot['revision']}
        elif 'catalog' in path:body=catalog
        elif 'changes' in path:body={'apiVersion':'1','instanceId':snapshot['instanceId'],'sessionId':snapshot['sessionId'],'revision':snapshot['revision'],'resyncRequired':False,'changes':[{'revision':snapshot['revision'],'sections':list(snapshot['sections'])}]}
        else:body=snapshot
        await route.fulfill(content_type='application/json',body=json.dumps(body),headers={'Access-Control-Allow-Origin':'*'})
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        context=await browser.new_context(viewport={'width':1440,'height':1100})
        await context.route('http://127.0.0.1:17840/**',route_api)
        page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        await page.goto('http://127.0.0.1:17841')
        await page.wait_for_function("document.querySelector('#connection').textContent.includes('Kingdom connected')")
        # All currency types use native icons and exact integer amounts, without visible names.
        icons={'Gold':'Icons_8','Requisition':'Icons_33','Medal':'Icons_63','Ring':'Icons_135','Mana':'Icons_162','Crown':'Icons_188','Ducat':'Icons_197','Ingenuity':'Icons2_67','Faith':'Icons2_66'}
        for kind,icon in icons.items():
            cell=page.locator(f'.currency-amount[title="{kind}"]')
            assert await cell.count()==1
            assert (await cell.locator('img').first.get_attribute('src')).endswith(icon+'.png')
            assert kind not in await cell.inner_text()
        assert await page.locator('.currency-amount[title="Gold"]').get_attribute('aria-label')=='900,719,925,474 gold, 9 silver, 93 copper'
        await page.locator('.add-production').click()
        await page.locator('#production-kind').select_option('objective')
        assert not await page.locator('#new-rate-fields').is_visible()
        await page.locator('[data-item="WarEffort"]').click();await page.locator('#create-goal').click()
        assert 'War Effort' in await page.locator('.goal-heading').inner_text()
        assert 'Add an input' in await page.locator('.preparation-panel').inner_text()
        await page.locator('#add-objective-input').select_option('conscript')
        assert await page.locator('.input-card').count()==1
        # Steppers must not inherit a .001 offset. Exercise the browser's default
        # whole-number stepping too, while keeping fractional typed rates valid.
        rate_field=page.locator('[data-feed-rate]')
        await rate_field.fill('1')
        await rate_field.press('Tab')
        await rate_field.evaluate("el => el.removeAttribute('step')")
        await rate_field.press('ArrowUp')
        assert await rate_field.input_value()=='2'
        await rate_field.press('ArrowDown')
        assert await rate_field.input_value()=='1'
        await rate_field.fill('0.125')
        await rate_field.press('Tab')
        assert await rate_field.input_value()=='0.125'
        # A rejected zero must restore the committed value, not seed an offset.
        await rate_field.fill('0')
        await rate_field.press('Tab')
        assert await rate_field.input_value()=='0.125'
        await page.locator('[data-feed-rate]').fill('2.5')
        await page.wait_for_timeout(1000)
        assert await page.locator('[data-feed-rate]').input_value()=='2.5'
        await page.locator('[data-feed-rate]').press('Tab')
        await page.locator('[data-add-stage]').select_option('outfit:iron_sword')
        assert await page.locator('.prep-stage').count()==1
        await page.locator('[data-add-stage]').select_option('training')
        assert await page.locator('.prep-stage').count()==2
        # A materially meaningful calculation: one human supply, one sword per human,
        # plus a 1-second Outfitter and a 20-second / four-slot training stage.
        result=await page.evaluate("""async () => {
          const {createModel,planGoal}=await import('/model.js');
          const goal=JSON.parse(localStorage.getItem('kingdom-dashboard:goals'))[0];
          const catalog=JSON.parse(localStorage.getItem('kingdom-dashboard:catalog'));
          const snapshot=JSON.parse(localStorage.getItem('kingdom-dashboard:snapshot'));
          return planGoal(createModel(catalog,snapshot,await (await fetch('/item-traits.json')).json()),goal);
        }""")
        conscripts=[r for r in result['nodes'] if r['itemId']=='conscript']
        assert len(conscripts)==1 and conscripts[0]['rate']==2.5,result
        assert next(r for r in result['nodes'] if r['itemId']=='iron_sword')['rate']==2.5
        assert [(r['station'],r['count']) for r in result['stages']]==[('Outfitter',3),('TrainingGrounds',13)]
        assert next(r for r in result['costs'] if r['currency']=='Requisition')['rate']==5
        assert not result['issues'],result['issues']
        before=int(await page.locator('.goal-total strong').inner_text())
        await page.locator('[data-add-enhance]').select_option('engrave_weapon_str')
        assert 'Gold Wire' in await page.locator('.chain-panel').inner_text()
        assert int(await page.locator('.goal-total strong').inner_text())>before
        # Existing equipment supplies skip only the material chain, retaining preparation.
        await page.locator('[data-gear-supply]').select_option('existing')
        assert 'Existing / external supply' in await page.locator('.chain-panel').inner_text()
        assert 'Gold Wire' in await page.locator('.chain-panel').inner_text()
        await page.locator('[data-stage-up="1"]').click()
        assert 'Training Grounds' in await page.locator('.prep-stage-title').first.inner_text()
        await page.locator('[data-add-stage]').select_option('training')
        assert 'half effectiveness' in await page.locator('.plan-note').inner_text()
        await page.locator('[data-add-stage]').select_option('training')
        assert 'no effect' in await page.locator('.plan-issues').inner_text()
        await page.locator('[data-stage-remove="3"]').click()
        # A second feed remains independent and contributes additional supply demand.
        await page.locator('#add-objective-input').select_option('conscript')
        assert await page.locator('.input-card').count()==2
        await page.locator('[data-feed-supply]').last.select_option('existing')
        await page.reload();await page.wait_for_function("document.querySelector('#goal-count').textContent==='01'")
        await page.locator('[data-goal]').first.click()
        assert await page.locator('.input-card').count()==2
        assert await page.locator('.prep-stage').count()==3
        await page.screenshot(path=str(PROJECT/'Verification/objective-fixture-desktop.png'),full_page=True)
        for width in [1024,390]:
            await page.set_viewport_size({'width':width,'height':844})
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'Objective overflow {width}'
            await page.screenshot(path=str(PROJECT/f'Verification/objective-fixture-{width}.png'),full_page=True)
        # Filters and prerequisite/conflict calculations use a separate pure model check.
        checks=await page.evaluate("""async () => {
          const {createModel,planGoal}=await import('/model.js');
          const {accepts,enhancementOptions}=await import('/objective-model.js');
          const m=createModel(JSON.parse(localStorage.getItem('kingdom-dashboard:catalog')),JSON.parse(localStorage.getItem('kingdom-dashboard:snapshot')),await (await fetch('/item-traits.json')).json());
          const g={kind:'objective',buildingType:'WarEffort',inputs:[{itemId:'conscript',rate:1,modifiers:[{kind:'outfit',itemId:'iron_armor'},{kind:'outfit',itemId:'iron_armor'}]}]};
          const conflict=planGoal(m,g);
          return {warRejectsOre:!accepts(m,'WarEffort',m.items.get('iron_ore')),questRejectsConscript:!accepts(m,'QuestBoard',m.items.get('conscript')),restaurantRejectsSword:!accepts(m,'Restaurant',m.items.get('iron_sword')),conflicts:conflict.issues.length>0,armorEnhancement:enhancementOptions(m,'iron_armor',true).some(r=>r.id==='engrave_heavy_armor_health'),swordRejectsArmorEnhancement:!enhancementOptions(m,'iron_sword',true).some(r=>r.id==='engrave_heavy_armor_health')};
        }""")
        assert all(checks.values()),checks
        assert not errors,errors
        report={'passed':True,'testedAtUtc':datetime.now(timezone.utc).isoformat(),'fixtureOnly':True,'objectiveCreationAndPersistence':True,'rateSteppingWithoutDecimalOffset':True,'fractionalRatesAndInvalidRateRecovery':True,'multipleInputs':True,'orderedPreparation':True,'outfitterMaterialAndOperatingCosts':True,'equipmentEnhancements':True,'trainingDiminishingReturns':True,'draftSurvivesLiveUpdates':True,'currencyIconsAndInt64Precision':True,'responsiveWidths':[1440,1024,390],'rules':checks,'pageErrors':errors}
        (PROJECT/'Verification/objective-tests.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2));await browser.close()

if __name__=='__main__':asyncio.run(main())
