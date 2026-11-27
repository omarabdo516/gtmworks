export type AppCategory='ads'|'content'|'communication'|'analytics'|'sales'|'more';
export type AppSource='engine'|'remote'|'own'|'custom';
/** What the own-tool card is filled with for a command server the Owner runs (decision 0079). */
export type AppPreset={readonly command:string,readonly args:readonly string[]};
/** `command`: a command server the Owner added, which runs in the Company's work sandbox (#459). */
export type AppAuth='oauth'|'header'|'none'|'command';
export type App={readonly key:string,readonly name:string,readonly mark:string,readonly category:AppCategory,readonly source:AppSource,readonly url?:string,readonly docs?:string,readonly auth?:AppAuth,readonly care?:'customers'|'money',readonly preset?:AppPreset};
export type AppState='connected'|'attention'|'off'|'checking';
/** One visible Agent's view of one app. `state` null: its profile could not be read now. `own` false: the Agent still
 *  runs on the main Agent's profile, so nothing can be turned on for it alone. */
export type AppAgent={id:string,name:string,connection:string,main:boolean,own:boolean,state:AppState|null};
/** A field the Engine's catalogue declares for an app, never a stored value. */
export type AppEnv={name:string,prompt:string,required:boolean};
/** `state` is mergedState(agents), never stored. */
export type CompanyApp={key:string,name:string,mark:string,category:AppCategory,source:AppSource,url?:string,command?:string,args?:string[],docs?:string,auth?:AppAuth,care?:'customers'|'money',fields?:AppEnv[],preset?:AppPreset,state:AppState,agents:AppAgent[]};
export const appKey:RegExp;
export const apps:readonly App[];
export const appByKey:(key:unknown)=>App|undefined;
export const offeredApp:(key:unknown)=>App|undefined;
export const openDesignGuide:string;
export const customApp:(key:string,kind?:{command?:boolean})=>App;
export const presetOf:(key:unknown)=>App|undefined;
export const serverKeyOf:(name:unknown)=>string;
export function knownApp(name:string):{key:string,name:string,mark:string}|undefined;
export function appState(installed:boolean,reached:boolean):AppState;
export function mergedState(agents:readonly {own:boolean,state:AppState|null}[]):AppState;
export function appConfig(app:App,redirectUri:string|null):{mcp_servers:Record<string,{enabled:true,oauth?:{redirect_uri:string}}>};
