"""Measured final products, routed Shop deliveries and scoped net earnings."""
import asyncio,copy,json
from datetime import datetime,timezone
from playwright.async_api import async_playwright
from verify_dashboard import fixtures,PROJECT

async def main():
    catalog,snapshot=fixtures();factory=snapshot['sections']['factory']['data'];flow=factory['flows'][0]
    template=copy.deepcopy(flow['buildings'][0])
    def building(id,type,x,y,item=None,recipe=None,category='Utility'):
        b=copy.deepcopy(template);b.update(id=id,type=type,category=category,position=[x,y],recipeId=recipe,resourceItemId=None,inputs=[],outputs=[],state={})
        if item:b['outputs']=[{'index':0,'itemId':item,'inventory':[],'buffered':0,'capacity':5,'connected':True}]
        return b
    flow.update(index=0,name='Main',buildings=[building('a','Blacksmith',120,800,'iron_sword','iron_sword','Crafting'),building('b','Blacksmith',100,600,'iron_sword','iron_sword','Crafting'),building('r','Manifold',600,800),building('s1','Shop',1200,800,category='Consumption'),building('s2','Shop',1200,600,category='Consumption')])
    def connection(a,b,sp=0,tp=0):return {'sourceBuildingId':a,'sourcePort':sp,'targetBuildingId':b,'targetPort':tp,'itemRejected':False,'points':[]}
    flow['connections']=[connection('a','r'),connection('b','r',tp=1),connection('r','s1'),connection('r','s2',sp=1)]
    snapshot['sections']['native']={'revision':1,'data':{'Flows':[{'Decorations':[
        {'Position':[0,1000],'Size':[1000,1000]}, {'Position':[80,850],'Size':[200,200]},
        {'Position':[20,980],'Size':[150,20],'Label':'Swords'}, {'Position':[90,840],'Size':[100,20],'Label':'Nested line'}]}]}}
    initial={'available':True,'epoch':'epoch','clockSeconds':0,'transfers':[],'deliveries':[],'buildings':[]}
    factory['telemetry']=copy.deepcopy(initial)
    control={'advance':False,'available':True}
    def update():
        if not control['available']:factory.pop('telemetry',None);return
        if not control['advance']:return
        t=factory['telemetry'];t['clockSeconds']+=1
        n=int(t['clockSeconds'])
        t['deliveries']=[{'producerBuildingId':p,'targetBuildingId':s,'itemId':'iron_sword','count':str(n*c),'earned':{'Gold':str(n*g)}} for p,s,c,g in [('a','s1',2,200),('a','s2',1,100),('b','s2',4,400)]]
        t['buildings']=[{'buildingId':'a','earned':{},'spent':{'Gold':str(n*20)}},{'buildingId':'b','earned':{},'spent':{'Gold':str(n*40)}},{'buildingId':'s1','earned':{'Gold':str(n*200)},'spent':{}},{'buildingId':'s2','earned':{'Gold':str(n*500)},'spent':{}}]
        snapshot['revision']+=1
    async def route_api(route):
        path=route.request.url.split('17840',1)[1]
        if 'health' in path:body={'apiVersion':'1','instanceId':snapshot['instanceId'],'sessionId':snapshot['sessionId'],'status':'live','stale':False,'readOnly':True,'revision':snapshot['revision']}
        elif 'catalog' in path:body=catalog
        elif 'changes' in path:body={'apiVersion':'1','instanceId':snapshot['instanceId'],'sessionId':snapshot['sessionId'],'revision':snapshot['revision'],'resyncRequired':False,'changes':[{'revision':snapshot['revision'],'sections':['factory']}]}
        else:update();body=snapshot
        await route.fulfill(content_type='application/json',body=json.dumps(body),headers={'Access-Control-Allow-Origin':'*'})
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True);context=await browser.new_context(viewport={'width':1440,'height':1100})
        await context.route('http://127.0.0.1:17840/**',route_api);page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        await page.goto('http://127.0.0.1:17841');await page.wait_for_function("document.querySelector('#connection').textContent.includes('Kingdom connected')")
        root=page.locator('[data-floor-container]').first
        summary=root.locator(':scope > [data-container-output]')
        assert 'Iron Sword' in await summary.inner_text() and 'Item Shop ×2' in await summary.inner_text()
        assert 'Measuring' in await summary.inner_text()
        control['advance']=True
        await page.wait_for_function("document.querySelector('[data-output-total]').textContent.trim()==='7 items /sec'")
        assert await summary.locator('[data-output-profit] .output-money').get_attribute('aria-label')=='+0 gold, 6 silver, 40 copper per second'
        child=root.locator('[data-floor-container]').first;await child.locator(':scope > summary').click()
        child_summary=child.locator(':scope > [data-container-output]')
        assert '3 items /sec' in await child_summary.locator('[data-output-total]').inner_text()
        assert await child_summary.locator('[data-output-profit] .output-money').get_attribute('aria-label')=='+0 gold, 2 silver, 80 copper per second'
        await page.screenshot(path=str(PROJECT/'Verification/container-products-desktop.png'),full_page=True)
        # Move Shops inside: their total income replaces attributed delivery income,
        # and is counted once, including descendants and shared input streams.
        scenarios=await page.evaluate("""async ({catalog,snapshot})=>{
          const {createModel}=await import('/model.js');const {containerOutput,createFlowMetrics}=await import('/container-output.js');
          const base=structuredClone(snapshot),t=base.sections.factory.data.telemetry;
          t.clockSeconds=0;t.deliveries.forEach(d=>{d.count='0';d.earned.Gold='0';});t.buildings.forEach(b=>{for(const side of ['earned','spent'])for(const c in b[side])b[side][c]='0';});
          const metrics=createFlowMetrics();metrics.record(base);
          const next=structuredClone(snapshot);next.sections.factory.data.telemetry.clockSeconds=1;
          // Use a fixed one-second counter delta for pure accounting checks.
          const n=snapshot.sections.factory.data.telemetry.clockSeconds;
          for(const d of next.sections.factory.data.telemetry.deliveries){d.count=String(Number(d.count)/n);d.earned.Gold=String(Number(d.earned.Gold)/n);}
          for(const b of next.sections.factory.data.telemetry.buildings)for(const side of ['earned','spent'])for(const c in b[side])b[side][c]=String(Number(b[side][c])/n);
          metrics.record(next);const m=createModel(catalog,next),parent=m.containerRoots[0],child=m.containerIndex.get(parent.children[0]);
          const out=containerOutput(m,parent,metrics),nested=containerOutput(m,child,metrics);
          const all={...parent,buildingIds:new Set(m.buildings.map(b=>b.id))};const owned=containerOutput(m,all,metrics);
          const variant=structuredClone(next);variant.sections.factory.data.flows[0].buildings[0].outputs[0].itemId='iron_sword:quest-variant';
          for(const d of variant.sections.factory.data.telemetry.deliveries)if(d.producerBuildingId==='a')d.itemId='iron_sword:quest-variant';
          const vm=createFlowMetrics();vm.record(base);vm.record(variant);const variantOutput=containerOutput(createModel(catalog,variant),parent,vm);
          const variantsGrouped=variantOutput.rows.length===1&&variantOutput.rows[0].itemId==='iron_sword'&&variantOutput.totalItems===7;
          const untraced=structuredClone(next);untraced.sections.factory.data.telemetry.clockSeconds=2;untraced.sections.factory.data.telemetry.deliveries.push({producerBuildingId:null,targetBuildingId:'s1',itemId:'iron_sword',count:'1',earned:{}});metrics.record(untraced);
          const incomplete=containerOutput(createModel(catalog,untraced),parent,metrics);
          const reset=structuredClone(untraced);reset.sections.factory.data.telemetry.epoch='restart';metrics.record(reset);
          return {parentRate:out.totalItems,parentNet:out.net[0].rate,childRate:nested.totalItems,childNet:nested.net[0].rate,ownedNet:owned.net[0].rate,variantsGrouped,untracedUnknown:incomplete.totalItems===null&&!incomplete.complete,epochReset:!metrics.ready};
        }""",{'catalog':catalog,'snapshot':snapshot})
        assert scenarios=={'parentRate':7,'parentNet':640,'childRate':3,'childNet':280,'ownedNet':640,'variantsGrouped':True,'untracedUnknown':True,'epochReset':True},scenarios
        for width in [1024,390]:
            await page.set_viewport_size({'width':width,'height':844})
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            await page.screenshot(path=str(PROJECT/f'Verification/container-products-{width}.png'),full_page=True)
        control['available']=False;await page.wait_for_function("document.querySelector('.output-heading').textContent.includes('Awaiting flow telemetry')")
        assert not errors,errors
        report={'passed':True,'testedAtUtc':datetime.now(timezone.utc).isoformat(),'finalProductsThroughRouters':True,'multipleShopTotals':True,'nestedScopeAndNoDoubleCredit':True,'actualOperatingSpend':True,'unknownAttributionNotEstimated':True,'legacyApiFallback':True,'epochReset':True,'responsiveWidths':[1440,1024,390],'pageErrors':errors}
        (PROJECT/'Verification/container-output-tests.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report,indent=2));await browser.close()

if __name__=='__main__':asyncio.run(main())
