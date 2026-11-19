import Link from 'next/link';
import {redirect} from 'next/navigation';
import {authenticatedClient} from '@/lib/supabase/server';
import {FoundationShell} from '@/components/foundation/shell';
import {tradingAvailable} from '@/lib/trading/config';

export default async function PlatformSettings() {
  let session;
  try { session=await authenticatedClient(); } catch { redirect('/auth/login'); }
  const {data,error}=await session.db.rpc('has_permission',{p:'staff.manage',b:null});
  if(error||data!==true)return <FoundationShell title="Staff access required."><p>Current staff-management permission and verified MFA are required.</p></FoundationShell>;
  const settings=[
    ['Marketplace workflows',tradingAvailable()?'Enabled for the configured deployment':'Disabled by release control — no live trading'],
    ['Optional notifications',process.env.ETLINK_NOTIFICATIONS_ENABLED==='true'?'Enabled':'Disabled'],
    ['Optional external email delivery',process.env.ETLINK_TRANSACTIONAL_EMAIL_SEND_APPROVED==='true'?'Enabled':'Disabled'],
    ['Confidentiality','Private party-specific offers; manual ET Link matching'],
    ['Commission policy','Supplier-only 0.5%–2%; 30% first supplier payment, 70% after export and final payment'],
  ];
  return <FoundationShell title="Platform settings" eyebrow="ET Link administration"><p>Read-only operational settings. Changes to hosting, credentials, authentication and release access require a separately authorized operation.</p><p>Marketplace workflows require separate deployment activation and operational staff permissions. Staff management alone does not authorize business verification, inventory, matching or commissions.</p><dl className="foundation-card">{settings.map(([name,value])=><div key={name}><dt><strong>{name}</strong></dt><dd>{value}</dd></div>)}</dl><p>No credentials or private configuration values are displayed.</p><Link href="/admin/staff">Manage authorized staff</Link></FoundationShell>;
}
