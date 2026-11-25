import { logActionFailure } from '@/lib/diagnostics.mjs';

// A read that failed is not an empty answer (#776, #777; spec #760). A page or a record that cannot read what it needs
// throws this, and the page answers with the error page (app/error.tsx: "Could not load this page" and "Try again") and an
// error status, never "not found", an empty channel or a page without the reader's controls. A route answers it with its
// own error status, and the browser keeps what it showed.
export class ReadFailed extends Error {
 constructor(what:string) { super(`${what} could not be read`); this.name='ReadFailed'; }
}

// One read's data, or ReadFailed when the database answered an error. `what` names the read in the log, never a value.
export function mustRead<T>(answer:{data:T,error:{code?:string}|null},what:string):T {
 if(answer.error) {
  logActionFailure('read',{code:answer.error.code,message:`${what} could not be read`});
  throw new ReadFailed(what);
 }
 return answer.data;
}
