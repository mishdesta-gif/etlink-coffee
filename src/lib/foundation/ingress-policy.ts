import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export type IngressScope = 'inquiry';
type Configuration = { appUrl?: string; supabaseUrl?: string; edgeSecret?: string; identitySecret?: string; synthetic?: string; authProtectionReviewed?: string };

/** A test bypass is permitted only when BOTH services are explicitly loopback. */
export function syntheticIngress(config: Configuration): boolean {
  try {
    return config.synthetic === 'true' && [config.appUrl, config.supabaseUrl].every(value => {
      const url = new URL(value || '');
      return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    });
  } catch { return false; }
}

/** Operational readiness gate, not a replacement for provider-enforced Auth controls. */
export function assertAuthProviderReady(config: Configuration): void {
  if (!syntheticIngress(config) && config.authProtectionReviewed !== 'true') throw new Error('Account services await provider security validation.');
}

/** Optional local staging-validation restriction; never authorizes additional recipients. */
export function assertStagingAuthEmail(mode:string,address:string,validation:boolean,allowedAddress:string|undefined):void {
  const approved=(allowedAddress||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean);
  if(validation&&['register','forgot'].includes(mode)&&!approved.includes(address.toLowerCase()))throw new Error('Please use the approved staging test inbox.');
}

/** Edge must strip inbound assertion headers and sign its observed socket address. */
export function ingressIdentity(headers: Pick<Headers, 'get'>, scope: IngressScope, config: Configuration, now = Date.now()): string {
  if (syntheticIngress(config)) return createHmac('sha256', 'synthetic-loopback-identity').update(scope).digest('hex');
  if (!config.edgeSecret || config.edgeSecret.length < 32 || !config.identitySecret || config.identitySecret.length < 32) throw new Error('Secure request protection is not configured.');
  const ip = headers.get('x-etlink-client-ip') || '';
  const stamp = headers.get('x-etlink-edge-time') || '';
  const signature = headers.get('x-etlink-edge-signature') || '';
  if (!isIP(ip) || !/^\d{13}$/.test(stamp) || Math.abs(now - Number(stamp)) > 60_000 || !/^[a-f0-9]{64}$/.test(signature)) throw new Error('Secure request verification failed.');
  const expected = createHmac('sha256', config.edgeSecret).update(`${stamp}\n${ip}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new Error('Secure request verification failed.');
  // Never store raw IP addresses, email addresses, or browser-selected quota keys.
  return createHmac('sha256', config.identitySecret).update(`${scope}\n${ip}`).digest('hex');
}
