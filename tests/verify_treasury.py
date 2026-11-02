"""Treasury observed profit/deficit, exact Int64 subtraction, and reconnects."""
import asyncio,json
from datetime import datetime,timezone
from playwright.async_api import async_playwright
from verify_dashboard import fixtures,PROJECT

async def main():
    catalog,snapshot=fixtures();control={'online':True}
    balances=snapshot['sections']['economy']['data']['currencies']
    balances.update(Gold='9007199254740993',Requisition='43',Medal='120',Ring='4',Mana='27',Crown='16',Ducat='3',Ingenuity='7',Faith='5')
    async def route_api(route):
        if not control['online']:await route.abort('connectionrefused');return
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
        page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        await page.goto('http://127.0.0.1:17841')
        await page.wait_for_function("document.querySelector('#connection').textContent.includes('Kingdom connected')")
        assert await page.locator('[data-treasury-net="Gold"]').inner_text()=='— /sec\nMeasuring…'
        balances['Gold']='9007199254740994';balances['Requisition']='0';snapshot['revision']+=1
        await page.locator('[data-treasury-net="Gold"].profit').wait_for()
        assert await page.locator('[data-treasury-net="Requisition"].deficit').count()==1
        assert await page.locator('.currency-amount[title="Requisition"]').inner_text()=='0'
        assert await page.locator('.currency-amount[title="Gold"]').get_attribute('aria-label')=='900,719,925,474 gold, 9 silver, 94 copper'
        assert '+' in await page.locator('[data-treasury-net="Gold"]').inner_text()
        assert '−' in await page.locator('[data-treasury-net="Requisition"]').inner_text()
        assert await page.locator('[data-treasury-net="Medal"].balanced').count()==1
        assert await page.locator('[data-treasury-net="Medal"] .money-rate').get_attribute('aria-label')=='0 Medal per second'
        await page.locator('.currency-card').screenshot(path=str(PROJECT/'Verification/treasury-profit-deficit-desktop.png'))
        for width in [1024,390]:
            await page.set_viewport_size({'width':width,'height':844})
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            await page.locator('.currency-card').screenshot(path=str(PROJECT/f'Verification/treasury-profit-deficit-{width}.png'))
        control['online']=False
        await page.locator('[data-treasury-net="Gold"].offline').wait_for()
        assert not await page.locator('.treasury-net.profit,.treasury-net.deficit').count()
        balances['Gold']='300';snapshot['revision']+=1;control['online']=True
        await page.locator('[data-treasury-net="Gold"].measuring').wait_for()
        snapshot['sessionId']='new-kingdom';balances['Gold']='200';snapshot['revision']+=1
        await page.locator('[data-treasury-net="Gold"].measuring').wait_for()
        # Deterministic timing checks avoid relying on browser/network timing.
        checks=await page.evaluate("""async()=>{
          const {createTreasuryTracker}=await import('/treasury.js');
          const sample=(Gold,id='kingdom')=>({instanceId:'game',sessionId:id,sections:{session:{data:{loaded:true}},economy:{data:{currencies:{Gold}}}}});
          const t=createTreasuryTracker();t.record(sample('9007199254740993'),0);
          const initial=t.rate('Gold')===null;t.record(sample('9007199254740994'),1000);
          const exact=t.rate('Gold').perSecond===1;t.record(sample('9007199254740990'),2000);
          const negative=t.rate('Gold').perSecond===-1.5&&t.rate('Gold').direction==='deficit';
          t.record(sample('0','new'),3000);const sessionReset=t.rate('Gold')===null;
          t.record(sample('10','new'),4000);t.record(sample('100','new'),10000);const gapReset=t.rate('Gold')===null;
          t.clear();const cleared=t.rate('Gold')===null;
          const w=createTreasuryTracker({maxGapMs:120000});w.record(sample('100'),0);w.record(sample('200'),30000);w.record(sample('400'),60000);
          const fullWindow=w.rate('Gold').perSecond===5;w.record(sample('410'),61000);
          const rollingWindow=w.rate('Gold').seconds<=60&&Math.abs(w.rate('Gold').perSecond-210/31)<1e-10;
          w.record(sample('0'),60000);const oldIgnored=Math.abs(w.rate('Gold').perSecond-210/31)<1e-10;
          return {initial,exact,negative,sessionReset,gapReset,cleared,fullWindow,rollingWindow,oldIgnored};
        }""")
        assert all(checks.values()),checks
        assert not errors,errors
        report={'passed':True,'testedAtUtc':datetime.now(timezone.utc).isoformat(),'profitDeficitAndBalanced':True,
                'zeroBalanceDeficitStillVisible':True,'int64DeltaPrecision':True,'offlineAndReconnect':True,
                'rollingWindowAndSessionReset':checks,'responsiveWidths':[1440,1024,390],'pageErrors':errors}
        (PROJECT/'Verification/treasury-tests.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report,indent=2));await browser.close()

if __name__=='__main__':asyncio.run(main())
