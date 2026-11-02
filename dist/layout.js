// A browser-only build guide. Banks group identical machines; bundle metadata
// describes their individual pipes without expanding large plans into millions of nodes.
export function layoutSignature(model,goal,plan){
  const {id,showLocked,...configuration}=goal;
  return JSON.stringify([3,configuration,plan.nodes.map(n=>[n.itemId,n.useSupply,n.rate,n.count,n.unitRate,n.locked,n.rateBasis]),plan.stages,plan.warnings,
    ['Collector','Distributor','Manifold','Stockpile'].map(t=>[t,model.buildable.has(t)])]);
}
export function generateLayout(model,goal,plan){
  if(plan.issues.length)throw new Error('Resolve the input and preparation issues before generating a layout.');
  const nodes=[],edges=[],supplyNodes=new Map(),warnings=new Set(),external=new Set(goal.external||[]);
  const planned=new Map(plan.nodes.map(n=>[n.itemId+':'+n.useSupply,n]));
  let serial=0,stageIndex=0,operations=0;
  const buffers=goal.layoutOptions?.buffers!==false&&model.buildable.has('Stockpile');
  function node(properties){const n={id:'n'+(++serial),count:1,kind:'production',settings:{},...properties};nodes.push(n);return n;}
  function edge(from,to,itemId,rate,input=0,output=0,extra={}){
    const prior=edges.find(e=>e.from===from.id&&e.to===to.id&&e.input===input&&e.output===output&&e.itemId===itemId);
    if(prior){prior.rate+=rate;return prior;}
    const e={from:from.id,to:to.id,itemId,rate,input,output,...extra};edges.push(e);return e;
  }
  function supply(itemId,rate,force=false,path=new Set()){
    if(++operations>2000||path.has(itemId))throw new Error('This supply chain is too deep or circular. Choose an existing supply to break the cycle.');
    const useSupply=!!force||external.has(itemId)&&itemId!==goal.itemId,key=itemId+':'+useSupply;
    const previous=supplyNodes.get(key);
    if(previous){previous.rate+=rate;} // Dependencies receive only this new contribution.
    const p=planned.get(key),source=model.sources.get(itemId),recipe=model.providers.get(itemId);
    const isExternal=useSupply||!source&&!recipe;
    const output=source?null:recipe?.outputs.filter(o=>o.hasOutput).find(o=>o.itemId===itemId);
    const outputPort=source?0:Math.max(0,recipe?.outputs.filter(o=>o.hasOutput).findIndex(o=>o.itemId===itemId)??0);
    const n=previous||node({kind:isExternal?'external':'production',type:isExternal?null:source?.station||recipe?.stationTag,itemId,
      title:model.name(itemId),subtitle:isExternal?'Existing supply':model.name(source?.station||recipe?.stationTag),rate,
      count:isExternal?0:p?.count||1,locked:!!p?.locked,outputPort,recipeId:source?null:recipe?.id,rateBasis:isExternal?null:p?.rateBasis,
      settings:source?{resource:itemId}:isExternal?{supply:itemId}:{recipe:recipe?.id}});
    supplyNodes.set(key,n);
    if(isExternal||source)return n;
    const next=new Set(path);next.add(itemId);
    for(const input of recipe.inputs){
      const inputRate=rate/(output?.count||1)*input.count;
      const upstream=supply(input.itemId,inputRate,false,next);
      edge(upstream,n,input.itemId,inputRate,input.port,upstream.outputPort||0);
    }
    if(recipe.outputs.filter(o=>o.hasOutput).length>1)warnings.add('Unused recipe outputs need a separate outlet in-game; this layout does not credit their production.');
    return n;
  }
  function prep(type,itemId,label,settings={}){
    const p=plan.stages[stageIndex++];
    if(!p||p.station!==type)throw new Error('Preparation changed. Generate the layout again.');
    return node({kind:'preparation',type,itemId,title:label,subtitle:model.name(type),count:p.count,rate:p.rate,locked:p.locked,settings,rateBasis:p.rateBasis});
  }
  function applyPreparation(next,previous,step){
    next.appliedModifiers=[structuredClone(step)];
    next.modifierStreams=[{itemId:next.itemId,steps:[...(previous.modifierStreams?.[0]?.steps||[]),structuredClone(step)]}];
  }
  function enhance(previous,itemId,rate,ids){
    let current=previous;
    for(const id of ids||[]){
      const recipe=model.catalog.recipes.find(r=>r.id===id),filtered=recipe.inputs.find(i=>i.filtered);
      const next=prep(recipe.stationTag,itemId,model.name(id),{recipe:id});
      applyPreparation(next,current,{kind:'recipe',recipeId:id});
      edge(current,next,itemId,rate,filtered?.port||0,current.outputPort||0);
      for(const i of recipe.inputs.filter(i=>!i.filtered)){
        const ingredient=supply(i.itemId,rate*i.count);edge(ingredient,next,i.itemId,rate*i.count,i.port,ingredient.outputPort||0);
      }
      current=next;
    }
    return current;
  }
  function buffer(previous,itemId,rate,purpose){
    if(!buffers)return previous;
    const next=node({kind:'utility',type:'Stockpile',itemId,title:'Stockpile',subtitle:purpose,rate,settings:{Capacity:10},reason:'Buffer batches; adds storage, not production capacity.'});
    if(previous.modifierStreams)next.modifierStreams=structuredClone(previous.modifierStreams);
    edge(previous,next,itemId,rate,0,previous.outputPort||0);return next;
  }
  const feeds=goal.kind==='objective'?goal.inputs:[{itemId:goal.itemId,rate:goal.rate,modifiers:goal.modifiers||[]}],finished=[];
  for(const feed of feeds){
    let current=supply(feed.itemId,feed.rate,feed.useSupply),training=0;
    const enhancements=[];
    for(const mod of feed.modifiers||[]){
      if(mod.kind==='recipe'){enhancements.push(mod.recipeId);continue;}
      if(mod.kind==='outfit'){
        let equipment=supply(mod.itemId,feed.rate,mod.useSupply);
        equipment=enhance(equipment,mod.itemId,feed.rate,mod.enhancements);
        equipment=buffer(equipment,mod.itemId,feed.rate,'Equipment reserve');
        const outfitter=prep('Outfitter',feed.itemId,'Equip '+model.name(mod.itemId),{equipment:mod.itemId,Timeout:0});
        applyPreparation(outfitter,current,{kind:'outfit',itemId:mod.itemId,slot:model.gear.get(mod.itemId)?.slot,enhancements:[...(mod.enhancements||[])]});
        edge(current,outfitter,feed.itemId,feed.rate,0,current.outputPort||0);edge(equipment,outfitter,mod.itemId,feed.rate,1,equipment.outputPort||0);current=outfitter;
      }else if(mod.kind==='training'){
        const next=prep('TrainingGrounds',feed.itemId,'Training pass '+(++training),{pass:training});
        applyPreparation(next,current,{kind:'training',pass:training,halfEffectiveness:training===2&&model.items.get(feed.itemId)?.kind!=='AdventurerItemType'});
        edge(current,next,feed.itemId,feed.rate,0,current.outputPort||0);current=next;
      }
    }
    current=enhance(current,feed.itemId,feed.rate,enhancements);
    current=buffer(current,feed.itemId,feed.rate,goal.kind==='objective'?'Destination reserve':'Finished production');
    finished.push({node:current,itemId:feed.itemId,rate:feed.rate});
  }
  if(goal.kind==='objective'){
    const endpoint=node({kind:'objective',type:goal.buildingType,title:model.name(goal.buildingType),subtitle:'Destination · set encounter / contract in-game',rate:plan.rate,locked:!model.buildable.has(goal.buildingType),settings:{}});
    const ports=goal.buildingType==='Dungeon'?5:goal.buildingType==='Arena'?2:1;
    if(ports>1){
      const assignments=Array.from({length:ports},(_,port)=>({port,feed:port%finished.length}));
      // More streams than ports can share a port through a Collector. Fewer streams
      // are distributed across all party/opponent slots, never leaving required slots empty.
      for(let i=0;i<finished.length;i++){
        const assigned=assignments.filter(a=>a.feed===i);
        if(!assigned.length)assigned.push({port:i%ports,feed:i});
        for(const a of assigned){const f=finished[i];edge(f.node,endpoint,f.itemId,f.rate/assigned.length,a.port,f.node.outputPort||0);}
      }
      warnings.add(`${model.name(goal.buildingType)} uses ${ports} input slots. Streams are assigned cyclically; match party composition, opposing feeds, and rates to the encounter in-game.`);
    }else for(const f of finished)edge(f.node,endpoint,f.itemId,f.rate,0,f.node.outputPort||0);
  }else if(!buffers){
    const f=finished[0],endpoint=node({kind:'output',itemId:f.itemId,title:'Finished supply',subtitle:model.name(f.itemId),count:0,rate:f.rate});edge(f.node,endpoint,f.itemId,f.rate,0,f.node.outputPort||0);
  }
  // Normalize real port constraints: only one pipe per input/output. These utility
  // nodes represent single placed buildings with the stated configurable port count.
  function utility(type,itemId,rate,slots,reason){
    if(slots>4)throw new Error('Routing utilities support at most four ports per side.');
    const locked=!model.buildable.has(type);
    if(locked)warnings.add(`${model.name(type)} research is required for this wiring.`);
    if(type==='Manifold')warnings.add('Manifold outputs use priority and backpressure. Labelled branch rates are demand budgets, not configured split ratios; check for starvation in-game.');
    if(nodes.length>=500)throw new Error('This layout exceeds 500 groups. Split it into smaller production goals.');
    return node({kind:'utility',type,itemId,title:model.name(type),subtitle:reason,rate,locked,reason,
      settings:type==='Distributor'?{OutputCount:Math.max(2,slots)}:{InputCount:Math.max(2,slots)}});
  }
  const mergeType=()=>model.buildable.has('Collector')?'Collector':model.buildable.has('Manifold')?'Manifold':'Collector';
  const splitType=()=>model.buildable.has('Distributor')?'Distributor':model.buildable.has('Manifold')?'Manifold':'Distributor';
  const sum=group=>group.reduce((total,e)=>total+e.rate,0);
  const sharedItem=group=>group.every(e=>e.itemId===group[0].itemId)?group[0].itemId:null;
  // Build bounded trees from connection records. Intermediate pipes retain their
  // aggregate demand; each leaf addresses no more than four physical ports.
  function mergeConnections(group,reason){
    if(group.length>4){
      const branches=[];
      for(let start=0;start<group.length;start+=4){
        const chunk=group.slice(start,start+4),target=chunk[0].to,input=chunk[0].input,rate=sum(chunk),itemId=sharedItem(chunk);
        const child=mergeConnections(chunk,reason),pipe={from:child.id,to:target,input,output:0,itemId,rate};
        edges.push(pipe);branches.push(pipe);
      }
      return mergeConnections(branches,reason);
    }
    const router=utility(mergeType(),sharedItem(group),sum(group),group.length,reason);
    group.forEach((e,index)=>{e.to=router.id;e.input=index;});return router;
  }
  function splitConnections(group,reason){
    if(group.length>4){
      const branches=[];
      for(let start=0;start<group.length;start+=4){
        const chunk=group.slice(start,start+4),source=chunk[0].from,output=chunk[0].output,rate=sum(chunk),itemId=sharedItem(chunk);
        const child=splitConnections(chunk,reason),pipe={from:source,to:child.id,input:0,output,itemId,rate};
        edges.push(pipe);branches.push(pipe);
      }
      return splitConnections(branches,reason);
    }
    const equal=group.every(e=>Math.abs(e.rate-group[0].rate)<1e-7),type=model.buildable.has('Manifold')?'Manifold':equal?splitType():'Manifold';
    const router=utility(type,sharedItem(group),sum(group),group.length,reason);
    group.forEach((e,index)=>{e.from=router.id;e.output=index;});return router;
  }
  // Merge multiple streams before a single destination input (including mixed units).
  for(const target of [...nodes]){
    const groups=new Map();
    for(const e of edges.filter(e=>e.to===target.id)){const group=groups.get(e.input)||[];group.push(e);groups.set(e.input,group);}
    for(const [port,group] of groups){
      if(group.length<2)continue;
      const same=group.every(e=>e.itemId===group[0].itemId),itemId=same?group[0].itemId:null,total=group.reduce((s,e)=>s+e.rate,0);
      const router=mergeConnections(group,'Merge input streams');edge(router,target,itemId,total,port);
    }
  }
  // One Manifold can collect a bank and distribute to downstream banks at once.
  // Keep a distinct output per physical destination port, even across different recipes.
  if(model.buildable.has('Manifold'))for(const source of [...nodes]){
    const ports=[...new Set(edges.filter(e=>e.from===source.id).map(e=>e.output))];
    for(const port of ports){
      const group=edges.filter(e=>e.from===source.id&&e.output===port),copies=Math.max(1,source.count);
      const targets=group.map(e=>nodes.find(n=>n.id===e.to)),outputs=targets.reduce((s,n)=>s+Math.max(1,n.count),0);
      if(outputs<2||copies>4||outputs>4||copies===1&&group.length===1)continue;
      const rate=group.reduce((s,e)=>s+e.rate,0),router=utility('Manifold',group[0].itemId,rate,Math.max(copies,outputs),'Collect and distribute parallel supply');
      let offset=0;
      group.forEach((e,index)=>{const count=Math.max(1,targets[index].count);e.from=router.id;e.output=offset;if(count>1){e.sourcePortRange=count;e.targetCopies=count;}offset+=count;});
      edge(source,router,group[0].itemId,rate,0,port,copies>1?{sourceCopies:copies,targetPortRange:copies}:{});
      warnings.add('Manifold outputs use priority and backpressure. Labelled branch rates are demand budgets, not configured split ratios; check for starvation in-game.');
    }
  }
  // A bank's outputs converge before any shared consumer split.
  for(const bank of nodes.filter(n=>n.count>1)){
    const outgoing=edges.filter(e=>e.from===bank.id&&!e.sourceCopies),ports=[...new Set(outgoing.map(e=>e.output))];
    for(const port of ports){
      const group=outgoing.filter(e=>e.output===port),rate=group.reduce((s,e)=>s+e.rate,0);
      const leaves=[];
      for(let start=0;start<bank.count;start+=4){
        const count=Math.min(4,bank.count-start),leaf=utility(mergeType(),group[0].itemId,rate*count/bank.count,count,`Collect machines ${start+1}–${start+count}`);
        edge(bank,leaf,group[0].itemId,rate*count/bank.count,0,port,{sourceCopies:count,sourceStart:start,targetPortRange:count});
        leaves.push(leaf);
      }
      let router=leaves[0];
      if(leaves.length>1){
        const pipes=leaves.map(leaf=>({from:leaf.id,to:group[0].to,input:group[0].input,output:0,itemId:group[0].itemId,rate:leaf.rate}));
        edges.push(...pipes);router=mergeConnections(pipes,`Collect ${bank.count} machine outputs`);
      }
      group.forEach(e=>{e.from=router.id;e.output=0;});
    }
  }
  // Fanout requires explicit routing. Manifolds use backpressure/priority, not ratios.
  for(const source of [...nodes]){
    const ports=[...new Set(edges.filter(e=>e.from===source.id&&!e.sourceCopies).map(e=>e.output))];
    for(const port of ports){
      const group=edges.filter(e=>e.from===source.id&&e.output===port&&!e.sourceCopies);if(group.length<2)continue;
      const total=sum(group),router=splitConnections(group,'Share supply between branches');edge(source,router,group[0].itemId,total,0,port);
    }
  }
  // Every input of a parallel machine bank needs its own distribution utility.
  for(const bank of nodes.filter(n=>n.count>1)){
    for(const e of [...edges.filter(e=>e.to===bank.id&&!e.targetCopies)]){
      const port=e.input,leaves=[];
      for(let start=0;start<bank.count;start+=4){
        const count=Math.min(4,bank.count-start),leaf=utility(splitType(),e.itemId,e.rate*count/bank.count,count,`Feed machines ${start+1}–${start+count}`);
        edge(leaf,bank,e.itemId,e.rate*count/bank.count,port,0,{sourcePortRange:count,targetCopies:count,targetStart:start});leaves.push(leaf);
      }
      let router=leaves[0];
      if(leaves.length>1){
        const pipes=leaves.map(leaf=>({from:e.from,to:leaf.id,input:0,output:e.output,itemId:e.itemId,rate:leaf.rate}));
        edges.push(...pipes);router=splitConnections(pipes,`Feed ${bank.count} parallel machines`);
      }
      e.to=router.id;e.input=0;
    }
  }
  if(!buffers&&goal.layoutOptions?.buffers!==false)warnings.add('Stockpiles are not unlocked; optional storage buffers were omitted.');
  if(nodes.length>500)throw new Error('This layout exceeds 500 groups. Split it into smaller production goals.');
  const {width,height}=positionFlow(nodes,edges);
  // Preserve each distinct preparation history through routing, without treating
  // an equipment input as the human stream processed by an Outfitter.
  const carried=new Map();
  for(const e of edges){const group=carried.get(e.to)||[];group.push(e.from);carried.set(e.to,group);}
  const byId=new Map(nodes.map(n=>[n.id,n]));
  for(const n of [...nodes].sort((a,b)=>a.column-b.column)){
    if(n.modifierStreams)continue;
    if(['utility','objective','output'].includes(n.kind)){
      const streams=(carried.get(n.id)||[]).flatMap(id=>byId.get(id).modifierStreams||[]);
      n.modifierStreams=[...new Map(streams.map(s=>[JSON.stringify(s),structuredClone(s)])).values()];
    }else n.modifierStreams=n.itemId?[{itemId:n.itemId,steps:[]}]:[];
  }
  const bill=new Map();for(const n of nodes.filter(n=>n.type)){const row=bill.get(n.type)||{type:n.type,count:0,locked:false,category:n.kind==='utility'?'utility':n.kind==='objective'?'destination':'production'};row.count+=n.count;row.locked||=n.locked;bill.set(n.type,row);}
  return {schema:'kingdom-factory-layout/v1',generatedAtUtc:new Date().toISOString(),goalId:goal.id,goalName:model.name(goal.kind==='objective'?goal.buildingType:goal.itemId),
    nodes,edges,bill:[...bill.values()].sort((a,b)=>a.category.localeCompare(b.category)||a.type.localeCompare(b.type)),
    warnings:[...warnings],width,height,
    machines:nodes.filter(n=>['production','preparation'].includes(n.kind)).reduce((s,n)=>s+n.count,0),utilities:nodes.filter(n=>n.kind==='utility').length,
    destinations:nodes.filter(n=>n.kind==='objective').length,locked:nodes.some(n=>n.locked),readOnly:true};
}

function positionFlow(nodes,edges){
  const byId=new Map(nodes.map(n=>[n.id,n])),incoming=new Map(nodes.map(n=>[n.id,[]])),outgoing=new Map(nodes.map(n=>[n.id,[]]));
  for(const e of edges){incoming.get(e.to).push(e);outgoing.get(e.from).push(e);}
  const indegree=new Map(nodes.map(n=>[n.id,incoming.get(n.id).length])),queue=nodes.filter(n=>!indegree.get(n.id));
  let visited=0;
  for(let i=0;i<queue.length;i++){
    const n=queue[i];visited++;n.column=Math.max(0,...incoming.get(n.id).map(e=>byId.get(e.from).column+1));
    for(const e of outgoing.get(n.id)){indegree.set(e.to,indegree.get(e.to)-1);if(!indegree.get(e.to))queue.push(byId.get(e.to));}
  }
  if(visited!==nodes.length)throw new Error('The layout contains a cycle. Select an existing supply to break it.');
  const columns=Array.from({length:Math.max(...nodes.map(n=>n.column))+1},(_,column)=>nodes.filter(n=>n.column===column));
  for(const group of columns)group.sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
  // Alternating barycentre passes align parents and children while retaining fixed columns.
  for(let pass=0;pass<5;pass++){
    const forward=pass%2===0,sequence=forward?columns:[...columns].reverse();
    for(const group of columns)group.forEach((n,index)=>{n.order=index;});
    for(const group of sequence){
      const score=n=>{const links=forward?incoming.get(n.id):outgoing.get(n.id);return links.length?links.reduce((s,e)=>s+byId.get(forward?e.from:e.to).order,0)/links.length:n.order;};
      group.sort((a,b)=>score(a)-score(b)||a.order-b.order);group.forEach((n,index)=>{n.order=index;});
    }
  }
  const cardWidth=216,cardHeight=116,gapX=116,gapY=44,margin=42;
  let lane=0;for(const e of edges)if(byId.get(e.to).column-byId.get(e.from).column>1)e.routeLane=lane++;
  const topGutter=lane?32+lane*12:0,bodyHeight=Math.max(340,Math.max(...columns.map(g=>g.length))*(cardHeight+gapY)+margin*2),height=bodyHeight+topGutter;
  for(const group of columns)group.forEach((n,index)=>{
    n.x=margin+n.column*(cardWidth+gapX);n.y=topGutter+(bodyHeight-(group.length*(cardHeight+gapY)-gapY))/2+index*(cardHeight+gapY);n.width=cardWidth;n.height=cardHeight;
    n.arrangement=n.count>1?{columns:Math.min(4,n.count),rows:Math.ceil(n.count/4)}:null;
  });
  return {width:columns.length*(cardWidth+gapX)-gapX+margin*2,height};
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:3});
export const familyColors=['#f27784','#f6a45d','#ead568','#91d47e','#65d3dc','#86a9ff','#c395f5'];
export function overviewLayout(layout,columns=6){
  const ordered=[...layout.nodes].sort((a,b)=>a.column-b.column||a.y-b.y),margin=72,gapX=64,gapY=64;
  columns=Math.max(1,Math.min(columns,ordered.length));
  const nodes=ordered.map((n,index)=>({...n,x:margin+(index%columns)*(216+gapX),y:margin+Math.floor(index/columns)*(116+gapY),overviewRow:Math.floor(index/columns),overviewColumn:index%columns}));
  const right=margin+(columns-1)*(216+gapX)+216;
  return {...layout,nodes,compact:true,gridRight:right,width:right+40+layout.edges.length*4+margin,height:margin*2+Math.ceil(nodes.length/columns)*(116+gapY)-gapY};
}
const machineLayouts=new WeakMap();
export function expandMachineLayout(layout){
  if(machineLayouts.has(layout))return machineLayouts.get(layout);
  const total=layout.nodes.reduce((sum,n)=>sum+Math.max(1,n.count),0);
  if(total>2000)throw new Error('Individual view supports up to 2,000 nodes. Split this production into smaller goals to expand every machine.');
  const copies=new Map(),nodes=[];
  for(const n of layout.nodes){
    const count=Math.max(1,n.count),instances=Array.from({length:count},(_,index)=>{
      const copy={...n,id:count>1?n.id+':'+(index+1):n.id,groupId:n.id,instance:index+1,instanceCount:count,
        count:n.count?1:0,rate:n.rate/count,title:count>1?n.title+' #'+(index+1):n.title,settings:{...n.settings}};
      nodes.push(copy);return copy;
    });
    copies.set(n.id,instances);
  }
  const edges=[];
  for(const e of layout.edges){
    const count=Math.max(e.sourceCopies||1,e.targetCopies||1);
    for(let index=0;index<count;index++){
      const copy={...e,from:copies.get(e.from)[e.sourceCopies?(e.sourceStart||0)+index:0].id,to:copies.get(e.to)[e.targetCopies?(e.targetStart||0)+index:0].id,
        output:e.output+(e.sourcePortRange?index:0),input:e.input+(e.targetPortRange?index:0),rate:e.rate/count};
      for(const key of ['sourceCopies','targetCopies','sourceStart','targetStart','sourcePortRange','targetPortRange','routeLane'])delete copy[key];
      edges.push(copy);
    }
  }
  const display={...layout,nodes,edges,...positionFlow(nodes,edges),individualMachines:true};
  machineLayouts.set(layout,display);return display;
}
export const layoutForView=(layout,ui={})=>ui.machinesExpanded?expandMachineLayout(layout):ui.expanded&&ui.overview!==false?overviewLayout(layout,ui.overviewColumns||6):layout;
export function nodeFamily(layout,id){
  if(!layout.nodes.some(n=>n.id===id))return {selected:null,parents:[],children:[]};
  const unique=edges=>[...new Set(edges)];
  const parents=unique(layout.edges.filter(e=>e.to===id).sort((a,b)=>a.input-b.input).map(e=>e.from));
  const children=unique(layout.edges.filter(e=>e.from===id).sort((a,b)=>a.output-b.output).map(e=>e.to));
  return {selected:id,parents:parents.map((node,index)=>({id:node,label:'P'+(index+1),role:'parent',color:familyColors[index%familyColors.length]})),children:children.map((node,index)=>({id:node,label:'C'+(index+1),role:'child',color:familyColors[(parents.length+index)%familyColors.length]}))};
}
export function highlightFamily(root,layout,id){
  const family=nodeFamily(layout,id),neighbors=new Map([...family.parents,...family.children].map(n=>[n.id,n]));
  for(const node of root.querySelectorAll('[data-layout-node]')){
    const relation=neighbors.get(node.dataset.layoutNode),selected=node.dataset.layoutNode===family.selected;
    node.classList.toggle('is-selected',selected);node.classList.toggle('is-related',!!relation);node.classList.toggle('is-dim',!!family.selected&&!selected&&!relation);
    node.setAttribute('aria-pressed',String(selected));node.style.setProperty('--relation-color',relation?.color||'');
    const label=node.querySelector('.relation-badge text');if(label)label.textContent=relation?.label||'';
  }
  for(const wire of root.querySelectorAll('[data-layout-from]')){
    const relation=wire.dataset.layoutTo===family.selected?neighbors.get(wire.dataset.layoutFrom):wire.dataset.layoutFrom===family.selected?neighbors.get(wire.dataset.layoutTo):null;
    wire.classList.toggle('is-related',!!relation);wire.classList.toggle('is-dim',!!family.selected&&!relation);
    wire.style.setProperty('--relation-color',relation?.color||'');
  }
  const names=new Map(layout.nodes.map(n=>[n.id,n.title])),bar=root.querySelector('.layout-family-bar');
  if(bar)bar.innerHTML=family.selected?`<span class="family-title">${esc(names.get(id))}</span><span class="family-direction">Parents → selected → children</span>${[...family.parents,...family.children].map(n=>`<span class="family-chip" style="--relation-color:${n.color}"><b>${n.label}</b> ${esc(names.get(n.id))}</span>`).join('')}<button class="text-button" data-layout-clear>Clear</button>`:'<span>Select or hover a node to trace its direct parents and children.</span>';
  const inspect=root.querySelector('[data-layout-inspect]');if(inspect)inspect.disabled=!family.selected;
  return family;
}
const icon=(model,n)=>model.definitions[n.type]?.icon||(n.type==='QuestBoard'?'Icons_136':model.items.get(n.itemId)?.icon)||'Icons_1';
function wrap(value,length=27){
  const words=String(value).split(' '),lines=[''];for(const word of words){if((lines.at(-1)+' '+word).trim().length>length&&lines.at(-1))lines.push(word);else lines[lines.length-1]+=(lines.at(-1)?' ':'')+word;}return lines;
}
export function layoutSvg(model,layout,scale=1,standalone=false){
  const byId=new Map(layout.nodes.map(n=>[n.id,n])),tracks=new Map(),incoming=new Map(layout.nodes.map(n=>[n.id,[]])),outgoing=new Map(layout.nodes.map(n=>[n.id,[]]));
  for(const e of layout.edges){incoming.get(e.to).push(e);outgoing.get(e.from).push(e);}
  for(const e of layout.edges.filter(e=>e.routeLane===undefined)){const column=byId.get(e.from).column,group=tracks.get(column)||[];group.push(e);tracks.set(column,group);}
  const styles=`.layout-wire.is-dim{opacity:.12}.layout-node.is-dim{opacity:.24}.layout-svg .layout-node.is-related>rect{stroke:var(--relation-color);stroke-width:3;fill:color-mix(in srgb,var(--relation-color) 12%,#292427)}.layout-svg .layout-node.is-selected>rect{stroke:#fff1cd;stroke-width:4}.layout-wire.is-related .wire{stroke:var(--relation-color);stroke-width:3;opacity:1}.relation-badge{display:none}.layout-node.is-related .relation-badge{display:block}.layout-svg .layout-node .relation-badge rect{fill:var(--relation-color);stroke:none}.layout-node .relation-badge text{fill:#151419;font:bold 12px Arial,sans-serif;text-anchor:middle}.wire{fill:none;stroke:#8c9d67;stroke-width:2;opacity:.7}.wire.utility{stroke:#b38f5a}.layout-node rect{fill:#30272a;stroke:#957144;stroke-width:1.5}.layout-node.utility rect{fill:#282d24;stroke:#788655}.layout-node.external rect{fill:#24232b;stroke:#8a839b;stroke-dasharray:5 4}.layout-node.objective rect{fill:#442b27;stroke:#c59855;stroke-width:2}.layout-node.locked rect{stroke:#bc785b;stroke-dasharray:5 4}.layout-node:focus rect,.layout-node:hover rect{stroke:#f0ce87;stroke-width:3}.layout-node text{font-family:Arial,sans-serif;fill:#ead6b0;font-size:13px}.layout-node .node-subtitle{fill:#b7a385;font-size:11px}.layout-node .node-count{fill:#d0dbad;font-size:12px}.layout-node .node-rate{fill:#efca82;font-size:12px}.layout-port{fill:#b3c587}.wire-label{font:10px Arial,sans-serif;fill:#cbb98f;paint-order:stroke;stroke:#191719;stroke-width:4px;stroke-linejoin:round}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="layout-svg" width="${Math.ceil(layout.width*scale)}" height="${Math.ceil(layout.height*scale)}" viewBox="0 0 ${layout.width} ${layout.height}" role="group" aria-label="${esc(layout.goalName)} production layout, resources to destination"><title>${esc(layout.goalName)} · Factory build layout</title><style>${styles}</style><defs><marker id="layout-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs><rect width="100%" height="100%" fill="#191719"/>
  ${layout.edges.map((e,index)=>{
    const a=byId.get(e.from),b=byId.get(e.to),from=outgoing.get(a.id),to=incoming.get(b.id);
    const x1=a.x+a.width,x2=b.x,y1=a.y+28+(from.indexOf(e)+1)/(from.length+1)*(a.height-40),y2=b.y+28+(to.indexOf(e)+1)/(to.length+1)*(b.height-40),group=tracks.get(a.column)||[],middle=x1+24+(group.indexOf(e)+1)/(group.length+1)*Math.max(0,x2-x1-48);
    const offset=12+(index%8)*5,sourceStub=x1+offset,targetStub=x2-offset,bus=layout.gridRight+28+index*4;
    const path=layout.compact?(a.overviewRow===b.overviewRow?(b.overviewColumn===a.overviewColumn+1?`M${x1},${y1} H${(x1+x2)/2} V${y2} H${x2-5}`:`M${x1},${y1} H${sourceStub} V${a.y-offset} H${targetStub} V${y2} H${x2-5}`):`M${x1},${y1} H${sourceStub} V${a.y+a.height+offset} H${bus} V${b.y-offset} H${targetStub} V${y2} H${x2-5}`):e.routeLane!==undefined?`M${x1},${y1} H${x1+22} V${20+e.routeLane*12} H${x2-22} V${y2} H${x2-5}`:Math.abs(y2-y1)<.1?`M${x1},${y1} H${x2-5}`:`M${x1},${y1} H${middle} V${y2} H${x2-5}`;
    return `<g class="layout-wire" data-layout-from="${esc(e.from)}" data-layout-to="${esc(e.to)}"><path class="wire ${a.kind==='utility'||b.kind==='utility'?'utility':''}" d="${path}" marker-end="url(#layout-arrow)"/><title>${esc(e.itemId?model.name(e.itemId):'Mixed inputs')}: ${fmt(e.rate)}/sec · input ${e.input+1}${e.sourceCopies||e.targetCopies?' · parallel pipe bundle':''}</title>${!layout.compact&&e.routeLane===undefined&&Math.abs(y1-y2)<36?`<text class="wire-label" x="${middle}" y="${Math.min(y1,y2)-7}" text-anchor="middle">${fmt(e.rate)}/s</text>`:''}</g>`;
  }).join('')}
  ${layout.nodes.map(n=>{
    const inputs=incoming.get(n.id),outputs=outgoing.get(n.id);
    const ports=[...inputs.map((e,i)=>({x:0,y:28+(i+1)/(inputs.length+1)*(n.height-40)})),...outputs.map((e,i)=>({x:n.width,y:28+(i+1)/(outputs.length+1)*(n.height-40)}))].map(p=>`<circle class="layout-port" cx="${p.x}" cy="${p.y}" r="3"/>`).join('');
    const lines=wrap(n.title,22),imageUrl=(standalone?'http://127.0.0.1:17841/':'')+'assets/icons/'+icon(model,n)+'.png';
    return `<g class="layout-node ${n.kind} ${n.locked?'locked':''}" ${standalone?'':`data-layout-node="${esc(n.id)}" role="button" aria-pressed="false" tabindex="0"`} aria-label="${esc(n.title)}, ${n.count>0?n.count+' '+model.name(n.type):'existing supply'}, ${fmt(n.rate)}/sec" transform="translate(${n.x},${n.y})"><title>${esc(n.title)} · ${esc(n.subtitle)}${n.locked?' · Research required':''}</title><rect width="${n.width}" height="${n.height}" rx="5"/><image href="${imageUrl}" x="12" y="13" width="28" height="28" style="image-rendering:pixelated"/>${lines.slice(0,2).map((line,i)=>`<text x="49" y="${26+i*17}">${esc(line)}</text>`).join('')}<text class="node-subtitle" x="13" y="67">${esc(wrap(n.subtitle,33)[0])}</text><text class="node-count" x="13" y="94">${n.count>1?'×'+fmt(n.count)+' machines':n.count===0?'External connection':n.kind==='objective'?'1 destination':'1 building'}${n.locked?' · locked':''}</text><text class="node-rate" x="203" y="94" text-anchor="end">${fmt(n.rate)}/s</text>${ports}<g class="relation-badge" transform="translate(184,-10)"><rect width="32" height="20" rx="3"/><text x="16" y="14"></text></g></g>`;
  }).join('')}</svg>`;
}
export function layoutPanel(model,goal,plan,record,ui={}){
  const stale=record&&record.signature!==layoutSignature(model,goal,plan),layout=record?.layout;
  const options=`<label class="layout-buffer-option"><input id="layout-buffers" type="checkbox" ${goal.layoutOptions?.buffers!==false?'checked':''}> Stockpile buffers${model.buildable.has('Stockpile')?'':' (when unlocked)'}</label>`;
  return `<section class="panel generated-layout" id="generated-layout" data-layout-goal="${esc(goal.id)}" data-layout-stamp="${esc(layout?.generatedAtUtc||'')}"><div class="layout-heading"><div><h3>Factory layout</h3><p>${layout?'Resources → production → preparation → destination':'Generate a connected build guide from your selected inputs and preparation.'}</p></div><button class="primary" data-action="generate-layout" ${plan.issues.length?'disabled':''}>${layout?'Regenerate layout':'Generate layout'}</button></div><div class="layout-options">${options}<span>${layout?`${fmt(layout.machines)} machines · ${layout.utilities} utilities${layout.destinations?' · '+layout.destinations+' destination':''}`:'Build guide · grouped machines'}</span></div>
  ${layout?`${stale?'<div class="layout-stale" role="status">Inputs, game progress, or routing rules changed. Regenerate this layout to update it.</div>':''}<div class="layout-toolbar"><div><button class="ghost" data-layout-zoom="out" aria-label="Zoom layout out">−</button><span class="layout-zoom-label">${Math.round((ui.zoom||1)*100)}%</span><button class="ghost" data-layout-zoom="in" aria-label="Zoom layout in">＋</button><button class="ghost" data-layout-zoom="fit">Fit</button><button class="ghost" data-layout-zoom="reset">100%</button><button class="ghost" data-layout-fullscreen aria-expanded="${!!ui.expanded}">${ui.expanded?'Exit fullscreen':'Fullscreen'}</button><button class="ghost" data-layout-machines aria-pressed="${!!ui.machinesExpanded}">${ui.machinesExpanded?'Group machines':'Expand'}</button>${ui.expanded&&!ui.machinesExpanded?`<button class="ghost" data-layout-arrangement>${ui.overview===false?'Compact view':'Flow view'}</button>`:''}</div><div class="layout-secondary-tools"><button class="text-button" data-layout-inspect disabled>Node details</button><button class="text-button" data-layout-export="json">Download plan</button></div></div><div class="layout-family-bar" aria-label="Direct node connections"><span>Select or hover a node to trace its direct parents and children.</span></div><div class="layout-scroll" tabindex="0" aria-label="Scrollable production layout">${layoutSvg(model,layoutForView(layout,ui),ui.zoom||1)}</div><div class="layout-key"><span>◆ Production</span><span class="green">◆ Utilities</span><span>◇ Existing supply</span><span>Hover to trace · Click for modifiers · Wheel to zoom · Drag to pan.</span></div>
  <details class="layout-build-list"><summary>Building list · ${fmt(layout.machines+layout.utilities+layout.destinations)} total</summary><div class="layout-bill">${layout.bill.map(b=>`<div><img class="item-icon" src="assets/icons/${esc(model.definitions[b.type]?.icon||'Icons_1')}.png" alt=""><span>${esc(model.name(b.type))}${b.locked?' · research required':''}</span><strong>×${fmt(b.count)}</strong></div>`).join('')}</div></details>
  ${layout.warnings.length?`<details class="layout-assumptions"><summary>Routing notes · ${layout.warnings.length}</summary>${layout.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</details>`:''}<p class="layout-footnote">${ui.machinesExpanded?'Each node is one machine; every pipe connects its physical ports.':'Groups contain identical parallel machines. Expand to see each machine and its individual pipes.'} This is a build guide for placing in-game.</p>`:`<div class="layout-placeholder"><img src="assets/icons/Icons_104.png" alt=""><p>${plan.issues.length?'Complete or correct the inputs above to generate a layout.':'Your layout will include machine groups, connected supply lines, and utility settings.'}</p></div>`}</section>`;
}
