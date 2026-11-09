import fs from 'node:fs/promises';
import {database,seedUsers,asUser,ids} from './database.mjs';
export {asUser,ids};
export const tradeInput=(extra={})=>({origin:'Guji',grade:'Grade 1',process:'washed',quantity:'100',unit:'feresula',price:'5',currency:'USD',price_unit:'kg',trade_type:'international',destination:'Hamburg',location:'Synthetic warehouse',window_start:'2099-01-01',window_end:'2099-02-01',specifications:'Synthetic quality requirements',packaging:'Synthetic bags',sample_requirements:'To be agreed; no reservation',document_requirements:'Synthetic documents',...extra});
export async function tradingDatabase(){const db=await database();for(const name of (await fs.readdir('supabase/migrations')).filter(n=>n.includes('_phase2_')).sort())await db.exec(await fs.readFile('supabase/migrations/'+name,'utf8'));return db;}
export async function seedTrading(db,{approveBuyer=false,approveSupplier=true}={}){
 await seedUsers(db);await asUser(db,ids.alice);
 const buyer=(await db.query("select public.register_business('Synthetic buyer secret identity','Germany','overseas_buyer','buyer','Synthetic buyer registration data') as id")).rows[0].id;
 await asUser(db,ids.bob);const supplier=(await db.query("select public.register_business('Synthetic supplier secret identity','Ethiopia','exporter','supplier','Synthetic supplier registration data') as id")).rows[0].id;
 await db.exec('reset role');
 await db.query("insert into public.staff_grants(user_id,permission) select $1,unnest(array['trading.requests.review','trading.lots.review','trading.matches.manage','trading.offers.issue','trading.commissions.manage'])",[ids.reviewer]);
 for(const [b,yes]of [[buyer,approveBuyer],[supplier,approveSupplier]])if(yes)await db.query("update public.capabilities set status='approved',reviewed_by=$2,expires_at='2099-12-31',revision=revision+1 where business_id=$1",[b,ids.reviewer]);
 return {buyer,supplier};
}
