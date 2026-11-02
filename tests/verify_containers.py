"""Container geometry, nested register groups, filtering and live expansion state."""
import asyncio,copy,json
from datetime import datetime,timezone
from pathlib import Path
from playwright.async_api import async_playwright
from verify_dashboard import fixtures

PROJECT=Path(__file__).resolve().parents[1]

async def main():
    catalog,snapshot=fixtures();flow=snapshot['sections']['factory']['data']['flows'][0]
    flow.update(name='Main workshop',index=0)
    for b in flow['buildings']:b['position']=[40,600]
    flow['buildings'][0]['position']=[20,900]
    flow['buildings'][1]['position']=[120,880]
    flow['buildings'][2]['position']=[170,800]
    flow['buildings'][-1]['position']=[1500,1500]
    decorations=[{'Position':[0,1000],'Size':[1000,1000],'StyleIndex':1},
                 {'Position':[100,900],'Size':[400,400],'StyleIndex':4},
                 {'Position':[150,850],'Size':[100,100],'StyleIndex':2},
                 {'Position':[1100,1000],'Size':[300,300],'StyleIndex':3},
                 {'Position':[20,1010],'Size':[100,24],'Label':'Metalworks'},
                 {'Position':[110,910],'Size':[100,24],'Label':'Forge hall'},
                 {'Position':[160,862],'Size':[60,26],'Label':'Finishing'},
                 {'Position':[800,1000],'Size':[24,24],'Sticker':{'Type':'IconSticker','IconName':'Icons_3'}},
                 {'Position':[470,900],'Size':[24,24],'Sticker':{'Type':'IconSticker','IconName':'Icons_27'}},
                 {'Position':[1500,1500],'Size':[24,24],'Sticker':{'Type':'IconSticker','IconName':'Icons_57'}},
                 {'Position':[180,820],'Size':[24,24],'Sticker':{'Type':'IconSticker','IconName':'../bad'}}]
    second=copy.deepcopy(flow);second.update(id='second-workshop',index=1,name='Second workshop',connections=[])
    second['buildings']=second['buildings'][:1];second['buildings'][0].update(id='second-building',position=[10,990])
    snapshot['sections']['factory']['data']['flows'].append(second)
    snapshot['sections']['native']={'revision':1,'data':{'Currency':{'private':'not needed'},'Flows':[{'Label':'Main workshop','Decorations':decorations},{'Label':'Second workshop','Decorations':[{'Position':[0,1000],'Size':[1000,1000],'StyleIndex':5}]}]}}
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
        context=await browser.new_context(viewport={'width':1440,'height':1100});await context.route('http://127.0.0.1:17840/**',route_api)
        page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        await page.goto('http://127.0.0.1:17841');await page.wait_for_function("document.querySelector('#connection').textContent.includes('Kingdom connected')")
        data=await page.evaluate("""async () => {
          const {groupContainers}=await import('/containers.js');const s=JSON.parse(localStorage.getItem('kingdom-dashboard:snapshot'));const g=groupContainers(s);
          return {nativeKeys:Object.keys(s.sections.native.data),groups:g.groups.map(c=>({id:c.id,label:c.label,icon:c.icon||null,parent:c.parentId,direct:c.buildings.map(b=>b.id),total:c.totalBuildings,depth:c.depth,path:c.path})),owners:[...g.byBuildingId]};
        }""")
        groups={g['label']:g for g in data['groups'] if g['label'] in ['Metalworks','Forge hall','Finishing']}
        root,child,grand=[groups[n] for n in ['Metalworks','Forge hall','Finishing']]
        assert child['parent']==root['id'] and grand['parent']==child['id']
        assert root['icon']=='Icons_3' and child['icon']=='Icons_27' and grand['icon'] is None
        assert sum(g['icon'] is not None for g in data['groups'])==2
        assert grand['depth']==2 and root['total']==len(flow['buildings'])-1
        assert len(child['direct'])==1 and len(grand['direct'])==1
        assert data['nativeKeys']==['Flows']
        all_ids=[b for g in data['groups'] for b in g['direct']]
        assert len(all_ids)==len(set(all_ids))==len(flow['buildings'])+1
        floor_root=page.locator(f'[data-floor-container="{root["id"]}"]')
        floor_child=page.locator(f'[data-floor-container="{child["id"]}"]')
        floor_grand=page.locator(f'[data-floor-container="{grand["id"]}"]')
        assert await floor_root.locator(':scope > summary .container-mark img').get_attribute('src')=='assets/icons/Icons_3.png'
        assert await floor_root.locator(f'[data-floor-container="{child["id"]}"]').count()==1
        assert await floor_child.locator(f'[data-floor-container="{grand["id"]}"]').count()==1
        await floor_child.locator(':scope > summary').click()
        await floor_grand.locator(':scope > summary').click()
        snapshot['revision']+=1;await page.wait_for_timeout(1000)
        assert await floor_child.get_attribute('open') is not None and await floor_grand.get_attribute('open') is not None
        assert await floor_child.locator(':scope > summary .container-mark img').get_attribute('src')=='assets/icons/Icons_27.png'
        await page.locator('.floor-panel').screenshot(path=str(PROJECT/'Verification/containers-fixture-desktop.png'))
        # A parent filter includes descendants, with every row shown in exactly one list.
        await floor_root.locator(':scope > .container-foot [data-open-container]').click()
        assert await page.locator('#factory-container').input_value()==root['id']
        assert await page.locator('tr[data-building]').count()==root['total']
        reg_root=page.locator(f'[data-register-container="{root["id"]}"]')
        reg_child=page.locator(f'[data-register-container="{child["id"]}"]')
        reg_grand=page.locator(f'[data-register-container="{grand["id"]}"]')
        assert await reg_root.locator(f'[data-register-container="{child["id"]}"]').count()==1
        assert await reg_child.locator(f'[data-register-container="{grand["id"]}"]').count()==1
        assert await reg_child.locator(':scope > summary .container-mark img').get_attribute('src')=='assets/icons/Icons_27.png'
        # Decoration edits propagate without changing container identity or expansion.
        decorations[8]['Sticker']['IconName']='Icons2_67'
        decorations[5]['Label']='Forge hall renamed';snapshot['revision']+=1
        await page.wait_for_function("document.querySelectorAll('.container-mark img[src=\"assets/icons/Icons2_67.png\"]').length===1")
        assert await reg_child.locator(':scope > summary .container-name strong').inner_text()=='Forge hall renamed'
        assert await reg_child.get_attribute('open') is not None
        await reg_child.locator(':scope > summary').click()
        snapshot['revision']+=1;await page.wait_for_timeout(1000)
        assert await reg_child.get_attribute('open') is None
        await reg_child.locator(':scope > summary').click()
        await reg_grand.locator('tr[data-building]').first.press('Enter')
        assert await page.locator('#detail-dialog').is_visible();await page.keyboard.press('Escape')
        await page.locator('.register-groups').screenshot(path=str(PROJECT/'Verification/register-containers-fixture-desktop.png'))
        await page.locator('#factory-container').select_option(grand['id'])
        assert await page.locator('tr[data-building]').count()==1
        await page.locator('#factory-container').select_option('all')
        assert await page.locator('tr[data-building]').count()==len(all_ids)
        # A live move out of a nested container changes membership/counts immediately.
        flow['buildings'][2]['position']=[1500,1500];snapshot['revision']+=1
        await page.locator('#factory-container').select_option(grand['id'])
        await page.wait_for_function("document.querySelectorAll('tr[data-building]').length===0")
        await page.locator('#factory-container').select_option(root['id'])
        assert await page.locator('tr[data-building]').count()==root['total']-1
        for width in [1024,390]:
            await page.set_viewport_size({'width':width,'height':844})
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            await page.locator('.register-groups').screenshot(path=str(PROJECT/f'Verification/register-containers-fixture-{width}.png'))
            await page.locator('.tabs [data-view="overview"]').click()
            await page.locator(f'[data-floor-container="{child["id"]}"] > summary').click()
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            await page.locator('.floor-panel').screenshot(path=str(PROJECT/f'Verification/containers-fixture-{width}.png'))
            await page.locator('.tabs [data-view="factory"]').click()
        assert not errors,errors
        report={'passed':True,'testedAtUtc':datetime.now(timezone.utc).isoformat(),'fixtureOnly':True,'nestedDepth':3,'oneOwnerPerBuilding':True,'multipleWorkshops':True,'parentCountsIncludeDescendants':True,'floorAndRegisterHierarchy':True,'borderCrossingLabels':True,'containedStickerIconsBothViews':True,'stickersStayInDirectContainer':True,'liveDecorationEdits':True,'parentAndChildFilters':True,'liveMoves':True,'expansionSurvivesLiveUpdates':True,'buildingInspector':True,'compactNativeCache':True,'responsiveWidths':[1440,1024,390],'pageErrors':errors}
        (PROJECT/'Verification/container-tests.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2));await browser.close()

if __name__=='__main__':asyncio.run(main())
