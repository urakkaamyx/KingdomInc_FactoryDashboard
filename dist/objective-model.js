// Destination filters mirror the preserved Flow.Elements classes. Rates describe supplied
// inputs, never encounter wins, quest completions, or storage capacity.
import {stationRateBasis} from './rate-basis.js';
export const currencyIcons = {Gold:'Icons_8',Requisition:'Icons_33',Medal:'Icons_63',Ring:'Icons_135',Mana:'Icons_162',Crown:'Icons_188',Ducat:'Icons_197',Ingenuity:'Icons2_67',Faith:'Icons2_66'};
export const human = item => ['HumanItemType','AdventurerItemType'].includes(item?.kind);
export const combatant = item => human(item) || item?.kind==='CombatantItemType';
const utilityTargets = ['Arena','Armory','Hoard','Portal','TrainingGrounds'];
export function objectives(model) {
  return Object.values(model.definitions).filter(b=>(b.category==='Consumption'&&b.id!=='DemoTurtle')||utilityTargets.includes(b.id))
    .map(b=>({id:b.id,icon:b.icon||(b.id==='QuestBoard'?'Icons_136':'Icons_1'),displayName:model.name(b.id),unlocked:model.buildable.has(b.id)}))
    .sort((a,b)=>a.displayName.localeCompare(b.displayName));
}
export function accepts(model,type,item) {
  if(!item)return false;
  const gear=model.gear.get(item.id), sell=item.canSell&&!combatant(item);
  switch(type){
    case 'WarEffort':return combatant(item)&&(item.kind!=='AdventurerItemType'||model.purchased.has('adv_to_war'));
    case 'QuestBoard':case 'Dungeon':return item.kind==='AdventurerItemType';
    case 'Arena':return combatant(item);
    case 'TrainingGrounds':return human(item);
    case 'Shop':case 'LuxuryShop':return sell;
    case 'RequisitionOffice':return item.canSell&&!combatant(item);
    case 'Restaurant':return item.canSell&&gear?.slot==='Food';
    case 'MercenaryGuild':return item.canSell&&(item.kind==='AdventurerItemType'||human(item)&&model.purchased.has('mercenary_conscripts'));
    case 'Disenchanter':return item.canSell&&!!gear&&!['Food','Potion','Scroll'].includes(gear.slot);
    case 'NightmareCollector':return item.id==='nightmare_collector';
    case 'Armory':return !!gear&&(item.kind==='WeaponItemType'||['Head','Chest'].includes(gear.slot));
    case 'Hoard':return item.sourceDungeon||item.sourceQuest&&!combatant(item);
    case 'Portal':return true;
    default:return false;
  }
}
export function inputOptions(model,type,showLocked=false) {
  return [...model.items.values()].filter(i=>accepts(model,type,i)&&(showLocked||model.unlockedItems.has(i.id)))
    .sort((a,b)=>model.name(a.id).localeCompare(model.name(b.id)));
}
export function enhancementFits(model,recipe,itemId) {
  const gear=model.gear.get(itemId), item=model.items.get(itemId);
  if(!gear||!recipe.outputs.some(o=>o.enhancementId))return false;
  const filter=recipe.inputs.find(i=>i.filtered)?.description;
  switch(filter){
    case '@engraver_reagent_weapon':return item.kind==='WeaponItemType';
    case '@engraver_reagent_shield':return gear.weapon==='Shield';
    case '@engraver_reagent_heavy_armor':return model.traits[itemId]?.armorType==='Heavy';
    case '@engraver_reagent_light_armor':return ['Light','Medium'].includes(model.traits[itemId]?.armorType);
    case '@engraver_reagent_armor':return ['Head','Chest'].includes(gear.slot);
    case '@engraver_reagent_jewelry':return ['Ring','Amulet'].includes(gear.slot);
    case '@enchant_reagent_food':return gear.slot==='Food';
    case '@enchant_reagent_equipment':return true;
    case '@shrine_reagent_armor':return item.kind!=='WeaponItemType';
    default:return false;
  }
}
export function enhancementOptions(model,itemId,showLocked=false){
  return (model.catalog?.recipes||[]).filter(r=>enhancementFits(model,r,itemId)&&(showLocked||model.available.has(r.id)&&model.buildable.has(r.stationTag)));
}
export function slotUnlocked(model,slot){
  const techs={Food:['campfire','adventure_supplies','kitchen'],Potion:['adventure_supplies','alchemist'],Amulet:['jeweler'],Ring:['jeweler'],Trinket:['inventor'],Scroll:['scribe']};
  return !techs[slot]||techs[slot].some(t=>model.purchased.has(t));
}
export function modifierOptions(model,itemId,showLocked=false){
  const rows=[];
  if(human(model.items.get(itemId))){
    if(showLocked||model.buildable.has('TrainingGrounds'))rows.push({value:'training',label:model.name('TrainingGrounds')+' · one pass',icon:'Icons_137'});
    if(showLocked||model.buildable.has('Outfitter'))for(const gear of model.gear.values()){
      if(!showLocked&&(!model.unlockedItems.has(gear.id)||!slotUnlocked(model,gear.slot)))continue;
      rows.push({value:'outfit:'+gear.id,label:'Outfitter · '+model.name(gear.id),icon:model.items.get(gear.id)?.icon});
    }
  }
  for(const r of enhancementOptions(model,itemId,showLocked))rows.push({value:'recipe:'+r.id,label:model.name(r.stationTag)+' · '+model.name(r.id),icon:r.icon});
  return rows;
}
export function stageFromValue(value){
  if(value==='training')return {kind:'training'};
  const [kind,id]=value.split(':');
  return kind==='outfit'?{kind,itemId:id,enhancements:[]}:kind==='recipe'?{kind,recipeId:id}:null;
}
export function stageName(model,stage){
  return stage.kind==='outfit'?`${model.name('Outfitter')} · ${model.name(stage.itemId)}`:stage.kind==='training'?model.name('TrainingGrounds'):model.name(stage.recipeId);
}
export const objectiveNotes={
  WarEffort:'Supply to the war effort. Battle progress and medals depend on the encounter and equipped combatants.',
  QuestBoard:'Adventurer feed, not quest completions. A party holds up to five; survivors return and can be reused.',
  Dungeon:'Adventurer feed, not dungeon clears. Each dungeon needs a complete party of five and returns survivors.',
  Arena:'Combatant feed. The two arena inputs need opponents; results and survivor reuse depend on the match.',
  RequisitionOffice:'Contracts change. Inputs are checked against the currently sampled Requisition contracts.',
  LuxuryShop:'Only sellable items above 100% quality are accepted. Currency yield depends on their actual quality.',
  MercenaryGuild:'Only eligible humans above 100% quality are accepted. Conscripts need Foreign Legion research.',
  Disenchanter:'Equipment must have at least 104% quality. Mana yield depends on its actual quality.',
  Armory:'Deposit supply. Storage is finite; deposits cost Gold. This is not continuous consumption.',
  Hoard:'Deposit eligible dungeon or quest loot. Storage is finite; upgraded adventurers are not accepted.',
  Portal:'Portal input supply. Storage is finite; deposits cost Mana. This is not continuous consumption.',
  TrainingGrounds:'Incoming trainees. Training time depends on speed, occupied slots, food, and remaining energy.',
  NightmareCollector:'Collector supply. Nightmare progression is shared across the kingdom.'
};
export function planPreparedGoal(model,goal,planItem){
  const objective=goal.kind==='objective', roots=[],stages=[],warnings=new Set(),issues=[],costs=new Map();
  const feeds=objective?(goal.inputs||[]):[{itemId:goal.itemId,rate:goal.rate,modifiers:goal.modifiers||[]}];
  const rate=feeds.reduce((sum,f)=>sum+(Number(f.rate)||0),0);
  function stage(type,label,itemId,rate,time,recipeId,capacity=1){
    const locked=!model.buildable.has(type)||!!recipeId&&!model.available.has(recipeId);
    if(locked)warnings.add(`${label} requires research.`);
    const automated=type==='Outfitter'?model.purchased.has('outfitter_automation'):model.buildings.some(b=>b.type===type&&b.automatic)||(model.snapshot?.sections?.upgrades?.data?.availableByBuildingType?.[type]||[]).includes('Worker');
    if(!automated)warnings.add(`${model.name(type)} rates assume continuous work; automation is not unlocked.`);
    const basis=stationRateBasis(model,type,recipeId);
    stages.push({station:type,label,itemId,rate,count:Math.ceil(rate*time/(basis.speed*capacity)-1e-9),locked,
      rateBasis:{...basis,cycleSeconds:time,capacity,outputPerCycle:1,automationAssumed:!automated}});
  }
  function enhance(itemId,rate,ids){
    const types=new Set();
    if(ids.length>1&&!model.purchased.has('enhance_multiple'))issues.push('Multiple enhancements require Enhance Multiple research.');
    for(const id of ids){
      const recipe=model.catalog.recipes.find(r=>r.id===id);
      if(!recipe||!enhancementFits(model,recipe,itemId)){issues.push(`${model.name(id)} cannot be applied to ${model.name(itemId)}.`);continue;}
      if(types.has(recipe.stationTag))issues.push(`${model.name(itemId)} can only have one enhancement of each type.`);
      types.add(recipe.stationTag);
      stage(recipe.stationTag,model.name(id),itemId,rate,recipe.craftingTimeSeconds,id);
      for(const i of recipe.inputs.filter(i=>!i.filtered))roots.push({itemId:i.itemId,rate:rate*i.count});
      for(const [currency,value] of Object.entries(recipe.cost||{}))costs.set(currency,(costs.get(currency)||0)+Number(value)*rate);
    }
  }
  for(const feed of feeds){
    if(!model.items.has(feed.itemId)||!(feed.rate>0)||!Number.isFinite(feed.rate)){issues.push('Select an input and a positive supply rate.');continue;}
    if(objective&&!accepts(model,goal.buildingType,model.items.get(feed.itemId)))issues.push(`${model.name(goal.buildingType)} does not accept ${model.name(feed.itemId)} with current research.`);
    if(objective&&goal.buildingType==='RequisitionOffice'){
      const ids=model.snapshot?.sections?.economy?.data?.requisitionItemIds||[];
      if(!ids.includes(feed.itemId))warnings.add(`${model.name(feed.itemId)} is not on a currently sampled Requisition contract.`);
    }
    roots.push({itemId:feed.itemId,rate:feed.rate,useSupply:!!feed.useSupply});
    let trained=0,loadout=[];const enhancements=[];
    for(const mod of feed.modifiers||[]){
      if(mod.kind==='recipe'){enhancements.push(mod.recipeId);continue;}
      if(!human(model.items.get(feed.itemId))){issues.push('Outfitting and training require a human input.');continue;}
      if(mod.kind==='outfit'){
        const gear=model.gear.get(mod.itemId);
        if(!gear){issues.push('Choose valid Outfitter equipment.');continue;}
        if(!slotUnlocked(model,gear.slot))issues.push(`${gear.slot} equipment needs additional slot research.`);
        const weapons=loadout.filter(g=>g.weapon), same=loadout.filter(g=>g.slot===gear.slot);
        const conflict=gear.weapon?(gear.twoHanded?loadout.some(g=>['MainHand','OffHand'].includes(g.slot)):gear.ambidextrous?weapons.some(g=>g.twoHanded)||weapons.length>=2:same.length>0||gear.slot==='OffHand'&&weapons.some(g=>g.twoHanded)):same.length>0;
        if(conflict)issues.push(`${model.name(gear.id)} conflicts with equipment already selected; the Outfitter may replace or skip it.`);
        loadout.push(gear);roots.push({itemId:gear.id,rate:feed.rate,useSupply:!!mod.useSupply});
        enhance(gear.id,feed.rate,mod.enhancements||[]);
        stage('Outfitter',`Equip ${model.name(gear.id)}`,feed.itemId,feed.rate,1);
      } else if(mod.kind==='training'){
        trained++;
        if(model.items.get(feed.itemId).kind!=='AdventurerItemType'){
          if(trained===2)warnings.add('The second conscript training pass has half effectiveness.');
          if(trained>2)issues.push('Third and later conscript training passes have no effect.');
        }
        const fed=model.purchased.has('training_grounds_food')&&loadout.some(g=>g.slot==='Food');
        const capacity=3+Number(model.purchased.has('training_grounds_slot'))+Number(model.purchased.has('training_grounds_slot_2'));
        stage('TrainingGrounds',`Training pass ${trained}${fed?' · fed':''}`,feed.itemId,feed.rate,fed?10:20,null,capacity);
        warnings.add('Training counts assume complete cycles and enough energy; exhausted trainees may not survive. Existing supplies may already have training.');
        if(model.purchased.has('training_grounds_food'))loadout=loadout.filter(g=>g.slot!=='Food');
      }
    }
    enhance(feed.itemId,feed.rate,enhancements);
  }
  const base=planItem(model,goal,roots);
  for(const row of base.costs)costs.set(row.currency,(costs.get(row.currency)||0)+row.rate);
  if(objective&&!model.buildable.has(goal.buildingType))warnings.add(`${model.name(goal.buildingType)} requires research.`);
  if(objective&&!feeds.length)issues.push('Add an input to calculate this objective’s supply chain.');
  if(objective&&objectiveNotes[goal.buildingType])warnings.add(objectiveNotes[goal.buildingType]);
  return {...base,stages,rate,issues,costs:[...costs].map(([currency,rate])=>({currency,rate})),warnings:[...new Set([...base.warnings,...warnings])],buildings:base.buildings+stages.reduce((s,n)=>s+n.count,0),locked:base.locked||stages.some(s=>s.locked)||objective&&!model.buildable.has(goal.buildingType)};
}
