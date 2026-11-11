import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FoundationShell } from '@/components/foundation/shell';
import { AdminOperations } from '@/components/foundation/admin-operations';
import { authenticatedClient } from '@/lib/supabase/server';
import { tradingAvailable } from '@/lib/trading/config';
import type { Operations } from '@/lib/trading/operations-types';
import type { Commercial } from '@/lib/trading/types';

export default async function OperationsPage() {
  if (!tradingAvailable()) return <FoundationShell title="Marketplace operations"><p>Trading is unavailable on this deployment.</p></FoundationShell>;
  let session;
  try { session = await authenticatedClient(); } catch { redirect('/auth/login'); }
  const {db,user} = session;
  const {data:grants,error} = await db.from('staff_grants').select('permission,business_id').eq('user_id',user.id).is('revoked_at',null);
  if (error) throw new Error('Staff permissions unavailable.');
  const allowed = new Set<string>();
  for (const grant of grants || []) {
    if (!['trading.matches.manage','trading.commissions.manage'].includes(grant.permission)) continue;
    const {data,error:permissionError} = await db.rpc('has_permission',{p:grant.permission,b:grant.business_id});
    if (!permissionError && data === true) allowed.add(grant.permission);
  }
  if (!allowed.size) return <FoundationShell title="Staff access required."><p>Current operations permissions and verified MFA are required.</p><Link href="/portal/security">Verify MFA</Link></FoundationShell>;
  const [operations,commercial] = await Promise.all([db.rpc('admin_marketplace_operations'),db.rpc('admin_trading_commercial')]);
  if (operations.error || commercial.error) return <FoundationShell title="Marketplace operations"><p>Marketplace operations are unavailable. Contact ET Link.</p></FoundationShell>;
  return <FoundationShell title="Samples, stock and deals" eyebrow="ET Link operations">
    <nav className="foundation-nav"><Link href="/admin/trading">Requests, lots and private offers</Link><Link href="/portal">My workspace</Link></nav>
    <AdminOperations data={operations.data as Operations} commercial={commercial.data as Commercial} canManage={allowed.has('trading.matches.manage')} canCommission={allowed.has('trading.commissions.manage')}/>
  </FoundationShell>;
}
