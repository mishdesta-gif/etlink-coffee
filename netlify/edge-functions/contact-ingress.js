// Trust Netlify's socket-derived context.ip, never a caller's forwarding headers.
// No body, address, signature or credential is logged or returned to the visitor.
export default async function contactIngress(request,context) {
  const headers=new globalThis.Headers(request.headers);
  for(const name of ['x-etlink-client-ip','x-etlink-edge-time','x-etlink-edge-signature'])headers.delete(name);
  if(request.method==='POST'){
    const secret=globalThis.Netlify?.env?.get('ETLINK_EDGE_ASSERTION_SECRET');
    if(!secret||secret.length<32||!context.ip)return new globalThis.Response('Secure inquiry intake is unavailable. Please contact ET Link by email.',{status:503,headers:{'Cache-Control':'no-store'}});
    const time=String(Date.now()),encoder=new globalThis.TextEncoder();
    const key=await globalThis.crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signed=await globalThis.crypto.subtle.sign('HMAC',key,encoder.encode(`${time}\n${context.ip}`));
    headers.set('x-etlink-client-ip',context.ip);headers.set('x-etlink-edge-time',time);
    headers.set('x-etlink-edge-signature',Array.from(new Uint8Array(signed),byte=>byte.toString(16).padStart(2,'0')).join(''));
  }
  return context.next(new globalThis.Request(request,{headers}));
}
export const config={path:'/contact'};
