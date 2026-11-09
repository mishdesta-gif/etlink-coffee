import { FoundationShell } from '@/components/foundation/shell';
import { appUrl } from '@/lib/supabase/server';
import { recoveryDestination } from '@/lib/foundation/recovery-confirmation';
import { RecoveryConfirmationForm } from '@/components/foundation/recovery-confirmation-form';

export const dynamic = 'force-dynamic';
export const metadata = { title:'Confirm password recovery',robots:{index:false,follow:false} };

export default async function RecoveryConfirmation({searchParams}:{searchParams:Promise<{confirmation_url?:string|string[]}>}) {
  const {confirmation_url} = await searchParams;
  let destination: string | null = null;
  try { destination = recoveryDestination(confirmation_url,process.env.NEXT_PUBLIC_SUPABASE_URL || '',appUrl(),process.env.ETLINK_SYNTHETIC_TEST_MODE === 'true'); } catch { /* Never echo credentials or provider errors. */ }
  return <FoundationShell title="Confirm password recovery." eyebrow="ET Link accounts"><div className="foundation-card">
    {destination ? <><p>Continue only if you requested a password reset. Keep this window open in the browser where you started recovery.</p>
      <RecoveryConfirmationForm destination={destination}/></> : <aside className="foundation-notice" role="alert">This recovery confirmation is invalid. Request a new recovery email.</aside>}
  </div></FoundationShell>;
}
