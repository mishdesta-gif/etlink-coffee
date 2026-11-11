import { FoundationShell,NotConfigured } from '@/components/foundation/shell';
import { MfaForm } from '@/components/foundation/auth-form';
import { configured } from '@/lib/supabase/server';
import { workspace } from '@/lib/foundation/workspace';
export default async function Security() {
  if (!configured()) return <FoundationShell title="Account security."><NotConfigured/></FoundationShell>;
  const { db, user } = await workspace();
  let status = 'Unable to verify MFA status for this session.';
  try {
    const { data, error } = await db.auth.getClaims();
    if (!error && data?.claims.sub === user.id) {
      if (data.claims.aal === 'aal2') status = 'MFA verified.';
      if (data.claims.aal === 'aal1') status = 'MFA is unverified for this session.';
    }
  } catch {
    // Keep the status unavailable if Auth cannot verify the current claims.
  }
  return <FoundationShell title="Account security.">
    <p role="status">{status}</p>
    <MfaForm/>
  </FoundationShell>;
}
