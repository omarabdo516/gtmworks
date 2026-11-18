// The images of one channel message (#156). They are kept in the Company's private folder for that channel, named by the
// message's send key and each image's place, so a retry of the same send writes the same paths and keeps the same rows:
// every Member of the channel reads them, by their id (app/c/[slug]/files/channel/[id]).
const bucket='creatives';

// Where one image of a channel message is stored: the Company's folder for one channel, by its send key.
/** @param {string} company @param {string} channel @param {string} messageKey @param {number} index */
const channelFilePath=(company,channel,messageKey,index)=>`${company}/channels/${channel}/${messageKey}-${index}`;

// The refusal to show for a database answer, in the channel's own words.
/** @param {string|undefined} code */
const refusalOf=code=>code==='42501'?'channelNotAllowed':code==='P0002'?'channelNotFound':'channelFailed';

// Keeps a sent message's images with it: the rows first, under the database's own check (reserve_channel_files refuses
// a Viewer, a message that is not the caller's, and a channel they are not in), then the bytes in the Company's folder
// for the channel. The bucket has no write policy for that folder, so the server writes them, where and as the rows the
// database just accepted say. A failed upload gives the rows back, so a failed send keeps nothing.
/** @param {any} db @param {any} service @param {{company:string,channel:string,messageKey:string,files:File[]}} kept
 * @returns {Promise<{error?:string}>} */
export async function keepChannelFiles(db,service,{company,channel,messageKey,files}) {
 // The database builds every path itself and ignores one sent here; the server uploads to the same place.
 const rows=files.map((file,index)=>({position:index,name:file.name.slice(0,255)||'image',content_type:file.type.slice(0,127),size:file.size}));
 const {error}=await db.rpc('reserve_channel_files',{ch:channel,c:company,message_key:messageKey,files:rows});
 if(error) return {error:refusalOf(error.code)};
 /** @type {string[]} */ const written=[];
 for(const [index,file] of files.entries()) {
  const path=channelFilePath(company,channel,messageKey,index);
  const stored=await service.storage.from(bucket).upload(path,Buffer.from(await file.arrayBuffer()),{contentType:rows[index].content_type,upsert:true});
  if(stored.error) {
   if(written.length) await service.storage.from(bucket).remove(written);
   await discardChannelFiles(db,service,{company,channel,messageKey});
   return {error:'channelFailed'};
  }
  written.push(path);
 }
 return {};
}

// A send that stored no message takes its rows with it, then their bytes. Only the sender's own send, and only files no
// message took.
/** @param {any} db @param {any} service @param {{company:string,channel:string,messageKey:string}} gone */
export async function discardChannelFiles(db,service,{company,channel,messageKey}) {
 const {data}=await db.rpc('discard_channel_files',{ch:channel,c:company,message_key:messageKey});
 const paths=(Array.isArray(data)?data:[]).filter(/** @param {unknown} path @returns {path is string} */ path=>typeof path==='string');
 if(paths.length) await service.storage.from(bucket).remove(paths);
}

// The images one channel message carries, in the order they were chosen, as the Engine reads them: one image part per
// file, with the file's own type and its bytes in base64. Read when the Run starts, so a retry of the same start sends
// the same body. `service` is a service-role client: a Run is sent by the driver, not by a person's own session.
/** @param {any} service @param {number} message @returns {Promise<{content_type:string,base64:string}[]|undefined>} */
export async function channelImages(service,message) {
 const {data,error}=await service.from('channel_attachments').select('content_type,path').eq('message_id',message).order('position');
 if(error) throw error;
 /** @type {{content_type:string,base64:string}[]} */ const images=[];
 for(const row of data||[]) {
  const file=await service.storage.from(bucket).download(row.path);
  if(file.error||!file.data) throw file.error||new Error('channelFileMissing');
  images.push({content_type:row.content_type,base64:Buffer.from(await file.data.arrayBuffer()).toString('base64')});
 }
 return images.length?images:undefined;
}
