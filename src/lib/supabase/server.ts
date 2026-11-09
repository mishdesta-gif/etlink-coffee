import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function configured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && process.env.ETLINK_APP_URL);
}
export function appUrl() {
  const url = new URL(process.env.ETLINK_APP_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(url.protocol) || (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Configure an HTTPS application URL.');
  return url.origin;
}
export async function serverClient() {
  if (!configured()) throw new Error('Account services are not configured. Please contact ET Link.');
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: appUrl().startsWith('https://'), path: '/' },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Server Components are read-only; proxy refreshes sessions before rendering. */ }
      },
    },
  });
}
export async function authenticatedClient() {
  const db = await serverClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user || !user.email_confirmed_at) throw new Error('Please sign in with a confirmed email address.');
  return { db, user };
}
