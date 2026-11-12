type Env = Record<string, string | undefined>;
export function appOrigin(env?: Env): string;
export function appUrl(path: string, env?: Env): URL;
export function crossSiteWrite(headers: Headers): boolean;
