'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useActionState } from 'react';
import { authenticate, mfa } from '@/app/auth/actions';
import { initialState } from '@/lib/foundation/validation';

export function AuthForm({ mode, enabled }: { mode:'login'|'register'|'forgot'|'reset';enabled:boolean }) {
  const [state,action,pending] = useActionState(authenticate,initialState);
  const title = {login:'Sign in',register:'Create account',forgot:'Send recovery email',reset:'Set new password'}[mode];
  const passwordSaved = mode === 'reset' && state.ok;
  return <form action={action} className="foundation-form"><input type="hidden" name="mode" value={mode}/>
    {mode !== 'reset' && <label>Email address<input name="email" type="email" required autoComplete="email" maxLength={254}/></label>}
    {mode !== 'forgot' && !passwordSaved && <label>{mode === 'reset' ? 'New password' : 'Password'}<input name="password" type="password" required minLength={mode === 'login' ? 1 : 12} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/></label>}
    {mode === 'register' && <p>Use at least 12 characters. Confirm your email before registering a business. Buyer and supplier approval are reviewed independently.</p>}
    {!passwordSaved && <button className="button" disabled={pending || !enabled}>{pending ? 'Please wait…' : title}</button>}
    <p role="status" aria-live="polite">{state.message}</p>
    <div className="foundation-links"><Link href="/auth/login">Sign in</Link><Link href="/auth/register">Create account</Link><Link href="/auth/forgot">Forgot password?</Link></div>
  </form>;
}
export function MfaForm() {
  const [setup, enroll, enrolling] = useActionState(mfa,initialState);
  const [result, verify, verifying] = useActionState(mfa,initialState);
  return <div className="foundation-card"><h2>Staff security</h2><p>Every staff permission requires an authenticator and an MFA-verified session. If you have already scanned your setup code, enter your authenticator’s current six-digit code below.</p>
    <form action={enroll}><input type="hidden" name="operation" value="enroll"/><button className="button" disabled={enrolling}>Set up authenticator</button></form>
    {setup.qr && <div className="mfa-qr">{/* Authenticator QR is a trusted Supabase SVG encoded as an image, never inserted as markup. */}
      <Image unoptimized src={setup.qr} width={220} height={220} alt="Scan this QR code using your authenticator app"/></div>}
    <p role="status">{setup.message}</p><form action={verify} className="foundation-form"><input type="hidden" name="operation" value="verify"/><input type="hidden" name="factorId" value={setup.factorId || ''}/><label>Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required minLength={6} maxLength={6}/></label><button className="button" disabled={verifying}>Verify MFA</button><p role="status">{result.message}</p></form><Link className="text-link" href="/admin">Open staff workspace ↗</Link>
  </div>;
}
