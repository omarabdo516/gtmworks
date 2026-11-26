import { engineRequest, bodyLimit, bothListeners } from './transport.mjs';

// One Agent is one Hermes profile (ADR 0011). Profiles are made and read on Hermes's management listener (its
// dashboard, port 9119 of the same host unless the connection names another address), authenticated with the same key
// as the Run API. A new profile has no Run API key of its own, so creating an Agent also gives it the connection's key;
// a create that stops part way is failed, and its profile reads as not ready rather than being changed by a retry.
export const agentName=/^[a-z0-9][a-z0-9_-]{0,63}$/;
// A model is "provider/model", split on the first slash (openrouter/anthropic/claude-opus-4.6); none keeps the default.
export const modelOf=model=>/^([^/\s]+)\/(\S+)$/.exec(model)?.slice(1)||null;
export const noAgent=state=>({state,agent:null});
// The state an answer that is not a success means: refused for a refused key, unreachable for anything else.
export const refusal=response=>[401,403].includes(response.status)?'refused':'unreachable';
export async function manage(connection,path,{method='GET',body,timeout=method==='POST'?15000:5000}={}) {
 const response=await engineRequest(connection,{listener:'management',path,method,...(body?{body}:{}),deadline:timeout});
 return {response,result:await boundedJson(response)};
}
export const reachable=bothListeners;
export const query=name=>`?profile=${encodeURIComponent(name)}`;
export const stepState=step=>[401,403].includes(step.response.status)?'refused':'failed';
export const noProfile=state=>({state,toolsets:null});
// A run record holds at most a 200,000-character reply (4 bytes a character at most), well under this limit.
export const tooLarge=Symbol('tooLarge');
export async function boundedJson(response) {
 const reader=response.body?.getReader(); if(!reader) return null;
 const chunks=[]; let size=0;
 for(;;) {
  const {done,value}=await reader.read();
  if(done) break;
  size+=value.byteLength;
  if(size>bodyLimit) { await reader.cancel().catch(()=>{}); return tooLarge; }
  chunks.push(value);
 }
 const body=new Uint8Array(size); let at=0; for(const chunk of chunks) { body.set(chunk,at); at+=chunk.byteLength; }
 try { return JSON.parse(new TextDecoder().decode(body)); } catch { return null; }
}
// How long any one read of the Engine may take before it is unreachable.
export const requestTime=5000;
