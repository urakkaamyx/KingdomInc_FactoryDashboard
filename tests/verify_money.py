"""Native coin units, exact balances, fractional rate carries, and responsive display."""
import asyncio,json
from playwright.async_api import async_playwright
from verify_dashboard import fixtures,PROJECT

async def main():
    catalog,snapshot=fixtures()
    snapshot['sections']['economy']['data']['currencies']={'Gold':'123456','Requisition':'43','Medal':'120','Mana':'27'}
    async def route_api(route):
        path=route.request.url.split('17840',1)[1]
        if 'health' in path:body={'apiVersion':'1','instanceId':snapshot['instanceId'],'sessionId':snapshot['sessionId'],'status':'live','stale':False,'readOnly':True,'revision':snapshot['revision']}
        elif 'catalog' in path:body=catalog
        elif 'changes' in path:body={'apiVersion':'1','instanceId':snapshot['instanceId'],'sessionId':snapshot['sessionId'],'revision':snapshot['revision'],'resyncRequired':False,'changes':[]}
        else:body=snapshot
        await route.fulfill(content_type='application/json',body=json.dumps(body),headers={'Access-Control-Allow-Origin':'*'})
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        context=await browser.new_context(viewport={'width':1440,'height':1100})
        await context.route('http://127.0.0.1:17840/**',route_api)
        page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        await page.goto('http://127.0.0.1:17841')
        await page.wait_for_function("document.querySelector('#connection').textContent.includes('Kingdom connected')")
        checks=await page.evaluate("""async()=>{
          const {moneyParts,moneyHtml}=await import('/money.js');
          const gold=(v,o)=>moneyParts('Gold',v,o)?.label;
          return {
            zero:gold('0')==='0 gold, 0 silver, 0 copper',belowSilver:gold('99')==='0 gold, 0 silver, 99 copper',
            silver:gold('100')==='0 gold, 1 silver, 0 copper',mixedSilver:gold('101')==='0 gold, 1 silver, 1 copper',
            belowGold:gold('9999')==='0 gold, 99 silver, 99 copper',gold:gold('10000')==='1 gold, 0 silver, 0 copper',
            mixed:gold('123456')==='12 gold, 34 silver, 56 copper',
            negative:gold('-123456')==='−12 gold, 34 silver, 56 copper',
            exactInt64:gold('9223372036854775807')==='922,337,203,685,477 gold, 58 silver, 7 copper',
            rate:gold(12345.678,{fraction:true,signed:true})==='+1 gold, 23 silver, 46 copper',
            silverCarry:gold(99.9999,{fraction:true})==='0 gold, 1 silver, 0 copper',
            goldCarry:gold(9999.9999,{fraction:true})==='1 gold, 0 silver, 0 copper',
            screenshotExample:gold(4598.95,{fraction:true,signed:true})==='+0 gold, 45 silver, 99 copper',
            nearestCopper:gold(99.49,{fraction:true})==='0 gold, 0 silver, 99 copper',
            copperHalfCarry:gold(99.5,{fraction:true})==='0 gold, 1 silver, 0 copper',
            silverHalfCarry:gold(9999.5,{fraction:true})==='1 gold, 0 silver, 0 copper',
            negativeRate:gold(-100.125,{fraction:true,signed:true})==='−0 gold, 1 silver, 0 copper',
            noNegativeZero:gold(-.0001,{fraction:true,signed:true})==='0 gold, 0 silver, 0 copper',
            everyRateHasThreePositions:[0,.125,99,100,10000,12345.678].every(v=>{
              const {parts}=moneyParts('Gold',v,{fraction:true});
              return parts.map(p=>p.name).join(',')==='gold,silver,copper'&&parts.every(p=>!p.value.includes('.'));
            }),
            otherCurrency:moneyParts('Medal','123456').label==='123,456 Medal',
            otherCurrencyRate:moneyParts('Medal',1.234,{fraction:true}).label==='1.234 Medal',
            invalid:moneyParts('Gold',NaN,{fraction:true})===null,
            rateIcons:moneyHtml('Gold',12345.678,{fraction:true,perSecond:true}).includes('Icons_10.png')
          };
        }""")
        assert all(checks.values()),checks
        gold=page.locator('.currency-amount[title="Gold"]')
        assert await gold.get_attribute('aria-label')=='12 gold, 34 silver, 56 copper'
        assert await gold.locator('[data-denomination]').evaluate_all('(els)=>els.map(el=>el.dataset.denomination)')==['gold','silver','copper']
        assert await gold.locator('img').evaluate_all('(els)=>els.map(el=>el.getAttribute("src"))')==['assets/icons/Icons_8.png','assets/icons/Icons_9.png','assets/icons/Icons_10.png']
        assert await gold.locator('.coin-value').all_text_contents()==['12','34','56']
        assert await page.locator('.currency-amount[title="Medal"] .coin-value').inner_text()=='120'
        for width in [1440,1024,390]:
            await page.set_viewport_size({'width':width,'height':1100 if width==1440 else 844})
            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            assert await gold.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
            await page.locator('.currency-card').screenshot(path=str(PROJECT/f'Verification/money-{width}.png'))
        # Reproduce the user's small profit rate: the leading Gold coin stays visible.
        sample=await page.evaluate("""async()=>{
          const {moneyHtml}=await import('/money.js');
          return moneyHtml('Gold',4598.95,{fraction:true,signed:true,perSecond:true,className:'money-rate'});
        }""")
        example=await context.new_page();await example.set_viewport_size({'width':430,'height':100})
        await example.set_content('<base href="http://127.0.0.1:17841/"><link rel="stylesheet" href="styles.css"><div class="treasury-net profit" style="margin:20px;padding:12px;background:#201c1e"><strong>'+sample+'</strong></div>')
        assert await example.locator('[data-denomination]').evaluate_all('(els)=>els.map(el=>el.dataset.denomination)')==['gold','silver','copper']
        assert await example.locator('.coin-value').all_text_contents()==['0','45','99']
        await example.locator('img').evaluate_all('(els)=>Promise.all(els.map(el=>el.decode()))')
        await example.locator('.treasury-net').screenshot(path=str(PROJECT/'Verification/money-fixed-order-rate.png'))
        assert not errors,errors
        report={'passed':True,'checks':checks,'responsiveWidths':[1440,1024,390],'pageErrors':errors}
        (PROJECT/'Verification/money-tests.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report,indent=2));await browser.close()

if __name__=='__main__':asyncio.run(main())
