// Provider-neutral delivery logic. No environment reads or network calls in this module.
export type DeliveryCode = 'provider_unavailable'|'rate_limited'|'invalid_recipient'|'timeout'|'unknown';
export type DeliveryJob = {delivery_id:string;notification_id:string;recipient_id:string;lease_token:string};
export type DeliveryRecipient = {email:string;confirmed:boolean;banned:boolean};
export type DeliveryMessage = {from:string;to:string;subject:string;text:string;idempotencyKey:string};
export type DeliveryRepository = {
  claim:(limit:number)=>Promise<DeliveryJob[]>;
  recipient:(id:string)=>Promise<DeliveryRecipient|null>;
  authorize:(job:DeliveryJob)=>Promise<boolean>;
  finish:(job:DeliveryJob,success:boolean,code:DeliveryCode|null)=>Promise<void>;
};
export class DeliveryFailure extends Error {
  code:DeliveryCode;
  constructor(code:DeliveryCode){super(code);this.code=code;}
}
export type DeliveryConfiguration = {enabled:boolean;externalSendApproved:boolean;projectUrl:string;from:string;allowedRecipients:string[];appOrigin:string};
const address=(value:string)=>value.length<=254&&!/[\r\n]/.test(value)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function deliverStagingNotifications(config:DeliveryConfiguration,repository:DeliveryRepository,send:(message:DeliveryMessage)=>Promise<void>) {
  if(!config.enabled)return {status:'disabled',claimed:0,sent:0,failed:0,uncertain:0};
  // Auth-test email approval does NOT authorize transactional notification delivery.
  if(!config.externalSendApproved)throw new Error('Transactional email delivery requires separate owner approval.');
  if(config.projectUrl!=='https://fzgnepvhwhvxukuyubzk.supabase.co'||config.appOrigin!=='http://127.0.0.1:3103')throw new Error('Only the approved local staging connection is supported.');
  if(!address(config.from)||!config.allowedRecipients.length||config.allowedRecipients.some(v=>!address(v)))throw new Error('An approved sender and exact recipient allowlist are required.');
  const allow=new Set(config.allowedRecipients.map(v=>v.toLowerCase()));
  const jobs=await repository.claim(10);
  const result={status:'completed',claimed:jobs.length,sent:0,failed:0,uncertain:0};
  for(const job of jobs){
    let accepted=false;
    try {
      const recipient=await repository.recipient(job.recipient_id);
      if(!recipient||!recipient.confirmed||recipient.banned||!address(recipient.email)||!allow.has(recipient.email.toLowerCase()))throw new DeliveryFailure('invalid_recipient');
      if(!await repository.authorize(job))throw new DeliveryFailure('invalid_recipient');
      // Never copy inquiry bodies, identities, document paths, decisions or arbitrary stored text into email.
      await send({from:config.from,to:recipient.email.toLowerCase(),subject:'ET Link Coffee — workspace update',
        text:'There is an update in your ET Link Coffee workspace. Sign in to view it: '+config.appOrigin+'/portal',
        idempotencyKey:'etlink-notification/'+job.delivery_id});
      accepted=true;
      await repository.finish(job,true,null);result.sent++;
    } catch(error) {
      if(accepted){result.uncertain++;continue;} // Provider accepted but DB acknowledgement failed: reconcile, do not claim success.
      const candidate=error&&typeof error==='object'&&'code' in error?String(error.code):'';
      const code:DeliveryCode=error instanceof DeliveryFailure?error.code:
        ['provider_unavailable','rate_limited','invalid_recipient','timeout','unknown'].includes(candidate)?candidate as DeliveryCode:'unknown';
      await repository.finish(job,false,code);result.failed++;
    }
  }
  return result;
}
