const routers=new Set(['Collector','Distributor','Manifold','Filter','TrackSwitch','Stockpile','Inspector','SingleButton','Timer']);
const key=(...parts)=>JSON.stringify(parts);
export const isObjective=b=>b?.category==='Consumption'||['Arena','Armory','Hoard','Portal'].includes(b?.type);
export const transferKey=e=>key('transfer',e.sourceBuildingId,e.sourcePort,e.targetBuildingId,e.targetPort,e.itemId);
export const deliveryKey=e=>key('delivery',e.producerBuildingId,e.targetBuildingId,e.itemId);
const productId=(model,id)=>model.items.has(id)?id:model.items.has(String(id).split(':')[0])?String(id).split(':')[0]:id;
export function createFlowMetrics(){
  let samples=[],identity=null,latest=null;
  function clear(){samples=[];identity=null;latest=null;}
  function record(snapshot){
    const factory=snapshot?.sections?.factory?.data,t=factory?.telemetry;
    if(!t?.available||!Number.isFinite(t.clockSeconds)){clear();return;}
    const topology=key(factory.flows.map(f=>[f.id,f.buildings.map(b=>[b.id,b.position,b.recipeId]),f.connections.map(e=>[e.sourceBuildingId,e.sourcePort,e.targetBuildingId,e.targetPort])]),snapshot.sections.native?.data?.Flows?.map(f=>f.Decorations?.filter(d=>d.Label==null&&d.Sticker==null).map(d=>[d.Position,d.Size])));
    const id=key(snapshot.instanceId,snapshot.sessionId,t.epoch,topology),now=Date.now();
    if(id!==identity||samples.length&&now-samples.at(-1).received>5000){clear();identity=id;}
    if(samples.length&&t.clockSeconds<=samples.at(-1).at)return;
    const values=new Map(),put=(k,v)=>{try{values.set(k,BigInt(v));}catch{}};
    for(const row of t.transfers||[])put(transferKey(row),row.count);
    for(const row of t.deliveries||[]){put(deliveryKey(row),row.count);for(const [currency,amount] of Object.entries(row.earned||{}))put(key('sale',row.producerBuildingId,row.targetBuildingId,row.itemId,currency),amount);}
    for(const row of t.buildings||[])for(const side of ['earned','spent'])for(const [currency,amount] of Object.entries(row[side]||{}))put(key(side,row.buildingId,currency),amount);
    samples.push({at:t.clockSeconds,received:now,values});while(samples.length>1&&samples[0].at<t.clockSeconds-60)samples.shift();latest=t;
  }
  function rate(k){
    if(samples.length<2)return null;
    const first=samples[0],last=samples.at(-1),delta=(last.values.get(k)||0n)-(first.values.get(k)||0n);
    return delta<0n?null:Number(delta)/(last.at-first.at);
  }
  return {record,clear,rate,get telemetry(){return latest;},get ready(){return samples.length>1;}};
}
export function containerOutput(model,container,metrics){
  const flow=model.snapshot?.sections?.factory?.data?.flows?.find(f=>f.id===container.flowId);
  if(!flow)return {rows:[],net:[],totalItems:null,ready:false};
  const buildings=new Map(flow.buildings.map(b=>[b.id,b])),owned=container.buildingIds,incoming=new Map(),outgoing=new Map();
  for(const e of flow.connections){if(!buildings.has(e.sourceBuildingId)||!buildings.has(e.targetBuildingId))continue;for(const [map,id] of [[incoming,e.targetBuildingId],[outgoing,e.sourceBuildingId]]){const list=map.get(id)||[];list.push(e);map.set(id,list);}}
  function items(b,port=0,seen=new Set()){
    if(!b||seen.has(b.id))return [];const next=new Set(seen);next.add(b.id);
    const output=b.outputs?.find(p=>p.index===port),recipe=model.catalog?.recipes?.find(r=>r.id===b.recipeId);
    const explicit=output?.itemId||b.resourceItemId||recipe?.outputs?.filter(o=>o.hasOutput)[port]?.itemId;
    if(explicit)return [productId(model,explicit)];
    if(['Outfitter','TrainingGrounds'].includes(b.type)||routers.has(b.type))return [...new Set((incoming.get(b.id)||[]).filter(e=>routers.has(b.type)||e.targetPort===0).flatMap(e=>items(buildings.get(e.sourceBuildingId),e.sourcePort,next)))];
    return [...new Set((output?.inventory||[]).map(i=>productId(model,typeof i==='string'?i:i.Type||i.type)).filter(Boolean))];
  }
  const rows=new Map();
  function add(itemId,destination,producer,kind='objective',edge=null){
    if(!itemId)return;
    itemId=productId(model,itemId);
    const type=destination?.type||'Unconnected output',id=key(itemId,type,kind);
    let row=rows.get(id);if(!row){row={itemId,type,kind,targets:new Set(),producers:new Set(),ownedTargets:new Set(),edges:new Map()};rows.set(id,row);}
    if(destination){row.targets.add(destination.id);if(owned.has(destination.id))row.ownedTargets.add(destination.id);}
    if(producer)row.producers.add(producer);
    if(edge)row.edges.set(key(edge.sourceBuildingId,edge.sourcePort,edge.targetBuildingId,edge.targetPort),edge);
  }
  function walk(producer,itemId,edges,seen=new Set()){
    for(const e of edges){const target=buildings.get(e.targetBuildingId);if(!target||seen.has(target.id))continue;
      if(isObjective(target)){add(itemId,target,producer);continue;}
      if(routers.has(target.type)){
        const next=outgoing.get(target.id)||[];
        if(!next.length)add(itemId,target,producer,'buffer',e);
        else walk(producer,itemId,next,new Set([...seen,target.id]));
      }else if(!owned.has(target.id))add(itemId,target,producer,'export',e);
    }
  }
  for(const b of flow.buildings.filter(b=>owned.has(b.id)&&!routers.has(b.type)&&!isObjective(b))){
    for(const port of b.outputs||[]){const edges=(outgoing.get(b.id)||[]).filter(e=>e.sourcePort===port.index);
      for(const item of items(b,port.index)){if(edges.length)walk(b.id,item,edges);else add(item,null,b.id,'unconnected');}
    }
  }
  // An objective inside this container also counts imported input streams.
  for(const target of flow.buildings.filter(b=>owned.has(b.id)&&isObjective(b)))for(const e of incoming.get(target.id)||[])for(const item of items(buildings.get(e.sourceBuildingId),e.sourcePort))add(item,target,null);
  // Routing-only containers can still export an incoming product.
  if(!rows.size)for(const e of flow.connections.filter(e=>owned.has(e.sourceBuildingId)&&!owned.has(e.targetBuildingId)))for(const item of items(buildings.get(e.sourceBuildingId),e.sourcePort)){
    if(isObjective(buildings.get(e.targetBuildingId)))add(item,buildings.get(e.targetBuildingId),null,'objective',e);
    else add(item,buildings.get(e.targetBuildingId),null,'export',e);
  }
  const t=metrics.telemetry,net=new Map(),addMoney=(currency,amount)=>net.set(currency,(net.get(currency)||0)+amount);
  function physicalRate(row){
    if(!metrics.ready)return null;
    let rate=0;
    for(const e of t.transfers||[])if(productId(model,e.itemId)===row.itemId&&row.edges.has(key(e.sourceBuildingId,e.sourcePort,e.targetBuildingId,e.targetPort)))rate+=metrics.rate(transferKey(e))||0;
    return rate;
  }
  let complete=true,totalItems=metrics.ready?0:null;
  const result=[...rows.values()].map(row=>{
    let count=metrics.ready?0:null;const revenue=new Map();
    if(row.kind==='objective'){
      const untraced=(t?.deliveries||[]).some(d=>row.targets.has(d.targetBuildingId)&&productId(model,d.itemId)===row.itemId&&!d.producerBuildingId&&!row.ownedTargets.has(d.targetBuildingId)&&(metrics.rate(deliveryKey(d))||0)>0);
      for(const d of t?.deliveries||[])if(row.targets.has(d.targetBuildingId)&&productId(model,d.itemId)===row.itemId&&(row.ownedTargets.has(d.targetBuildingId)||row.producers.has(d.producerBuildingId))){
        const value=metrics.rate(deliveryKey(d));if(value!==null)count+=value;
        for(const currency of Object.keys(d.earned||{})){const value=metrics.rate(key('sale',d.producerBuildingId,d.targetBuildingId,d.itemId,currency));if(value!==null)revenue.set(currency,(revenue.get(currency)||0)+value);}
      }
      // A routing-only boundary has no producer owned by this container.
      if(!row.producers.size&&!row.ownedTargets.size)count=physicalRate(row);
      if(untraced&&row.producers.size){count=null;complete=false;}
      if(!row.producers.size&&!row.ownedTargets.size)complete=false;
      if([...row.targets].some(id=>!owned.has(id)&&!['Shop','LuxuryShop','Restaurant','MercenaryGuild'].includes(buildings.get(id)?.type)))complete=false;
      if(count===null)totalItems=null;else if(totalItems!==null)totalItems+=count;
    }else count=physicalRate(row);
    return {...row,targets:[...row.targets],count,revenue:[...revenue].map(([currency,rate])=>({currency,rate}))};
  });
  if(metrics.ready){
    for(const b of t.buildings||[])if(owned.has(b.buildingId)){
      for(const side of ['earned','spent'])for(const currency of Object.keys(b[side]||{})){const value=metrics.rate(key(side,b.buildingId,currency));if(value!==null)addMoney(currency,value*(side==='earned'?1:-1));}
    }
    // Owned destinations already include their total revenue above. Only add
    // externally sold goods when the observer traced their producer here.
    for(const d of t.deliveries||[])if(!owned.has(d.targetBuildingId)&&owned.has(d.producerBuildingId))for(const currency of Object.keys(d.earned||{})){const value=metrics.rate(key('sale',d.producerBuildingId,d.targetBuildingId,d.itemId,currency));if(value!==null)addMoney(currency,value);}
  }
  return {rows:result.sort((a,b)=>model.name(a.itemId).localeCompare(model.name(b.itemId))),totalItems,net:[...net].map(([currency,rate])=>({currency,rate})),ready:metrics.ready,available:!!t,complete};
}
