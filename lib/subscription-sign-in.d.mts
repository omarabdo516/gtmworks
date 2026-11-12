import type { SignInState } from './hermes-sign-in.mjs';
export type SubscriptionSignIn={
 kind:'engine'|'home',
 start(provider:string):Promise<SignInState>,
 state(provider:string):Promise<SignInState>,
 disconnect(provider:string):Promise<SignInState>,
 complete(provider:string,authorizationCode?:unknown):Promise<SignInState>,
};
export type Busy={readonly state:'busy'};
export const busy:Busy;
export function signInFor(company:string,env?:Record<string,string|undefined>):SubscriptionSignIn|null;
export type SignInLimits={
 read(key:string,caller:string,work:()=>Promise<unknown>):Promise<unknown>,
 act(key:string,caller:string,work:()=>Promise<unknown>,options?:{starts?:boolean}):Promise<unknown>,
};
export function signInLimits(options?:{reads?:number,actions?:number,perCaller?:number,waiting?:number,fresh?:number}):SignInLimits;
export function subscriptionStates(signIn:SubscriptionSignIn,options:{company:string,caller:string,limits?:SignInLimits}):Promise<{providers:Record<string,SignInState>}|Busy>;
export function subscriptionAction(signIn:SubscriptionSignIn,options:{company:string,caller:string,provider:string,intent:string,authorizationCode?:unknown,limits?:SignInLimits}):Promise<SignInState|Busy>;
