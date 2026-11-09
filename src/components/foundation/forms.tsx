'use client';
import { useActionState,useEffect,useRef } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { mutate,sendInquiry } from '@/app/portal/actions';
import { initialState,businessKinds,permissions,teamRoles } from '@/lib/foundation/validation';

export function MutationForm({operation,children,label='Save changes',disabled=false}:{operation:string;children:ReactNode;label?:string;disabled?:boolean}) {
  const [state,action,pending]=useActionState(mutate,initialState);
  return <form action={action} className="foundation-form"><input type="hidden" name="operation" value={operation}/>{children}<button className="button" disabled={pending||disabled}>{pending?'Saving…':label}</button><p role="status" aria-live="polite">{state.message}</p>{state.link && <p><Link href={state.link} className="text-link">{operation==='invite'?'Private invitation link — copy now':'Continue to workspace ↗'}</Link>{operation==='invite'&&<input aria-label="Copy private invitation link" readOnly value={state.link} onFocus={e=>e.target.select()}/>}</p>}</form>;
}
export function BusinessForm() {
  return <MutationForm operation="business" label="Submit business application"><label>Business name<input name="business_name" required minLength={2} maxLength={160} autoComplete="organization"/></label><label>Country<input name="country" required minLength={2} maxLength={80} autoComplete="country-name"/></label><label>Registration path<select name="kind">{businessKinds.map(k=><option key={k} value={k}>{k.replaceAll('_',' ')}</option>)}</select></label><label>Initial capability<select name="capability"><option value="buyer">Buyer</option><option value="supplier">Supplier</option></select></label><label>Business background and review information<textarea name="details" required minLength={10} maxLength={4000}/></label><p>For Ethiopian registration paths, enter Ethiopia as the country. Exporter-to-exporter activity stays blocked until transaction-specific legal clearance. You can apply for the other capability from your workspace.</p></MutationForm>;
}
export function InvitationForm({businessId}:{businessId?:string}) {
  return <MutationForm operation="invite" label="Create private invitation"><input type="hidden" name="business_id" value={businessId||''}/><label>Invitee email<input type="email" name="email" required maxLength={254}/></label>{businessId?<label>Team role<select name="role">{teamRoles.map(r=><option key={r}>{r}</option>)}</select></label>:<fieldset><legend>Explicit staff permissions</legend>{permissions.map(p=><label className="checkbox-label" key={p}><input type="checkbox" name="permissions" value={p}/>{p}</label>)}</fieldset>}<p>Staff must confirm their email and verify MFA before accepting a staff invitation. No invitation is emailed automatically.</p></MutationForm>;
}
export function AcceptInvitation() {
  const ref=useRef<HTMLInputElement>(null);
  useEffect(()=>{const value=new URLSearchParams(window.location.hash.slice(1)).get('token');if(ref.current&&value)ref.current.value=value;window.history.replaceState(null,'',window.location.pathname);},[]);
  return <MutationForm operation="accept" label="Accept invitation"><label>Invitation token<input ref={ref} name="token" required minLength={64} maxLength={64} autoComplete="off"/></label><p>Sign in with the email address on the invitation. Staff invitations require MFA first.</p></MutationForm>;
}
export function InquiryForm({enabled}:{enabled:boolean}) {
  const [state,action,pending]=useActionState(sendInquiry,initialState);
  return <div className="inquiry-form foundation-card"><h2>Send a private inquiry.</h2><p>Keep confidential identity documents out of this first message. Submitting does not approve a business or reserve coffee.</p><form action={action} className="foundation-form"><label>Inquiry type<select name="category"><option value="buyer">Buyer sourcing</option><option value="supplier">Supplier onboarding</option><option value="exporter_to_exporter">Exporter-to-exporter — eligibility review required</option><option value="general">General inquiry</option></select></label><label>Your name<input name="name" required minLength={2} maxLength={100} autoComplete="name"/></label><label>Email address<input name="email" type="email" required maxLength={254} autoComplete="email"/></label><label>Business name<input name="business_name" required minLength={2} maxLength={160} autoComplete="organization"/></label><label>Country<input name="country" required minLength={2} maxLength={80} autoComplete="country-name"/></label><label>Your message<textarea name="message" required minLength={20} maxLength={4000}/></label><label className="honeypot" aria-hidden="true">Leave this field empty<input name="website" tabIndex={-1} autoComplete="off"/></label><button className="button" disabled={!enabled||pending}>{pending?'Submitting…':'Send inquiry'}</button><p role="status" aria-live="polite">{state.message || (!enabled?'Online inquiry intake awaits configuration. Please use the email, phone or WhatsApp links above.':'Your inquiry is stored privately for ET Link review. No automated external message is sent.')}</p></form></div>;
}
