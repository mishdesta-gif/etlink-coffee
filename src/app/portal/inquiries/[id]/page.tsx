import { notFound } from 'next/navigation';
import { FoundationShell,NotConfigured } from '@/components/foundation/shell';
import { configured } from '@/lib/supabase/server';
import { workspace } from '@/lib/foundation/workspace';
import { uuid } from '@/lib/foundation/validation';
export default async function Inquiry({params}:{params:Promise<{id:string}>}){
  if(!configured())return <FoundationShell title="Your inquiry."><NotConfigured/></FoundationShell>;
  const {db,user}=await workspace();let id;try{id=uuid((await params).id);}catch{notFound();}
  const {data:q,error}=await db.from('inquiries').select('id,reference,message,status').eq('id',id).eq('user_id',user.id).maybeSingle();if(error)throw new Error('Inquiry could not be loaded.');if(!q)notFound();
  const {data:messages,error:messagesError}=await db.from('inquiry_messages').select('id,body,created_at').eq('inquiry_id',id).eq('internal',false).order('created_at');if(messagesError)throw new Error('Replies could not be loaded.');
  return <FoundationShell title="Your inquiry."><div className="foundation-card"><h2>{q.reference}</h2><span className="foundation-status">{q.status.replaceAll('_',' ')}</span><p className="foundation-pre">{q.message}</p><h3>ET Link response history</h3>{messages?.length?messages.map(m=><article key={m.id}><p className="foundation-pre">{m.body}</p><p>{new Date(m.created_at).toLocaleString('en-GB',{timeZone:'Africa/Addis_Ababa'})}</p></article>):<p>No responses yet.</p>}</div></FoundationShell>;
}
