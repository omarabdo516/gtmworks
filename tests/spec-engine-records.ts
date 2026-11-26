import { execFileSync } from 'node:child_process';
import { lane, workdirOf } from './lane.mjs';

// The Engine handle reads a Company's Engine record with the service role, as the server does (#782). A browser spec
// that drives library code in its own process (a Run's start and close, with the fake of the contract answering for the
// Engine) points that client at its own lane's database, where the seeded Companies' records are; importing this file is
// enough, before any record is read.
const env=execFileSync('npx',['--no-install','supabase','status','-o','env',...(lane?['--workdir',workdirOf(lane)]:[])],{encoding:'utf8'});
const value=(name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))?.[1]??'';
process.env.NEXT_PUBLIC_SUPABASE_URL=value('API_URL');
process.env.SUPABASE_SERVICE_ROLE_KEY=value('SERVICE_ROLE_KEY');
// The key scripts/local-db.sh encrypted the seeded records with, as scripts/web.sh gives the app.
process.env.WEBHOOK_ENCRYPTION_KEY??='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
