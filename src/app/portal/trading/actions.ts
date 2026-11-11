'use server';
import {revalidatePath} from 'next/cache';
import {createHash,randomBytes} from 'node:crypto';
import {authenticatedClient,appUrl} from '@/lib/supabase/server';
import {requireTrading} from '@/lib/trading/config';
import {field,choice,uuid,integer,email,type ActionState} from '@/lib/foundation/validation';
import {tradingPermissions,origins} from '@/lib/trading/types';
import {availabilityWindow,calendarDate,TradingInputError} from '@/lib/trading/validation';
function decimal(value:string){if(!/^\d{1,12}(\.\d{1,6})?$/.test(value)||Number(value)<=0)throw new TradingInputError('Enter a positive decimal number.');return value;}
function date(data:FormData,name:string){return calendarDate(field(data,name,10,10));}
function quote(form:FormData){return {origin:choice(field(form,'origin'),origins),grade:choice(field(form,'grade'),['1','2','3','4','5','6','7','8','9','ungraded'] as const),process:choice(field(form,'process'),['washed','natural','honey','other'] as const),quantity_kg:decimal(field(form,'quantity_kg')),price:decimal(field(form,'price')),currency:field(form,'currency',3,3).toUpperCase(),incoterm:choice(field(form,'incoterm'),['EXW','FCA','FOB','CFR','CIF','DAP','to_be_agreed'] as const)};}
function selectedQuote(form:FormData,name:string){const parts=field(form,name).split(':');if(parts.length!==2)throw new TradingInputError('Choose a current private quote.');return {id:uuid(parts[0]),version:integer(parts[1])};}
const operations = new Set(['request_sample','sample_status','allocate_stock','reserve_stock','release_stock','create_deal','confirm_deal','advance_deal','commission_receipt']);
export async function tradingMutation(_state:ActionState,form:FormData):Promise<ActionState>{
 try { requireTrading(); } catch { return {ok:false,message:'Trading is unavailable on this deployment.'}; }
 try{
  const {db}=await authenticatedClient();const operation=field(form,'operation');let error:{code?:string;message?:string}|null=null;let link:string|undefined;
  switch(operation){
   case 'request_sample':({error}=await db.rpc('request_coffee_sample',{offer:uuid(field(form,'offer_id')),offer_version:integer(field(form,'offer_version')),i:uuid(field(form,'id')),grams:decimal(field(form,'quantity_grams'))}));break;
   case 'sample_status':{
    const status=choice(field(form,'next_status'),['dispatched','received','accepted','rejected','cancelled'] as const);
    ({error}=await db.rpc('update_coffee_sample',{i:uuid(field(form,'id')),v:integer(field(form,'revision')),next_status:status,carrier_name:status==='dispatched'?field(form,'carrier',2,100):'',tracking:status==='dispatched'?field(form,'tracking',3,120):''}));break;
   }
   case 'allocate_stock':({error}=await db.rpc('allocate_coffee_stock',{m:uuid(field(form,'match_id')),sample:uuid(field(form,'sample_id')),i:uuid(field(form,'id')),quantity:decimal(field(form,'quantity_kg'))}));break;
   case 'reserve_stock':({error}=await db.rpc('reserve_coffee_stock',{allocation:uuid(field(form,'allocation_id')),i:uuid(field(form,'id')),expires:new Date(date(form,'expires_at')+'T23:59:59Z').toISOString()}));break;
   case 'release_stock':({error}=await db.rpc('release_coffee_stock',{domain:choice(field(form,'domain'),['allocation','reservation'] as const),i:uuid(field(form,'id')),v:integer(field(form,'revision'))}));break;
   case 'create_deal':{
    const buyer=selectedQuote(form,'buyer_quote'),supplier=selectedQuote(form,'supplier_quote');
    ({error}=await db.rpc('create_coffee_deal',{reservation:uuid(field(form,'reservation_id')),buyer_quote:buyer.id,buyer_quote_version:buyer.version,supplier_quote:supplier.id,supplier_quote_version:supplier.version,i:uuid(field(form,'id'))}));break;
   }
   case 'confirm_deal':
    if(form.get('confirm_exact_record')!=='on')throw new TradingInputError('Confirm that you are authorized for this exact business record.');
    ({error}=await db.rpc('confirm_coffee_deal',{i:uuid(field(form,'id')),b:uuid(field(form,'business_id')),kind:choice(field(form,'kind'),['terms','delivery'] as const)}));break;
   case 'advance_deal':{
    const status=choice(field(form,'next_status'),['confirmed','contract_signed','in_transit','delivered','completed','cancelled'] as const);
    ({error}=await db.rpc('advance_coffee_deal',{i:uuid(field(form,'id')),v:integer(field(form,'revision')),next_status:status,evidence:field(form,'evidence',['contract_signed','delivered'].includes(status)?3:0,120)}));break;
   }
   case 'commission_receipt':({error}=await db.rpc('record_commission_receipt',{receivable:uuid(field(form,'receivable_id')),i:uuid(field(form,'id')),amount_received:decimal(field(form,'amount')),payment_reference:field(form,'payment_reference',3,120)}));break;
   case 'save':{
    const d=choice(field(form,'domain'),['request','lot'] as const),s=choice(field(form,'status'),['draft','submitted','withdrawn'] as const);
    const price=field(form,'price',0,30);const p=s==='withdrawn'?{}:{origin:field(form,'origin',2,160),grade:field(form,'grade',1,80),process:choice(field(form,'process'),['washed','natural','honey','other'] as const),quantity:decimal(field(form,'quantity')),unit:choice(field(form,'unit'),['kg','feresula','lb'] as const),price:price?decimal(price):'',currency:field(form,'currency',3,3).toUpperCase(),price_unit:choice(field(form,'price_unit'),['kg','feresula','lb'] as const),trade_type:choice(field(form,'trade_type'),['international','domestic','exporter_to_exporter'] as const),incoterm:choice(field(form,'incoterm'),['to_be_agreed','EXW','FCA','FOB','CFR','CIF','DAP'] as const),destination:field(form,'destination',0,1000),location:field(form,'location',0,1000),...availabilityWindow(form.get('window_start'),form.get('window_end')),specifications:field(form,'specifications',0,1000),packaging:field(form,'packaging',0,1000),sample_requirements:field(form,'sample_requirements',0,1000),document_requirements:field(form,'document_requirements',0,1000)};
    ({error}=await db.rpc('save_trade_record',{d,b:uuid(field(form,'business_id')),i:uuid(field(form,'id')),v:integer(field(form,'revision'),0),p,s}));break;
   }
   case 'review':({error}=await db.rpc('review_trade_record',{d:choice(field(form,'domain'),['request','lot'] as const),i:uuid(field(form,'id')),v:integer(field(form,'revision')),s:field(form,'status'),r:field(form,'reason',5,1000)}));break;
   case 'match':({error}=await db.rpc('approve_trade_match',{req:uuid(field(form,'request_id')),rv:integer(field(form,'request_revision')),lot:uuid(field(form,'lot_id')),lv:integer(field(form,'lot_revision')),reason:field(form,'reason',5,1000)}));break;
   case 'commission':({error}=await db.rpc('create_commission_terms',{m:uuid(field(form,'match_id')),payer:uuid(field(form,'payer')),calculation:choice(field(form,'calculation'),['percentage','fixed'] as const),amount:decimal(field(form,'amount')),currency:field(form,'currency',3,3).toUpperCase(),earning_trigger:choice(field(form,'earning_trigger'),['signed_sale_contract','confirmed_delivery'] as const),starts:new Date(date(form,'effective_from')+'T00:00:00Z').toISOString(),expires:new Date(date(form,'expires_at')+'T23:59:59Z').toISOString()}));break;
   case 'accept_commission':if(form.get('accept_exact_terms')!=='on')throw new TradingInputError('Confirm acceptance of the exact terms shown.');({error}=await db.rpc('accept_commission_terms',{i:uuid(field(form,'id'))}));break;
   case 'issue':({error}=await db.rpc('issue_trade_offer',{m:uuid(field(form,'match_id')),recipient:uuid(field(form,'recipient')),i:uuid(field(form,'id')),v:integer(field(form,'revision'),0),p:quote(form),expires:new Date(date(form,'valid_until')+'T23:59:59Z').toISOString()}));break;
   case 'respond':{const response=choice(field(form,'response'),['interested','declined','counter'] as const);({error}=await db.rpc('respond_trade_offer',{i:uuid(field(form,'id')),v:integer(field(form,'revision')),response,counter_payload:response==='counter'?quote(form):null,response_id:uuid(field(form,'response_id'))}));break;}
   case 'invite':{const perms=form.getAll('permissions').map(p=>choice(String(p),tradingPermissions));if(!perms.length)throw new TradingInputError('Select only the required trading permissions.');const token=randomBytes(32).toString('hex');({error}=await db.rpc('create_trading_invitation',{email_address:email(field(form,'email')),perms,hash:createHash('sha256').update(token).digest('hex')}));if(!error)link=appUrl()+'/portal/invitations#token='+token;break;}
   default:throw new TradingInputError('Unknown trading action.');
  }
  if(error){if(error.code==='42501')throw new TradingInputError('Current business eligibility, permission and MFA are required.');if(error.code==='40001')throw new TradingInputError('This record changed. Reload before trying again.');if(error.message?.includes('commission'))throw new TradingInputError('Current commission terms must be accepted before this protected step.');throw new TradingInputError('Change not saved. Check current status, revision, eligibility and inputs.');}
  revalidatePath('/portal');revalidatePath('/portal/trading','layout');revalidatePath('/admin/trading');revalidatePath('/admin/operations');return {ok:true,message:operations.has(operation)?'Recorded privately. Marketplace status updated.':operation==='invite'?'Private trading invitation created for 3 days. Copy now; no email was sent.':'Recorded privately. No introduction, stock reservation, sale or external email was created.',link};
 }catch(e){return {ok:false,message:e instanceof TradingInputError?e.message:'Trading service unavailable. Check your inputs and sign in again before retrying.'};}
}
