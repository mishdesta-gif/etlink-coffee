import { authenticatedClient } from '@/lib/supabase/server';
import { uuid } from '@/lib/foundation/validation';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  try {
    const id=uuid((await params).id);
    const {db}=await authenticatedClient();
    const {data:doc,error}=await db.from('documents').select('object_path').eq('id',id).eq('status','uploaded').maybeSingle();
    if(error||!doc)return Response.json({error:'Document unavailable.'},{status:404,headers});
    const {data,error:signError}=await db.storage.from('verification').createSignedUrl(doc.object_path,60,{download:true});
    if(signError||!data)return Response.json({error:'Document unavailable or upload incomplete.'},{status:404,headers});
    return new Response(null,{status:303,headers:{...headers,Location:data.signedUrl}});
  }catch{return Response.json({error:'Sign in with document access to continue.'},{status:403,headers});}
}
