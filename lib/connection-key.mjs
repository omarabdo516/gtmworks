import { decryptSecret } from './agent-crypto.mjs';

// A saved Connection's kept key, read by the service role (no one else can read it, ADR 0008) by the Connection's id and
// the Company the caller is already authorized in, so an id from any other Company yields nothing. Only the Connections
// route uses it; a conversation reaches a shared Connection through its agent instead (lib/conversation-runs.mjs).
export async function savedConnectionKey(service,{id,company},encryptionKey) {
 const {data,error}=await service.from('hermes_connections').select('key_encrypted').eq('id',id).eq('company_id',company).maybeSingle();
 if(error||!data) return null;
 return decryptSecret(data.key_encrypted,encryptionKey);
}
