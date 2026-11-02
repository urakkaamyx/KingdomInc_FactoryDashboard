import {FactoryApiClient} from './client.js';
import {sections,flatten,dataOf,translate,number,resourceRows,buildingState,createModel,planGoal,combinedDemand,finiteRate} from './model.js';
import {objectives} from './objective-model.js';
import {moneyHtml,moneyParts} from './money.js';
import {preparationEditor,editPreparation} from './preparation-ui.js';
import {generateLayout,layoutSignature,layoutPanel,highlightFamily,overviewLayout,layoutForView,expandMachineLayout} from './layout.js';
import {compactSnapshot} from './containers.js';
import {createTreasuryTracker} from './treasury.js';
import {containerOutput,createFlowMetrics} from './container-output.js';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage={read(key,fallback){try{return JSON.parse(localStorage.getItem('kingdom-dashboard:'+key))??fallback;}catch{return fallback;}},write(key,value){try{localStorage.setItem('kingdom-dashboard:'+key,JSON.stringify(value));}catch{}}};
const savedGoals=storage.read('goals',[]);
const state={catalog:storage.read('catalog',null),snapshot:storage.read('snapshot',null),traits:{},goals:Array.isArray(savedGoals)?savedGoals.filter(g=>g&&typeof g.id==='string'&&(g.kind==='objective'?typeof g.buildingType==='string'&&Array.isArray(g.inputs):typeof g.itemId==='string'&&finiteRate(g.rate))).slice(0,100):[],
  base:storage.read('api','http://127.0.0.1:17840'),view:'overview',selected:null,connected:false,cached:true,health:null,goalSearch:'',itemSearch:'',picker:null,
  factorySearch:'',factoryType:'all',factoryContainer:'all',researchSearch:'',researchFilter:'available',resourceSearch:'',activity:[],history:[],lastCache:0,rooms:{},api:null,watch:null,previous:null,
  layouts:storage.read('layouts',{}),layoutUi:{}};
let model=createModel(state.catalog,state.snapshot),toastTimer;
const treasury=createTreasuryTracker();
const flowMetrics=createFlowMetrics();
const name=id=>model.name(id);
const icon=(id,extra='')=>`<img class="item-icon ${extra}" src="assets/icons/${esc(/^[\w-]+$/.test(id||'')?id:'Icons_1')}.png" alt="" loading="lazy">`;
const itemIcon=id=>icon(model.items.get(id)?.icon);
const goalName=g=>name(g.kind==='objective'?g.buildingType:g.itemId);
const goalIcon=g=>g.kind==='objective'?icon(model.definitions[g.buildingType]?.icon||(g.buildingType==='QuestBoard'?'Icons_136':'Icons_1')):itemIcon(g.itemId);
const goalRate=g=>g.kind==='objective'?(g.inputs||[]).reduce((s,f)=>s+Number(f.rate),0):g.rate;
const money=(kind,value,fraction=false)=>moneyHtml(kind,value,{fraction});
const badge=(label,kind='')=>`<span class="badge ${kind}">${esc(label)}</span>`;
const heading=(title,action,view)=>`<div class="section-heading"><h3>${title}</h3>${action?`<button class="text-button" data-view="${view}">${action} <span aria-hidden="true">↗</span></button>`:''}</div>`;
const panel=(body,cls='')=>`<section class="panel ${cls}"><div class="panel-inner">${body}</div></section>`;
const empty=(title,description,button='')=>`<section class="panel empty-state"><img src="assets/icons/Icons_12.png" alt=""><h3>${title}</h3><p>${description}</p>${button}</section>`;
const live=()=>dataOf(state.snapshot,'session')?.loaded===true;
const buildings=()=>model.buildings;
const t=value=>translate(state.catalog,value);
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,2800);}
function saveGoals(){storage.write('goals',state.goals);}
function event(message){state.activity.unshift({message,at:Date.now()});state.activity=state.activity.slice(0,12);}
function time(value){return new Date(value).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}
function countStats(){const b=buildings(),flows=dataOf(state.snapshot,'factory')?.flows||[];return {nodes:b.length,machines:b.reduce((s,n)=>s+Math.max(1,n.stackSize),0),pipes:flows.reduce((s,f)=>s+f.connections.length,0),recipes:dataOf(state.snapshot,'unlocks')?.recipeIds.length||0,research:(dataOf(state.snapshot,'research')||[]).filter(t=>t.purchased).length};}
function stats(){const counts=countStats();return `<div class="stats">${[
  ['PLACED BUILDINGS',live()?counts.nodes:null,`${number(counts.machines)} machines including stacks`,'Icons_12'],
  ['CONNECTIONS',live()?counts.pipes:null,'Across your factory workflows','Icons_29'],
  ['AVAILABLE RECIPES',live()?counts.recipes:null,'Unlocked in this kingdom','Icons_17'],
  ['RESEARCH PURCHASED',live()?counts.research:null,`${state.catalog?.research.length||'—'} technologies in the tree`,'Icons_4']
].map(([label,value,note,img])=>`<div class="stat"><div class="stat-top"><span class="eyebrow">${label}</span>${icon(img)}</div><div class="metric ${value===null?'empty-metric':''}">${value===null?'—':number(value,0)}</div><p>${esc(note)}</p></div>`).join('')}</div>`;}
function sidebar(){
  const scroll=$('goal-list').scrollTop;
  const goals=state.goals.filter(g=>goalName(g).toLowerCase().includes(state.goalSearch.toLowerCase()));
  $('goal-count').textContent=String(state.goals.length).padStart(2,'0');$('tab-goal-count').textContent=state.goals.length;
  $('goal-list').innerHTML=goals.length?goals.map(g=>`<button class="goal-option ${state.selected===g.id&&state.view==='production'?'selected':''}" data-goal="${esc(g.id)}" aria-pressed="${state.selected===g.id&&state.view==='production'}">${goalIcon(g)}<span><strong>${esc(goalName(g))}</strong><small>${number(goalRate(g),3)} /sec</small></span><span class="row-arrow" aria-hidden="true">›</span></button>`).join(''):
    `<div class="sidebar-empty"><img src="assets/icons/Icons_12.png" alt=""><p>${state.goals.length?'No matching production.':'Your next production starts here.'}</p><p>Choose a product or an objective.</p></div>`;
  $('goal-list').scrollTop=scroll;
}
function containerSummary(c,register=false,count=null){
  return `<span class="container-mark style-${Math.abs(c.style)%6}" aria-hidden="true">${c.icon?icon(c.icon):'▣'}</span><span class="container-name"><strong>${esc(c.label)}</strong><small>${esc(c.flowName)}${c.children.length?' · '+c.children.length+' nested Container'+(c.children.length===1?'':'s'):''}${c.children.length?' · '+c.buildings.length+' direct building'+(c.buildings.length===1?'':'s'):''}</small></span><span class="container-totals"><strong>${number(count??c.totalBuildings,0)}</strong><small>${register?'matching buildings':'buildings · '+number(c.totalMachines,0)+' machine'+(c.totalMachines===1?'':'s')}</small></span><span class="container-chevron" aria-hidden="true">›</span>`;
}
function containerProducts(c){
  const output=containerOutput(model,c,flowMetrics);if(!output.rows.length)return '';
  const amount=(kind,rate)=>moneyHtml(kind,rate,{fraction:true,signed:true,perSecond:true,className:`output-money ${rate<0?'red':'green'}`});
  const objective=output.rows.some(r=>r.kind==='objective');
  return `<section class="container-output" data-container-output="${esc(c.id)}"><div class="output-heading"><h4>Final products</h4><span>${output.ready?'Measured · last 60s':output.available?'Measuring live transfers…':'Awaiting flow telemetry'}</span></div><div class="output-products">${output.rows.map(row=>`<article class="output-product" data-output-item="${esc(row.itemId)}" data-output-destination="${esc(row.type)}"><div class="output-product-title">${itemIcon(row.itemId)}<div><strong>${esc(name(row.itemId))}</strong><small>→ ${esc(row.kind==='unconnected'?'Output unconnected':name(row.type))}${row.targets.length>1?' ×'+row.targets.length:''}${row.kind==='export'?' · leaves container':''}</small></div></div><div class="output-product-rate"><strong>${row.count===null?'—':number(row.count,3)}</strong><span>items sent /sec</span></div>${row.revenue.length?`<div class="output-revenue"><small>Revenue</small>${row.revenue.map(r=>amount(r.currency,r.rate)).join('')}</div>`:''}</article>`).join('')}</div>${objective?`<div class="output-totals"><div><small>Total to objectives</small><strong data-output-total>${output.totalItems===null?'—':number(output.totalItems,3)} <span>items /sec</span></strong></div><div><small>Container profit / deficit</small><div class="output-profit" data-output-profit>${!output.ready?'Measuring…':!output.complete?'Attribution unavailable':output.net.length?output.net.map(r=>amount(r.currency,r.rate)).join(''):'No income or operating costs yet'}</div></div></div>`:''}<p class="output-note">${!output.available?'Exact counters require Factory API 0.1.3. Install the prepared update with the game closed, then restart.':!output.complete?'Some external objective revenue cannot be attributed to this container. No estimated profit is substituted.':'Measured net includes attributed sales and operating costs inside this container, including nested Containers. Imported or shared production costs are not allocated.'}</p></section>`;
}
function roomRegister(){
  const actual=model.containers.filter(c=>!c.outside).length;
  function renderContainer(c,first=false){
    return `<details class="floor-container" data-floor-container="${esc(c.id)}" ${first?'open':''}><summary>${containerSummary(c)}</summary>${containerProducts(c)}${c.types.length?`<div class="rooms">${c.types.slice(0,4).map(g=>`<button class="room-card" data-type="${esc(g.type)}" data-container-scope="${esc(c.id)}" title="View ${esc(name(g.type))} in ${esc(c.label)}"><div class="room-scene">${state.rooms[g.type]?`<img src="assets/rooms/${esc(g.type)}.png" alt="${esc(name(g.type))} room">`:icon(model.definitions[g.type]?.icon,'room-icon')}<span class="room-quantity">${g.count}</span></div><div class="room-caption"><strong>${esc(name(g.type))}</strong><small>${g.machines} machines · ${g.count} placed nodes</small></div></button>`).join('')}</div>`:c.children.length?'':'<p class="container-empty muted">This Container has no buildings.</p>'}${c.children.length?`<div class="nested-containers">${c.children.map(id=>renderContainer(model.containerIndex.get(id))).join('')}</div>`:''}<div class="container-foot"><span>${c.children.length?'Includes its nested Containers':c.outside?'Buildings outside any Container':'Most-used building types in this Container'}</span><button class="text-button" data-open-container="${esc(c.id)}">View ${c.totalBuildings} building${c.totalBuildings===1?'':'s'} →</button></div></details>`;
  }
  return `<section class="panel floor-panel"><div class="section-heading floor-heading"><div><h3>Workshop floors</h3><p>Grouped by your in-game Containers</p></div><button class="text-button" data-view="factory" data-factory-all>Open register ↗</button></div><div class="floor-containers">${model.containerRoots.map((c,index)=>renderContainer(c,index===0)).join('')||'<p class="container-empty muted">Your Containers will appear when a kingdom is loaded.</p>'}</div><div class="floor-foot"><span><span class="green">◆</span> Read from your running factory</span><span>${actual} Container${actual===1?'':'s'} · ${dataOf(state.snapshot,'factory')?.flows.length||0} workshop${dataOf(state.snapshot,'factory')?.flows.length===1?'':'s'}</span></div></section>`;
}
function quotaRow(r){const kind=r.shortfallPerSecond>0?'bad':r.utilization>=.9?'warn':'';return `<div class="quota-row"><div class="quota-title">${itemIcon(r.itemId)}<strong>${esc(name(r.itemId))}</strong><span class="rate">${number(r.demandPerSecond)} <small>/ ${number(r.availablePerSecond)} /sec</small></span></div><div class="bar ${kind}"><span style="width:${Math.min(100,Math.max(0,r.utilization*100))}%"></span></div><div class="quota-caption"><span>${Number.isFinite(r.utilization)?number(r.utilization*100,0)+'% of quota':'No quota available'}</span><span class="${r.shortfallPerSecond>0?'amber':''}">${r.shortfallPerSecond>0?number(r.shortfallPerSecond)+' /sec short':number(r.sparePerSecond)+' /sec spare'}</span></div></div>`;}
function resourceSummary(){const rows=resourceRows(state.snapshot),short=rows.filter(r=>r.shortfallPerSecond>0);return panel(heading('Resource pressure','Resource ledger','resources')+rows.slice(0,4).map(quotaRow).join('')+(rows.length?'':'<p class="muted">No active resource quotas.</p>')+`<div class="supply-status ${short.length?'warning':''}"><span aria-hidden="true">◆</span>${short.length?`${short.length} resource${short.length===1?' is':'s are'} over quota`:'Current demand is within resource quotas'}</div>`);}
function researchRows(){return (state.catalog?.research||[]).filter(r=>model.research.get(r.id)?.available).sort((a,b)=>a.tier-b.tier||t(a.name).localeCompare(t(b.name)));}
function researchSummary(){const rows=researchRows();return panel(heading('Ready to research','Tech ledger','research')+rows.slice(0,4).map(r=>`<button class="research-row" data-tech="${esc(r.id)}">${icon(r.icon)}<span><strong>${esc(t(r.name))}</strong><small>${esc(name(r.rootId||r.id))} · Tier ${r.tier}</small></span><span class="ready-mark" aria-hidden="true">◇</span></button>`).join('')+(!rows.length?'<p class="muted">No research currently available.</p>':'')+`<p class="panel-note">${rows.length} available · Requirements met; currency cost is not checked.</p>`);}
function chart(){const rows=resourceRows(state.snapshot),id=state.history.at(-1)?.id||rows[0]?.itemId;const values=state.history.filter(h=>h.id===id).map(h=>h.value);const maximum=Math.max(1,...values,rows.find(r=>r.itemId===id)?.availablePerSecond||0);const points=values.map((n,i)=>`${values.length===1?0:i/(values.length-1)*400},${75-n/maximum*65}`).join(' ');return panel(heading('Supply watch')+`<div class="chart-label"><strong>${esc(id?name(id):'Resource demand')}</strong><span>${number(values.at(-1)||0)} <small>/sec</small></span></div><svg class="spark" viewBox="0 0 400 85" preserveAspectRatio="none" role="img" aria-label="${esc(id?name(id):'Resource')} demand over recent live samples">${values.length>1?`<polygon points="0,85 ${points} 400,85" fill="#8e9b5a17"/><polyline points="${points}" fill="none" stroke="#a5b572" stroke-width="2" vector-effect="non-scaling-stroke"/>`:''}</svg><div class="chart-foot"><span>${values.length>1?'Recent live samples':'Collecting live samples…'}</span><span>Quota ${number(rows.find(r=>r.itemId===id)?.availablePerSecond||0)} /sec</span></div>`);}
function activity(){return panel(heading('From the kingdom')+`<div>${state.activity.slice(0,4).map(e=>`<div class="activity-item"><span class="activity-dot"></span><p>${esc(e.message)}</p><time>${time(e.at)}</time></div>`).join('')||'<p class="muted">Research and factory changes will appear here.</p>'}</div>`);}
function currencyCard(){
  const balances=Object.entries(dataOf(state.snapshot,'economy')?.currencies||{}).filter(([kind,value])=>{const direction=treasury.rate(kind)?.direction;return BigInt(value)!==0n||direction==='profit'||direction==='deficit';});
  const cell=([kind,value])=>{
    const rate=state.connected?treasury.rate(kind):null,status=rate?rate.direction:state.connected?'measuring':'offline';
    const signed=rate?moneyParts(kind,rate.perSecond,{fraction:true,signed:true})?.label:'—';
    const label=rate?status==='profit'?'Profit':status==='deficit'?'Deficit':'Balanced':state.connected?'Measuring…':'Offline';
    return `<div class="treasury-currency" data-currency-kind="${esc(kind)}"${kind==='Gold'?` style="grid-column:span ${Math.min(2,balances.length)}"`:''}>${money(kind,value)}<div class="treasury-net ${status}" data-treasury-net="${esc(kind)}" aria-label="${esc(kind)} ${label}${rate?': '+esc(signed)+' per second':''}" title="${rate?'Observed over '+number(rate.seconds,1)+' seconds':'Waiting for live balance samples'}"><strong>${rate?moneyHtml(kind,rate.perSecond,{fraction:true,signed:true,perSecond:true,className:'money-rate'}):'—<small> /sec</small>'}</strong><span>${label}</span></div></div>`;
  };
  return `<section class="panel currency-card" aria-label="Currency balances"><div class="panel-inner"><div class="treasury-heading"><h3>Treasury</h3><p>Net /sec · 60s window</p></div><div class="currency-balances" style="--currency-columns:${Math.max(1,Math.min(4,balances.length))}">${balances.map(cell).join('')||'<p class="muted">No balances yet.</p>'}</div></div><p class="treasury-note">Observed balance change, including purchases, refunds and collections.</p></section>`;
}
function overview(){return stats()+(live()?currencyCard()+roomRegister()+`<div class="dashboard-columns"><div class="column-stack">${resourceSummary()}${chart()}</div><div class="column-stack">${researchSummary()}${activity()}</div></div>`:empty('Your workshop is waiting','Launch Kingdom Inc. and load a kingdom. Its buildings, resources, and research will appear here automatically.'));}
function production(){
  const goal=state.goals.find(g=>g.id===state.selected);
  if(goal)return goalDetail(goal);
  if(!state.goals.length)return empty('Make room for your next production','Set an item and an output rate. Each goal gets its own chain from basic resources, using your current game progress.','<button class="primary" data-action="add">＋ Add production</button>');
  const planned=combinedDemand(model,state.goals),short=planned.filter(r=>r.shortfall>0);
  return `<div class="section-intro"><h3>Your production ledger</h3><p>Separate production chains. Shared resource limits across the kingdom.</p></div><div class="toolbar"><span class="muted">${state.goals.length} saved goal${state.goals.length===1?'':'s'}</span><button class="primary" data-action="add">＋ Production</button></div>${short.length?`<div class="connection-banner">Additional supply is short for ${short.map(r=>esc(name(r.itemId))).join(', ')} across these plans.</div>`:''}<div class="production-grid">${state.goals.map(g=>{const p=planGoal(model,g);return `<article class="panel production-card"><div class="heading">${goalIcon(g)}<div><h3>${esc(goalName(g))}</h3><small>${g.kind==='objective'?'Objective input supply':'Dedicated production chain'}</small></div><span class="goal-rate">${number(goalRate(g),3)} <small>/sec</small></span></div><div class="card-metrics"><span><strong>${p.buildings}</strong><small>Estimated machines</small></span><span><strong>${p.nodes.length}</strong><small>Production stages</small></span><span><strong>${p.issues.length?'Check inputs':p.locked?'Locked':'Ready'}</strong><small>${p.issues.length?'Preparation needs attention':p.locked?'Research needed':'Recipe research'}</small></span></div><button class="ghost" data-goal="${esc(g.id)}">Open production →</button></article>`;}).join('')}</div>`;
}
function goalDetail(goal){
  const plan=planGoal(model,goal),objective=goal.kind==='objective',quotaMap=new Map((dataOf(state.snapshot,'resources')?.quotas||[]).map(r=>[r.itemId,r]));
  return `<section class="panel goal-heading">${goalIcon(goal)}<div><span class="eyebrow">${objective?'OBJECTIVE BUILDING':'PRODUCTION TARGET'}</span><h3>${esc(goalName(goal))}</h3><small>${objective?'Choose incoming supplies and preparation below':'A dedicated chain, from basic resources'}</small></div>${objective?`<div class="objective-feed-total"><strong>${number(goalRate(goal),3)}</strong><small>total input /sec</small></div>`:`<div class="rate-edit"><label for="goal-rate">Desired output</label><input id="goal-rate" aria-label="Desired output per second" type="number" min="0" max="1000000" step="any" value="${goal.rate}"><span class="muted">/sec</span></div>`}</section>
  <div class="goal-controls"><button class="ghost" data-action="all-goals">← All production</button><button class="danger" data-remove="${esc(goal.id)}">Remove production</button></div>
  ${preparationEditor(model,goal)}
  ${plan.issues.length?`<div class="plan-issues" role="status"><strong>Check this plan</strong>${plan.issues.map(w=>`<p>${esc(w)}</p>`).join('')}</div>`:''}
  ${layoutPanel(model,goal,plan,state.layouts[goal.id],state.layoutUi[goal.id])}
  ${plan.stages.length?panel(heading('Preparation stages')+`<p class="panel-note">Equipment is prepared before its Outfitter. Human stages run in your selected order.</p>`+plan.stages.map(n=>`<div class="chain-row">${icon(model.definitions[n.station]?.icon)}<div><strong>${esc(n.label)}</strong><small>${esc(name(n.itemId))} · ${esc(name(n.station))}${n.locked?' · Research required':''}</small></div><span class="chain-rate">${number(n.rate)} <small>/sec</small></span><span class="machine-count">${n.count}<small>machines</small></span></div>`).join('')):''}
  <div class="panel chain-panel"><div class="supply-chain-heading"><h3>Production & input supplies</h3><small>${objective?'Destination capacity is encounter or storage dependent; its building count is excluded.':'Each stage includes its material production.'}</small></div>${plan.nodes.map(n=>`<div class="chain-row ${n.depth?'depth':''}">${itemIcon(n.itemId)}<div><strong>${esc(name(n.itemId))}</strong><small>${n.external?'Existing / external supply':esc(name(n.station))}${n.locked?' · Research required':''}</small></div><span class="chain-rate">${number(n.rate)} <small>/sec</small></span><span class="machine-count">${n.external?'--':n.count}<small>${n.external?'supplied':'machines'}</small></span>${n.depth>0?`<button class="text-button" data-supply="${esc(n.itemId)}">${n.useSupply?'Build chain':'Use supply'}</button>`:'<span class="chain-action-space"></span>'}</div>`).join('')}<div class="goal-total"><span>Estimated supply & preparation machines</span><strong>${plan.buildings}</strong></div></div>
  ${panel(heading('Additional supply required')+plan.demand.map(r=>{const q=quotaMap.get(r.itemId),short=q?Math.max(0,r.rate-q.sparePerSecond):null;return `<div class="detail-line"><span>${itemIcon(r.itemId)} ${esc(name(r.itemId))}</span><span class="number ${short>0?'amber':''}">${number(r.rate)} /sec <small>${q?`· ${number(q.sparePerSecond)} spare${short>0?' · '+number(short)+' short':''}`:'· supply allocation needed'}</small></span></div>`;}).join('')+(plan.costs.length?`<div class="currency-rate"><small>Operating cost /sec</small>${plan.costs.map(r=>money(r.currency,r.rate,true)).join('')}</div>`:''))}
  <div class="plan-note">${plan.warnings.map(w=>esc(w)+' ').join('')}Estimates use current median machine speed or base speed. Productivity, byproducts, currency income, and survivor reuse are not credited. Existing supply must be allocated separately.</div>`;
}
function resources(){const rows=resourceRows(state.snapshot).filter(r=>name(r.itemId).toLowerCase().includes(state.resourceSearch.toLowerCase()));const totals=combinedDemand(model,state.goals);const map=new Map(totals.map(r=>[r.itemId,r]));return `<div class="section-intro"><h3>The resource ledger</h3><p>Live demand and quotas are shared across the entire kingdom. Planned goals are additional demand.</p></div><div class="toolbar"><label class="search-box"><span>⌕</span><input id="resource-search" type="search" aria-label="Search resources" placeholder="Find a resource…" value="${esc(state.resourceSearch)}"></label><span class="muted">${rows.length} active resources</span></div><section class="panel table-wrap"><table><thead><tr><th>Resource</th><th>Kingdom quota</th><th>Live demand</th><th>Spare supply</th><th>Planned demand</th><th>Pressure</th></tr></thead><tbody>${rows.map(r=>`<tr><td><span class="cell-item">${itemIcon(r.itemId)}<strong>${esc(name(r.itemId))}</strong></span></td><td class="number">${number(r.availablePerSecond)} /sec</td><td class="number">${number(r.demandPerSecond)} /sec</td><td class="number ${r.shortfallPerSecond>0?'amber':'green'}">${number(r.sparePerSecond)} /sec</td><td class="number ${map.get(r.itemId)?.shortfall>0?'amber':''}">${number(map.get(r.itemId)?.rate||0)} /sec</td><td>${badge(Number.isFinite(r.utilization)?number(r.utilization*100,0)+'%':'No quota',r.shortfallPerSecond>0?'red':r.utilization>=.9?'amber':'green')}</td></tr>`).join('')||'<tr><td colspan="6">No matching active resources.</td></tr>'}</tbody></table></section>${forestResources()}`;}
function forestResources(){const f=dataOf(state.snapshot,'resources')?.forest;if(!f)return '';return `<div style="margin-top:23px">${panel(heading('Forest workforce')+`<p class="muted">${f.blocked?'The Forest is currently blocked.':'Workers are shared across Forest production.'}</p><div class="treasury">${f.workers.map(w=>`<span class="coin">${number(w.count,0)}<small>${esc(w.type)} · ${number(w.utilization*100,0)}% utilization</small></span>`).join('')}</div>`)}</div>`;}
function research(){const all=state.catalog?.research||[];const rows=all.filter(r=>{const status=model.research.get(r.id);return !r.developerOnly&&status&&!status.hidden&&(state.researchFilter==='all'||state.researchFilter==='available'&&status.available||state.researchFilter==='purchased'&&status.purchased||state.researchFilter==='locked'&&status.locked)&&t(r.name).toLowerCase().includes(state.researchSearch.toLowerCase());}).sort((a,b)=>a.tier-b.tier||t(a.name).localeCompare(t(b.name)));return `<div class="section-intro"><h3>Your research, as it unlocks</h3><p>Availability follows your kingdom. Select a technology to inspect its requirements.</p></div><div class="toolbar"><label class="search-box"><span>⌕</span><input id="research-search" type="search" aria-label="Search research" placeholder="Find research…" value="${esc(state.researchSearch)}"></label><select id="research-filter" aria-label="Research status">${[['available','Available'],['purchased','Purchased'],['locked','Locked'],['all','All research']].map(([v,n])=>`<option value="${v}" ${state.researchFilter===v?'selected':''}>${n}</option>`).join('')}</select></div><div class="research-summary"><span><strong>${countStats().research}</strong> purchased</span><span><strong>${researchRows().length}</strong> available</span><span>${rows.length} shown</span></div><div class="research-grid">${rows.map(r=>{const s=model.research.get(r.id);return `<button class="tech-card ${s.locked?'locked':''}" data-tech="${esc(r.id)}">${icon(r.icon)}<span><strong>${esc(t(r.name))}</strong><small>${esc(r.kind.replace(/([a-z])([A-Z])/g,'$1 $2'))} · Tier ${r.tier}</small>${badge(s.purchased?'Purchased':s.available?'Available':'Locked',s.purchased||s.available?'green':'')}</span></button>`;}).join('')||'<p class="muted">No research matches this view.</p>'}</div>`;}
function factory(){
  const selected=model.containerIndex.get(state.factoryContainer);
  const rows=buildings().filter(b=>(!selected||selected.buildingIds.has(b.id))&&(state.factoryType==='all'||b.type===state.factoryType)&&[name(b.type),b.recipeId&&name(b.recipeId),b.resourceItemId&&name(b.resourceItemId)].join(' ').toLowerCase().includes(state.factorySearch.toLowerCase()));
  const types=[...new Set(buildings().map(b=>b.type))].sort((a,b)=>name(a).localeCompare(name(b))),matches=new Set(rows.map(b=>b.id)),filterActive=state.factoryType!=='all'||!!state.factorySearch||!!selected;
  function table(buildings){return `<div class="table-wrap"><table><thead><tr><th>Building / product</th><th>Stack</th><th>Speed</th><th>Progress</th><th>State</th><th>Upgrades</th></tr></thead><tbody>${buildings.map(b=>{const status=buildingState(b),def=model.definitions[b.type];return `<tr data-building="${esc(b.id)}" tabindex="0" aria-label="Inspect ${esc(name(b.type))}"><td><span class="cell-item">${icon(model.items.get(b.recipeId||b.resourceItemId)?.icon||def?.icon)}<span><strong>${esc(name(b.type))}</strong><small>${esc(b.recipeId?name(b.recipeId):b.resourceItemId?name(b.resourceItemId):b.category)}</small></span></span></td><td class="number">${b.stackSize}</td><td class="number">${number(b.speed)}×</td><td class="progress-cell"><div class="bar"><span style="width:${Math.min(100,Math.max(0,b.progress*100))}%"></span></div></td><td><span class="status-text ${status.kind}">${status.label}</span></td><td class="number">${b.installedUpgrades.filter(u=>u.type).length}<small class="muted"> / ${b.upgradeSlots}</small></td></tr>`;}).join('')}</tbody></table></div>`;}
  function group(c,root=false){
    const total=[...c.buildingIds].filter(id=>matches.has(id)).length;if(!total&&filterActive)return '';
    const direct=c.buildings.filter(b=>matches.has(b.id)),children=c.children.map(id=>group(model.containerIndex.get(id))).join('');
    return `<details class="floor-container register-container" data-register-container="${esc(c.id)}" ${root||filterActive?'open':''}><summary>${containerSummary(c,true,total)}</summary>${containerProducts(c)}${direct.length?table(direct):!children?'<p class="container-empty muted">This Container has no buildings.</p>':''}${children?`<div class="nested-containers">${children}</div>`:''}</details>`;
  }
  function option(c){return `<option value="${esc(c.id)}" ${state.factoryContainer===c.id?'selected':''}>${esc('  '.repeat(c.depth)+(c.depth?'↳ ':'')+c.path.join(' / '))} · ${esc(c.flowName)}</option>${c.children.map(id=>option(model.containerIndex.get(id))).join('')}`;}
  const filterKey=JSON.stringify([state.factoryContainer,state.factoryType,state.factorySearch]);
  return `<div class="section-intro"><h3>The building register</h3><p>Expand a Container to see its buildings and nested Containers. Parent filters include everything inside.</p></div><div class="toolbar"><label class="search-box"><span>⌕</span><input id="factory-search" type="search" aria-label="Search buildings" placeholder="Find a building or product…" value="${esc(state.factorySearch)}"></label><select id="factory-filter" aria-label="Building type"><option value="all">All building types</option>${types.map(type=>`<option value="${esc(type)}" ${state.factoryType===type?'selected':''}>${esc(name(type))}</option>`).join('')}</select><select id="factory-container" aria-label="Container"><option value="all">All Containers</option>${model.containerRoots.map(option).join('')}</select><span class="muted">${rows.length} placed nodes</span></div><section class="panel register-groups" data-register-filter="${esc(filterKey)}">${(selected?[selected]:model.containerRoots).map(c=>group(c,true)).join('')||'<p class="container-empty muted">No matching buildings.</p>'}</section>`;
}
const views={overview,production,resources,research,factory};
function render(force=false){
  model=createModel(state.catalog,state.snapshot,state.traits);if(state.factoryContainer!=='all'&&!model.containers.some(c=>c.id===state.factoryContainer))state.factoryContainer='all';sidebar();
  const active=document.activeElement,id=active?.id,inMain=!!active?.closest('main'),focusedBuilding=active?.dataset?.building,focusedTech=active?.dataset?.tech,focusedLayoutNode=active?.dataset?.layoutNode,focusedFloor=active?.tagName==='SUMMARY'?active.closest('[data-floor-container]')?.dataset.floorContainer:null,focusedRegister=active?.tagName==='SUMMARY'?active.closest('[data-register-container]')?.dataset.registerContainer:null,draft=!force&&active?.type==='number'?active.value:null,selection=typeof active?.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
  const names={overview:['Factory overview','A clear view of everything keeping your kingdom moving.'],production:['Production ledger','Your targets. Your supply chains. Your kingdom’s progress.'],resources:['Resource ledger','Know what your kingdom can supply before you expand.'],research:['Research ledger','New possibilities, straight from your kingdom.'],factory:['Building register','The buildings and connections behind your production.']};
  $('page-title').textContent=names[state.view][0];$('page-subtitle').textContent=names[state.view][1];
  document.querySelectorAll('.tabs button').forEach(b=>b.toggleAttribute('aria-current',false));
  document.querySelector(`.tabs [data-view="${state.view}"]`).setAttribute('aria-current','page');
  if(state.layoutPan||!force&&inMain&&active?.tagName==='SELECT'){renderStatus();return;}
  const mainScroll=window.scrollY,hadFloor=!!document.querySelector('.floor-containers'),openContainers=new Set([...document.querySelectorAll('[data-floor-container][open]')].map(el=>el.dataset.floorContainer));
  const previousRegister=document.querySelector('.register-groups'),openRegister=new Set([...document.querySelectorAll('[data-register-container][open]')].map(el=>el.dataset.registerContainer));
  const previousLayout=$('generated-layout');
  const layoutScroll=document.querySelector('.layout-scroll'),openLayoutSections=[...document.querySelectorAll('.generated-layout details[open]')].map(el=>el.className);
  if(layoutScroll&&state.selected&&!state.layoutViewportPending){state.layoutUi[state.selected]||={zoom:1};state.layoutUi[state.selected].left=layoutScroll.scrollLeft;state.layoutUi[state.selected].top=layoutScroll.scrollTop;}
  $('main').innerHTML=views[state.view]();
  if(hadFloor)document.querySelectorAll('[data-floor-container]').forEach(el=>el.open=openContainers.has(el.dataset.floorContainer));
  const newRegister=document.querySelector('.register-groups');
  if(previousRegister&&newRegister&&previousRegister.dataset.registerFilter===newRegister.dataset.registerFilter)document.querySelectorAll('[data-register-container]').forEach(el=>el.open=openRegister.has(el.dataset.registerContainer));
  const newLayout=$('generated-layout');
  if(!force&&previousLayout?.dataset.layoutStamp&&previousLayout.dataset.layoutStamp===newLayout?.dataset.layoutStamp&&previousLayout.dataset.layoutGoal===newLayout.dataset.layoutGoal){
    const stale=newLayout.querySelector('.layout-stale'),oldStale=previousLayout.querySelector('.layout-stale');
    if(stale&&!oldStale)previousLayout.querySelector('.layout-toolbar').before(stale);else if(!stale&&oldStale)oldStale.remove();
    newLayout.replaceWith(previousLayout);
  }
  applyLayoutPresentation();
  const nextLayout=document.querySelector('.layout-scroll'),layoutUi=state.layoutUi[state.selected];
  if(nextLayout&&layoutUi){nextLayout.scrollLeft=layoutUi.left||0;nextLayout.scrollTop=layoutUi.top||0;}
  state.layoutViewportPending=false;
  for(const cls of openLayoutSections)document.querySelector('.generated-layout details.'+cls)?.setAttribute('open','');
  if(id&&$(id)&&id!=='goal-search'&&id!=='item-search'&&inMain){const input=$(id);if(draft!==null)input.value=draft;input.focus({preventScroll:true});if(selection&&input.type!=='number')input.setSelectionRange(...selection);}
  else if(inMain&&focusedRegister)document.querySelector(`[data-register-container="${CSS.escape(focusedRegister)}"]>summary`)?.focus({preventScroll:true});
  else if(inMain&&focusedFloor)document.querySelector(`[data-floor-container="${CSS.escape(focusedFloor)}"]>summary`)?.focus({preventScroll:true});
  else if(inMain&&focusedLayoutNode)document.querySelector(`[data-layout-node="${CSS.escape(focusedLayoutNode)}"]`)?.focus({preventScroll:true});
  else if(inMain&&(focusedBuilding||focusedTech))document.querySelector(focusedBuilding?`[data-building="${CSS.escape(focusedBuilding)}"]`:`[data-tech="${CSS.escape(focusedTech)}"]`)?.focus({preventScroll:true});
  if(inMain)window.scrollTo({top:mainScroll,behavior:'instant'});
  renderStatus();
}
function renderStatus(){const el=$('connection'),session=dataOf(state.snapshot,'session');el.classList.toggle('offline',!state.connected||!session?.loaded);el.lastElementChild.textContent=state.connected?(session?.loaded?'Kingdom connected':'At the main menu'):(state.snapshot?'Last known state':'Waiting for game');const banner=$('connection-banner');banner.hidden=state.connected&&!!session?.loaded;
  if(!state.connected)banner.innerHTML=state.snapshot?'<strong>Showing the last synced state.</strong> Reconnecting to the game. Live figures and estimates may be out of date.':'<strong>Waiting for Kingdom Inc.</strong> Start the game with the Factory API enabled, then load your kingdom.';
  else if(!session?.loaded)banner.innerHTML='<strong>Your game is connected.</strong> Load a kingdom to see its factory and research.';
  $('sync-detail').textContent=state.snapshot?`${state.connected?'Synced':'Last synced'} ${time(state.snapshot.capturedAtUtc)} · ${state.connected?'Live kingdom data':'Saved browser snapshot'}`:'Waiting for the game';
}
function navigate(view){state.view=view;if(view!=='production')state.selected=null;render();}
function updateActivity(snapshot){const previous=state.previous;const session=dataOf(snapshot,'session');if(previous&&snapshot.sessionId===previous.sessionId&&snapshot.instanceId===previous.instanceId){const priorTech=new Set((dataOf(previous,'research')||[]).filter(t=>t.purchased).map(t=>t.id));for(const tech of dataOf(snapshot,'research')||[])if(tech.purchased&&!priorTech.has(tech.id)){const definition=state.catalog.research.find(t=>t.id===tech.id);event(`Research unlocked: ${t(definition?.name||tech.id)}`);}
    const before=flatten(previous).length,after=flatten(snapshot).length;if(after!==before)event(`${Math.abs(after-before)} building${Math.abs(after-before)===1?'':'s'} ${after>before?'added to':'removed from'} the factory`);
    const oldSlots=dataOf(previous,'upgrades')?.slotsByBuildingType||{};for(const [type,count] of Object.entries(dataOf(snapshot,'upgrades')?.slotsByBuildingType||{}))if(count>(oldSlots[type]||0))event(`${name(type)} now has ${count} upgrade slots`);
  } else if(session?.loaded){state.history=[];event('Kingdom loaded. Workshop ledger synchronized.');}
  state.previous=snapshot;
}
async function connect(){
  if(state.watch){state.watch.stop();await state.watch.done;}
  state.api=new FactoryApiClient(state.base,{interval:750});
  state.watch=state.api.watch({sections,onSnapshot:async snapshot=>{
    if(!state.catalog || state.catalog.gameVersion!==dataOf(snapshot,'session')?.gameVersion){state.catalog=await state.api.catalog();storage.write('catalog',state.catalog);}
    updateActivity(snapshot);state.snapshot=compactSnapshot(snapshot);flowMetrics.record(state.snapshot);state.cached=false;
    const row=resourceRows(snapshot)[0];if(row){state.history.push({id:row.itemId,value:row.demandPerSecond});state.history=state.history.slice(-50);}
    if(Date.now()-state.lastCache>5000){storage.write('snapshot',state.snapshot);state.lastCache=Date.now();}
    render();if($('production-dialog').open)picker();
  },onStatus:status=>{const changed=state.connected!==status.connected;state.connected=status.connected;state.health=status.health||null;$('connection').title=status.error?.message||'';
    // A successful poll also confirms unchanged balances when no snapshot changed.
    if(status.connected)treasury.record(state.snapshot);else {treasury.clear();flowMetrics.clear();}
    if(changed)render();else {renderStatus();if(state.view==='overview'){const card=document.querySelector('.currency-card');if(card)card.outerHTML=currencyCard();}}
  }});
}
function picker(){
  const scroll=$('item-picker').scrollTop,showLocked=$('show-locked').checked,objective=$('production-kind').value==='objective';
  const entries=objective?objectives(model):model.options;
  const rows=entries.filter(i=>(i.unlocked||showLocked)&&i.displayName.toLowerCase().includes(state.itemSearch.toLowerCase()));
  $('picker-count').textContent=`${rows.length} ${objective?'objective building'+(rows.length===1?'':'s'):'item'+(rows.length===1?'':'s')} ${showLocked?'in the ledger':'unlocked'}`;
  $('item-picker').innerHTML=rows.map(i=>`<button type="button" class="picker-item" role="option" aria-selected="${state.picker===i.id}" data-item="${esc(i.id)}">${icon(i.icon)}<span>${esc(i.displayName)}<small>${objective?'Choose incoming items and preparation':esc(name(i.source?.station||i.recipe?.stationTag||''))}</small></span>${!i.unlocked?'<span class="locked-label">Locked</span>':''}</button>`).join('')||'<p class="muted" style="padding:20px">No matches. Enable Show locked to plan ahead.</p>';
  $('item-picker').scrollTop=scroll;const selected=entries.find(i=>i.id===state.picker);
  $('selection').innerHTML=selected?`${icon(selected.icon)}<strong>${esc(selected.displayName)}</strong>${!selected.unlocked?badge('Plan ahead','amber'):''}`:`<span class="muted">Select ${objective?'an objective building':'an item'} for this production.</span>`;
  $('new-rate-fields').hidden=objective;$('new-rate').required=!objective;$('new-rate').disabled=objective;$('new-unit').disabled=objective;
  $('production-dialog-title').textContent=objective?'Where shall it go?':'What shall we make?';
  $('create-goal').textContent=objective?'Add objective':'Add production';$('create-goal').disabled=!selected;
  $('production-dialog-note').textContent=objective?'Next, select your incoming items, supply rates, and modifiers.':'A separate chain, starting at basic resources. Estimates follow current research and speeds.';
}
function addDialog(){state.itemSearch='';state.picker=null;$('production-kind').value='item';$('item-search').value='';$('show-locked').checked=!live();$('new-rate').value='1';$('new-unit').value='1';$('production-error').textContent='';picker();$('production-dialog').showModal();$('item-search').focus();}
function techDetail(id){const r=state.catalog?.research.find(t=>t.id===id);if(!r)return;const s=model.research.get(id)||{};const requirements=[...new Set([r.rootId,r.previousId,...r.requirements].filter(Boolean))];$('detail-title').textContent=t(r.name);$('detail-eyebrow').textContent='RESEARCH LEDGER';$('detail-content').innerHTML=`<div class="cell-item" style="margin-bottom:20px">${icon(r.icon)}${badge(s.purchased?'Purchased':s.available?'Available':'Locked',s.purchased||s.available?'green':'amber')}</div><p class="muted">${esc(t(r.description))}</p><h3 class="detail-label">Requirements</h3>${requirements.map(req=>`<div class="detail-line"><span>${esc(t(state.catalog.research.find(x=>x.id===req)?.name||req))}</span>${badge(model.purchased.has(req)?'Purchased':'Needed',model.purchased.has(req)?'green':'amber')}</div>`).join('')||'<p class="muted">No prerequisite research.</p>'}${r.customRequirement?`<p class="plan-note">${esc(t(r.customRequirement))}</p>`:''}<p class="panel-note" style="margin-top:20px">Research is purchased inside the game. This ledger updates automatically.</p>`;$('detail-dialog').showModal();}
function buildingDetail(id){const b=buildings().find(b=>b.id===id);if(!b)return;$('detail-title').textContent=name(b.type);$('detail-eyebrow').textContent='BUILDING REGISTER';const fields=['Capacity','InputCount','SwitchPosition','FilterType','MaxTime','TimeLeft','ClickCount'];$('detail-content').innerHTML=`<div class="detail-grid">${[['Stack',b.stackSize],['Speed',number(b.speed)+'×'],['Quality',number(b.quality)+'×'],['Productivity',number(b.productivity*100)+'%']].map(([k,v])=>`<div class="detail-metric"><span>${k}</span><strong>${v}</strong></div>`).join('')}</div>${b.recipeId?`<p class="muted">Producing ${esc(name(b.recipeId))}</p>`:''}<h3 class="detail-label">Installed upgrades</h3>${b.installedUpgrades.map(u=>`<div class="detail-line"><span>Slot ${u.slot+1}</span><span>${esc(u.type?u.type.replace(/([a-z])([A-Z])/g,'$1 $2'):'Empty')}</span></div>`).join('')||'<p class="muted">No upgrade slots.</p>'}<h3 class="detail-label">Ports & inventory</h3>${['inputs','outputs'].map(side=>b[side].map(p=>`<div class="detail-line"><span>${side==='inputs'?'Input':'Output'} ${p.index+1}<small> · ${esc(p.itemId?name(p.itemId):'Any accepted item')}</small></span><span class="number">${p.buffered} / ${p.capacity} ${badge(p.connected?'Connected':'Open',p.connected?'green':'')}</span></div>`).join('')).join('')}${fields.filter(k=>b.state[k]!==undefined).length?'<h3 class="detail-label">Utility settings</h3>':''}${fields.filter(k=>b.state[k]!==undefined).map(k=>`<div class="detail-line"><span>${esc(k.replace(/([a-z])([A-Z])/g,'$1 $2'))}</span><span>${esc(k==='FilterType'?name(b.state[k]):b.state[k])}</span></div>`).join('')}<p class="panel-note" style="margin-top:17px">Sampled from the game. Output batches may exceed a port’s nominal buffer threshold.</p>`;$('detail-dialog').showModal();}
function layoutModifierDetails(n){
  const modifier=step=>step.kind==='outfit'?`Equip ${name(step.itemId)}${step.slot?' · '+step.slot:''}${step.enhancements?.length?' · '+step.enhancements.map(name).join(', '):''}`:step.kind==='training'?`Training pass ${step.pass}${step.halfEffectiveness?' · half effectiveness':''}`:name(step.recipeId);
  const basis=n.rateBasis,streams=n.modifierStreams||[];
  return `<section class="layout-node-modifiers"><h3 class="detail-label">Modifiers</h3>
    ${n.modifierStreams===undefined?'<p class="plan-note">Regenerate this saved layout to include its modifier details.</p>':''}
    ${n.appliedModifiers?.length?`<h4 class="detail-label">This node applies</h4>${n.appliedModifiers.map(step=>`<div class="detail-line"><span>${esc(modifier(step))}</span></div>`).join('')}`:''}
    ${streams.some(s=>s.steps.length)?`<h4 class="detail-label">${['objective','output'].includes(n.kind)?'Incoming stream modifiers':'Preparation on outgoing streams'}</h4>${streams.map(s=>`<div class="layout-connection"><strong>${esc(name(s.itemId))}</strong>${s.steps.length?`<ol class="modifier-history">${s.steps.map(step=>`<li>${esc(modifier(step))}</li>`).join('')}</ol>`:'<small>No preparation selected for this stream.</small>'}</div>`).join('')}`:n.modifierStreams!==undefined?`<p class="panel-note">${n.kind==='external'?'No preparation specified. Existing supplies may already have modifiers.':n.kind==='utility'?'This utility applies no item modifiers.':'No item preparation selected for this node.'}</p>`:''}
    ${basis?`<h4 class="detail-label">Production estimate</h4><div class="detail-line"><span>Effective speed per machine</span><strong>${number(basis.speed,3)}×</strong></div><div class="detail-line"><span>Base cycle</span><strong>${number(basis.cycleSeconds,3)} sec</strong></div>${basis.capacity>1?`<div class="detail-line"><span>Training slots</span><strong>${basis.capacity}</strong></div>`:''}<p class="panel-note">${basis.sampled?`Median speed from ${basis.sampleCount} matching placed station${basis.sampleCount===1?'':'s'}, normalized for stacks.`:'Base speed used; no matching placed station was sampled.'}</p>${basis.sampled?`<h4 class="detail-label">Sampled upgrade loadout</h4>${basis.upgrades.map(u=>`<div class="detail-line"><span>Slot ${u.slot+1}</span><strong>${esc(u.type?u.type.replace(/([a-z])([A-Z])/g,'$1 $2'):'Empty')}</strong></div>`).join('')||'<p class="panel-note">No installed upgrade slots on the reference station.</p>'}<p class="panel-note">These upgrades belong to the sampled station used for this estimate. Match its effective speed when placing this build.</p>`:''}${basis.automationAssumed?'<p class="plan-note">This rate assumes continuous work; automation is not unlocked.</p>':''}`:''}
  </section>`;
}
function layoutNodeDetail(id){
  const record=state.layouts[state.selected],layout=record&&layoutForView(record.layout,state.layoutUi[state.selected]),n=layout?.nodes.find(n=>n.id===id);if(!n)return;
  const nodes=new Map(layout.nodes.map(n=>[n.id,n]));
  const pipe=e=>e.sourceCopies?`${e.sourceCopies} pipes: machines ${(e.sourceStart||0)+1}–${(e.sourceStart||0)+e.sourceCopies}, output ${e.output+1} → routing inputs ${e.input+1}–${e.input+e.targetPortRange}`:e.targetCopies?`${e.targetCopies} pipes: routing outputs ${e.output+1}–${e.output+e.sourcePortRange} → machines ${(e.targetStart||0)+1}–${(e.targetStart||0)+e.targetCopies}, input ${e.input+1}`:`Output ${e.output+1} → input ${e.input+1}`;
  $('detail-title').textContent=n.title;$('detail-eyebrow').textContent='GENERATED BUILD LAYOUT';
  $('detail-content').innerHTML=`<div class="detail-grid"><div class="detail-metric"><span>${n.kind==='external'?'Existing supply':'Buildings to place'}</span><strong>${n.count?number(n.count,0):'External'}</strong></div><div class="detail-metric"><span>Planned flow /sec</span><strong>${number(n.rate,3)}</strong></div></div><p class="muted">${esc(n.subtitle)}${n.arrangement?` · Arrange as a compact bank, up to ${n.arrangement.columns} columns × ${n.arrangement.rows} rows.`:''}</p>${n.locked?'<p class="plan-note">Research required before this building or recipe can be used.</p>':''}
  ${document.querySelector('.layout-stale')?'<p class="plan-note">This layout is outdated. Modifiers below are from the generated plan; regenerate to use your latest settings and game progress.</p>':''}${layoutModifierDetails(n)}
  ${Object.keys(n.settings).length?'<h3 class="detail-label">Building settings</h3>':''}${Object.entries(n.settings).map(([k,v])=>`<div class="detail-line"><span>${esc(k.replace(/([a-z])([A-Z])/g,'$1 $2'))}</span><strong>${esc(['recipe','resource','equipment','supply'].includes(k)?name(v):v)}</strong></div>`).join('')}
  ${n.type==='Outfitter'?'<p class="panel-note">Timeout 0 waits for equipment. Unlock Outfitter automation for continuous operation.</p>':''}
  ${n.type==='Stockpile'?'<p class="panel-note">Use the normal output. The optional overflow output is left unconnected.</p>':''}
  ${['incoming','outgoing'].map(side=>`<h3 class="detail-label">${side==='incoming'?'Inputs':'Outputs'}</h3>${layout.edges.filter(e=>e[side==='incoming'?'to':'from']===id).map(e=>{const other=nodes.get(e[side==='incoming'?'from':'to']);return `<div class="layout-connection"><strong>${esc(other.title)} · ${number(e.rate,3)} /sec</strong><small>${esc(e.itemId?name(e.itemId):'Mixed inputs')} · ${esc(pipe(e))}</small></div>`;}).join('')||'<p class="muted">No connected pipes.</p>'}`).join('')}${n.reason?`<p class="plan-note">${esc(n.reason)}</p>`:''}`;
  $('detail-dialog').showModal();
}
function applyLayoutPresentation(){
  const root=$('generated-layout'),ui=state.layoutUi[state.selected],record=state.layouts[state.selected],expanded=!!(root&&record&&ui?.expanded);
  document.body.classList.toggle('layout-expanded-mode',expanded);root?.classList.toggle('is-expanded',expanded);
  for(const el of document.querySelectorAll('.sidebar,.page-header,.tabs,#connection-banner,.main-shell>footer'))el.inert=expanded;
  for(const el of $('main').children)el.inert=expanded&&el!==root;
  if(root){
    if(expanded){root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Fullscreen factory layout');}
    else {root.removeAttribute('role');root.removeAttribute('aria-modal');root.removeAttribute('aria-label');}
    const button=root.querySelector('[data-layout-fullscreen]');if(button){button.textContent=expanded?'Exit fullscreen':'Fullscreen';button.setAttribute('aria-expanded',String(expanded));}
    if(record)highlightFamily(root,layoutForView(record.layout,ui),ui?.hoveredNode||ui?.selectedNode||null);
  }
}
function selectLayoutNode(id){
  const root=$('generated-layout'),record=state.layouts[state.selected];if(!root||!record)return;
  state.layoutUi[state.selected]||={zoom:1};state.layoutUi[state.selected].selectedNode=id;state.layoutUi[state.selected].hoveredNode=null;highlightFamily(root,layoutForView(record.layout,state.layoutUi[state.selected]),id);
}
function zoomLayout(mode){
  const record=state.layouts[state.selected],ui=state.layoutUi[state.selected]||{zoom:1},pane=document.querySelector('.layout-scroll');if(!record||!pane)return;
  const old=ui.zoom;
  if(mode==='fit'&&ui.expanded&&!ui.machinesExpanded&&ui.overview!==false){let best=0;for(let columns=2;columns<=Math.min(10,record.layout.nodes.length);columns++){const candidate=overviewLayout(record.layout,columns),score=Math.min((pane.clientWidth-24)/candidate.width,(pane.clientHeight-24)/candidate.height);if(score>best){best=score;ui.overviewColumns=columns;}}}
  const display=layoutForView(record.layout,ui);
  ui.zoom=mode==='fit'?Math.min(1,(pane.clientWidth-24)/display.width,(pane.clientHeight-24)/display.height):mode==='reset'?1:Math.max(.001,Math.min(2,old*(mode==='in'?1.25:.8)));
  ui.left=mode==='fit'?0:Math.max(0,(pane.scrollLeft+pane.clientWidth/2)*ui.zoom/old-pane.clientWidth/2);ui.top=mode==='fit'?0:Math.max(0,(pane.scrollTop+pane.clientHeight/2)*ui.zoom/old-pane.clientHeight/2);
  state.layoutUi[state.selected]=ui;state.layoutViewportPending=true;render(true);
  if(mode==='fit'){
    // Toolbar and family labels can wrap after rendering (especially fullscreen
    // on narrow screens). Fit once more against the resulting canvas bounds.
    const fitted=document.querySelector('.layout-scroll'),svg=fitted?.querySelector('.layout-svg');
    const zoom=Math.min(ui.zoom,(fitted.clientWidth-24)/display.width,(fitted.clientHeight-24)/display.height);
    if(svg&&zoom<ui.zoom){ui.zoom=zoom;svg.setAttribute('width',Math.ceil(display.width*zoom));svg.setAttribute('height',Math.ceil(display.height*zoom));$('generated-layout').querySelector('.layout-zoom-label').textContent=Math.round(zoom*100)+'%';}
  }
}
function wheelZoomLayout(event){
  const pane=event.target.closest?.('.layout-scroll'),ui=state.layoutUi[state.selected],svg=pane?.querySelector('.layout-svg');
  if(!svg||!ui||!event.deltaY||event.shiftKey||state.layoutPan)return;
  event.preventDefault();
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?pane.clientHeight:1);
  const zoom=Math.max(.001,Math.min(2,ui.zoom*Math.exp(Math.max(-.7,Math.min(.7,-delta*.0015)))));
  if(zoom===ui.zoom)return;
  // Work from rendered bounds so the cursor stays anchored even when a fitted
  // diagram is vertically centered. Keep the SVG mounted during wheel gestures.
  const before=svg.getBoundingClientRect(),x=(event.clientX-before.left)/before.width,y=(event.clientY-before.top)/before.height;
  svg.setAttribute('width',Math.ceil(svg.viewBox.baseVal.width*zoom));
  svg.setAttribute('height',Math.ceil(svg.viewBox.baseVal.height*zoom));
  const after=svg.getBoundingClientRect();
  pane.scrollLeft+=after.left+x*after.width-event.clientX;
  pane.scrollTop+=after.top+y*after.height-event.clientY;
  ui.zoom=zoom;ui.left=pane.scrollLeft;ui.top=pane.scrollTop;
  $('generated-layout').querySelector('.layout-zoom-label').textContent=Math.round(zoom*100)+'%';
}
function expandLayout(expand){
  const root=$('generated-layout'),record=state.layouts[state.selected];if(!root||!record)return;
  const ui=state.layoutUi[state.selected]||{zoom:1},pane=root.querySelector('.layout-scroll');
  if(expand){ui.inlineViewport={zoom:ui.zoom,left:pane.scrollLeft,top:pane.scrollTop};ui.expanded=true;ui.overview??=true;state.layoutUi[state.selected]=ui;applyLayoutPresentation();zoomLayout('fit');}
  else {ui.expanded=false;Object.assign(ui,ui.inlineViewport||{zoom:1,left:0,top:0});state.layoutUi[state.selected]=ui;state.layoutViewportPending=true;render(true);}
  $('generated-layout')?.querySelector('[data-layout-fullscreen]')?.focus({preventScroll:true});
}
function layoutAction(event){
  const goal=state.goals.find(g=>g.id===state.selected),record=state.layouts[state.selected];
  const node=event.target.closest('[data-layout-node]');if(node){selectLayoutNode(node.dataset.layoutNode);layoutNodeDetail(node.dataset.layoutNode);return true;}
  if(event.target.closest('[data-layout-fullscreen]')){expandLayout(!state.layoutUi[state.selected]?.expanded);return true;}
  if(event.target.closest('[data-layout-machines]')&&record){
    const ui=state.layoutUi[state.selected]||{zoom:1};
    try{
      const display=layoutForView(record.layout,ui),selected=display.nodes.find(n=>n.id===ui.selectedNode);
      if(!ui.machinesExpanded)expandMachineLayout(record.layout);
      ui.machinesExpanded=!ui.machinesExpanded;ui.hoveredNode=null;
      const next=layoutForView(record.layout,ui);
      ui.selectedNode=selected?next.nodes.find(n=>n.id===selected.id||n.groupId===(selected.groupId||selected.id)||n.id===selected.groupId)?.id||null:null;
      // The inline viewport belongs to the previous representation after a switch.
      ui.inlineViewport=null;state.layoutUi[state.selected]=ui;zoomLayout('fit');
      $('generated-layout')?.querySelector('[data-layout-machines]')?.focus({preventScroll:true});
    }catch(error){toast(error.message);}
    return true;
  }
  if(event.target.closest('[data-layout-arrangement]')){const ui=state.layoutUi[state.selected];ui.overview=ui.overview===false;zoomLayout('fit');return true;}
  if(event.target.closest('[data-layout-clear]')){selectLayoutNode(null);return true;}
  if(event.target.closest('[data-layout-inspect]')){const id=state.layoutUi[state.selected]?.selectedNode;if(id)layoutNodeDetail(id);return true;}
  if(event.target.closest('[data-action="generate-layout"]')&&goal){
    try{
      const plan=planGoal(model,goal),layout=generateLayout(model,goal,plan);
      const previousUi=state.layoutUi[goal.id];
      if(previousUi?.machinesExpanded)expandMachineLayout(layout);
      state.layouts[goal.id]={signature:layoutSignature(model,goal,plan),layout};storage.write('layouts',state.layouts);
      state.layoutUi[goal.id]={zoom:1,left:0,top:0,expanded:!!previousUi?.expanded,machinesExpanded:!!previousUi?.machinesExpanded,overview:previousUi?.overview,overviewColumns:previousUi?.overviewColumns,inlineViewport:previousUi?.inlineViewport};state.layoutViewportPending=true;render(true);if(previousUi?.expanded||previousUi?.machinesExpanded)zoomLayout('fit');
      if(!state.layoutUi[goal.id]?.expanded)$('generated-layout')?.scrollIntoView({behavior:'smooth',block:'start'});toast('Layout generated. Click a building for its wiring.');
    }catch(error){toast(error.message);}
    return true;
  }
  const zoom=event.target.closest('[data-layout-zoom]');if(zoom&&record){zoomLayout(zoom.dataset.layoutZoom);return true;}
  if(event.target.closest('[data-layout-export]')&&record){
    const exported=state.layoutUi[state.selected]?.machinesExpanded?expandMachineLayout(record.layout):record.layout;
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:'application/json'}));
    link.href=url;link.download=record.layout.goalName.replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'-layout.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
  }
  return false;
}
document.addEventListener('click',async e=>{
  if(layoutAction(e))return;
  if(editPreparation(e,model,state.goals.find(g=>g.id===state.selected))){saveGoals();render();return;}
  const close=e.target.closest('[data-close]');if(close){$(close.dataset.close).close();return;}
  const container=e.target.closest('[data-open-container]');if(container){state.factoryContainer=container.dataset.openContainer;state.factoryType='all';state.factorySearch='';navigate('factory');return;}
  if(e.target.closest('[data-factory-all]')){state.factoryContainer='all';state.factoryType='all';state.factorySearch='';}
  const nav=e.target.closest('[data-view]');if(nav){navigate(nav.dataset.view);return;}
  const goal=e.target.closest('[data-goal]');if(goal){state.selected=goal.dataset.goal;state.view='production';render();return;}
  const type=e.target.closest('[data-type]');if(type){state.factoryType=type.dataset.type;state.factoryContainer=type.dataset.containerScope||'all';state.factorySearch='';navigate('factory');return;}
  const item=e.target.closest('[data-item]');if(item){state.picker=item.dataset.item;picker();return;}
  const tech=e.target.closest('[data-tech]');if(tech){techDetail(tech.dataset.tech);return;}
  const building=e.target.closest('[data-building]');if(building){buildingDetail(building.dataset.building);return;}
  const remove=e.target.closest('[data-remove]');if(remove){delete state.layouts[remove.dataset.remove];storage.write('layouts',state.layouts);state.goals=state.goals.filter(g=>g.id!==remove.dataset.remove);state.selected=null;saveGoals();render();toast('Production removed from your ledger.');return;}
  const supply=e.target.closest('[data-supply]');if(supply){const goal=state.goals.find(g=>g.id===state.selected);if(goal){const items=new Set(goal.external||[]);items.has(supply.dataset.supply)?items.delete(supply.dataset.supply):items.add(supply.dataset.supply);goal.external=[...items];saveGoals();render();}return;}
  const action=e.target.closest('[data-action]')?.dataset.action;
  if(action==='add')addDialog();if(action==='settings'){$('api-address').value=state.base;$('settings-error').textContent='';$('settings-dialog').showModal();}
  if(action==='all-goals'){state.selected=null;render();}
});
let layoutResizeTimer;window.addEventListener('resize',()=>{clearTimeout(layoutResizeTimer);if(state.layoutUi[state.selected]?.expanded)layoutResizeTimer=setTimeout(()=>zoomLayout('fit'),120);});
document.addEventListener('dblclick',e=>{const n=e.target.closest('[data-layout-node]');if(n)layoutNodeDetail(n.dataset.layoutNode);});
document.addEventListener('pointerover',e=>{const n=e.target.closest('[data-layout-node]'),root=$('generated-layout'),record=state.layouts[state.selected];if(n&&root&&record&&(!e.relatedTarget||!n.contains(e.relatedTarget))){state.layoutUi[state.selected]||={zoom:1};state.layoutUi[state.selected].hoveredNode=n.dataset.layoutNode;highlightFamily(root,layoutForView(record.layout,state.layoutUi[state.selected]),n.dataset.layoutNode);}});
document.addEventListener('pointerout',e=>{const n=e.target.closest('[data-layout-node]'),root=$('generated-layout'),record=state.layouts[state.selected];if(n&&root&&record&&(!e.relatedTarget||!n.contains(e.relatedTarget))){if(state.layoutUi[state.selected])state.layoutUi[state.selected].hoveredNode=null;highlightFamily(root,layoutForView(record.layout,state.layoutUi[state.selected]),state.layoutUi[state.selected]?.selectedNode||null);}});
document.addEventListener('keydown',e=>{
  if(!state.layoutUi[state.selected]?.expanded||document.querySelector('dialog[open]'))return;
  if(e.key==='Escape'){e.preventDefault();expandLayout(false);return;}
  if(e.key==='Tab'){
    const controls=[...$('generated-layout').querySelectorAll('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);
    const index=controls.indexOf(document.activeElement),next=e.shiftKey?index-1:index+1;
    if(next<0||next>=controls.length){e.preventDefault();controls[e.shiftKey?controls.length-1:0]?.focus();}
  }
});
document.addEventListener('keydown',e=>{if(e.target.matches('[data-layout-node]')&&['Enter',' '].includes(e.key)){e.preventDefault();selectLayoutNode(e.target.dataset.layoutNode);}if(e.target.matches('[data-building]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();buildingDetail(e.target.dataset.building);}if($('production-dialog').open&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)&&(e.target.closest('#item-picker')||e.target.id==='item-search')){const buttons=[...$('item-picker').querySelectorAll('[data-item]')];if(!buttons.length)return;const index=buttons.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:e.key==='ArrowDown'?Math.min(buttons.length-1,index+1):Math.max(0,index-1);buttons[next].focus();e.preventDefault();}});
document.addEventListener('input',e=>{const id=e.target.id;const mapping={'goal-search':'goalSearch','factory-search':'factorySearch','research-search':'researchSearch','resource-search':'resourceSearch'};if(mapping[id]){state[mapping[id]]=e.target.value;id==='goal-search'?sidebar():render();}if(id==='item-search'){state.itemSearch=e.target.value;picker();}});
document.addEventListener('change',e=>{if(e.target.id==='layout-buffers'){const g=state.goals.find(g=>g.id===state.selected);if(g){g.layoutOptions={buffers:e.target.checked};saveGoals();render(true);}return;}if(editPreparation(e,model,state.goals.find(g=>g.id===state.selected))){saveGoals();render(true);return;}if(e.target.id==='production-kind'){state.picker=null;state.itemSearch='';$('item-search').value='';picker();}if(e.target.id==='show-locked')picker();if(e.target.id==='research-filter'){state.researchFilter=e.target.value;render(true);}if(e.target.id==='factory-container'){state.factoryContainer=e.target.value;render(true);}if(e.target.id==='factory-filter'){state.factoryType=e.target.value;render(true);}if(e.target.id==='goal-rate'){const g=state.goals.find(g=>g.id===state.selected);if(g&&finiteRate(e.target.value)){g.rate=Number(e.target.value);saveGoals();render(true);}else {toast('Enter an output greater than zero.');render(true);}}});
$('production-form').addEventListener('submit',e=>{e.preventDefault();const objective=$('production-kind').value==='objective',rate=Number($('new-rate').value)/Number($('new-unit').value);if(!state.picker||!objective&&!finiteRate(rate)){$('production-error').textContent='Choose an item and enter a valid output rate.';return;}if(state.goals.length>=100){$('production-error').textContent='This ledger supports 100 production goals.';return;}const goal=objective?{id:crypto.randomUUID(),kind:'objective',buildingType:state.picker,inputs:[],external:[]}:{id:crypto.randomUUID(),itemId:state.picker,rate,external:[],modifiers:[]};state.goals.push(goal);saveGoals();state.selected=goal.id;state.view='production';$('production-dialog').close();render();toast('Production added to your ledger.');});
$('settings-form').addEventListener('submit',async e=>{e.preventDefault();try{const url=new URL($('api-address').value.replace(/\/api\/v1\/?$/,''));if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use an HTTP localhost address, such as http://127.0.0.1:17840.');state.base=url.origin;storage.write('api',state.base);state.connected=false;$('settings-dialog').close();renderStatus();await connect();}catch(error){$('settings-error').textContent=error.message;}});
document.addEventListener('pointerdown',e=>{const pane=e.target.closest('.layout-scroll');if(!pane||e.pointerType!=='mouse'||e.button!==0||e.target.closest('[data-layout-node]'))return;state.layoutPan={pane,id:e.pointerId,x:e.clientX,y:e.clientY,left:pane.scrollLeft,top:pane.scrollTop};pane.setPointerCapture(e.pointerId);pane.classList.add('is-panning');e.preventDefault();});
document.addEventListener('wheel',wheelZoomLayout,{passive:false});
document.addEventListener('pointermove',e=>{const p=state.layoutPan;if(p&&p.id===e.pointerId){p.pane.scrollLeft=p.left-(e.clientX-p.x);p.pane.scrollTop=p.top-(e.clientY-p.y);}});
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,e=>{const p=state.layoutPan;if(p&&p.id===e.pointerId){p.pane.classList.remove('is-panning');state.layoutPan=null;}});
document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement){e.target.style.visibility='hidden';}},true);
fetch('item-traits.json').then(r=>r.json()).then(traits=>{state.traits=traits;render();}).catch(()=>{});
fetch('assets.json').then(r=>r.json()).then(a=>{state.rooms=a.rooms;render();}).catch(()=>{});
if(!state.catalog)fetch('catalog.json').then(r=>r.ok?r.json():null).then(c=>{if(c&&!state.catalog){state.catalog=c;storage.write('catalog',c);render();if($('production-dialog').open)picker();}}).catch(()=>{});
render();connect();
