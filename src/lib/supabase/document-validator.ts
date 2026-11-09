import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Isolated server-only client: never inherit an end-user session or browser cookies. */
export function documentValidatorConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.ETLINK_STORAGE_VALIDATOR_SECRET_KEY?.startsWith('sb_secret_'));
}
export function documentValidator() {
  if(!documentValidatorConfigured())throw new Error('Private document uploads await secure validation configuration.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.ETLINK_STORAGE_VALIDATOR_SECRET_KEY!,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  });
}
