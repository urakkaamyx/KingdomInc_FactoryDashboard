import {planPreparedGoal} from './objective-model.js';
import {groupContainers} from './containers.js';
import {stationRateBasis} from './rate-basis.js';
export const sections = ['session','research','unlocks','upgrades','resources','economy','factory','progression','native'];
export const flatten = snapshot => snapshot?.sections?.factory?.data?.flows?.flatMap(f => f.buildings.map(b => ({...b, flowName:f.name, flowId:f.id}))) || [];
export const dataOf = (snapshot,key) => snapshot?.sections?.[key]?.data ?? null;
export function translate(catalog, value) {
  if (!value) return '';
  const dictionary=catalog?.reference?.['localization_en-US'] || {};
  const key=value.replace(/^@/,'');
  return dictionary[key] || (value.startsWith('@') ? key.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) : value);
}
export const number = (v,digits=2) => Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US',{maximumFractionDigits:digits}) : '--';
export const finiteRate = value => Number.isFinite(Number(value)) && Number(value)>0 && Number(value)<=1000000;
export function currency(value) {
  try { return BigInt(value).toLocaleString('en-US'); } catch { return '—'; }
}
export function resourceRows(snapshot) {
  return (dataOf(snapshot,'resources')?.quotas || []).filter(r=>r.availablePerSecond>0 || r.demandPerSecond>0)
    .map(r=>({...r,utilization:r.availablePerSecond>0?r.demandPerSecond/r.availablePerSecond:r.demandPerSecond>0?Infinity:0}))
    .sort((a,b)=>(b.shortfallPerSecond>0)-(a.shortfallPerSecond>0) || b.utilization-a.utilization || a.itemId.localeCompare(b.itemId));
}
export function buildingState(b) {
  if (b.outputs.some(p=>p.capacity>0 && p.buffered>=p.capacity)) return {label:'Output full',kind:'amber'};
  if (b.crafting && b.automatic) return {label:'Crafting',kind:'green'};
  if (b.recipeId && !b.automatic) return {label:'Manual',kind:'muted'};
  if (b.inputs.length && b.inputs.some(p=>p.buffered<p.capacity) && !b.crafting) return {label:'Awaiting input',kind:'muted'};
  if (b.resourceItemId && b.automatic) return {label:'Automated',kind:'green'};
  return {label:'Ready',kind:'muted'};
}
export function createModel(catalog,snapshot,traits={}) {
  const items=new Map((catalog?.items || []).map(i=>[i.id,i]));
  const research=new Map((dataOf(snapshot,'research') || []).map(t=>[t.id,t]));
  const purchased=new Set([...research.values()].filter(t=>t.purchased).map(t=>t.id));
  const available=new Set(dataOf(snapshot,'unlocks')?.recipeIds || []);
  const unlockedItems=new Set(dataOf(snapshot,'unlocks')?.itemIds || []);
  const definitions=catalog?.reference?.planner_rules?.buildings || {};
  const buildable=new Set(dataOf(snapshot,'unlocks')?.buildingTypes || []);
  const sources=new Map((catalog?.reference?.planner_rules?.resourceSources || []).map(s=>[s.item,s]));
  const providers=new Map();
  for (const recipe of catalog?.recipes || []) {
    if (!recipe.inputs.every(i=>i.itemId && !i.filtered) || !recipe.outputs.every(o=>o.itemId && o.probability===1 && !o.customResult && !o.enhancementId)) continue;
    for (const output of recipe.outputs) {
      const previous=providers.get(output.itemId);
      if (!previous || !available.has(previous.id) && available.has(recipe.id)) providers.set(output.itemId,recipe);
    }
  }
  const buildings=flatten(snapshot);
  const name=id=>translate(catalog,items.get(id)?.name || definitions[id]?.name || catalog?.research?.find(t=>t.id===id)?.name || String(id||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()));
  const options=[...items.values()].filter(item=>sources.has(item.id)||providers.has(item.id)).map(item=>({...item,
    displayName:name(item.id),unlocked:unlockedItems.has(item.id)&&(sources.has(item.id)?buildable.has(sources.get(item.id).station):available.has(providers.get(item.id)?.id)&&buildable.has(providers.get(item.id)?.stationTag)),source:sources.get(item.id),recipe:providers.get(item.id)})).sort((a,b)=>a.displayName.localeCompare(b.displayName));
  const gear=new Map((catalog?.reference?.combat_rules?.gear||[]).map(g=>[g.id,g]));
  const containers=groupContainers(snapshot);
  return {catalog,snapshot,items,research,purchased,available,unlockedItems,buildable,definitions,sources,providers,buildings,name,options,gear,traits,containers:containers.groups,containerByBuildingId:containers.byBuildingId,containerIndex:containers.byId,containerRoots:containers.roots};
}
export function planGoal(model,goal) {
  return planPreparedGoal(model,goal,planItem);
}
function planItem(model,goal,roots) {
  const demand=new Map(), nodes=new Map(), costs=new Map(), warnings=new Set(), active=new Set(), external=new Set(goal.external || []);
  let operations=0;
  function add(itemId,rate,depth=0,forceSupply=false) {
    if (!Number.isFinite(rate)||rate<0||depth>40||++operations>2000) {warnings.add('This chain exceeds the supported planning depth.');return;}
    if (active.has(itemId)) {warnings.add('A circular recipe needs an external supply.');return;}
    const source=model.sources.get(itemId), recipe=model.providers.get(itemId), useSupply=forceSupply||external.has(itemId)&&itemId!==goal.itemId;
    let station=source?.station || recipe?.stationTag, time=source?.time || recipe?.craftingTimeSeconds || 1;
    const matched=model.buildings.filter(b=>b.type===station && (!recipe || source || b.recipeId===recipe.id));
    const basis=stationRateBasis(model,station,source?null:recipe?.id),speed=basis.speed;
    const output=source?1:recipe?.outputs.filter(o=>o.itemId===itemId).reduce((sum,o)=>sum+o.count,0) || 1;
    const unitRate=output/time*speed;
    const locked=!useSupply&&(source?!model.unlockedItems.has(itemId)||!model.buildable.has(station):recipe?!model.available.has(recipe.id)||!model.buildable.has(station):false);
    const automation=matched.some(b=>b.automatic)||(dataOf(model.snapshot,'upgrades')?.availableByBuildingType?.[station]||[]).includes('Worker');
    const nodeKey=itemId+':'+useSupply;
    let node=nodes.get(nodeKey);
    if (!node) {node={itemId,rate:0,station,useSupply,external:useSupply||!source&&!recipe,resource:!!source,locked,unitRate,depth,sampledSpeed:basis.sampled,rateBasis:{...basis,cycleSeconds:time,outputPerCycle:output,capacity:1,automationAssumed:!automation}};nodes.set(nodeKey,node);}
    node.rate+=rate;node.depth=Math.min(node.depth,depth);
    if (locked) warnings.add(`${model.name(itemId)} requires research.`);
    if (!useSupply && station && !automation) warnings.add(`${model.name(station)} rates assume continuous work; automation is not unlocked.`);
    if (useSupply || !source&&!recipe) {demand.set(itemId,(demand.get(itemId)||0)+rate);return;}
    const operatingCost=source?model.items.get(itemId)?.resource?.craftCost:recipe.cost;
    for(const [kind,value] of Object.entries(operatingCost||{}))costs.set(kind,(costs.get(kind)||0)+Number(value)*rate/(source?1:output));
    if (source) {demand.set(itemId,(demand.get(itemId)||0)+rate);return;}
    active.add(itemId);
    for (const input of recipe.inputs) add(input.itemId,rate/output*input.count,depth+1);
    active.delete(itemId);
  }
  for(const root of roots)add(root.itemId,root.rate,0,root.useSupply);
  const list=[...nodes.values()].map(n=>({...n,count:n.external?0:Math.ceil(n.rate/n.unitRate-1e-9)})).sort((a,b)=>a.depth-b.depth||a.itemId.localeCompare(b.itemId));
  return {nodes:list,demand:[...demand].map(([itemId,rate])=>({itemId,rate})),costs:[...costs].map(([currency,rate])=>({currency,rate})),buildings:list.reduce((sum,n)=>sum+n.count,0),warnings:[...warnings],locked:list.some(n=>n.locked)};
}
export function combinedDemand(model,goals) {
  const sum=new Map();
  for (const goal of goals) for (const row of planGoal(model,goal).demand) sum.set(row.itemId,(sum.get(row.itemId)||0)+row.rate);
  const quotas=new Map((dataOf(model.snapshot,'resources')?.quotas || []).map(r=>[r.itemId,r]));
  return [...sum].map(([itemId,rate])=>{const q=quotas.get(itemId),quota=q&&(q.availablePerSecond>0||q.demandPerSecond>0||model.sources.get(itemId)?.quotaKind==='resource')?q:null;return {itemId,rate,quota,shortfall:quota?Math.max(0,rate-quota.sparePerSecond):null};});
}
