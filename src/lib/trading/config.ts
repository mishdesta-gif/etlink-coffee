import 'server-only';
function matchesHttpsOrigin(configured: string | undefined, target: URL): boolean {
  if (!configured) return false;
  const approved = new URL(configured);
  return approved.protocol === 'https:' && approved.href === `${approved.origin}/` &&
    target.href === approved.href;
}

export function tradingAvailable():boolean {
  if(process.env.ETLINK_PHASE2_ENABLED!=='true')return false;
  try {
    const app=new URL(process.env.ETLINK_APP_URL||'');
    const db=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'');
    if (app.protocol==='http:'&&app.hostname==='127.0.0.1') {
      return db.origin==='https://fzgnepvhwhvxukuyubzk.supabase.co'||
        db.protocol==='http:'&&db.hostname==='127.0.0.1';
    }
    return process.env.ETLINK_SYNTHETIC_TEST_MODE !== 'true' &&
      process.env.ETLINK_PHASE2_FIXTURE !== 'true' &&
      matchesHttpsOrigin(process.env.ETLINK_TRADING_APPROVED_APP_ORIGIN, app) &&
      matchesHttpsOrigin(process.env.ETLINK_TRADING_APPROVED_SUPABASE_ORIGIN, db);
  }catch{return false;}
}
export function requireTrading(){if(!tradingAvailable())throw new Error('Trading is unavailable on this deployment.');}
