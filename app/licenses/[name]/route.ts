import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The licenses Settings › About opens (#616), as plain text from the install itself, so an install with no network still
// shows them: gtmworks's own MIT License and the third-party notices for what it ships. The image carries both files at
// its working directory (Dockerfile), as a source checkout does at its root. No other name reads a file.
const files:Record<string,string>={gtmworks:'LICENSE','third-party':'THIRD_PARTY_NOTICES.md'};

export async function GET(_request:Request,{params}:{params:Promise<{name:string}>}) {
 const {name}=await params;
 const file=Object.hasOwn(files,name)?files[name]:null;
 if(!file) return new Response('Not found',{status:404,headers:{'content-type':'text/plain; charset=utf-8'}});
 return new Response(await readFile(join(process.cwd(),file),'utf8'),{headers:{'content-type':'text/plain; charset=utf-8','cache-control':'public, max-age=3600','x-content-type-options':'nosniff'}});
}
