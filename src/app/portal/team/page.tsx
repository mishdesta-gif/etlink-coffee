import { FoundationShell,NotConfigured } from '@/components/foundation/shell';
import { InvitationForm,MutationForm } from '@/components/foundation/forms';
import { configured } from '@/lib/supabase/server';
import { workspace } from '@/lib/foundation/workspace';
import { teamRoles } from '@/lib/foundation/validation';
export default async function Team(){
  if(!configured())return <FoundationShell title="Business team."><NotConfigured/></FoundationShell>;
  const {db,membership,business}=await workspace();
  if(!membership||!business)return <FoundationShell title="Business team."><p>Register or join a business first.</p></FoundationShell>;
  const {data:team,error}=await db.from('memberships').select('user_id,role,active').eq('business_id',membership.business_id);
  if(error)throw new Error('Team could not be loaded.');
  return <FoundationShell title={`${business.name} team`}><div className="foundation-card"><h2>Team permissions</h2><p>Owners manage team access. Administrators may invite non-administrative staff. Traders and operations staff can participate in future trading workflows; viewers have read access. Verification submissions require owner or administrator access. Verification-document uploads also allow operations staff.</p>{team?.map(m=><article key={m.user_id}><h3>{m.role} · {m.active?'Active':'Inactive'}</h3><p className="foundation-metadata">Account ID: {m.user_id}</p>{membership.role==='owner'&&m.role!=='owner'&&<MutationForm operation="member"><input type="hidden" name="business_id" value={membership.business_id}/><input type="hidden" name="user_id" value={m.user_id}/><label>Role<select name="role" defaultValue={m.role}>{teamRoles.map(r=><option key={r}>{r}</option>)}</select></label><label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={m.active}/>Active membership</label></MutationForm>}</article>)}</div>{['owner','admin'].includes(membership.role)&&<div className="foundation-card"><h2>Invite a team member</h2><InvitationForm businessId={membership.business_id}/></div>}</FoundationShell>;
}
