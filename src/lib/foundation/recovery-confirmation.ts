// Pure destination policy. Never fetches or verifies a recovery credential.
export function recoveryDestination(raw: unknown, provider: string, application: string, synthetic = false): string {
  const reject = () => { throw new Error('Invalid recovery confirmation.'); };
  if (typeof raw !== 'string' || raw.length > 4096 || /[\s\\]/.test(raw)) return reject();
  let target: URL, expected: URL, app: URL;
  try { target = new URL(raw); expected = new URL(provider); app = new URL(application); } catch { return reject(); }
  const local = synthetic && expected.origin === 'http://127.0.0.1:54329';
  if ((!local && (expected.protocol !== 'https:' || !expected.hostname.endsWith('.supabase.co'))) || expected.username || expected.password || expected.pathname !== '/' || expected.search || expected.hash) return reject();
  if (app.username || app.password || app.pathname !== '/' || app.search || app.hash || (app.protocol !== 'https:' && !(app.protocol === 'http:' && ['127.0.0.1','localhost'].includes(app.hostname)))) return reject();
  if (target.origin !== expected.origin || target.pathname !== '/auth/v1/verify' || target.username || target.password || target.hash) return reject();
  if (Array.from(target.searchParams.keys()).some(key => !['token','type','redirect_to'].includes(key))) return reject();
  for (const key of ['token','type','redirect_to']) if (target.searchParams.getAll(key).length !== 1) return reject();
  if (!/^[a-fA-F0-9]{64}$/.test(target.searchParams.get('token') || '') || target.searchParams.get('type') !== 'recovery') return reject();
  let callback: URL;
  try { callback = new URL(target.searchParams.get('redirect_to') || ''); } catch { return reject(); }
  if (callback.origin !== app.origin || callback.pathname !== '/auth/callback' || callback.username || callback.password || callback.hash || callback.searchParams.getAll('next').length !== 1 || callback.searchParams.get('next') !== 'reset') return reject();
  if (Array.from(callback.searchParams.keys()).some(key => !['next','sb_flow_id'].includes(key))) return reject();
  if (callback.searchParams.has('sb_flow_id') && (callback.searchParams.getAll('sb_flow_id').length !== 1 || !/^[A-Za-z0-9_-]{8,64}$/.test(callback.searchParams.get('sb_flow_id') || ''))) return reject();
  return target.href;
}
