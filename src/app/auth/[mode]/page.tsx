import { notFound } from 'next/navigation';
import { FoundationShell,NotConfigured } from '@/components/foundation/shell';
import { AuthForm } from '@/components/foundation/auth-form';
import { configured } from '@/lib/supabase/server';
export const metadata = { title:'Your ET Link account',robots:{index:false,follow:false} };
export default async function AuthPage({ params,searchParams }: { params:Promise<{mode:string}>;searchParams:Promise<{notice?:string}> }) {
  const { mode } = await params;
  if (mode!=='login' && mode!=='register' && mode!=='forgot' && mode!=='reset') notFound();
  const enabled = configured();
  const {notice}=await searchParams;
  const warning=mode==='login' ? notice==='signout-incomplete'
    ? 'Sign-out could not be completed for all sessions. Close this browser on shared devices. Sign in again and retry signing out; contact ET Link if this continues.'
    : notice==='invalid-link' ? 'This account link is invalid, expired or already used. Request a new link and open it in the same browser where you started.' : null : null;
  return <FoundationShell title={{login:'Welcome back.',register:'Your connection starts here.',forgot:'Recover your account.',reset:'Choose a new password.'}[mode]} eyebrow="ET Link accounts">{!enabled && <NotConfigured/>}{warning&&<aside className="foundation-notice" role="alert">{warning}</aside>}<div className="foundation-card"><AuthForm mode={mode} enabled={enabled}/></div></FoundationShell>;
}
