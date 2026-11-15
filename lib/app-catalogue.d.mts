export type AppCategory='content'|'communication'|'analytics'|'sales';
export type App={readonly key:string,readonly name:string,readonly mark:string,readonly category:AppCategory,readonly readTools:readonly string[]};
export type AppState='connected'|'attention'|'off';
export type CompanyApp={key:string,name:string,mark:string,category:AppCategory,state:AppState};
export const apps:readonly App[];
export function appByKey(key:unknown):App|undefined;
export function appState(installed:boolean,reached:boolean):AppState;
export function appConfig(app:App,redirectUri:string):{mcp_servers:Record<string,{enabled:true,tools:{include:string[],prompts:false,resources:false},oauth:{redirect_uri:string}}>};
