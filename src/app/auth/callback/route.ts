import { NextResponse } from 'next/server';
import { serverClient, appUrl } from '@/lib/supabase/server';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (code) {
    try {
      const db = await serverClient();
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(url.searchParams.get('next') === 'reset' ? '/auth/reset' : '/portal',appUrl()), { headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'} });
    } catch { /* A generic error avoids exposing provider details. */ }
  }
  return NextResponse.redirect(new URL('/auth/login?notice=invalid-link',appUrl()));
}
