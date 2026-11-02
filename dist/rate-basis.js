// Keep the evidence for the exact median speed used by the planner. Sampled
// upgrades describe that existing station, rather than assigning upgrades to a guide.
export function stationRateBasis(model,type,recipeId=null){
  const samples=model.buildings.filter(b=>b.type===type&&(!recipeId||b.recipeId===recipeId))
    .map(b=>({building:b,speed:b.speed/Math.max(1,b.stackSize)}))
    .filter(s=>Number.isFinite(s.speed)&&s.speed>0).sort((a,b)=>a.speed-b.speed);
  const sample=samples[Math.floor(samples.length/2)];
  return {speed:sample?.speed||1,sampled:!!sample,sampleCount:samples.length,
    buildingId:sample?.building.id||null,stackSize:sample?.building.stackSize||1,
    upgrades:(sample?.building.installedUpgrades||[]).map(u=>({slot:u.slot,type:u.type||null}))};
}
