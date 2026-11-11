import type {TradeRecord} from './types';
const kgPerUnit:Record<string,number>={kg:1,feresula:17,lb:1/2.2046226218};
function validWindow(payload: TradeRecord['payload']) {
 const dates = [payload.window_start, payload.window_end];
 return dates.every(value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
 }) && String(dates[0]) <= String(dates[1]);
}
export function assessCandidate(request:TradeRecord,lot:TradeRecord,now=Date.now()){
 const r=request.payload,l=lot.payload;const reasons:string[]=[];const warnings:string[]=[];
 if(request.status!=='qualified')reasons.push('Request is not qualified');if(lot.status!=='approved')reasons.push('Lot is not approved');
 if(request.business_id===lot.business_id)reasons.push('Same-business matching is blocked');
 if(!request.business_id||!lot.business_id)reasons.push('Business identity is missing');
 if(['origin','grade','process','trade_type'].some(key => !String(r[key] ?? '').trim() || !String(l[key] ?? '').trim()))reasons.push('Required coffee specifications are missing');
 for(const k of ['origin','grade','process','trade_type'])if(String(r[k]).trim().toLowerCase()!==String(l[k]).trim().toLowerCase())reasons.push(`${k.replaceAll('_',' ')} differs`);
 if(r.trade_type==='exporter_to_exporter'||l.trade_type==='exporter_to_exporter')reasons.push('Transaction-specific legal clearance is unavailable');
 const requested=Number(r.quantity_kg),available=Number(l.quantity_kg);
 if(!Number.isFinite(requested)||!Number.isFinite(available)||requested<=0||available<=0)reasons.push('A valid positive quantity is required');
 else if(requested>available)reasons.push('Declared lot quantity is insufficient');
 if(!validWindow(r)||!validWindow(l))reasons.push('A valid availability window is required');
 if(String(r.window_end)<String(l.window_start)||String(l.window_end)<String(r.window_start))reasons.push('Dates do not overlap');
 if(Date.parse(String(r.window_end)+'T23:59:59Z')<now||Date.parse(String(l.window_end)+'T23:59:59Z')<now)reasons.push('Availability window expired');
 if(r.price&&l.price){if(!Number.isFinite(Number(r.price))||!Number.isFinite(Number(l.price))||Number(r.price)<=0||Number(l.price)<=0||!Object.hasOwn(kgPerUnit,String(r.price_unit))||!Object.hasOwn(kgPerUnit,String(l.price_unit)))warnings.push('Price compatibility requires valid prices and units for staff review');else if(r.currency!==l.currency)warnings.push('Different currencies: no automatic FX comparison');else{const target=Number(r.price)/kgPerUnit[String(r.price_unit)],asking=Number(l.price)/kgPerUnit[String(l.price_unit)];if(asking>target)warnings.push('Asking price exceeds indicative target; staff negotiation required');else warnings.push('Private indicative target covers asking price after unit normalization');}}
 else warnings.push('Price compatibility requires staff review');
 return {compatible:reasons.length===0,reasons,warnings};
}
