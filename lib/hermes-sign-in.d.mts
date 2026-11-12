export type SignInProvider='openai-codex'|'anthropic';
export type SignInState={state:'pending',link:string,code:string|null}|{state:'connected'|'disconnected'|'failed'};
export const signInProviders:SignInProvider[];
export function companyHermesHome(company:string,env?:Record<string,string|undefined>):string|null;
export function hermesSignIn(options:{home:string,env?:Record<string,string|undefined>}):{
 start(provider:string):Promise<SignInState>,
 state(provider:string):Promise<SignInState>,
 disconnect(provider:string):Promise<SignInState>,
};
