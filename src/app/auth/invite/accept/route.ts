import { assertAuthProviderReady } from '@/lib/foundation/ingress-policy';
import { isInviteTokenHash } from '@/lib/foundation/invite-token';
import { appUrl, serverClient } from '@/lib/supabase/server';

const privacy = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' };

function result(status: number) {
  return new Response(null, { status, headers: privacy });
}

export async function POST(request: Request) {
  try {
    const site = request.headers.get('sec-fetch-site');
    if (request.headers.get('origin') !== appUrl() || (site !== null && site !== 'same-origin')) return result(403);
    if (!/^text\/plain(?:;|$)/i.test(request.headers.get('content-type') || '')) return result(415);

    const reader = request.body?.getReader();
    if (!reader) return result(400);
    const bytes = new Uint8Array(56);
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > bytes.length) {
        await reader.cancel();
        return result(400);
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
    if (size !== bytes.length) return result(400);
    const tokenHash = new TextDecoder().decode(bytes);
    if (!isInviteTokenHash(tokenHash)) return result(400);

    assertAuthProviderReady({
      appUrl: process.env.ETLINK_APP_URL,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      synthetic: process.env.ETLINK_SYNTHETIC_TEST_MODE,
      authProtectionReviewed: process.env.ETLINK_AUTH_PROVIDER_PROTECTION_REVIEWED,
    });
    const db = await serverClient();
    const { data, error } = await db.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' });
    if (error) return result(error.status === 400 || error.status === 403 || error.status === 422 ? 400 : 503);
    return result(data.session && data.user?.email_confirmed_at ? 204 : 400);
  } catch {
    // Provider errors can contain credentials. Return only a fixed status.
    return result(503);
  }
}
