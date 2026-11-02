import {currencyIcons} from './objective-model.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const denominations=[['gold',10000n,'Icons_8'],['silver',100n,'Icons_9'],['copper',1n,'Icons_10']];

// Gold API values are copper. Keep integer balances exact, including Int64 values.
// Round money rates to whole copper before splitting, so carries remain correct.
export function moneyParts(kind,value,{fraction=false,signed=false}={}){
  const digits=fraction&&kind!=='Gold'?3:0;
  let units,scale=10n**BigInt(digits);
  try{
    if(fraction){
      const amount=Number(value);
      if(!Number.isFinite(amount))return null;
      const [whole,decimal='0']=Math.abs(amount).toLocaleString('en-US',{useGrouping:false,minimumFractionDigits:digits,maximumFractionDigits:digits}).split('.');
      units=BigInt(whole)*scale+BigInt(decimal);
      if(amount<0)units=-units;
    }else units=BigInt(value);
  }catch{return null;}
  const sign=units<0n?'−':signed&&units>0n?'+':'';
  let remaining=units<0n?-units:units;
  const parts=[];
  for(const [name,base,icon] of kind==='Gold'?denominations:[[kind,1n,currencyIcons[kind]||'Icons_18']]){
    const divisor=base*scale,whole=remaining/divisor;
    remaining%=divisor;
    const decimal=base===1n&&digits?remaining.toString().padStart(digits,'0').replace(/0+$/,''):'';
    // Preserve all three money positions, even when Gold or Silver is zero.
    parts.push({name,icon,value:whole.toLocaleString('en-US')+(decimal?'.'+decimal:'')});
  }
  return {sign,parts,label:sign+parts.map(p=>`${p.value} ${p.name}`).join(', ')};
}

export function moneyHtml(kind,value,options={}){
  const amount=moneyParts(kind,value,options),cls=options.className||'currency-amount';
  const label=amount?amount.label+(options.perSecond?' per second':''):'Unavailable';
  return `<span class="${esc(cls)} money-display" title="${esc(kind)}" aria-label="${esc(label)}" data-money-value="${esc(value)}">${amount?`${amount.sign?`<span class="money-sign" aria-hidden="true">${amount.sign}</span>`:''}${amount.parts.map(p=>`<span class="money-coin" data-denomination="${esc(p.name)}" aria-hidden="true"><img class="item-icon" src="assets/icons/${esc(p.icon)}.png" alt="" loading="lazy"><span class="coin-value">${p.value}</span></span>`).join('')}`:'—'}${options.perSecond?'<small aria-hidden="true"> /sec</small>':''}</span>`;
}
