// Headers a client can send to claim another address. The install gateway overwrites or drops each one on its way to
// Auth (scripts/install-nginx.conf), and the install checks send every one, naming a different address each attempt:
// if Auth keyed its rate limit on any of them, each wrong password would get a fresh allowance (issue #41).
export const FORGED_IDENTITY_HEADERS=['X-Real-IP','X-Forwarded-For','Forwarded','Sb-Forwarded-For','True-Client-IP','CF-Connecting-IP','X-Client-IP','X-Cluster-Client-IP','Fastly-Client-IP'];

// Documentation addresses (RFC 5737), a different one for each attempt.
export function forgedIdentity(attempt) {
 const address=`203.0.113.${attempt%250+1}`, other=`198.51.100.${attempt%250+1}`;
 return Object.fromEntries(FORGED_IDENTITY_HEADERS.map(name=>[name.toLowerCase(),
  name==='Forwarded' ? `for=${address}` : name==='X-Forwarded-For' || name==='Sb-Forwarded-For' ? `${address}, ${other}` : address]));
}
