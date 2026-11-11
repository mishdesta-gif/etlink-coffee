import { InviteConfirmationForm } from '@/components/foundation/invite-confirmation-form';
import { FoundationShell, NotConfigured } from '@/components/foundation/shell';
import { configured } from '@/lib/supabase/server';

export const metadata = { title: 'Confirm your ET Link invitation', robots: { index: false, follow: false } };

export default function InviteConfirmationPage() {
  return <FoundationShell title="Confirm your account invitation." eyebrow="ET Link accounts">
    {configured() ? <div className="foundation-card">
      <p>Confirm only if you expected this invitation. You’ll then choose a password for your ET Link account.</p>
      <InviteConfirmationForm/>
    </div> : <NotConfigured/>}
  </FoundationShell>;
}
