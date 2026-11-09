'use client';
import {useActionState,type ReactNode} from 'react';
import {tradingMutation} from '@/app/portal/trading/actions';
import {initialState} from '@/lib/foundation/validation';
export function TradingForm({operation,label,children}:{operation:string;label:string;children:ReactNode}){
 const [state,action,pending]=useActionState(tradingMutation,initialState);
 return <form action={action} className="foundation-form"><input type="hidden" name="operation" value={operation}/>{children}<button className="button" disabled={pending}>{pending?'Saving…':label}</button><p role="status" aria-live="polite">{state.message}</p>{state.link&&<label>Private invitation link — copy now<input readOnly value={state.link} onFocus={e=>e.target.select()}/></label>}</form>;
}
