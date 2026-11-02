"""Generated build guides: real port wiring, material flow, utility unlocks, and browser use."""
import asyncio, json
from datetime import datetime, timezone
from pathlib import Path
from playwright.async_api import async_playwright
from verify_dashboard import fixtures

PROJECT=Path(__file__).resolve().parents[1]

async def verify_wheel_zoom(page):
    await page.locator('[data-layout-zoom="reset"]').click()
    pane=page.locator('.layout-scroll')
    await pane.scroll_into_view_if_needed()
    await pane.evaluate('el=>{el.scrollLeft=350;el.scrollTop=70;}')
    box=await pane.bounding_box();point={'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}
    await page.mouse.move(point['x'],point['y'])
    before=await page.locator('.layout-svg').evaluate("""(el,p)=>{
      el.dataset.wheelRetained='yes';const local=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM().inverse());
      return {width:el.getBoundingClientRect().width,x:local.x,y:local.y,pageY:scrollY};
    }""",point)
    await page.mouse.wheel(0,-120);await page.wait_for_timeout(120)
    after=await page.locator('.layout-svg').evaluate("""(el,p)=>{
      const screen=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());
      return {width:el.getBoundingClientRect().width,x:screen.x,y:screen.y,pageY:scrollY};
    }""",before)
    assert after['width']>before['width']
    assert abs(after['x']-point['x'])<1.1 and abs(after['y']-point['y'])<1.1,(before,after,point)
    assert after['pageY']==before['pageY']
    assert await page.locator('.layout-svg').get_attribute('data-wheel-retained')=='yes'
    zoom=await page.locator('.layout-zoom-label').inner_text()
    await page.wait_for_timeout(1100)
    assert await page.locator('.layout-zoom-label').inner_text()==zoom
    await page.mouse.wheel(0,120);await page.wait_for_timeout(120)
    assert await page.locator('.layout-zoom-label').inner_text()=='100%'
    # Some browsers report wheel movement in lines rather than pixels.
    prevented=await pane.evaluate("""(el,p)=>!el.dispatchEvent(new WheelEvent('wheel',{
      deltaY:-3,deltaMode:1,clientX:p.x,clientY:p.y,bubbles:true,cancelable:true
    }))""",point)
    assert prevented and int((await page.locator('.layout-zoom-label').inner_text()).rstrip('%'))>100

def validate(layout):
    nodes={n['id']:n for n in layout['nodes']}
    used_in=set();used_out=set()
    for e in layout['edges']:
        a,b=nodes[e['from']],nodes[e['to']]
        assert a['x']+a['width']<b['x'],(a,b)
        assert e['rate']>0
        copies=e.get('sourceCopies',e.get('targetCopies',1))
        for index in range(copies):
            output=(a['id'],e.get('sourceStart',0)+index if 'sourceCopies' in e else 0,e['output']+index if 'sourcePortRange' in e else e['output'])
            input_=(b['id'],e.get('targetStart',0)+index if 'targetCopies' in e else 0,e['input']+index if 'targetPortRange' in e else e['input'])
            assert output not in used_out,('Output used twice',output)
            assert input_ not in used_in,('Input used twice',input_)
            if 'InputCount' in b['settings']:assert input_[2]<b['settings']['InputCount']
            if 'OutputCount' in a['settings']:assert output[2]<a['settings']['OutputCount']
            if a['type']=='Manifold':assert output[2]<a['settings']['InputCount']
            used_out.add(output);used_in.add(input_)
    # Distinct groups never overlap; every manufacturing group retains material flow.
    for a in layout['nodes']:
        if a.get('type') in ['Manifold','Collector','Distributor']:
            assert max(a['settings'].get('InputCount',1),a['settings'].get('OutputCount',1))<=4,a
            assert max((p[2] for p in used_in if p[0]==a['id']),default=0)<4,a
            assert max((p[2] for p in used_out if p[0]==a['id']),default=0)<4,a
        if a['kind']=='utility':
            incoming=sum(e['rate'] for e in layout['edges'] if e['to']==a['id'])
            outgoing=sum(e['rate'] for e in layout['edges'] if e['from']==a['id'])
            assert abs(incoming-outgoing)<1e-7,(a,incoming,outgoing)
            assert abs(incoming-a['rate'])<1e-7,(a,incoming)
        for b in layout['nodes']:
            if a['id']==b['id']:continue
            assert a['x']+a['width']<=b['x'] or b['x']+b['width']<=a['x'] or a['y']+a['height']<=b['y'] or b['y']+b['height']<=a['y']
        if a['kind'] in ['production','preparation']:
            outgoing=sum(e['rate'] for e in layout['edges'] if e['from']==a['id'])
            assert abs(outgoing-a['rate'])<1e-7,(a,outgoing)

async def main():
    catalog,snapshot=fixtures();data={k:v['data'] for k,v in snapshot['sections'].items()}
    data['unlocks']['buildingTypes']+=['WarEffort','Outfitter','TrainingGrounds','Barracks','Collector','Distributor','Manifold','Stockpile']
    data['unlocks']['itemIds']+=['conscript','iron_armor']
    data['unlocks']['recipeIds']+=['iron_armor']
    for t in data['research']:
        if t['id'] in ['outfitter','outfitter_automation','training_grounds','war_effort','collector','distributor','manifold','stockpile']:t.update(purchased=True,locked=False,available=False)
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
        await page.locator('.add-production').click();await page.locator('#production-kind').select_option('objective')
        await page.locator('[data-item="WarEffort"]').click();await page.locator('#create-goal').click()
        assert not await page.locator('[data-action="generate-layout"]').is_enabled()
        await page.locator('#add-objective-input').select_option('conscript')
        await page.locator('[data-feed-rate]').fill('2');await page.locator('[data-feed-rate]').press('Tab')
        await page.locator('[data-add-stage]').select_option('outfit:iron_sword')
        await page.locator('[data-add-stage]').select_option('outfit:iron_armor')
        await page.locator('[data-add-stage]').select_option('training')
        await page.locator('[data-action="generate-layout"]').click()
        await page.locator('.layout-svg').wait_for()
        layout=await page.evaluate("Object.values(JSON.parse(localStorage.getItem('kingdom-dashboard:layouts')))[0].layout")
        validate(layout)
        assert layout['machines']==int(await page.locator('.goal-total strong').inner_text())
        assert {'Collector','Distributor','Manifold','Stockpile'}<={n['type'] for n in layout['nodes']}
        outfitter=[n for n in layout['nodes'] if n['type']=='Outfitter']
        assert len(outfitter)==2
        for n in outfitter:
            assert {e['input'] for e in layout['edges'] if e['to']==n['id']}=={0,1}
        assert any('priority' in w for w in layout['warnings'])
        await page.locator('.layout-scroll').evaluate("el=>el.dataset.retained='yes'")
        snapshot['revision']+=1
        await page.wait_for_timeout(1000)
        assert await page.locator('.layout-scroll').get_attribute('data-retained')=='yes'
        await page.screenshot(path=str(PROJECT/'Verification/layout-fixture-desktop.png'),full_page=True)
        # SVG nodes are keyboard accessible and describe exact individual bank pipes.
        await page.locator('[data-layout-node="'+outfitter[0]['id']+'"]').press('Enter')
        await page.locator('[data-layout-inspect]').click()
        assert 'Buildings to place' in await page.locator('#detail-content').inner_text()
        assert 'Timeout' in await page.locator('#detail-content').inner_text()
        assert 'pipes:' in await page.locator('#detail-content').inner_text()
        await page.keyboard.press('Escape')
        # Expanded view fits both dimensions; parent/child highlights stop after one hop.
        await page.locator('[data-layout-fullscreen]').click()
        assert await page.locator('#generated-layout').get_attribute('aria-modal')=='true'
        assert await page.locator('[data-layout-fullscreen]').inner_text()=='Exit fullscreen'
        fits=await page.locator('.layout-scroll').evaluate('el=>({x:el.scrollWidth<=el.clientWidth+1,y:el.scrollHeight<=el.clientHeight+1})')
        assert all(fits.values()),fits
        assert await page.locator('.sidebar').evaluate('el=>el.inert')
        family=await page.evaluate("""async id=>{const {nodeFamily}=await import('/layout.js');return nodeFamily(Object.values(JSON.parse(localStorage.getItem('kingdom-dashboard:layouts')))[0].layout,id);}""",outfitter[0]['id'])
        actual=await page.locator('.layout-node.is-related').evaluate_all('nodes=>nodes.map(n=>n.dataset.layoutNode)')
        assert set(actual)=={n['id'] for n in family['parents']+family['children']}
        assert await page.locator('.layout-node.is-selected').get_attribute('data-layout-node')==outfitter[0]['id']
        assert await page.locator('.layout-node.is-dim').count()==len(layout['nodes'])-len(actual)-1
        assert len({n['color'] for n in family['parents']+family['children']})==len(actual)
        strokes=await page.locator('.layout-wire.is-related').evaluate_all("nodes=>nodes.map(n=>({from:n.dataset.layoutFrom,to:n.dataset.layoutTo,color:getComputedStyle(n.querySelector('.wire')).stroke}))")
        assert len({n['color'] for n in strokes})>=2
        borders=await page.locator('.layout-node.is-related').evaluate_all("nodes=>nodes.map(n=>({id:n.dataset.layoutNode,color:getComputedStyle(n.querySelector(':scope>rect')).stroke,badge:getComputedStyle(n.querySelector('.relation-badge rect')).fill}))")
        for border in borders:
            assert border['color']==border['badge']
            assert any(w['color']==border['color'] and border['id'] in [w['from'],w['to']] for w in strokes)
        paths=await page.locator('.wire').evaluate_all("paths=>paths.map(p=>p.getAttribute('d'))")
        import re
        assert all(not re.search('[CQSLTAZcqsl taz]'.replace(' ',''),path) for path in paths),paths
        await page.screenshot(path=str(PROJECT/'Verification/layout-expanded-fixture-desktop.png'))
        await verify_wheel_zoom(page)
        await page.locator('[data-layout-zoom="fit"]').click()
        # Preview a child, then leave it; the pinned family is restored.
        await page.locator('[data-layout-node="'+family['children'][0]['id']+'"]').hover()
        assert await page.locator('.layout-node.is-selected').get_attribute('data-layout-node')==family['children'][0]['id']
        snapshot['revision']+=1;await page.wait_for_timeout(1000)
        assert await page.locator('.layout-node.is-selected').get_attribute('data-layout-node')==family['children'][0]['id']
        await page.locator('[data-layout-fullscreen]').hover()
        assert await page.locator('.layout-node.is-selected').get_attribute('data-layout-node')==outfitter[0]['id']
        # Details can open above the expanded canvas; Escape closes them independently.
        await page.locator('[data-layout-inspect]').click();await page.keyboard.press('Escape')
        assert await page.locator('#generated-layout').get_attribute('aria-modal')=='true'
        await page.locator('[data-layout-arrangement]').click()
        assert await page.locator('[data-layout-arrangement]').inner_text()=='Compact view'
        await page.locator('[data-layout-arrangement]').click()
        assert await page.locator('[data-layout-arrangement]').inner_text()=='Flow view'
        await page.locator('[data-action="generate-layout"]').click()
        assert await page.locator('#generated-layout').get_attribute('aria-modal')=='true'
        await page.locator('[data-action="generate-layout"]').focus();await page.keyboard.press('Shift+Tab')
        assert await page.evaluate("document.querySelector('#generated-layout').contains(document.activeElement)")
        await page.keyboard.press('Escape')
        assert await page.locator('#generated-layout').get_attribute('aria-modal') is None
        assert not await page.locator('.sidebar').evaluate('el=>el.inert')
        assert await page.locator('.layout-zoom-label').inner_text()=='100%'
        # Expand means every physical machine and pipe; Fullscreen is independent.
        assert await page.locator('[data-layout-fullscreen]').inner_text()=='Fullscreen'
        await page.locator('[data-layout-machines]').click()
        assert await page.locator('[data-layout-machines]').inner_text()=='Group machines'
        assert await page.locator('#generated-layout').get_attribute('aria-modal') is None
        individual=await page.evaluate("""async()=>{
          const {expandMachineLayout}=await import('/layout.js');
          const layout=Object.values(JSON.parse(localStorage.getItem('kingdom-dashboard:layouts')))[0].layout;
          const before=JSON.stringify(layout),display=expandMachineLayout(layout);
          if(before!==JSON.stringify(layout))throw new Error('Expansion mutated saved layout');
          const huge=structuredClone(layout);huge.nodes[0].count=2001;
          let limited=false;try{expandMachineLayout(huge);}catch{limited=true;}
          return {display,limited};
        }""")
        expanded=individual['display'];validate(expanded)
        assert individual['limited'] and expanded['individualMachines']
        assert len(expanded['nodes'])==sum(max(1,n['count']) for n in layout['nodes'])
        assert len(expanded['edges'])==sum(max(e.get('sourceCopies',1),e.get('targetCopies',1)) for e in layout['edges'])
        assert await page.locator('.layout-node').count()==len(expanded['nodes'])
        assert all(n['count']<=1 for n in expanded['nodes'])
        assert all(not any(k in e for k in ['sourceCopies','targetCopies','sourcePortRange','targetPortRange']) for e in expanded['edges'])
        for bank in layout['nodes']:
            machines=[n for n in expanded['nodes'] if n['groupId']==bank['id']]
            assert len(machines)==max(1,bank['count'])
            assert abs(sum(n['rate'] for n in machines)-bank['rate'])<1e-7
            for side in ['from','to']:
                old=sum(e['rate'] for e in layout['edges'] if e[side]==bank['id'])
                new=sum(e['rate'] for e in expanded['edges'] if e[side] in {n['id'] for n in machines})
                assert abs(old-new)<1e-7
        machine=next(n for n in expanded['nodes'] if n['kind']=='preparation' and n['instanceCount']>1)
        await page.locator('[data-layout-node="'+machine['id']+'"]').press('Enter')
        await page.locator('[data-layout-inspect]').click()
        assert await page.locator('#detail-title').inner_text()==machine['title']
        assert await page.locator('.detail-metric strong').first.inner_text()=='1'
        assert 'pipes:' not in await page.locator('#detail-content').inner_text()
        await page.keyboard.press('Escape')
        await page.locator('[data-layout-fullscreen]').click()
        assert await page.locator('.layout-node').count()==len(expanded['nodes'])
        assert not await page.locator('[data-layout-arrangement]').count()
        await verify_wheel_zoom(page)
        await page.locator('[data-layout-zoom="fit"]').click()
        await page.locator('[data-layout-machines]').hover()
        related=await page.locator('.layout-node.is-related').evaluate_all('nodes=>nodes.map(n=>n.dataset.layoutNode)')
        expected={e['from'] for e in expanded['edges'] if e['to']==machine['id']}|{e['to'] for e in expanded['edges'] if e['from']==machine['id']}
        assert set(related)==expected
        await page.screenshot(path=str(PROJECT/'Verification/layout-individual-machines-desktop.png'))
        async with page.expect_download() as physical_download_info:
            await page.locator('[data-layout-export]').click()
        physical_download=await physical_download_info.value
        physical=json.loads(Path(await physical_download.path()).read_text(encoding='utf-8'))
        assert physical['individualMachines'] and physical['edges']==expanded['edges']
        await page.locator('[data-action="generate-layout"]').click()
        assert await page.locator('[data-layout-machines]').inner_text()=='Group machines'
        assert await page.locator('.layout-node').count()==len(expanded['nodes'])
        await page.keyboard.press('Escape')
        assert await page.locator('.layout-node').count()==len(expanded['nodes'])
        await page.locator('[data-layout-machines]').click()
        assert await page.locator('.layout-node').count()==len(layout['nodes'])
        await page.locator('[data-layout-zoom="reset"]').click()
        # Background dragging pans the graph without changing nodes or losing the drag
        # when a live API sample arrives.
        await page.locator('.layout-scroll').scroll_into_view_if_needed()
        pane_box=await page.locator('.layout-scroll').bounding_box()
        await page.locator('.layout-scroll').evaluate('el=>el.scrollLeft=100')
        await page.mouse.move(pane_box['x']+260,pane_box['y']+10)
        await page.mouse.down();await page.wait_for_timeout(850)
        await page.mouse.move(pane_box['x']+160,pane_box['y']+10,steps=5)
        await page.mouse.up()
        assert await page.locator('.layout-scroll').evaluate('el=>el.scrollLeft')>=190
        await page.locator('.layout-scroll').evaluate('el=>{el.scrollLeft=350;el.scrollTop=70;}')
        await page.wait_for_timeout(1100)
        assert await page.locator('.layout-scroll').evaluate('el=>el.scrollLeft')==350
        assert await page.locator('.layout-zoom-label').inner_text()=='100%'
        await verify_wheel_zoom(page)
        await page.locator('[data-layout-zoom="fit"]').click()
        # Wheel gestures outside the canvas still scroll the dashboard normally.
        toolbar=page.locator('.layout-toolbar')
        await toolbar.scroll_into_view_if_needed();box=await toolbar.bounding_box()
        await page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        page_y=await page.evaluate('scrollY')
        await page.mouse.wheel(0,120);await page.wait_for_timeout(150)
        assert await page.evaluate('scrollY')>page_y
        assert not await page.locator('.layout-stale').count()
        async with page.expect_download() as download_info:
            await page.locator('[data-layout-export]').click()
        download=await download_info.value
        exported=json.loads(Path(await download.path()).read_text(encoding='utf-8'))
        assert exported['schema']=='kingdom-factory-layout/v1' and exported['readOnly']
        assert exported['nodes']==layout['nodes'],[(repr(a),repr(b)) for a,b in zip(exported['nodes'],layout['nodes']) if a!=b][:1]
        # Live speed changes invalidate the generated guide but do not silently replace it.
        for b in data['factory']['flows'][0]['buildings']:
            if b['type']=='Forge':b['speed']*=2
        snapshot['revision']+=1
        await page.locator('.layout-stale').wait_for()
        await page.locator('[data-action="generate-layout"]').click()
        assert not await page.locator('.layout-stale').count()
        # Buffers are optional, saved, and regenerated explicitly.
        await page.locator('#layout-buffers').uncheck()
        assert await page.locator('.layout-stale').is_visible()
        await page.locator('[data-action="generate-layout"]').click()
        no_buffers=await page.evaluate("Object.values(JSON.parse(localStorage.getItem('kingdom-dashboard:layouts')))[0].layout")
        assert not any(n['type']=='Stockpile' for n in no_buffers['nodes'])
        validate(no_buffers)
        await page.reload();await page.wait_for_function("document.querySelector('#goal-count').textContent==='01'")
        await page.locator('[data-goal]').first.click();await page.locator('.layout-svg').wait_for()
        assert not await page.locator('.layout-stale').count()
        # Existing saved guides must request regeneration under the new port rules.
        await page.evaluate("""()=>{
          const saved=JSON.parse(localStorage.getItem('kingdom-dashboard:layouts'));
          for(const record of Object.values(saved)){const signature=JSON.parse(record.signature);signature[0]=1;record.signature=JSON.stringify(signature);}
          localStorage.setItem('kingdom-dashboard:layouts',JSON.stringify(saved));
        }""")
        await page.reload();await page.locator('[data-goal]').first.click()
        await page.locator('.layout-stale').wait_for()
        await page.locator('[data-action="generate-layout"]').click()
        assert not await page.locator('.layout-stale').count()
        # Regeneration after editing is explicit and invalid drafts cannot generate a guide.
        await page.locator('[data-feed-rate]').fill('3');await page.locator('[data-feed-rate]').press('Tab')
        assert await page.locator('.layout-stale').is_visible()
        await page.locator('[data-action="generate-layout"]').click()
        for width in [1024,390]:
            await page.set_viewport_size({'width':width,'height':844})
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),f'Layout overflow {width}'
            await page.locator('[data-layout-zoom="fit"]').click()
            await page.locator('#generated-layout').screenshot(path=str(PROJECT/f'Verification/layout-fixture-{width}.png'))
            await page.locator('[data-layout-fullscreen]').click()
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            fits=await page.locator('.layout-scroll').evaluate('el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1')
            assert fits,await page.locator('.layout-scroll').evaluate('el=>({width:innerWidth,scroll:[el.scrollWidth,el.scrollHeight],client:[el.clientWidth,el.clientHeight],zoom:document.querySelector(".layout-zoom-label").textContent})')
            await page.screenshot(path=str(PROJECT/f'Verification/layout-expanded-fixture-{width}.png'))
            await page.locator('[data-layout-machines]').click()
            assert not await page.locator('[data-layout-arrangement]').count()
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            await page.screenshot(path=str(PROJECT/f'Verification/layout-individual-machines-{width}.png'))
            await page.locator('[data-layout-machines]').click()
            await page.keyboard.press('Escape')
        # Pure scenarios check unavailable utilities, external supply, and all dungeon ports.
        scenarios=await page.evaluate("""async ({catalog,snapshot})=>{
          const {createModel,planGoal}=await import('/model.js');const {generateLayout}=await import('/layout.js');
          const traits=await(await fetch('/item-traits.json')).json();
          const m=createModel(catalog,snapshot,traits);
          const external={id:'external',kind:'objective',buildingType:'WarEffort',inputs:[{itemId:'conscript',rate:2,useSupply:true,modifiers:[{kind:'outfit',itemId:'iron_sword',useSupply:true}]}]};
          const externalPlan=planGoal(m,external),supplied=generateLayout(m,external,externalPlan);
          const dungeon={id:'dungeon',kind:'objective',buildingType:'Dungeon',inputs:[{itemId:'adventurer',rate:1,useSupply:true,modifiers:[]}]};
          const d=generateLayout(m,dungeon,planGoal(m,dungeon));
          const lockedSnapshot=structuredClone(snapshot);lockedSnapshot.sections.unlocks.data.buildingTypes=lockedSnapshot.sections.unlocks.data.buildingTypes.filter(t=>!['Collector','Distributor','Manifold','Stockpile'].includes(t));
          const lockedModel=createModel(catalog,lockedSnapshot,traits),locked=generateLayout(lockedModel,external,planGoal(lockedModel,external));
          const enhancedGoal=structuredClone(external);enhancedGoal.inputs[0].modifiers[0].enhancements=['engrave_weapon_str'];
          const enhancedPlan=planGoal(m,enhancedGoal),enhanced=generateLayout(m,enhancedGoal,enhancedPlan);
          const product={id:'product',itemId:'iron_sword',rate:3,modifiers:[],layoutOptions:{buffers:false}};
          const productPlan=planGoal(m,product),plain=generateLayout(m,product,productPlan);
          const mixedGoal=structuredClone(external);mixedGoal.inputs.push({itemId:'conscript',rate:1,useSupply:true,modifiers:[]});
          const mixed=generateLayout(m,mixedGoal,planGoal(m,mixedGoal));
          return {supplied,externalMachinesMatch:supplied.machines===externalPlan.buildings,dungeon:d,locked,stockpilesOmitted:!locked.nodes.some(n=>n.type==='Stockpile'),enhanced,enhancedMachinesMatch:enhanced.machines===enhancedPlan.buildings,plain,plainMachinesMatch:plain.machines===productPlan.buildings,mixed};
        }""",{'catalog':catalog,'snapshot':snapshot})
        validate(scenarios['supplied']);validate(scenarios['dungeon']);validate(scenarios['locked'])
        dungeon_node=next(n for n in scenarios['dungeon']['nodes'] if n['type']=='Dungeon')
        assert {e['input'] for e in scenarios['dungeon']['edges'] if e['to']==dungeon_node['id']}==set(range(5))
        assert scenarios['externalMachinesMatch'] and scenarios['stockpilesOmitted']
        assert scenarios['locked']['locked'] and any('research is required' in w for w in scenarios['locked']['warnings'])
        for key in ['enhanced','plain','mixed']:validate(scenarios[key])
        assert scenarios['enhancedMachinesMatch'] and scenarios['plainMachinesMatch']
        engraver=next(n for n in scenarios['enhanced']['nodes'] if n['kind']=='preparation' and n['type']=='Engraver')
        assert engraver['settings']['recipe']=='engrave_weapon_str'
        assert {e['input'] for e in scenarios['enhanced']['edges'] if e['to']==engraver['id']}=={0,1,2}
        assert not errors,errors
        report={'passed':True,'testedAtUtc':datetime.now(timezone.utc).isoformat(),'fixtureOnly':True,'groups':len(layout['nodes']),'connections':len(layout['edges']),'machines':layout['machines'],'utilities':layout['utilities'],'realPortUniqueness':True,'fourPortRoutingTrees':True,'oldSavedPlansRequireRegeneration':True,'flowConservation':True,'nonOverlappingGroups':True,'outfitterEquipmentInputs':True,'allDungeonPorts':True,'utilityUnlockFallbacks':True,'bufferOptions':True,'keyboardInspector':True,'zoomAndScrollRetention':True,'cursorAnchoredWheelZoomBothViews':True,'wheelLineDeltaMode':True,'wheelOutsideCanvasScrollsPage':True,'individualMachineFlowAndPhysicalPipes':True,'individualFamilyAndInspector':True,'individualExportAndRegeneration':True,'fullscreenIndependentOfExpansion':True,'expandedViewportAndFit':True,'expandedKeyboardAndEscape':True,'rainbowDirectFamilyOnly':True,'hoverPreviewAndPinnedSelection':True,'orthogonalConnections':True,'staleAfterEditsAndUpgrades':True,'persistenceAndJsonExport':True,'responsiveWidths':[1440,1024,390],'pageErrors':errors}
        (PROJECT/'Verification/layout-tests.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2));await browser.close()

if __name__=='__main__':asyncio.run(main())
