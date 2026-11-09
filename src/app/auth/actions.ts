'use server';

import { redirect } from 'next/navigation';
import { assertAuthProviderReady,assertStagingAuthEmail } from '@/lib/foundation/ingress-policy';
import { serverClient, authenticatedClient, appUrl } from '@/lib/supabase/server';
import { field, email, password, choice, SafeActionError, safeActionMessage, type ActionState } from '@/lib/foundation/validation';

export async function authenticate(_state: ActionState, form: FormData): Promise<ActionState> {
  let next = false;
  let passwordUpdated = false;
  try {
    const mode = choice(field(form,'mode'), ['login','register','forgot','reset'] as const);
    const db = await serverClient();
    // Native Supabase Auth limits protect the actual provider endpoints, not a bypassable SQL guard.
    assertAuthProviderReady({appUrl:process.env.ETLINK_APP_URL,supabaseUrl:process.env.NEXT_PUBLIC_SUPABASE_URL,
      synthetic:process.env.ETLINK_SYNTHETIC_TEST_MODE,authProtectionReviewed:process.env.ETLINK_AUTH_PROVIDER_PROTECTION_REVIEWED});
    if (mode === 'reset') {
      await authenticatedClient();
      const { error } = await db.auth.updateUser({ password: password(form.get('password')) });
      if (error) return { ok:false, message:'Password could not be changed. Request a new recovery email and try again.' };
      passwordUpdated = true;
      const { error: signOutError } = await db.auth.signOut({ scope: 'global' });
      if (signOutError) return { ok:false, message:'Password updated, but other sessions could not be signed out. Sign in again and retry signing out. Contact ET Link if this continues.' };
      return { ok:true, message:'Password updated. Sign in again with your new password.' };
    }
    const addressEmail = email(field(form,'email',3,254));
    assertStagingAuthEmail(mode,addressEmail,process.env.ETLINK_STAGING_VALIDATION==='true',process.env.ETLINK_AUTH_EMAIL_ALLOWED_RECIPIENT);
    if (mode === 'forgot') {
      await db.auth.resetPasswordForEmail(addressEmail, { redirectTo: `${appUrl()}/auth/callback?next=reset` });
      return { ok:true, message:'If this address is registered, a recovery email will arrive. Check your inbox and spam folder.' };
    }
    if (mode === 'register') {
      const { data,error } = await db.auth.signUp({ email: addressEmail, password: password(form.get('password')), options: { emailRedirectTo: `${appUrl()}/auth/callback` } });
      if (error) return { ok:false, message:'Registration could not be completed. Try again later or contact ET Link.' };
      // With confirmation enabled there is no session. Preserve the PKCE verifier cookie.
      if(data.session) {
        await db.auth.signOut();
        return {ok:false,message:'Email confirmation must be enabled by the platform administrator before registration can continue.'};
      }
      return { ok:true, message:'Check your email to confirm your account, then sign in and register your business. If you already have an account, sign in.' };
    }
    const raw = form.get('password');
    if (typeof raw !== 'string' || raw.length < 1 || raw.length > 128) throw new SafeActionError('Enter your password.');
    const { data, error } = await db.auth.signInWithPassword({ email:addressEmail,password:raw });
    if (error || !data.user.email_confirmed_at) return { ok:false, message:'Unable to sign in. Check your credentials and email confirmation.' };
    next = true;
  } catch (e) { return { ok:false, message: safeActionMessage(e,passwordUpdated
    ? 'Password updated, but other sessions could not be signed out. Sign in again and retry signing out. Contact ET Link if this continues.'
    : 'Account service unavailable. Please try later.','authentication') }; }
  if (next) redirect('/portal');
  return { ok:false, message:'Please try again.' };
}
export async function signOut() {
  let incomplete = false;
  try {
    const db = await serverClient();
    const { error } = await db.auth.signOut({ scope:'global' });
    incomplete = Boolean(error);
  } catch { incomplete = true; }
  redirect(incomplete ? '/auth/login?notice=signout-incomplete' : '/auth/login');
}
export async function mfa(_state: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { db } = await authenticatedClient();
    if (form.get('operation') === 'enroll') {
      const { data, error } = await db.auth.mfa.enroll({ factorType:'totp',friendlyName:'ET Link authenticator' });
      if (error) return { ok:false, message:'Could not enroll. Remove an unused factor in your account provider or try your existing authenticator.' };
      const svg=data.totp.qr_code.replace(/^data:image\/svg\+xml;utf-8,/, '');
      return { ok:true, message:'Scan with your authenticator, then enter its six-digit code below.',qr:`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,factorId:data.id };
    }
    const { data: factors, error: factorError } = await db.auth.mfa.listFactors();
    if (factorError) return { ok:false,message:'Unable to load authenticator.' };
    const factorId = String(form.get('factorId') || factors.totp[0]?.id || factors.all.find(f=>f.factor_type==='totp')?.id || '');
    if (!factors.all.some(f => f.id === factorId && f.factor_type === 'totp')) return { ok:false,message:'Set up an authenticator first.' };
    const code = field(form,'code',6,6);
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit authenticator code.');
    const { error } = await db.auth.mfa.challengeAndVerify({ factorId,code });
    return error ? { ok:false,message:'Code could not be verified. Try a new code.' } : { ok:true,message:'MFA verified. Open the staff workspace to continue.' };
  } catch { return { ok:false,message:'Sign in to set up or verify your authenticator.' }; }
}
