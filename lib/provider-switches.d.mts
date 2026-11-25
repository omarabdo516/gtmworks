import type { SupabaseClient } from '@supabase/supabase-js';
import type { Placed } from './provider-order.mjs';
type Account={provider:string,account:string,exhausted?:boolean};
export function accountOrders(accounts:Account[],order:Record<string,Placed>):Record<string,{account:string,off:boolean}[]>;
export function accountName(accounts:Account[],names:Record<string,string>,provider:string,account:string):string;
export function keepProviderAccounts(db:SupabaseClient,options?:{memory?:Map<string,unknown>,driver?:Record<string,unknown>,engineFor?:(company:string)=>Promise<unknown>,now?:()=>number}):Promise<number>;
export function applyAccountOrder(db:SupabaseClient,change:{company:string,hermes?:unknown,driver?:Record<string,unknown>}):Promise<void>;
