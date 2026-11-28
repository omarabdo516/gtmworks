// The server-made password link (#955, ADR 0019) for the install job: sending its form sets the Administrator's new
// password, spends the link, ends their other sessions and signs them in, landing inside their Company. It posts the
// secret it is given to the app's own gateway (APP_ORIGIN is not reachable from there) and prints only the Company home
// it lands on. The link's secret and the password are given and read here, never printed.
const secret=process.env.LINK_SECRET||'';
if(!/^[a-f0-9]{64}$/.test(secret)) {
 console.error('LINK_SECRET is missing: pass the printed link\'s secret.');
 process.exit(1);
}
const password='password-link-administrator';
const body=new URLSearchParams({code:secret,password,confirm:password,language:'en'});
const answer=await fetch('http://gateway:8080/password/submit',{method:'POST',body,redirect:'manual'});
const location=answer.headers.get('location')||'';
if(answer.status!==303 || !/\/c\/[^/]+\/home$/.test(location)) {
 console.error(`the password link was refused: HTTP ${answer.status}`);
 process.exit(1);
}
console.log(location);
