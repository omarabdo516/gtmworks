// The first-Owner link proof (#383, ADR 0019) for the install job: sending the link's form makes the Company held behind
// it with its sender as Owner and signs them in, landing inside it. It runs inside the installed web container, posts the
// secret it is given to the app's own gateway (APP_ORIGIN is not reachable from there), and prints only the Company home
// it lands on. The link's secret, the password and the account are given and read here, never printed.
const secret=process.env.LINK_SECRET||'';
if(!/^[a-f0-9]{64}$/.test(secret)) {
 console.error('LINK_SECRET is missing: pass the printed link\'s secret.');
 process.exit(1);
}
const body=new URLSearchParams({code:secret,name:'Linked Owner',email:'linked-owner@example.test',password:'linked-owner-password',confirm:'linked-owner-password',language:'en'});
const answer=await fetch('http://gateway:8080/first-owner/submit',{method:'POST',body,redirect:'manual'});
const location=answer.headers.get('location')||'';
if(answer.status!==303 || !/\/c\/linked-company-[a-f0-9]{8}\/home$/.test(location)) {
 console.error(`the first-Owner link was refused: HTTP ${answer.status}`);
 process.exit(1);
}
console.log(location);
