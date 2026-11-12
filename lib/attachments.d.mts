export const maxFiles:number;
export const maxBytes:number;
export function isThumbnail(type:string):boolean;
export function attachmentHeaders(file:{name:string,content_type:string}):Record<string,string>;
export function filesProblem(files:{size:number}[]):'count'|'size'|null;
