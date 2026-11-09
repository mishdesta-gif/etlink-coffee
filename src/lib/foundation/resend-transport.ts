// Locally prepared adapter only. No request occurs unless an explicitly approved worker calls it.
import type {DeliveryMessage,DeliveryCode} from './notification-delivery';
const failure=(code:DeliveryCode)=>Object.assign(new Error('Email provider request failed; details redacted.'),{code});

export function resendTransport(apiKey:string,request:typeof fetch=fetch) {
  if(!apiKey)throw failure('provider_unavailable');
  return async(message:DeliveryMessage)=>{
    try {
      const response=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':message.idempotencyKey},
        body:JSON.stringify({from:message.from,to:[message.to],subject:message.subject,text:message.text}),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw failure(response.status===429?'rate_limited':response.status>=500?'provider_unavailable':'invalid_recipient');
      // Do not log provider bodies: they may contain recipient information.
    } catch(error){
      if(error&&typeof error==='object'&&'code' in error)throw error;
      throw failure(error instanceof Error&&/Abort|Timeout/.test(error.name)?'timeout':'provider_unavailable');
    }
  };
}
