export const companySoul:string;
export function keepCompanyProfiles(db:any,options:{hermes:{address:string,profile:string,key:string,managementAddress?:string}|null,encryptionKey:string|undefined,waiting?:Map<string,number>,now?:()=>number,driver?:object}):Promise<{provided:number,configured:number,attached:number,moved:number}>;
export function checkAgentTools(db:any,options:{encryptionKey:string|undefined,read?:Function}):Promise<number>;
