'use client';
import { useState, type FormEvent } from 'react';

export function RecoveryConfirmationForm({destination}:{destination:string}) {
  const [pending,setPending] = useState(false), [message,setMessage] = useState('');
  async function continueRecovery(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);setMessage('');
    try {
      // fetch sends an Origin header even under no-referrer. Never fetch the provider URL.
      const response = await fetch('/auth/recovery/continue',{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams({confirmation_url:destination})});
      if (!response.ok) throw new Error('Confirmation denied');
      const result = await response.json();
      if (typeof result.destination !== 'string') throw new Error('Confirmation denied');
      window.location.assign(result.destination);
    } catch {
      setMessage('Recovery could not continue. Request a new recovery email or contact ET Link.');setPending(false);
    }
  }
  return <form action="/auth/recovery/continue" method="post" onSubmit={continueRecovery} className="foundation-form">
    <input type="hidden" name="confirmation_url" value={destination}/>
    <button className="button" type="submit" disabled={pending}>{pending?'Please wait…':'Continue password recovery'}</button>
    <p role="status" aria-live="polite">{message}</p>
    <noscript>Enable JavaScript to securely continue password recovery.</noscript>
  </form>;
}
