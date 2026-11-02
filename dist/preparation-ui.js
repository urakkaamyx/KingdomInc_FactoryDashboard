import {inputOptions,modifierOptions,enhancementOptions,stageFromValue,stageName,objectiveNotes} from './objective-model.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const img=id=>`<img class="item-icon" src="assets/icons/${esc(id||'Icons_1')}.png" alt="">`;
const options=(rows,value)=>rows.map(r=>`<option value="${esc(r.value)}" ${r.value===value?'selected':''}>${esc(r.label)}</option>`).join('');
function stageEditor(model,feed,feedId,locked){
  const stages=feed.modifiers||[], available=modifierOptions(model,feed.itemId,locked);
  return `<div class="prep-stages">${stages.map((s,index)=>`<div class="prep-stage"><div class="prep-stage-title"><span class="step-number">${index+1}</span><strong>${esc(stageName(model,s))}</strong><div class="stage-actions"><button class="text-button" data-stage-up="${index}" data-feed="${esc(feedId)}" ${index===0?'disabled':''} aria-label="Move preparation stage ${index+1} up">↑</button><button class="text-button" data-stage-down="${index}" data-feed="${esc(feedId)}" ${index===stages.length-1?'disabled':''} aria-label="Move preparation stage ${index+1} down">↓</button><button class="text-button" data-stage-remove="${index}" data-feed="${esc(feedId)}" aria-label="Remove preparation stage ${index+1}">×</button></div></div>${s.kind==='outfit'?`<div class="gear-prep">${img(model.items.get(s.itemId)?.icon)}<span>${esc(model.gear.get(s.itemId)?.slot||'Equipment')} · one per incoming human</span><label>Equipment supply<select id="gear-supply-${esc(feedId)}-${index}" data-gear-supply="${index}" data-feed="${esc(feedId)}"><option value="build" ${!s.useSupply?'selected':''}>Build a chain</option><option value="existing" ${s.useSupply?'selected':''}>Existing supply</option></select></label></div><div class="gear-enhancements">${(s.enhancements||[]).map((id,n)=>`<div><span>${esc(model.name(id))}</span><button class="text-button" data-enhance-remove="${index}" data-enhance-index="${n}" data-feed="${esc(feedId)}" aria-label="Remove equipment enhancement ${n+1}">×</button></div>`).join('')}<select id="enhance-${esc(feedId)}-${index}" data-add-enhance="${index}" data-feed="${esc(feedId)}" aria-label="Prepare ${esc(model.name(s.itemId))} before outfitting"><option value="">＋ Prepare equipment…</option>${enhancementOptions(model,s.itemId,locked).filter(r=>!s.enhancements?.includes(r.id)).map(r=>`<option value="${esc(r.id)}">${esc(model.name(r.stationTag))} · ${esc(model.name(r.id))}</option>`).join('')}</select></div>`:''}</div>`).join('')}
    ${available.length?`<select id="add-stage-${esc(feedId)}" data-add-stage data-feed="${esc(feedId)}" aria-label="Add preparation for ${esc(model.name(feed.itemId))}"><option value="">＋ Add modifier / preparation…</option>${options(available,'')}</select>`:`<p class="panel-note">No ${locked?'compatible':'unlocked'} preparation stages for this input.</p>`}</div>`;
}
export function preparationEditor(model,goal){
  const objective=goal.kind==='objective', locked=!!goal.showLocked;
  const rows=objective?inputOptions(model,goal.buildingType,locked):[];
  return `<section class="panel preparation-panel"><div class="section-heading"><h3>${objective?'Inputs & preparation':'Preparation & modifiers'}</h3><label class="locked-choice"><input id="prep-show-locked" type="checkbox" ${locked?'checked':''}> Show locked</label></div>
    ${objective?`<p class="muted prep-intro">Choose the items you’ll feed into ${esc(model.name(goal.buildingType))}, then prepare each stream in order.</p><p class="panel-note">${esc(objectiveNotes[goal.buildingType]||'Input feed rates are supply targets for this building.')}</p>${(goal.inputs||[]).map(feed=>{const allowed=rows.some(r=>r.id===feed.itemId)?rows:[model.items.get(feed.itemId),...rows].filter(Boolean);return `<article class="input-card"><div class="input-card-heading">${img(model.items.get(feed.itemId)?.icon)}<label>Incoming item<select id="feed-item-${esc(feed.id)}" data-feed-item data-feed="${esc(feed.id)}">${options(allowed.map(i=>({value:i.id,label:model.name(i.id)+(model.unlockedItems.has(i.id)?'':' · locked')})),feed.itemId)}</select></label><button class="text-button" data-feed-remove="${esc(feed.id)}" aria-label="Remove ${esc(model.name(feed.itemId))} input">×</button></div><div class="feed-fields"><label>Input /sec<input id="feed-rate-${esc(feed.id)}" data-feed-rate data-feed="${esc(feed.id)}" type="number" min="0" max="1000000" step="any" value="${feed.rate}"></label><label>Input supply<select id="feed-supply-${esc(feed.id)}" data-feed-supply data-feed="${esc(feed.id)}"><option value="build" ${!feed.useSupply?'selected':''}>Build a chain</option><option value="existing" ${feed.useSupply?'selected':''}>Existing supply</option></select></label></div>${stageEditor(model,feed,feed.id,locked)}</article>`;}).join('')}<label class="add-input-label">Add an input<select id="add-objective-input" data-add-input><option value="">＋ Select an incoming item…</option>${options(rows.map(i=>({value:i.id,label:model.name(i.id)+(model.unlockedItems.has(i.id)?'':' · locked')})),'')}</select></label>${rows.length?'':'<p class="panel-note">No accepted inputs are unlocked. Enable Show locked to plan ahead.</p>'}`:stageEditor(model,goal,'root',locked)}
  </section>`;
}
export function editPreparation(event,model,goal){
  if(!goal)return false;
  const el=event.target.closest('button,select,input');if(!el)return false;
  const d=el.dataset, feed=d.feed==='root'?goal:goal.inputs?.find(f=>f.id===d.feed);
  if(event.type==='change'){
    if(el.id==='prep-show-locked'){goal.showLocked=el.checked;return true;}
    if('addInput' in d&&el.value&&inputOptions(model,goal.buildingType,goal.showLocked).some(i=>i.id===el.value)){
      goal.inputs||=[];if(goal.inputs.length<20)goal.inputs.push({id:crypto.randomUUID(),itemId:el.value,rate:1,useSupply:false,modifiers:[]});return true;
    }
    if(!feed)return false;
    if('feedRate' in d){const v=Number(el.value);if(v>0&&v<=1000000)feed.rate=v;return true;}
    if('feedItem' in d){feed.itemId=el.value;return true;}
    if('feedSupply' in d){feed.useSupply=el.value==='existing';return true;}
    if('addStage' in d&&el.value){const stage=stageFromValue(el.value);if(stage){feed.modifiers||=[];if(feed.modifiers.length<30)feed.modifiers.push(stage);}return true;}
    if('gearSupply' in d){feed.modifiers[+d.gearSupply].useSupply=el.value==='existing';return true;}
    if('addEnhance' in d&&el.value){const stage=feed.modifiers[+d.addEnhance];stage.enhancements||=[];stage.enhancements.push(el.value);return true;}
  } else if(event.type==='click'){
    if('feedRemove' in d){goal.inputs=goal.inputs.filter(f=>f.id!==d.feedRemove);return true;}
    if(!feed)return false;
    if('stageRemove' in d){feed.modifiers.splice(+d.stageRemove,1);return true;}
    if('stageUp' in d||'stageDown' in d){const i=+('stageUp' in d?d.stageUp:d.stageDown),j=i+('stageUp' in d?-1:1);if(j>=0&&j<feed.modifiers.length)[feed.modifiers[i],feed.modifiers[j]]=[feed.modifiers[j],feed.modifiers[i]];return true;}
    if('enhanceRemove' in d){feed.modifiers[+d.enhanceRemove].enhancements.splice(+d.enhanceIndex,1);return true;}
  }
  return false;
}
