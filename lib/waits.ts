// What a person waited for in a Conversation, as their browser measured it (#762): sent to /api/waits, which writes one
// line in the container log (lib/diagnostics.mjs waitLine). Ids and whole milliseconds only, never a message; a report
// that cannot be sent is dropped, and nothing waits on it.
export type BrowserWait={event:'message_drawn'|'reply_drawn',company:string,conversation:string,ms:number,from?:'stream'|'stored'};
export function reportWait(wait:BrowserWait) {
 try {
  const body=JSON.stringify({...wait,ms:Math.round(wait.ms)});
  if(navigator.sendBeacon?.('/api/waits',new Blob([body],{type:'application/json'}))) return;
  void fetch('/api/waits',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});
 } catch { /* A report must never break the page. */ }
}
