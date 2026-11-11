import { TradingForm } from './trading-form';
import type { Operations } from '@/lib/trading/operations-types';
import { randomUUID } from 'node:crypto';
import { outstandingAmount } from '@/lib/trading/money';

export function SampleRequestForm({offerId,version}:{offerId:string;version:number}) {
  return <details><summary>Request a physical coffee sample</summary><TradingForm operation="request_sample" label="Request physical sample">
    <input type="hidden" name="offer_id" value={offerId}/><input type="hidden" name="offer_version" value={version}/><input type="hidden" name="id" value={randomUUID()}/>
    <label>Sample quantity (g)<input name="quantity_grams" type="number" min="1" max="5000" step="0.001" defaultValue="300" required/></label>
    <p>ET Link coordinates dispatch. Sample acceptance, stock allocation and reservation are recorded separately.</p>
  </TradingForm></details>;
}

export function BusinessOperations({data,businessId,role}:{data:Operations;businessId:string;role:string}) {
  const canHandleSamples = ['owner','admin','trader'].includes(role);
  const canConfirm = ['owner','admin'].includes(role);
  return <>
    <p className="foundation-notice">ET Link coordinates physical samples and stock commitments. Accepting a sample records quality approval. Allocation, reservation and deal confirmation are separate steps. Counterparty identities and their prices stay private.</p>
    {!!data.stock.length && <section><h2>My stock balance</h2>{data.stock.map(stock => <article className="foundation-card" key={stock.id}><h3>{stock.reference}</h3><p>Declared {stock.declared_kg} kg · Allocated {stock.allocated_kg} kg · Reserved or committed {stock.reserved_kg} kg · Fulfilled {stock.fulfilled_kg} kg · Available for allocation {stock.available_kg} kg</p></article>)}</section>}
    <section><h2>Physical coffee samples</h2>{data.samples.length ? data.samples.map(sample => <article className="foundation-card" key={sample.id}>
      <h3>{sample.reference}</h3><p className="foundation-status">{sample.status} · {sample.quantity_grams} g</p>
      {sample.buyer && canHandleSamples && ['dispatched','received'].includes(sample.status) && <TradingForm operation="sample_status" label="Record sample response">
        <input type="hidden" name="id" value={sample.id}/><input type="hidden" name="revision" value={sample.revision}/>
        <label>Sample response<select name="next_status">{sample.status === 'dispatched' ? <option value="received">Received physical sample</option> : <><option value="accepted">Accept sample quality</option><option value="rejected">Reject sample quality</option></>}</select></label>
      </TradingForm>}
    </article>) : <p>No physical sample requests yet. Open an eligible private offer to request one.</p>}</section>
    <section><h2>Stock allocations and reservations</h2>{data.allocations.length ? data.allocations.map(allocation => <article className="foundation-card" key={allocation.id}>
      <h3>{allocation.reference}</h3><p>{allocation.quantity_kg} kg · Allocation {allocation.status}</p>
      <p>Reservation: {allocation.reservation_status || 'Not reserved'}{allocation.reserved_until && allocation.reservation_status === 'reserved' ? ` until ${allocation.reserved_until}` : ''}</p>
    </article>) : <p>No stock has been allocated or reserved for your business.</p>}</section>
    <section><h2>Deal lifecycle</h2>{data.deals.length ? data.deals.map(deal => <article className="foundation-card" key={deal.id}>
      <h3>{deal.reference}</h3><p className="foundation-status">{deal.status.replaceAll('_',' ')}</p><p>{deal.quantity_kg} kg · Your recorded price {deal.price} {deal.currency}/kg</p>
      {canConfirm && ((deal.status === 'draft' && !deal.terms_confirmed) || (deal.status === 'delivered' && !deal.delivery_confirmed)) && <TradingForm operation="confirm_deal" label={deal.status === 'draft' ? 'Confirm my business terms' : 'Confirm delivery for my business'}>
        <input type="hidden" name="id" value={deal.id}/><input type="hidden" name="business_id" value={businessId}/><input type="hidden" name="kind" value={deal.status === 'draft' ? 'terms' : 'delivery'}/>
        <label className="checkbox-label"><input type="checkbox" name="confirm_exact_record" required/>I am authorized to confirm the private record shown for my business.</label>
      </TradingForm>}
      {deal.status === 'draft' && deal.terms_confirmed && <p>Your business has confirmed these terms. ET Link will check both confirmations before advancing.</p>}
      {deal.delivery_confirmed && <p>Your business has confirmed delivery.</p>}
    </article>) : <p>No recorded deals yet.</p>}</section>
    <section><h2>Earned commissions and recorded payments</h2>{data.fees.length ? data.fees.map(fee => <article className="foundation-card" key={fee.id}>
      <h3>{fee.reference}</h3><p>Earned {fee.amount} {fee.currency} · Recorded paid {fee.paid} {fee.currency} · Outstanding {outstandingAmount(fee.amount,fee.paid)} {fee.currency}</p>
    </article>) : <p>No commission has reached its agreed earning milestone.</p>}</section>
  </>;
}
