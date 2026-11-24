export function servesOwnList(provider: string): boolean;
export function servedListOf(provider: string): {keyEnv:string,baseEnv:string,base:string}|null;
export function readServedModels(read: {provider:string,key:string,base?:string|null}): Promise<string[]|null>;
export function keepServed(models: string[], served: string[]|null): string[];
