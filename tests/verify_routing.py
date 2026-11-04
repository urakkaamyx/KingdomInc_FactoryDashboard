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
        # Import the local modules without starting the app's game API watcher.
        await page.route('http://127.0.0.1:17841/',lambda route:route.fulfill(content_type='text/html',body='<html></html>'))
        await page.goto('http://127.0.0.1:17841')
        scenarios=await page.evaluate("""async({catalog,snapshot})=>{
          const {createModel,planGoal}=await import('/model.js');
          const {generateLayout,expandMachineLayout,layoutSignature}=await import('/layout.js');
          const rows=[];
          const routers=['Collector','Distributor','Manifold'];
          function check(m,name,goal,plan,blocked){
            let layout;
            try{layout=generateLayout(m,goal,plan);}catch(error){
              if(!blocked||!error.message.includes('Research')||!error.message.includes('Manifold'))throw error;
              rows.push({name,blocked:true,message:error.message});return;
            }
            if(blocked)throw new Error(name+': expected missing-routing research error');
            for(const n of layout.nodes.filter(n=>n.kind==='utility')){
              if(!m.buildable.has(n.type)||n.locked)throw new Error(name+': inserted locked '+n.type);
            }
            for(const b of layout.bill.filter(b=>routers.includes(b.type))){
              if(!m.buildable.has(b.type)||b.locked)throw new Error(name+': locked router in building list');
            }
            rows.push({name,layout,physical:expandMachineLayout(layout)});
          }
          for(const unlocked of [['Collector','Distributor','Manifold'],['Manifold'],['Collector','Distributor'],['Collector'],['Distributor'],[]]){
            const s=structuredClone(snapshot);
            s.sections.unlocks.data.buildingTypes=s.sections.unlocks.data.buildingTypes.filter(t=>!['Collector','Distributor','Manifold'].includes(t)).concat(unlocked,'Shop','WarEffort','Outfitter');
            const m=createModel(catalog,s);
            for(const count of [1,4,5,16,17,32]){
              const goal={id:'bank',itemId:'iron_sword',rate:1,modifiers:[],layoutOptions:{buffers:false}};
              const plan=planGoal(m,goal);plan.nodes.forEach(n=>{if(!n.external)n.count=count;});
              check(m,unlocked.join(',')+':'+count,goal,plan,count>1&&!unlocked.includes('Manifold')&&!(unlocked.includes('Collector')&&unlocked.includes('Distributor')));
            }
            const fanout={id:'fanout',kind:'objective',buildingType:'WarEffort',layoutOptions:{buffers:false},inputs:Array.from({length:9},(_,i)=>({itemId:'conscript',rate:i+1,useSupply:true,modifiers:[{kind:'outfit',itemId:'iron_sword',useSupply:true}]}))};
            const plan=planGoal(m,fanout);
            check(m,unlocked.join(',')+':mixed-fanout',fanout,plan,!unlocked.includes('Manifold')&&!(unlocked.includes('Collector')&&unlocked.includes('Distributor')));
          }
          // An unequal branch split needs no merger: Distributor alone is sufficient.
          for(const unlocked of [['Distributor'],['Manifold'],[]]){
            const s=structuredClone(snapshot);
            s.sections.unlocks.data.buildingTypes=unlocked.concat('Mine','Forge','Blacksmith','SupplyDepot','Shop','Arena');
            const m=createModel(catalog,s);
            const goal={id:'unequal',kind:'objective',buildingType:'Arena',layoutOptions:{buffers:false},inputs:[{itemId:'conscript',rate:1,useSupply:true},{itemId:'conscript',rate:2,useSupply:true}]};
            const plan=planGoal(m,goal);
            // Two unequal streams reuse the same external source and distinct destination ports.
            check(m,unlocked.join(',')+':unequal-direct',goal,plan,!unlocked.length);
          }
          const sample=rows.find(r=>r.layout);
          const m=createModel(catalog,snapshot),goal={id:'saved',itemId:'iron_sword',rate:1,modifiers:[],layoutOptions:{buffers:false}},plan=planGoal(m,goal);
          if(JSON.parse(layoutSignature(m,goal,plan))[0]!==4)throw new Error('Saved layouts need a routing revision change');
          const {layoutPanel}=await import('/layout.js');
          const signature=JSON.parse(layoutSignature(m,goal,plan));signature[0]=3;
          if(!layoutPanel(m,goal,plan,{signature:JSON.stringify(signature),layout:sample.layout}).includes('layout-stale'))throw new Error('Old saved guide was not marked stale');
          for(const row of rows.filter(r=>r.layout&&r.name.startsWith('Collector,Distributor:'))){
            if(row.layout.nodes.some(n=>n.type==='Manifold'))throw new Error('Locked Manifold fallback returned');
          }
          return rows;
        }""",{'catalog':catalog,'snapshot':snapshot})
        for case in scenarios:
            if case.get('blocked'):continue
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
                'unlockFallbacks':True,'noLockedUtilities':True,'missingRoutingResearchBlocked':sum(bool(s.get('blocked')) for s in scenarios),
                'unequalDistributorFallback':True,'oldPlansMarkedStale':True}
        (PROJECT/'Verification/routing-tests.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report,indent=2));await browser.close()

if __name__=='__main__':asyncio.run(main())
