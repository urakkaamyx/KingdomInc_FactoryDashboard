// Observe actual balance changes, including purchases, refunds and collections.
// Subtract Int64 strings as BigInts before converting the small rate difference.
export function createTreasuryTracker({windowMs=60000,maxGapMs=5000}={}){
  let samples=[],session=null;
  function clear(){samples=[];session=null;}
  function record(snapshot,at=Date.now()){
    if(!snapshot?.sections?.session?.data?.loaded||!Number.isFinite(at)){clear();return;}
    const key=JSON.stringify([snapshot.instanceId,snapshot.sessionId]);
    if(session!==key||samples.length&&at-samples.at(-1).at>maxGapMs){clear();session=key;}
    if(samples.length&&at<=samples.at(-1).at)return;
    const balances={};
    for(const [kind,value] of Object.entries(snapshot.sections.economy?.data?.currencies||{})){
      try{balances[kind]=BigInt(value);}catch{/* An unavailable balance is not zero. */}
    }
    samples.push({at,balances});
    while(samples.length>1&&samples[0].at<at-windowMs)samples.shift();
  }
  function rate(kind){
    const first=samples.find(s=>s.balances[kind]!==undefined),last=samples.at(-1);
    if(!first||first===last||last.balances[kind]===undefined)return null;
    const seconds=(last.at-first.at)/1000,delta=last.balances[kind]-first.balances[kind];
    return {perSecond:Number(delta)/seconds,seconds,direction:delta>0n?'profit':delta<0n?'deficit':'balanced'};
  }
  return {record,rate,clear};
}
