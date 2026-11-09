'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createHash, randomBytes } from 'node:crypto';
import { authenticatedClient,appUrl,serverClient } from '@/lib/supabase/server';
import { documentValidator } from '@/lib/supabase/document-validator';
import { protectedIngress } from '@/lib/supabase/ingress';
import { field,choice,email,uuid,integer,validateDocument,documentHash,validateStoredDocument,businessKinds,capabilities,teamRoles,permissions,SafeActionError,safeActionMessage,verificationExpiry,type ActionState } from '@/lib/foundation/validation';

function failure(error: { code?:string;message?:string } | null): void {
  if (!error) return;
  if (error.code === '42501') throw new SafeActionError('You do not have permission for this action. Sign in, verify MFA if required, and check your business role.');
  if (error.message?.includes('Too many')) throw new SafeActionError('Too many requests. Please try later.');
  if (error.message?.includes('changed. Reload')) throw new SafeActionError('This record changed. Reload before trying again.');
  if (error.message?.includes('transition')) throw new SafeActionError('This status change is not allowed. Start review before approving or rejecting.');
  throw new SafeActionError('The change could not be saved. Check the details, current status and permissions, then try again.');
}
export async function mutate(_state:ActionState,form:FormData):Promise<ActionState> {
  try {
    const {db,user} = await authenticatedClient();
    const operation=field(form,'operation');
    let message='Your changes were saved.';
    let link:string|undefined;
    switch(operation) {
      case 'switch': {
        const b=uuid(field(form,'business_id'));
        const {data,error}=await db.from('memberships').select('business_id').eq('business_id',b).eq('user_id',user.id).eq('active',true).maybeSingle();
        failure(error);
        if(!data) throw new SafeActionError('This workspace is not available to your account.');
        (await cookies()).set('etlink-workspace',b,{httpOnly:true,sameSite:'lax',secure:appUrl().startsWith('https://'),path:'/'});
        message='Workspace changed.';break;
      }
      case 'profile': failure((await db.rpc('save_profile',{n:field(form,'display_name',2,100),optional:form.get('optional_notifications')==='on'})).error);break;
      case 'business': {
        const {data,error}=await db.rpc('register_business',{n:field(form,'business_name',2,160),c:field(form,'country',2,80),k:choice(field(form,'kind'),businessKinds),cap:choice(field(form,'capability'),capabilities),d:field(form,'details',10,4000)});
        failure(error);
        (await cookies()).set('etlink-workspace',String(data),{httpOnly:true,sameSite:'lax',secure:appUrl().startsWith('https://'),path:'/'});
        message='Business submitted for independent review.';link='/portal';break;
      }
      case 'update_business': failure((await db.rpc('update_business',{b:uuid(field(form,'business_id')),n:field(form,'business_name',2,160),c:field(form,'country',2,80)})).error);message='Business profile updated. Existing approvals require a new review.';break;
      case 'capability': failure((await db.rpc('submit_capability',{b:uuid(field(form,'business_id')),cap:choice(field(form,'capability'),capabilities),d:field(form,'details',10,4000)})).error);message='Capability application submitted.';break;
      case 'invite': {
        const b=String(form.get('business_id')||'');
        const perms=form.getAll('permissions').map(p=>choice(String(p),permissions));
        const token=randomBytes(32).toString('hex');
        const {error}=await db.rpc('create_invitation',{b:b?uuid(b):null,email_address:email(field(form,'email',3,254)),team_role:b?choice(field(form,'role'),teamRoles):null,perms:b?null:perms,hash:createHash('sha256').update(token).digest('hex')});
        failure(error);
        link=`${appUrl()}/portal/invitations#token=${token}`;
        message='Invitation created for 3 days. Copy this private link now and share it through your approved channel. No email was sent.';break;
      }
      case 'accept': {
        const token=field(form,'token',64,64);
        if(!/^[0-9a-f]{64}$/.test(token)) throw new SafeActionError('Paste the complete invitation token.');
        failure((await db.rpc('accept_invitation',{hash:createHash('sha256').update(token).digest('hex')})).error);
        message='Invitation accepted. Open your workspace.';link='/portal';break;
      }
      case 'member': failure((await db.rpc('set_member',{b:uuid(field(form,'business_id')),u:uuid(field(form,'user_id')),r:choice(field(form,'role'),teamRoles),enabled:form.get('active')==='on'})).error);break;
      case 'review': {
        const expires=verificationExpiry(form.get('expires_at')??'');
        failure((await db.rpc('review_capability',{i:uuid(field(form,'id')),v:integer(field(form,'revision')),s:choice(field(form,'status'),['under_review','approved','rejected','more_information_required','suspended'] as const),r:field(form,'reason',5,1000),e:expires})).error);message='Verification decision recorded and workspace notification created.';break;
      }
      case 'inquiry': failure((await db.rpc('manage_inquiry',{i:uuid(field(form,'id')),v:integer(field(form,'revision')),s:choice(field(form,'status'),['new','in_review','awaiting_response','resolved','closed'] as const),p:choice(field(form,'priority'),['normal','high','urgent'] as const),assignee:form.get('assigned_to')?uuid(field(form,'assigned_to')):null,note:field(form,'note',0,4000),internal_note:form.get('internal')==='on'})).error);message='Inquiry updated. External email delivery remains disabled.';break;
      case 'read': failure((await db.rpc('mark_notification',{i:uuid(field(form,'id'))})).error);break;
      case 'revoke_staff': failure((await db.rpc('revoke_staff',{i:uuid(field(form,'id'))})).error);break;
      case 'document': {
        const validator=documentValidator();
        const b=uuid(field(form,'business_id'));
        const file=form.get('document');
        if(!(file instanceof File)) throw new SafeActionError('Select a document.');
        const content=new Uint8Array(await file.arrayBuffer());
        validateDocument(content,file.type);
        const sha=await documentHash(content);
        const {data,error}=await db.rpc('prepare_document',{b,n:field(form,'label',2,100),mime:file.type,bytes:file.size,sha});
        failure(error);
        const {error:uploadError}=await db.storage.from('verification').upload(`${b}/${data}`,file,{contentType:file.type,upsert:false});
        if(uploadError) throw new SafeActionError('Upload could not finish. Its pending record is retained for review; retry with a new upload.');
        const {data:stored,error:readError}=await validator.storage.from('verification').download(`${b}/${data}`);
        if(readError||!stored)throw new SafeActionError('Upload remains private and pending because stored-file validation could not finish.');
        await validateStoredDocument(stored,{mime:file.type,bytes:file.size,sha256:sha});
        failure((await validator.rpc('finalize_document',{i:data,u:user.id,sha,mime:file.type,bytes:file.size})).error);
        message='Document uploaded privately. Download links are authorized and expire after 60 seconds.';break;
      }
      default: throw new SafeActionError('Unknown action.');
    }
    revalidatePath('/portal');revalidatePath('/admin');
    return {ok:true,message,link};
  } catch(e) {return {ok:false,message:safeActionMessage(e,'Services unavailable. Sign in again or try later.','workspace')};}
}
export async function sendInquiry(_state:ActionState,form:FormData):Promise<ActionState> {
  try {
    const cat=choice(field(form,'category'),['buyer','supplier','exporter_to_exporter','general'] as const);
    const input={cat,n:field(form,'name',2,100),em:email(field(form,'email',3,254)),bn:field(form,'business_name',2,160),c:field(form,'country',2,80),msg:field(form,'message',20,4000),website:field(form,'website',0,200)};
    if(input.website || [input.n,input.em,input.bn,input.c].some(v=>/[\x00-\x1f\x7f]/.test(v)))throw new SafeActionError('Please check the inquiry details.');
    const client=await serverClient();
    const {data:{session}}=await client.auth.getSession();
    let actor:string|null=null,actor_session:string|null=null;
    if(session){
      // getSession alone is not trusted: verify this exact token with Auth first.
      const {data:{user},error}=await client.auth.getUser(session.access_token);
      if(error||!user?.email_confirmed_at)throw new SafeActionError('Please sign in again.');
      const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString());
      actor=user.id;actor_session=uuid(String(claims.session_id||''));
    }
    const {db}=await protectedIngress('inquiry');
    const {data,error}=await db.rpc('submit_trusted_inquiry',{...input,actor,actor_session});
    failure(error);
    return {ok:true,message:`Inquiry received. Your reference is ${data}. ET Link will review it. No verification or trade approval is implied.`};
  } catch(e) {return {ok:false,message:safeActionMessage(e,'Inquiry service unavailable. Please contact ET Link by email.','inquiry')};}
}
