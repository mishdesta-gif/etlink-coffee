import 'server-only';
import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MutationForm } from './forms';

/** Account-level services remain available even before joining a business. */
export async function AccountPanels({db,userId}:{db:SupabaseClient;userId:string}) {
  const [{data:notes,error:nerr},{data:inquiries,error:ierr},{data:profile,error:perr}]=await Promise.all([
    db.from('notifications').select('id,message,created_at,read_at').order('created_at',{ascending:false}).limit(20),
    db.from('inquiries').select('id,reference,status').eq('user_id',userId).order('created_at',{ascending:false}).limit(10),
    db.from('profiles').select('display_name,optional_notifications').eq('user_id',userId).maybeSingle(),
  ]);
  if(nerr||ierr||perr)throw new Error('Your account records could not be loaded.');
  return <><div className="foundation-grid"><div className="foundation-card"><h2>Notifications</h2><p>Latest 20 authorized notifications. Email delivery is disabled.</p>{notes?.length?notes.map(n=><article key={n.id}><p>{n.message}</p>{!n.read_at&&<MutationForm operation="read" label="Mark read"><input type="hidden" name="id" value={n.id}/></MutationForm>}</article>):<p>No notifications yet.</p>}</div><div className="foundation-card"><h2>Support & inquiries</h2><Link href="/contact#inquiry" className="text-link">Send an inquiry ↗</Link>{inquiries?.length?<ul>{inquiries.map(q=><li key={q.id}><Link href={`/portal/inquiries/${q.id}`}>{q.reference} · {q.status.replaceAll('_',' ')}</Link></li>)}</ul>:<p>No inquiries submitted by this account.</p>}</div></div><div className="foundation-card"><h2>Your profile & preferences</h2><MutationForm operation="profile"><label>Display name<input name="display_name" defaultValue={profile?.display_name||''} required minLength={2} maxLength={100}/></label><label className="checkbox-label"><input type="checkbox" name="optional_notifications" defaultChecked={profile?.optional_notifications!==false}/>Optional notifications</label><p>Verification, support and security notifications remain mandatory.</p></MutationForm></div></>;
}
