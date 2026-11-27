export type AppCategory='ads'|'content'|'communication'|'analytics'|'sales'|'more';
export type AppSource='engine'|'remote'|'sandbox'|'own'|'custom';
/** `command`: a command server the Owner added, which runs in the Company's work sandbox (#459). */
export type AppAuth='oauth'|'header'|'none'|'command';
/** A vendor that refuses OAuth dynamic client registration (#914): the install settings that hold its own client, and the
 *  page that tells the install's Owner how to make it. */
export type AppOAuthClient={readonly id:string,readonly secret:string,readonly guide:string};
export type App={readonly key:string,readonly name:string,readonly mark:string,readonly category:AppCategory,readonly source:AppSource,readonly url?:string,readonly docs?:string,readonly auth?:AppAuth,readonly care?:'customers'|'money',readonly oauthClient?:AppOAuthClient};
export type OAuthClient={id:string,secret?:string};
export type AppState='connected'|'attention'|'off'|'checking';
/** One visible Agent's view of one app. `state` null: its profile could not be read now. `own` false: the Agent still
 *  runs on the main Agent's profile, so nothing can be turned on for it alone. */
export type AppAgent={id:string,name:string,connection:string,main:boolean,own:boolean,state:AppState|null};
/** A field the Engine's catalogue declares for an app, never a stored value. */
export type AppEnv={name:string,prompt:string,required:boolean};
/** `state` is mergedState(agents), never stored. `clientNeeded`: the vendor refuses dynamic registration and the install
 *  has no client of its own yet (#914), so nothing can be connected until its Owner adds one; `guide` says how. */
export type CompanyApp={key:string,name:string,mark:string,category:AppCategory,source:AppSource,url?:string,command?:string,args?:string[],docs?:string,auth?:AppAuth,care?:'customers'|'money',fields?:AppEnv[],clientNeeded?:{guide:string},state:AppState,agents:AppAgent[]};
export const appKey:RegExp;
export const apps:readonly App[];
export const appByKey:(key:unknown)=>App|undefined;
export const customApp:(key:string)=>App;
export const serverKeyOf:(name:unknown)=>string;
export function knownApp(name:string):{key:string,name:string,mark:string}|undefined;
export function appState(installed:boolean,reached:boolean):AppState;
export function mergedState(agents:readonly {own:boolean,state:AppState|null}[]):AppState;
export function oauthConfig(redirectUri:string|null,client?:OAuthClient|null):{oauth?:{redirect_uri:string,client_id?:string,client_secret?:string}};
export function appConfig(app:App,redirectUri:string|null,client?:OAuthClient|null):{mcp_servers:Record<string,{enabled:true,oauth?:{redirect_uri:string,client_id?:string,client_secret?:string}}>};
