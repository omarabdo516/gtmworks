import { discardMessageFiles, filesAsImages, keepMessageFiles } from './message-files.ts';

// The images of one channel message (#156): kept in the Company's private folder for that channel, under the message's
// send key, and read by every Member of the channel (app/c/[slug]/files/channel/[id]). The shared core is
// lib/message-files.ts (#355 review).
const words={notAllowed:'channelNotAllowed',notFound:'channelNotFound',failed:'channelFailed'};
/** @param {string} company @param {string} channel @param {string} messageKey @param {string} attempt */
const placeOf=(company,channel,messageKey,attempt)=>({company,folder:'channels',scope:channel,messageKey,attempt});
/** @param {{scope:string,company:string,messageKey:string}} place */
const reserveArgs=place=>({ch:place.scope,c:place.company,message_key:place.messageKey});
const reserve='reserve_channel_files';
const discard='discard_channel_files';
// One send's files: its keep and its discard name the same attempt (#727).
/** @typedef {{company:string,channel:string,messageKey:string,attempt:string}} ChannelFiles */
/** @type {import('./message-files.ts').FilesTable} */
const table={table:'channel_attachments',scope:'channel_id'};

// Keeps a channel send's images before its message is stored: the rows first, under the database's own check
// (reserve_channel_files refuses a Viewer, a channel they are not in, a key another person is writing under, and an
// image the Engine cannot read, and answers -1 for a key whose files a stored message already took, so nothing is
// uploaded again), then the bytes at the paths the database built.
/** @param {any} db @param {any} service @param {ChannelFiles&{files:File[]}} kept
 * @returns {Promise<{error?:string}>} */
export async function keepChannelFiles(db,service,{company,channel,messageKey,attempt,files}) {
 return keepMessageFiles(db,service,{place:placeOf(company,channel,messageKey,attempt),files,table,reserve,reserveArgs,discard,discardArgs:reserveArgs,words});
}

// A send that stored no message takes its rows with it, then their bytes. Only the sender's own send, only files no
// message took, and only those no other send of the key still holds: the discard names the keep's attempt (#727).
/** @param {any} db @param {any} service @param {ChannelFiles} gone */
export async function discardChannelFiles(db,service,{company,channel,messageKey,attempt}) {
 return discardMessageFiles(db,service,{place:placeOf(company,channel,messageKey,attempt),discard,discardArgs:reserveArgs});
}

// The images one channel message carries, in the order they were chosen, as the Engine reads them. Read when the Run
// starts, so a retry of the same start sends the same body. `service` is a service-role client: a Run is sent by the
// driver, not by a person's own session.
/** @param {any} service @param {number} message @returns {Promise<{content_type:string,base64:string}[]|undefined>} */
export async function channelImages(service,message) {
 const {data,error}=await service.from('channel_attachments').select('content_type,path').eq('message_id',message).order('position');
 if(error) throw error;
 return filesAsImages(service,data||[],'channelFileMissing');
}
