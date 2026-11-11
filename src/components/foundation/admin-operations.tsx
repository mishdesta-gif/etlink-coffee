import { randomUUID } from 'node:crypto';
import { TradingForm } from './trading-form';
import type { Operations } from '@/lib/trading/operations-types';
import type { Commercial } from '@/lib/trading/types';
import { outstandingAmount } from '@/lib/trading/money';

export function AdminOperations({data,commercial,canManage,canCommission}:{data:Operations;commercial:Commercial;canManage:boolean;canCommission:boolean}) {
  const actions:Record<string,string[]> = {draft:['confirmed','cancelled'],confirmed:['contract_signed','cancelled'],contract_signed:['in_transit'],in_transit:['delivered'],delivered:['completed']};
  return <>
    <p className="foundation-notice">Route samples and communications through ET Link. Planning allocations and timed reservations are explicit operations. Signed contracts commit reserved stock. Record external evidence privately at each milestone.</p>
    {canManage && <>
      <section><h2>Stock availability ledger</h2>{data.stock.map(stock => <article className="foundation-card" key={stock.id}><h3>{stock.reference}</h3><p>Declared {stock.declared_kg} kg · Allocated {stock.allocated_kg} kg · Reserved or committed {stock.reserved_kg} kg · Fulfilled {stock.fulfilled_kg} kg · Available for allocation {stock.available_kg} kg</p></article>)}</section>
      <section><h2>Physical sample tracking</h2>{data.samples.map(sample => <article className="foundation-card" key={sample.id}>
        <h3>{sample.reference}</h3><p className="foundation-status">{sample.status} · Revision {sample.revision} · {sample.quantity_grams} g</p>
        {sample.carrier && <p>Private dispatch evidence: {sample.carrier} · {sample.tracking_reference}</p>}
        {['requested','dispatched'].includes(sample.status) && <TradingForm operation="sample_status" label="Record sample logistics">
          <input type="hidden" name="id" value={sample.id}/><input type="hidden" name="revision" value={sample.revision}/>
          <label>Logistics step<select name="next_status">{sample.status === 'requested' && <option value="dispatched">Dispatched through ET Link</option>}<option value="cancelled">Cancel sample request</option></select></label>
          <label>Private carrier<input name="carrier" maxLength={100}/></label><label>Private tracking reference<input name="tracking" maxLength={120}/></label>
        </TradingForm>}
        {sample.status === 'accepted' && <TradingForm operation="allocate_stock" label="Allocate stock separately">
          <input type="hidden" name="id" value={randomUUID()}/><input type="hidden" name="match_id" value={sample.match_id}/><input type="hidden" name="sample_id" value={sample.id}/>
          <label>Allocation quantity (kg)<input name="quantity_kg" type="number" min="0.000001" step="0.000001" required/></label>
        </TradingForm>}
      </article>)}{!data.samples.length && <p>No samples requested.</p>}</section>
      <section><h2>Separate stock allocations</h2>{data.allocations.map(allocation => <article className="foundation-card" key={allocation.id}>
        <h3>{allocation.reference}</h3><p>{allocation.status} · {allocation.quantity_kg} kg allocated · {allocation.reserved_kg || 0} kg under active reservation</p>
        {allocation.status === 'allocated' && <>
          <TradingForm operation="reserve_stock" label="Create timed reservation"><input type="hidden" name="id" value={randomUUID()}/><input type="hidden" name="allocation_id" value={allocation.id}/><label>Reserve until (UTC)<input name="expires_at" type="date" required/></label></TradingForm>
          <TradingForm operation="release_stock" label="Release allocation"><input type="hidden" name="domain" value="allocation"/><input type="hidden" name="id" value={allocation.id}/><input type="hidden" name="revision" value={allocation.revision}/></TradingForm>
        </>}
      </article>)}</section>
      <section><h2>Timed stock reservations</h2>{data.reservations?.map(reservation => {
        const allocation = data.allocations.find(row => row.id === reservation.allocation_id);
        const match = commercial.matches?.find(row => row.id === allocation?.match_id);
        const quotes = commercial.offers.filter(offer => offer.match_id === match?.id && !commercial.offers.some(other => other.id === offer.id && other.version > offer.version));
        return <article className="foundation-card" key={reservation.id}><h3>{reservation.reference}</h3><p>{reservation.status}{reservation.status === 'reserved' ? ` · ${reservation.expired ? 'Expired' : 'Until'} ${reservation.expires_at}` : ''}</p>
          {reservation.status === 'reserved' && <TradingForm operation="release_stock" label="Release reservation"><input type="hidden" name="domain" value="reservation"/><input type="hidden" name="id" value={reservation.id}/><input type="hidden" name="revision" value={reservation.revision}/></TradingForm>}
          {reservation.status === 'reserved' && !reservation.expired && !data.deals.some(deal => deal.reservation_id === reservation.id) && <TradingForm operation="create_deal" label="Create private deal record">
            <input type="hidden" name="id" value={randomUUID()}/><input type="hidden" name="reservation_id" value={reservation.id}/>
            <label>Buyer private quote<select name="buyer_quote" required><option value="">Choose current quote</option>{quotes.filter(offer => offer.business_id === match?.buyer_business_id).map(offer => <option value={`${offer.id}:${offer.version}`} key={offer.id}>{offer.reference} · Version {offer.version}</option>)}</select></label>
            <label>Supplier private quote<select name="supplier_quote" required><option value="">Choose current quote</option>{quotes.filter(offer => offer.business_id === match?.supplier_business_id).map(offer => <option value={`${offer.id}:${offer.version}`} key={offer.id}>{offer.reference} · Version {offer.version}</option>)}</select></label>
          </TradingForm>}
        </article>;
      })}</section>
      <section><h2>Deal lifecycle management</h2>{data.deals.map(deal => <article className="foundation-card" key={deal.id}>
        <h3>{deal.reference}</h3><p className="foundation-status">{deal.status.replaceAll('_',' ')} · Revision {deal.revision}</p><p>Buyer terms confirmed: {deal.buyer_confirmed ? 'Yes' : 'No'} · Supplier terms confirmed: {deal.supplier_confirmed ? 'Yes' : 'No'}</p>
        {deal.contract_reference && <p>Private contract evidence: {deal.contract_reference}</p>}{deal.delivery_reference && <p>Private delivery evidence: {deal.delivery_reference}</p>}
        {actions[deal.status] && <TradingForm operation="advance_deal" label="Record deal milestone"><input type="hidden" name="id" value={deal.id}/><input type="hidden" name="revision" value={deal.revision}/>
          <label>Next milestone<select name="next_status">{actions[deal.status].map(status => <option key={status} value={status}>{status.replaceAll('_',' ')}</option>)}</select></label>
          <label>Private evidence reference<input name="evidence" maxLength={120}/></label>
        </TradingForm>}
      </article>)}</section>
    </>}
    {canCommission && <section><h2>Commission receivables</h2>{data.fees.map(fee => <article className="foundation-card" key={fee.id}>
      <h3>{fee.reference}</h3><p>Earned {fee.amount} {fee.currency} · Paid {fee.paid} · Outstanding {outstandingAmount(fee.amount,fee.paid)}</p>
      {outstandingAmount(fee.amount,fee.paid) !== '0' && <TradingForm operation="commission_receipt" label="Record received commission payment"><input type="hidden" name="id" value={randomUUID()}/><input type="hidden" name="receivable_id" value={fee.id}/>
        <label>Received amount ({fee.currency})<input name="amount" type="number" min="0.000001" step="0.000001" max={outstandingAmount(fee.amount,fee.paid)} required/></label>
        <label>External payment reference<input name="payment_reference" minLength={3} maxLength={120} required/></label>
        <p>Record an externally received payment. This operation does not transfer funds.</p>
      </TradingForm>}
    </article>)}{!data.fees.length && <p>No commission has reached its agreed earning milestone.</p>}</section>}
    {canManage && <details className="foundation-card"><summary>Append-only operations history</summary><ol>{data.history?.map(event => <li key={event.id}>{event.entity} · Revision {event.revision} · {event.status} · {event.created_at}</li>)}</ol></details>}
  </>;
}
