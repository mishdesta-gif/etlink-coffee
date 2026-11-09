import {origins,type TradePayload,type TradeRecord} from '@/lib/trading/types';
import {TradingForm} from './trading-form';
export function QuoteFields({payload={}}:{payload?:TradePayload}){return <>
 <label>Quote origin<select name="origin" defaultValue={String(payload.origin||'Guji')}>{origins.map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Quote grade<select name="grade" defaultValue={String(payload.grade||'1')}>{['1','2','3','4','5','6','7','8','9','ungraded'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Quote process<select name="process" defaultValue={String(payload.process||'washed')}>{['washed','natural','honey','other'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Quote quantity (kg)<input name="quantity_kg" type="number" step="0.000001" min="0.000001" required defaultValue={payload.quantity_kg}/></label>
 <label>Quote price per kg<input name="price" type="number" step="0.000001" min="0.000001" required defaultValue={payload.price}/></label>
 <label>Quote currency<input name="currency" required minLength={3} maxLength={3} pattern="[A-Z]{3}" defaultValue={String(payload.currency||'USD')}/></label>
 <label>Incoterm<select name="incoterm" defaultValue={String(payload.incoterm||'to_be_agreed')}>{['to_be_agreed','EXW','FCA','FOB','CFR','CIF','DAP'].map(x=><option key={x}>{x}</option>)}</select></label>
 </>;}
export function RecordFields({domain,businessId,id,record}:{domain:'request'|'lot';businessId:string;id:string;record?:TradeRecord}){
 const p=record?.payload||{};return <TradingForm operation="save" label={record?'Save revised details':'Save private record'}>
 <input type="hidden" name="domain" value={domain}/><input type="hidden" name="business_id" value={businessId}/><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={record?.revision||0}/>
 <label>Origin<input name="origin" required minLength={2} maxLength={160} defaultValue={p.origin}/></label>
 <label>Grade<input name="grade" required maxLength={80} defaultValue={p.grade}/></label>
 <label>Process<select name="process" defaultValue={String(p.process||'washed')}>{['washed','natural','honey','other'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Quantity<input name="quantity" type="number" min="0.000001" step="0.000001" required defaultValue={p.quantity}/></label>
 <label>Quantity unit<select name="unit" defaultValue={String(p.unit||'kg')}>{['kg','feresula','lb'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>{domain==='lot'?'Private asking price':'Indicative target price (optional)'}<input name="price" type="number" min="0.000001" step="0.000001" required={domain==='lot'} defaultValue={p.price}/></label>
 <label>Currency<input name="currency" required pattern="[A-Z]{3}" minLength={3} maxLength={3} defaultValue={String(p.currency||'USD')}/></label>
 <label>Price unit<select name="price_unit" defaultValue={String(p.price_unit||'kg')}>{['kg','feresula','lb'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Trade type<select name="trade_type" defaultValue={String(p.trade_type||'international')}><option value="international">International</option><option value="domestic">Domestic</option><option value="exporter_to_exporter">Exporter-to-exporter — progression blocked</option></select></label>
 <label>Proposed delivery term<select name="incoterm" defaultValue={String(p.incoterm||'to_be_agreed')}>{['to_be_agreed','EXW','FCA','FOB','CFR','CIF','DAP'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>{domain==='request'?'Destination / port':'Location / warehouse'}<input name={domain==='request'?'destination':'location'} required maxLength={1000} defaultValue={domain==='request'?p.destination:p.location}/></label><input type="hidden" name={domain==='request'?'location':'destination'} value=""/>
 <label>Window start<input name="window_start" type="date" required defaultValue={p.window_start}/></label><label>Window end<input name="window_end" type="date" required defaultValue={p.window_end}/></label>
 <label>Quality specifications / moisture<textarea name="specifications" maxLength={1000} defaultValue={p.specifications}/></label><label>Packaging<textarea name="packaging" maxLength={1000} defaultValue={p.packaging}/></label><label>Sample requirements<textarea name="sample_requirements" maxLength={1000} defaultValue={p.sample_requirements}/></label><label>Document requirements<textarea name="document_requirements" maxLength={1000} defaultValue={p.document_requirements}/></label>
 <label>Save as<select name="status" defaultValue="submitted"><option value="submitted">Submit for ET Link review</option>{!record||['draft','submitted'].includes(record.status)?<option value="draft">Private draft</option>:null}<option value="withdrawn" disabled={!record}>Withdraw</option></select></label><p>Edits resubmit reviewed records. Quotes are not stock reservations; identities remain private. Email is disabled.</p>
 </TradingForm>;
}
