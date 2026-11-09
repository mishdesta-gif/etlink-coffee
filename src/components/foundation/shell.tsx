import Link from 'next/link';
import {tradingAvailable} from '@/lib/trading/config';
import type { ReactNode } from 'react';
import './foundation.css';

export function FoundationShell({ title,eyebrow='Private workspace',children }: { title:string;eyebrow?:string;children:ReactNode }) {
  return <section className="foundation"><div className="container"><div className="foundation-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>Ethiopian Coffee. Connected Globally.</p></div><nav className="foundation-nav" aria-label="Account navigation"><Link href="/portal">My workspace</Link><Link href="/portal/register-business">Register a business</Link><Link href="/portal/security">Security</Link><Link href="/portal/invitations">Accept invitation</Link><Link href="/admin">Staff workspace</Link>{tradingAvailable()&&<Link href="/admin/trading">Trading administration</Link>}</nav>{children}</div></section>;
}
export function NotConfigured() {
  return <aside className="foundation-notice" role="status"><strong>Account services await configuration.</strong><p>The public website is available. Account creation, uploads and inquiry submissions will be enabled after the development Supabase connection is configured. For now, contact <a href="mailto:etlinkcoffee@gmail.com">etlinkcoffee@gmail.com</a>.</p></aside>;
}
