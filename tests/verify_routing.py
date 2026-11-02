"""Four-port routing trees preserve physical connections and material demand."""
import asyncio,json
from datetime import datetime,timezone
from playwright.async_api import async_playwright
from verify_dashboard import fixtures
from verify_layout import validate,PROJECT

async def main():
    catalog,snapshot=fixtures()
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        page=await browser.new_page()
        await page.goto('http://127.0.0.1:17841')
        scenarios=await page.evaluate("""async({catalog,snapshot})=>{
          const {createModel,planGoal}=await import('/model.js');
          const {generateLayout,expandMachineLayout,layoutSignature}=await import('/layout.js');
          const rows=[];
          for(const unlocked of [['Collector','Distributor','Manifold'],['Manifold'],['Collector','Distributor'],[]]){
            const s=structuredClone(snapshot);
            s.sections.unlocks.data.buildingTypes=s.sections.unlocks.data.buildingTypes.filter(t=>!['Collector','Distributor','Manifold'].includes(t)).concat(unlocked,'Shop','WarEffort','Outfitter');
            const m=createModel(catalog,s);
            for(const count of [1,4,5,16,17,32]){
              const goal={id:'bank',itemId:'iron_sword',rate:1,modifiers:[],layoutOptions:{buffers:false}};
              const plan=planGoal(m,goal);plan.nodes.forEach(n=>{if(!n.external)n.count=count;});
              const layout=generateLayout(m,goal,plan);
              rows.push({name:unlocked.join(',')+':'+count,layout,physical:expandMachineLayout(layout)});
            }
            const fanout={id:'fanout',kind:'objective',buildingType:'WarEffort',layoutOptions:{buffers:false},inputs:Array.from({length:9},(_,i)=>({itemId:'conscript',rate:i+1,useSupply:true,modifiers:[{kind:'outfit',itemId:'iron_sword',useSupply:true}]}))};
            const plan=planGoal(m,fanout),layout=generateLayout(m,fanout,plan);
            rows.push({name:unlocked.join(',')+':mixed-fanout',layout,physical:expandMachineLayout(layout)});
            if(JSON.parse(layoutSignature(m,fanout,plan))[0]!==3)throw new Error('Saved layouts need a routing revision change');
          }
          return rows;
        }""",{'catalog':catalog,'snapshot':snapshot})
        for case in scenarios:
            try:
                validate(case['layout']);validate(case['physical'])
                # Grouped connection bundles and the individual graph describe
                # the same set of source/target machine indices and port numbers.
                physical=case['physical'];groups={n['id']:n for n in physical['nodes']}
                expected=set()
                for e in case['layout']['edges']:
                    for i in range(max(e.get('sourceCopies',1),e.get('targetCopies',1))):
                        expected.add((e['from'],e.get('sourceStart',0)+i+1 if e.get('sourceCopies') else 1,
                                      e['output']+(i if e.get('sourcePortRange') else 0),
                                      e['to'],e.get('targetStart',0)+i+1 if e.get('targetCopies') else 1,
                                      e['input']+(i if e.get('targetPortRange') else 0)))
                actual={(groups[e['from']]['groupId'],groups[e['from']]['instance'],e['output'],
                         groups[e['to']]['groupId'],groups[e['to']]['instance'],e['input']) for e in physical['edges']}
                assert actual==expected
            except AssertionError as error:
                raise AssertionError(case['name'],error) from error
        report={'passed':True,'testedAtUtc':datetime.now(timezone.utc).isoformat(),'scenarios':len(scenarios),
                'bankSizes':[1,4,5,16,17,32],'fourPortsPerSide':True,'unequalFanoutAndMerge':True,
                'physicalPortsUnique':True,'flowConservation':True,'bundleInstanceOffsets':True,
                'unlockFallbacks':True,'oldPlansMarkedStale':True}
        (PROJECT/'Verification/routing-tests.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report,indent=2));await browser.close()

if __name__=='__main__':asyncio.run(main())
