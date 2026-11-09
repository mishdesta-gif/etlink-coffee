import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
export async function VerificationHistory({db,capabilityId}:{db:SupabaseClient;capabilityId:string}) {
  const {data:history,error}=await db.from('capability_history').select('id,revision,status,details,reason,reviewed_by,reviewed_at,expires_at,revoked_at,document_ids,created_at').eq('capability_id',capabilityId).order('revision',{ascending:false}).limit(20);
  if(error)throw new Error('Verification history could not be loaded.');
  return <details><summary>Application & decision history (latest 20)</summary>{history?.map(h=><article key={h.id}><h3>Revision {h.revision} · {h.status.replaceAll('_',' ')}</h3><p className="foundation-metadata">{new Date(h.created_at).toLocaleString('en-GB',{timeZone:'Africa/Addis_Ababa'})}{h.reviewed_by?` · Reviewer account: ${h.reviewed_by}`:''}</p><p className="foundation-pre">{h.details}</p>{h.reason&&<p>{h.reason}</p>}{h.expires_at&&<p>Approval expiry: {new Date(h.expires_at).toLocaleDateString('en-GB',{timeZone:'Africa/Addis_Ababa'})}</p>}{h.revoked_at&&<p>Revocation recorded: {new Date(h.revoked_at).toLocaleString('en-GB',{timeZone:'Africa/Addis_Ababa'})}</p>}{h.document_ids?.length>0&&<p>Supporting document records: {h.document_ids.length}. Original private files are retained.</p>}</article>)}</details>;
}
