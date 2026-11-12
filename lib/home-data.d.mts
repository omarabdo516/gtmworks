export function metricValue(value:number|null|undefined,language?:import("./i18n.mjs").Language):string;
export type HomeCard={id:number,title:string,stage_id:number,next_actor:string|null,created_at:string};
export type HomeStage={id:number,name:string,kind:string,stage_key:string|null};
export type HomeEvent={id:number,card_id:number,action:string,details:Record<string,unknown>,created_at:string};
export function homeCharts(cards:HomeCard[]|null,stages:HomeStage[]|null,activity:HomeEvent[]|null,now?:number):{delivered:{label:string,value:number}[]|null,stages:{label:string,value:number}[]|null,acceptance:number|null};
