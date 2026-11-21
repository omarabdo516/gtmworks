// A stand-in public host for the sandbox exit proof (scripts/ci-install-check.sh, #394). The install job runs it in a
// Node container on the isolated Docker machine's own network, at an address it adds there (EXIT_HOST_ADDRESS, one
// reserved for documentation, outside every network of the install), so the exit reaches it as it reaches the internet:
// out of the exit's own network and through the machine. It answers every HTTP and HTTPS request with EXIT_HOST_TOKEN,
// and counts what reaches its raw TCP port and its UDP port, which nothing may reach from the sandbox; GET /count
// returns the two counts.
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createServer as createTcpServer } from 'node:net';
import { createSocket } from 'node:dgram';

const address=process.env.EXIT_HOST_ADDRESS;
const token=process.env.EXIT_HOST_TOKEN;
const rawPort=Number(process.env.EXIT_HOST_RAW_PORT||2525);
const udpPort=Number(process.env.EXIT_HOST_UDP_PORT||5353);
if(!address||!token||!process.env.EXIT_HOST_KEY||!process.env.EXIT_HOST_CERT) {
 console.error('usage: EXIT_HOST_ADDRESS, EXIT_HOST_TOKEN, EXIT_HOST_KEY and EXIT_HOST_CERT');
 process.exit(2);
}
const counts={raw:0,udp:0};
const answer=(request,response)=>{
 if(request.url==='/count') { response.writeHead(200,{'Content-Type':'application/json'}); response.end(JSON.stringify(counts)); return; }
 response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
 response.end(`<!doctype html><title>stand-in</title><p>${token}</p>`);
};
const listening=server=>new Promise((resolve,reject)=>{ server.once('error',reject); server.once('listening',resolve); });
const plain=createServer(answer); plain.listen(80,address);
const secure=createSecureServer({key:process.env.EXIT_HOST_KEY,cert:process.env.EXIT_HOST_CERT},answer); secure.listen(443,address);
const raw=createTcpServer(socket=>{ counts.raw++; socket.destroy(); }); raw.listen(rawPort,address);
const udp=createSocket('udp4'); udp.on('message',()=>{ counts.udp++; }); udp.bind(udpPort,address);
await Promise.all([listening(plain),listening(secure),listening(raw),new Promise(resolve=>udp.once('listening',resolve))]);
console.log(`stand-in host listening on ${address}: 80, 443, ${rawPort}/tcp, ${udpPort}/udp`);
