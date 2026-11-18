export const maxFiles:number;
export const maxBytes:number;
export const maxRequestBytes:number;
export const imageTypes:string[];
export function isThumbnail(type:string):boolean;
export function attachmentHeaders(file:{name:string,content_type:string}):Record<string,string>;
export function filesProblem(files:{size:number}[]):'count'|'size'|null;
export function conversationFilesProblem(files:{name?:string,size:number,content_type?:string,type?:string}[],text?:string):'type'|'count'|'size'|'request'|null;
