import type {TradeRecord} from './types';
const kgPerUnit:Record<string,number>={kg:1,feresula:17,lb:1/2.2046226218};
export function assessCandidate(request:TradeRecord,lot:TradeRecord,now=Date.now()){
 const r=request.payload,l=lot.payload;const reasons:string[]=[];const warnings:string[]=[];
 if(request.status!=='qualified')reasons.push('Request is not qualified');if(lot.status!=='approved')reasons.push('Lot is not approved');
 if(request.business_id===lot.business_id)reasons.push('Same-business matching is blocked');
 for(const k of ['origin','grade','process','trade_type'])if(String(r[k]).trim().toLowerCase()!==String(l[k]).trim().toLowerCase())reasons.push(`${k.replaceAll('_',' ')} differs`);
 if(r.trade_type==='exporter_to_exporter'||l.trade_type==='exporter_to_exporter')reasons.push('Transaction-specific legal clearance is unavailable');
 if(Number(r.quantity_kg)>Number(l.quantity_kg))reasons.push('Declared lot quantity is insufficient');
 if(String(r.window_end)<String(l.window_start)||String(l.window_end)<String(r.window_start))reasons.push('Dates do not overlap');
 if(Date.parse(String(r.window_end)+'T23:59:59Z')<now||Date.parse(String(l.window_end)+'T23:59:59Z')<now)reasons.push('Availability window expired');
 if(r.price&&l.price){if(r.currency!==l.currency)warnings.push('Different currencies: no automatic FX comparison');else{const target=Number(r.price)/kgPerUnit[String(r.price_unit)],asking=Number(l.price)/kgPerUnit[String(l.price_unit)];if(asking>target)warnings.push('Asking price exceeds indicative target; staff negotiation required');else warnings.push('Private indicative target covers asking price after unit normalization');}}
 else warnings.push('Price compatibility requires staff review');
 return {compatible:reasons.length===0,reasons,warnings};
}
