export function metricValue(value:number|null|undefined,language?:import("./i18n.mjs").Language):string;
export type HomeCard={id:number,title:string,status:string,next_actor:string|null,created_at:string,assignee_agent?:string|null,wait?:{person:string,kind:'question'|'hand'|'permission',title:string}|null};
export function currentAgentCard(cards:HomeCard[]|null,agentId:string):HomeCard|null;
export type HomeEvent={id:number,card_id:number,action:string,details:Record<string,unknown>,created_at:string};
export function homeCharts(cards:HomeCard[]|null,activity:HomeEvent[]|null,now?:number):{delivered:{label:string,value:number}[]|null,statuses:{label:string,value:number}[]|null,acceptance:number|null};
