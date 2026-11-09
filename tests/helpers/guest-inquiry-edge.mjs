// Test-only socket-derived signing edge; no user-supplied assertion is forwarded.
import http from 'node:http';
import {createHmac} from 'node:crypto';
if(process.env.ETLINK_APP_URL!=='http://127.0.0.1:3104'||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54329'||process.env.ETLINK_SYNTHETIC_TEST_MODE!=='false'||!process.env.ETLINK_EDGE_ASSERTION_SECRET)throw Error('Local signed test edge only');
const server=http.createServer((req,res)=>{
 if(req.url==='/_test-edge/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"localOnly":true}');}
 const headers={...req.headers};
 for(const key of Object.keys(headers))if(key.startsWith('x-etlink-')||key.startsWith('x-forwarded-'))delete headers[key];
 const ip=req.socket.remoteAddress?.replace(/^::ffff:/,'');
 if(!['127.0.0.1','::1'].includes(ip)){res.writeHead(403);return res.end();}
 const stamp=String(Date.now());headers['x-etlink-client-ip']=ip;headers['x-etlink-edge-time']=stamp;headers['x-etlink-edge-signature']=createHmac('sha256',process.env.ETLINK_EDGE_ASSERTION_SECRET).update(`${stamp}\n${ip}`).digest('hex');
 const upstream=http.request({host:'127.0.0.1',port:3102,path:req.url,method:req.method,headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);
});
server.listen(3104,'127.0.0.1');process.on('SIGINT',()=>server.close(()=>process.exit(0)));
