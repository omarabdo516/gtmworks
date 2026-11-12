export type SignInProvider='openai-codex'|'anthropic';
export type SignInState={state:'pending',link:string,code:string|null,needsCode?:true}|{state:'connected'|'disconnected'|'failed'|'unavailable'};
export const signInProviders:SignInProvider[];
export function signInsWaiting():number;
export function credentialIds(output:string,provider:string):string[]|null;
export function deviceCode(text:string):string|null;
export function companyHermesHome(company:string,env?:Record<string,string|undefined>):string|null;
export function hermesSignIn(options:{home:string,env?:Record<string,string|undefined>}):{
 start(provider:string):Promise<SignInState>,
 state(provider:string):Promise<SignInState>,
 disconnect(provider:string):Promise<SignInState>,
 complete(provider:string,authorizationCode:unknown):Promise<SignInState>,
};
