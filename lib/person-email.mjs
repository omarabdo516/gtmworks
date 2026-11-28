// The one Person an email names (#382, #955): an Auth user that has a person row. A signed-up user without one is
// nobody here. `company add` and `company password-link` ask it of the service client, so the two commands agree about
// paging and about which letters of an address make it the same address. This file runs on the server only.
export const personByEmail=async(service,email)=>{
 for(let page=1;;page++) {
  const {data,error}=await service.auth.admin.listUsers({page,perPage:1000});
  if(error) throw new Error(error.message);
  const user=data.users.find(found=>String(found.email||'').toLowerCase()===email.toLowerCase());
  if(user) {
   const {data:person,error:personError}=await service.from('people').select('id').eq('id',user.id).maybeSingle();
   if(personError) throw new Error(personError.message);
   return person?user:null;
  }
  if(data.users.length<1000) return null;
 }
};
