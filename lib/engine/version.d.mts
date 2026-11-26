export const hermesVersion:string;
export type HermesState={state:'connected'|'refused'|'unreachable'|'untested_version',version:string|null,features:string[]};
export function testHermes(connection:{address:string,profile:string,key:string}):Promise<HermesState>;
