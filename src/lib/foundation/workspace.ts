import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticatedClient } from '@/lib/supabase/server';

export async function workspace() {
  let session;
  try { session=await authenticatedClient(); } catch { redirect('/auth/login'); }
  const {db,user}=session;
  const {data:members,error}=await db.from('memberships').select('business_id,role,businesses(id,name,country,kind)').eq('user_id',user.id).eq('active',true).order('created_at');
  if(error) throw new Error('Workspace service unavailable. Check the development database migration and connection.');
  const selected=(await cookies()).get('etlink-workspace')?.value;
  const membership=members?.find(m=>m.business_id===selected)||members?.[0];
  const business=membership?(Array.isArray(membership.businesses)?membership.businesses[0]:membership.businesses):null;
  return {db,user,members:members||[],membership,business};
}
