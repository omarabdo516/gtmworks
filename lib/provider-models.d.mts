export type ModelAccess={entries:{id:string,provider:string}[],off:Set<string>};
export const modelEnabled:(access:ModelAccess,choice:{provider:string,model:string})=>boolean;
export function offeredModels<T extends {provider:string,model:string}>(options:T[],access:ModelAccess|null):T[];
export function readModelAccess(db:unknown,request:{company:string,engine?:unknown}):Promise<ModelAccess|null>;
export function readProviderModels(db:unknown,request:{company:string}):Promise<Record<string,{model:string,enabled:boolean}[]>|null>;
export function changeProviderModel(db:unknown,change:{company:unknown,entry:unknown,model:unknown,enabled:unknown}):Promise<{status:number,body:Record<string,unknown>}>;
