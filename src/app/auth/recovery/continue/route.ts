import { NextResponse } from 'next/server';
import { appUrl } from '@/lib/supabase/server';
import { recoveryDestination } from '@/lib/foundation/recovery-confirmation';

const privacy = {'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer'};
// No GET handler: previews cannot initiate provider verification.
export async function POST(request: Request) {
  const origin = appUrl();
  const site = request.headers.get('sec-fetch-site');
  if (request.headers.get('origin') !== origin || (site !== null && site !== 'same-origin')) return new NextResponse('Recovery confirmation denied.',{status:403,headers:privacy});
  const contentType = request.headers.get('content-type') || '';
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(contentType)) return new NextResponse('Recovery confirmation denied.',{status:415,headers:privacy});
  // A fixed small body bound prevents oversized form parsing; credentials never enter logs.
  let text = '', size = 0;
  const reader = request.body?.getReader(), decoder = new TextDecoder();
  try {
    if (reader) while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return new NextResponse('Recovery confirmation denied.',{status:413,headers:privacy}); }
      text += decoder.decode(value,{stream:true});
    }
    text += decoder.decode();
  } catch { return new NextResponse('Recovery confirmation denied.',{status:400,headers:privacy}); }
  const form = new URLSearchParams(text);
  try {
    if (Array.from(form.keys()).some(key => key !== 'confirmation_url') || form.getAll('confirmation_url').length !== 1) throw new Error('Invalid form');
    const destination = recoveryDestination(form.get('confirmation_url'),process.env.NEXT_PUBLIC_SUPABASE_URL || '',origin,process.env.ETLINK_SYNTHETIC_TEST_MODE === 'true');
    if (request.headers.get('accept') === 'application/json') return NextResponse.json({destination},{headers:privacy});
    return NextResponse.redirect(destination,{status:303,headers:privacy});
  } catch {
    return NextResponse.redirect(new URL('/auth/login?notice=invalid-link',origin),{status:303,headers:privacy});
  }
}
