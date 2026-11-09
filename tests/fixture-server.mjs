// TEST ONLY. A loopback Auth/REST contract fixture backed by the migrated PGlite database.
// This verifies application wiring; it is not Supabase Auth, Storage, or an email provider.
import http from 'node:http';
import { randomUUID,randomBytes,createHmac,createHash } from 'node:crypto';
import { database,asUser,ids,seedUsers } from './database.mjs';
import {tradingDatabase} from './trading-database.mjs';
const inquiryOnly=process.env.ETLINK_INQUIRY_VALIDATION_ONLY==='true';
const foundationJourneys=process.env.ETLINK_PHASE1_JOURNEYS==='true';
const tradingOnly=process.env.ETLINK_PHASE2_FIXTURE==='true';
const tradingScenario=tradingOnly?process.env.ETLINK_TRADING_SCENARIO||'international':'international';
if(tradingOnly&&inquiryOnly)throw new Error('Fixture modes must be isolated');
const db=tradingOnly?await tradingDatabase():await database();
if(inquiryOnly){for(const id of [ids.alice,ids.bob,ids.reviewer,ids.support]){const name=Object.keys(ids).find(k=>ids[k]===id);await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,`${name}@example.test`]);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[id]);}}else await seedUsers(db);
const accounts=new Map();const sessions=new Map();const codes=new Map();const objects=new Map();
const recoveries=new Map();let failLogout=false;
const testPassword='Synthetic-test-password-123!';
for(const [name,id] of Object.entries(ids)){if(inquiryOnly&&![ids.alice,ids.bob,ids.reviewer,ids.support].includes(id))continue;accounts.set(`${name}@example.test`,{id,email:`${name}@example.test`,aud:'authenticated',role:'authenticated',email_confirmed_at:name==='unconfirmed'?null:new Date().toISOString(),created_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{},factors:[],password:testPassword});}
let importer,supplier;
if(!inquiryOnly){
await asUser(db,ids.alice);importer=(await db.query("select public.register_business($1,$2,$3,'buyer','SYNTHETIC buyer interested in Guji coffee') as id",[tradingScenario==='international'?'SYNTHETIC — Guji Importer':tradingScenario==='domestic'?'SYNTHETIC — Domestic Buyer':'SYNTHETIC — Exporter Sourcing',tradingScenario==='international'?'Germany':'Ethiopia',tradingScenario==='international'?'overseas_buyer':tradingScenario==='domestic'?'domestic_buyer':'exporter_sourcing'])).rows[0].id;
await asUser(db,ids.bob);supplier=(await db.query("select public.register_business('SYNTHETIC — Ethiopian Supplier','Ethiopia','exporter','supplier','SYNTHETIC supplier verification evidence for local QA') as id")).rows[0].id;
}
await db.exec('reset role');
if(inquiryOnly)await db.query("insert into public.staff_grants(user_id,permission) values($1,'verification.review'),($2,'inquiry.manage')",[ids.reviewer,ids.support]);
else await db.query("insert into public.staff_grants(user_id,permission) values($1,'verification.review'),($2,'inquiry.manage'),($3,'staff.manage'),($3,'audit.read')",[ids.reviewer,ids.support,ids.manager]);
if(tradingOnly)await db.query("insert into public.staff_grants(user_id,permission) select $1,unnest(array['trading.requests.review','trading.lots.review','trading.matches.manage','trading.offers.issue','trading.commissions.manage'])",[ids.reviewer]);
let emailRequests=0;
const recoveryLinks=new Map();let recoveryVerifications=0;
const publicUser=u=>Object.fromEntries(Object.entries(u).filter(([k])=>!['password','challenge'].includes(k)));
async function token(u,aal='aal1'){
  const sessionId=randomUUID();
  await db.exec('reset role');await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sessionId,u.id]);
  const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  const body=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:u.id,email:u.email,role:'authenticated',aud:'authenticated',aal,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,session_id:sessionId})}`;
  const access_token=`${body}.${createHmac('sha256','local-fixture-secret-never-use-live').update(body).digest('base64url')}`;
  const refresh_token=randomBytes(24).toString('hex');const session={u,aal,sessionId,access_token,refresh_token};sessions.set(access_token,session);sessions.set(refresh_token,session);
  return {access_token,refresh_token,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:publicUser(u)};
}
const tables=new Set(['memberships','businesses','capabilities','capability_history','profiles','notifications','documents','inquiries','inquiry_messages','staff_grants','audit_events','notification_deliveries']);
if(tradingOnly)for(const table of ['buyer_requests','coffee_lots','trade_record_history'])tables.add(table);
const identifier=s=>{if(!/^[a-z_]+$/.test(s))throw new Error('Invalid test query');return `"${s}"`;};
let queue=Promise.resolve();
const server=http.createServer((request,response)=>{
  queue=queue.then(async()=>{
    const url=new URL(request.url,'http://127.0.0.1:54329');
    const bearer=request.headers.authorization?.replace(/^Bearer /,'');const session=sessions.get(bearer);
    const validator=request.headers.apikey==='sb_secret_synthetic_local_validator'&&bearer==='sb_secret_synthetic_local_validator';
    const send=(status,data,headers={})=>{response.writeHead(status,{'Content-Type':'application/json',...headers});response.end(JSON.stringify(data));};
    try{
      let bytes=Buffer.alloc(0);for await(const chunk of request){bytes=Buffer.concat([bytes,chunk]);if(bytes.length>6*1024*1024)throw new Error('Fixture body too large');}
      const body=bytes.length&&request.headers['content-type']?.includes('application/json')?JSON.parse(bytes.toString()):{};
      if(url.pathname==='/_fixture/health')return send(200,{synthetic:true});
      if(foundationJourneys&&url.pathname==='/_fixture/recovery-link'&&request.method==='POST'){
        const pending=recoveries.get(body.email),u=accounts.get(body.email);
        if(!pending||!u)return send(404,{});
        recoveries.delete(body.email);const hash=randomBytes(32).toString('hex');
        recoveryLinks.set(hash,{u,challenge:pending.challenge,expired:body.expired===true});
        const destination=new URL('http://127.0.0.1:54329/auth/v1/verify');
        destination.searchParams.set('token',hash);destination.searchParams.set('type','recovery');destination.searchParams.set('redirect_to','http://127.0.0.1:3102/auth/callback?next=reset');
        return send(200,{confirmationUrl:destination.href});
      }
      if(foundationJourneys&&url.pathname==='/_fixture/recovery-stats')return send(200,{recoveryVerifications});
      if(foundationJourneys&&url.pathname==='/auth/v1/verify'){
        recoveryVerifications++;const hash=url.searchParams.get('token'),pending=recoveryLinks.get(hash);recoveryLinks.delete(hash);
        const destination=new URL('http://127.0.0.1:3102/auth/callback?next=reset');
        if(pending&&!pending.expired){const code=randomBytes(24).toString('hex');codes.set(code,{u:pending.u,challenge:pending.challenge});destination.searchParams.set('code',code);}
        response.writeHead(303,{Location:destination.href});return response.end();
      }
      if(foundationJourneys&&url.pathname==='/_fixture/phase1-control'&&request.method==='POST'){
        failLogout=body.failLogout===true;return send(200,{synthetic:true});
      }
      if(foundationJourneys&&url.pathname==='/_fixture/revoke-phase1-member'&&request.method==='POST'){
        const u=accounts.get(body.email);if(!u)return send(404,{});
        await db.exec('reset role');await db.query('update public.memberships set active=false where user_id=$1',[u.id]);return send(200,{revoked:true});
      }
      if(foundationJourneys&&url.pathname==='/_fixture/revoke-phase1-reviewer'&&request.method==='POST'){
        await db.exec('reset role');await db.query('update public.staff_grants set revoked_at=now() where user_id=$1',[ids.reviewer]);return send(200,{revoked:true});
      }
      if(foundationJourneys&&url.pathname==='/_fixture/phase1-state'){
        await db.exec('reset role');
        const state=(await db.query("select (select count(*)::int from audit_events) as audit_events,(select count(*)::int from capability_history) as verification_events,(select count(*)::int from notification_deliveries where status<>'disabled') as enabled_emails")).rows[0];
        return send(200,{...state,emailRequests,externalEmailsSent:0,tradingEnabled:tradingOnly});
      }
      if(foundationJourneys&&url.pathname==='/_fixture/recovery-code'&&request.method==='POST'){
        const pending=recoveries.get(body.email);const u=accounts.get(body.email);
        if(!pending||!u)return send(404,{});
        recoveries.delete(body.email);const code=randomBytes(24).toString('hex');codes.set(code,{u,challenge:pending.challenge});return send(200,{code});
      }
      if(tradingOnly&&url.pathname==='/_fixture/trading-state'){
        await db.exec('reset role');
        const state=(await db.query("select (select count(*)::int from buyer_requests) as requests,(select count(*)::int from coffee_lots) as lots,(select count(*)::int from private.trade_matches) as matches,(select count(*)::int from private.trade_offer_versions) as quote_versions,(select count(*)::int from private.trade_offer_responses) as responses,(select count(*)::int from notification_deliveries where status<>'disabled') as enabled_emails")).rows[0];
        return send(200,{...state,buyer:importer,supplier,emailRequests});
      }
      if(tradingOnly&&url.pathname==='/_fixture/revoke-trading-reviewer'&&request.method==='POST'){
        await db.exec('reset role');await db.query("update staff_grants set revoked_at=now() where user_id=$1",[ids.reviewer]);return send(200,{revoked:true});
      }
      if(inquiryOnly&&url.pathname==='/_fixture/inquiry-state'){
        await db.exec('reset role');
        const inquiries=(await db.query('select id,reference,category,country,business_name,user_id,status,revision from public.inquiries order by created_at')).rows;
        const audits=(await db.query('select action,previous_state,new_state,reason from public.audit_events order by id')).rows;
        const budgets=(await db.query('select hits from private.ingress_budgets')).rows;
        const deliveries=(await db.query('select status,attempts from public.notification_deliveries')).rows;
        const businessState=(await db.query('select (select count(*)::int from public.businesses) as businesses,(select count(*)::int from public.memberships) as memberships,(select count(*)::int from public.capabilities) as capabilities')).rows[0];
        return send(200,{inquiries,audits,budgets,deliveries,emailRequests,businessState});
      }
      if(inquiryOnly&&url.pathname==='/_fixture/revoke-inquiry-officer'&&request.method==='POST'){
        await db.exec('reset role');await db.query("update public.staff_grants set revoked_at=now() where user_id=$1 and permission='inquiry.manage'",[ids.support]);return send(200,{revoked:true});
      }
      if((inquiryOnly||foundationJourneys)&&['/auth/v1/signup','/auth/v1/recover'].includes(url.pathname))emailRequests++;
      if(url.pathname==='/_fixture/confirm'){
        const u=accounts.get(body.email);if(!u)return send(404,{});u.email_confirmed_at=new Date().toISOString();await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[u.id]);const code=randomBytes(24).toString('hex');codes.set(code,{u,challenge:u.challenge});return send(200,{code});
      }
      if(url.pathname==='/auth/v1/signup'){
        if(accounts.has(body.email))return send(422,{msg:'User already registered'});
        const u={id:randomUUID(),email:body.email,aud:'authenticated',role:'authenticated',email_confirmed_at:null,created_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},factors:[],password:body.password,challenge:body.code_challenge};accounts.set(u.email,u);
        await db.exec('reset role');await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,null)',[u.id,u.email]);return send(200,publicUser(u));
      }
      if(url.pathname==='/auth/v1/token'){
        if(url.searchParams.get('grant_type')==='pkce'){
          const pending=codes.get(body.auth_code);if(!pending||typeof body.code_verifier!=='string'||createHash('sha256').update(body.code_verifier).digest('base64url')!==pending.challenge)return send(400,{msg:'Invalid PKCE verifier'});codes.delete(body.auth_code);return send(200,await token(pending.u));
        }
        if(url.searchParams.get('grant_type')==='refresh_token'){const s=sessions.get(body.refresh_token);return s?send(200,await token(s.u,s.aal)):send(401,{msg:'Invalid refresh token'});}
        const u=accounts.get(body.email);if(!u||u.password!==body.password||!u.email_confirmed_at)return send(400,{msg:'Invalid login credentials',code:'invalid_credentials'});return send(200,await token(u));
      }
      if(url.pathname==='/auth/v1/recover'){
        if(foundationJourneys&&accounts.has(body.email))recoveries.set(body.email,{challenge:body.code_challenge});
        return send(200,{});
      }
      if(url.pathname==='/auth/v1/user'){
        if(!session)return send(401,{msg:'Invalid token'});
        if(request.method==='PUT'&&body.password)session.u.password=body.password;
        return send(200,publicUser(session.u));
      }
      if(url.pathname==='/auth/v1/logout'){
        if(foundationJourneys&&failLogout)return send(500,{msg:'Synthetic session retirement unavailable'});
        if(session){
          const affected=foundationJourneys&&url.searchParams.get('scope')!=='local'?[...new Set(sessions.values())].filter(s=>s.u.id===session.u.id):[session];
          await db.exec('reset role');
          for(const s of affected){await db.query('delete from auth.sessions where id=$1',[s.sessionId]);sessions.delete(s.access_token);sessions.delete(s.refresh_token);}
        }
        return send(200,{});
      }
      if(url.pathname==='/auth/v1/factors'&&session){const id=randomUUID();session.u.factors.push({id,factor_type:'totp',status:'unverified',friendly_name:'Synthetic authenticator'});return send(200,{id,type:'totp',totp:{qr_code:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/><text x="5" y="50">TEST QR</text></svg>',secret:'SYNTHETIC',uri:'otpauth://totp/Synthetic?secret=SYNTHETIC'}});}
      if(/^\/auth\/v1\/factors\/.+\/challenge$/.test(url.pathname)&&session)return send(200,{id:randomUUID(),expires_at:Math.floor(Date.now()/1000)+120});
      if(/^\/auth\/v1\/factors\/.+\/verify$/.test(url.pathname)&&session){if(body.code!=='123456')return send(400,{msg:'Synthetic invalid code'});const id=url.pathname.split('/')[4];const f=session.u.factors.find(f=>f.id===id);if(!f)return send(404,{});f.status='verified';return send(200,await token(session.u,'aal2'));}
      await asUser(db,session?.u.id||null,session?.aal||'aal1',validator?'service_role':session?'authenticated':'anon',session?.sessionId||null);
      if(url.pathname.startsWith('/rest/v1/rpc/')){
        const name=url.pathname.split('/').at(-1);identifier(name);
        const args=Object.entries(body);const placeholders=args.map(([name],i)=>`${identifier(name)} => $${i+1}`).join(',');
        const result=await db.query(`select public.${identifier(name)}(${placeholders}) as result`,args.map(([,v])=>v));
        return send(200,result.rows[0]?.result??null);
      }
      if(url.pathname.startsWith('/rest/v1/')){
        const table=url.pathname.split('/').at(-1);if(!tables.has(table))return send(404,{});
        const values=[];const clauses=[];
        for(const [key,value] of url.searchParams){
          if(['select','order','offset','limit'].includes(key))continue;
          const col=tradingOnly&&key==='payload->>origin'?"t.payload->>'origin'":`t.${identifier(key)}`;
          if(value==='is.null')clauses.push(`${col} is null`);
          else if(value.startsWith('in.(')){const vs=value.slice(4,-1).split(',').map(v=>v.replaceAll('"',''));const ps=vs.map(v=>{values.push(v);return `$${values.length}`;});clauses.push(`${col} in (${ps.join(',')})`);}
          else{const op=value.startsWith('eq.')?'=':value.startsWith('ilike.')?'ilike':null;if(!op)throw new Error('Unsupported fixture filter');values.push(value.slice(value.indexOf('.')+1));clauses.push(`${col} ${op} $${values.length}`);}
        }
        const where=clauses.length?`where ${clauses.join(' and ')}`:'';let json='to_jsonb(t)';
        if(url.searchParams.get('select')?.includes('businesses('))json="to_jsonb(t)||jsonb_build_object('businesses',(select to_jsonb(b) from public.businesses b where b.id=t.business_id))";
        const order=(url.searchParams.get('order')||'').split(',').filter(Boolean).map(o=>{const [col,dir]=o.split('.');return `t.${identifier(col)} ${dir==='desc'?'desc':'asc'}`;}).join(',');
        const offset=Number(url.searchParams.get('offset')||0);const limit=Number(url.searchParams.get('limit')||1000);if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(limit))throw new Error('Invalid fixture page');
        const count=(await db.query(`select count(*)::integer as n from public.${identifier(table)} t ${where}`,values)).rows[0].n;
        const rows=(await db.query(`select ${json} as row from public.${identifier(table)} t ${where} ${order?'order by '+order:''} limit ${Math.min(limit,1000)} offset ${offset}`,values)).rows.map(r=>r.row);
        const headers={'Content-Range':`${offset}-${offset+rows.length-1}/${count}`};
        if(request.headers.accept?.includes('vnd.pgrst.object+json'))return rows.length===1?send(200,rows[0],headers):send(406,{code:'PGRST116',message:'No single row',details:'0 rows'},headers);
        return send(200,rows,headers);
      }
      if(request.method==='POST'&&url.pathname.startsWith('/storage/v1/object/verification/')&&session){
        const path=url.pathname.slice('/storage/v1/object/verification/'.length);
        let storedBytes=bytes;let mime=request.headers['content-type'];
        if(mime?.startsWith('multipart/form-data')){
          const data=await new Response(bytes,{headers:{'Content-Type':mime}}).formData();
          const file=[...data.values()].find(v=>v instanceof Blob);if(!file)throw new Error('Missing fixture upload');
          storedBytes=Buffer.from(await file.arrayBuffer());mime=file.type;
        }
        await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('verification',$1,$2,$3)",[path,session.u.id,JSON.stringify({mimetype:mime,size:storedBytes.length})]);
        objects.set(path,{bytes:storedBytes,mime});return send(200,{Key:`verification/${path}`,Id:randomUUID()});
      }
      if(request.method==='GET'&&url.pathname.startsWith('/storage/v1/object/verification/')&&(session||validator)){
        const path=url.pathname.slice('/storage/v1/object/verification/'.length);
        const allowed=await db.query("select id from storage.objects where bucket_id='verification' and name=$1",[path]);const object=objects.get(path);
        if(!allowed.rows.length||!object)return send(404,{message:'Object unavailable'});
        response.writeHead(200,{'Content-Type':object.mime});return response.end(object.bytes);
      }
      if(url.pathname.startsWith('/storage/v1/object/sign/verification/')&&session){const path=url.pathname.slice('/storage/v1/object/sign/verification/'.length);const obj=await db.query("select id from storage.objects where bucket_id='verification' and name=$1",[path]);return obj.rows.length?send(200,{signedURL:`/object/sign/verification/${path}?token=SYNTHETIC` } ):send(404,{message:'Object missing'});}
      return send(404,{message:'Unimplemented synthetic endpoint'});
    }catch(error){return send(400,{code:error.code||'fixture_error',message:error.message});}
  }).catch(()=>{response.writeHead(500);response.end('Fixture failure');});
});
server.listen(54329,'127.0.0.1',()=>console.log(`Synthetic Auth/REST fixture ready on 127.0.0.1:54329 (${importer}, ${supplier})`));
process.on('SIGINT',()=>server.close(async()=>{await db.close();process.exit(0);}));
