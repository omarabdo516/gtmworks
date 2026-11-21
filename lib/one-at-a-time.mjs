// A queue per key (a Company): work handed in for one key runs after the work before it for that key has ended, whether
// that ended well or not; work for other keys does not wait. The install runs one app process (docker-compose.install.yml
// `app`), and the writes this serialises run there alone, so the queue lives in that process. A database lock cannot do
// it: the app reaches the database through PostgREST, one transaction per call, and a lock must be held across several
// database reads and Engine writes (#436). An install with several app processes would need a lease in the database.
/** @returns {<T>(key:string,work:()=>Promise<T>)=>Promise<T>} */
export function oneAtATime() {
 /** @type {Map<string,Promise<void>>} */
 const running=new Map();
 return (key,work)=>{
  const next=(running.get(key)||Promise.resolve()).then(work);
  const kept=next.then(()=>{},()=>{});
  running.set(key,kept);
  kept.then(()=>{ if(running.get(key)===kept) running.delete(key); });
  return next;
 };
}
