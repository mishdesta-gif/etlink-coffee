import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { ingressIdentity, syntheticIngress, type IngressScope } from '@/lib/foundation/ingress-policy';

/** Isolated trusted ingress. No browser cookies or caller-provided authorization. */
export async function protectedIngress(scope: IngressScope) {
  const config = {
    appUrl: process.env.ETLINK_APP_URL, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    edgeSecret: process.env.ETLINK_EDGE_ASSERTION_SECRET, identitySecret: process.env.ETLINK_ABUSE_IDENTITY_SECRET,
    synthetic: process.env.ETLINK_SYNTHETIC_TEST_MODE,
  };
  const identity = ingressIdentity(await headers(), scope, config);
  const key = process.env.ETLINK_INGRESS_SECRET_KEY;
  if (!key?.startsWith('sb_secret_') || !config.supabaseUrl) throw new Error('Secure request protection is not configured.');
  const db = createClient(config.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await db.rpc('reserve_ingress_budget', { scope, identity_hash: identity });
  if (error || data !== true) throw new Error('Too many requests or services unavailable. Please try later.');
  // Test loopback runs exercise DB budget reservations too; they never bypass a staging quota.
  return { db, synthetic: syntheticIngress(config) };
}
