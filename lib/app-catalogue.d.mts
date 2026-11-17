export type AppCategory='content'|'communication'|'analytics'|'sales';
export type App={readonly key:string,readonly name:string,readonly mark:string,readonly category:AppCategory,readonly readTools:readonly string[]};
export type AppState='connected'|'attention'|'off';
/** One visible Agent's view of one app. `state` null: its profile could not be read now. `own` false: the Agent still
 *  runs on the main Agent's profile, so nothing can be turned on for it alone. */
export type AppAgent={id:string,name:string,connection:string,main:boolean,own:boolean,state:AppState|null};
/** `state` is mergedState(agents), never stored. */
export type CompanyApp={key:string,name:string,mark:string,category:AppCategory,state:AppState,agents:AppAgent[]};
export const apps:readonly App[];
export function appByKey(key:unknown):App|undefined;
export function knownApp(name:string):{key:string,name:string,mark:string}|undefined;
export function appState(installed:boolean,reached:boolean):AppState;
export function mergedState(agents:readonly {own:boolean,state:AppState|null}[]):AppState;
export function appConfig(app:App,redirectUri:string):{mcp_servers:Record<string,{enabled:true,tools:{include:string[],prompts:false,resources:false},oauth:{redirect_uri:string}}>};
