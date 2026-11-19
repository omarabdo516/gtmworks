import type { SupabaseClient } from '@supabase/supabase-js';
import type { LibraryEntry, LibraryFile, LibraryList } from './hermes.mjs';
export type { LibraryEntry, LibraryFile, LibraryList };
// A row of the Library as the page draws it: an entry, and for a folder how many files it holds and when the newest was
// saved (null when it holds none or cannot be read now).
export type LibraryRow=LibraryEntry&{files:number|null,latest:string|null};
export type LibraryView={state:'found',entries:LibraryRow[]}|{state:'missing'|'refused'|'unreachable'|'invalid',entries:null};
export function agentLibrary(db:SupabaseClient,request:{company:string,agent:unknown,folder?:unknown,root?:unknown,hermes?:{address:string,key:string}|null,driver?:object}):Promise<LibraryView>;
export function agentFileDownload(db:SupabaseClient,request:{company:string,agent:string,folder?:unknown,name:unknown,root?:unknown,hermes?:{address:string,key:string}|null,driver?:object}):Promise<LibraryFile>;
// One file as the preview may draw it (#195): its kind, its type, its whole size, whether more follows, and the text only
// for the kinds drawn as text.
export type PreviewKind='image'|'text'|'table'|'none';
export type LibraryPreviewBody={name:string,kind:PreviewKind,type:string,byteSize:number,truncated:boolean,text:string|null};
export type PreviewView={state:'found',preview:LibraryPreviewBody}|{state:'missing'|'refused'|'unreachable'|'invalid'|'tooLarge'|'failed',preview:null};
export function agentFilePreview(db:SupabaseClient,request:{company:string,agent:string,folder?:unknown,name:unknown,root?:unknown,hermes?:{address:string,key:string}|null,driver?:object}):Promise<PreviewView>;
