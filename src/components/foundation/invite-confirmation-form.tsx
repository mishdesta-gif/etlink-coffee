'use client';

import { useRef, useState } from 'react';
import { isInviteTokenHash } from '@/lib/foundation/invite-token';

export function InviteConfirmationForm() {
  const submitted = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function confirm() {
    if (submitted.current) return;
    submitted.current = true;
    const tokens = new URLSearchParams(window.location.hash.slice(1)).getAll('token_hash');
    window.history.replaceState(null, '', window.location.pathname);
    if (tokens.length !== 1 || !isInviteTokenHash(tokens[0])) {
      setMessage('This invitation link is incomplete or invalid. Ask ET Link for a new invitation.');
      return;
    }

    setPending(true);
    try {
      const response = await fetch('/auth/invite/accept', {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        headers: { 'Content-Type': 'text/plain' },
        body: tokens[0],
      });
      if (response.status === 204) {
        window.location.replace('/auth/reset');
        return;
      }
      setMessage(response.status === 400
        ? 'This invitation is invalid, expired, or already used. Ask ET Link for a new invitation.'
        : 'We couldn’t confirm the invitation. Reopen the original email link to try again or contact ET Link.');
    } catch {
      setMessage('We couldn’t confirm the invitation. Reopen the original email link to try again or contact ET Link.');
    } finally {
      setPending(false);
    }
  }

  return <div className="foundation-form">
    <button className="button" type="button" onClick={confirm} disabled={pending || Boolean(message)}>
      {pending ? 'Confirming…' : 'Confirm invitation'}
    </button>
    <p role="status" aria-live="polite">{message}</p>
    <noscript>Enable JavaScript to confirm your invitation securely.</noscript>
  </div>;
}
