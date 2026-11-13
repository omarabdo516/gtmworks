// CI runs this in a Node container against the local install's gateway, with this repo's scripts/ mounted under /check,
// right after tests/install/rate-limit.install.ts has taken the browser's address past the auth service's rate limit
// (issue #41). Every attempt names other forged addresses (scripts/forged-identity.mjs).
//   fresh    another visitor, connecting from inside the install network: its wrong passwords are refused as wrong, not
//            limited, and the right password still signs in, so the limit counts per visitor, not for the whole install.
//   untrusted  a visitor inside the install network, whose X-Forwarded-For the gateway never believes: its wrong passwords
//            naming forged addresses reach the limit, so no forged address buys a fresh allowance.
//   limited  the browser's address again: the limit still answers within a few attempts, forged addresses or not.
import assert from 'node:assert/strict';
import { forgedIdentity } from './forged-identity.mjs';

const mode=process.argv[2];
const origin=process.env.APP_ORIGIN, anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, email=process.env.SIGN_IN_EMAIL;
assert.ok(['fresh','untrusted','limited'].includes(mode),'the mode is fresh, untrusted or limited');
assert.ok(origin && anon && email,'APP_ORIGIN, NEXT_PUBLIC_SUPABASE_ANON_KEY and SIGN_IN_EMAIL are set');

async function signIn(attempt,password) {
 const response=await fetch(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',
  headers:{apikey:anon,'content-type':'application/json',...forgedIdentity(attempt)},body:JSON.stringify({email,password})});
 return {status:response.status,body:await response.json().catch(()=>({}))};
}

if(mode==='fresh') {
 const password=process.env.SIGN_IN_PASSWORD;
 assert.ok(password,'SIGN_IN_PASSWORD is set');
 const wrong=10;
 for(let attempt=0; attempt<wrong; attempt++) {
  const answer=await signIn(attempt,`wrong-password-${attempt}`);
  assert.equal(answer.status,400,`another visitor is refused as wrong, not limited (HTTP ${answer.status}: ${JSON.stringify(answer.body)})`);
  assert.equal(answer.body.error_code,'invalid_credentials','another visitor gets the wrong-password answer');
 }
 const right=await signIn(wrong,password);
 assert.equal(right.status,200,`another visitor signs in with the right password (HTTP ${right.status}: ${JSON.stringify(right.body)})`);
 assert.ok(right.body.access_token,'another visitor gets a session');
 console.log(`Another visitor: ${wrong} wrong passwords refused as wrong, then signed in`);
} else if(mode==='untrusted') {
 // The bound only keeps a missing limit from hanging; it is above the install's allowance plus what refills meanwhile.
 const max=310;
 let limited=null, sent=0;
 for(; sent<max && !limited; sent++) {
  const answer=await signIn(sent,`untrusted-wrong-${sent}`);
  if(answer.status===429) limited=answer;
  else assert.equal(answer.status,400,`a wrong password is refused, not ${answer.status}: ${JSON.stringify(answer.body)}`);
 }
 assert.ok(limited,`a visitor inside the install network is limited within ${max} wrong passwords naming forged addresses`);
 assert.equal(limited.body.error_code,'over_request_rate_limit','the limited answer is the auth service rate limit');
 console.log(`A visitor inside the install network is limited after ${sent} wrong passwords naming forged addresses`);
} else {
 // The allowance refills slowly, so an attempt or two may count as an ordinary wrong password before the limit answers.
 const within=5;
 let limited=null, sent=0;
 for(; sent<within && !limited; sent++) {
  const answer=await signIn(sent,`still-wrong-${sent}`);
  if(answer.status===429) limited=answer;
  else assert.equal(answer.status,400,`a wrong password is refused, not ${answer.status}: ${JSON.stringify(answer.body)}`);
 }
 assert.ok(limited,`the first visitor is still limited within ${within} wrong passwords naming forged addresses`);
 assert.equal(limited.body.error_code,'over_request_rate_limit','the limited answer is the auth service rate limit');
 console.log(`The first visitor is still limited after ${sent} attempts`);
}
