// The names of a Company's active Owners, in order: whom a Member's request for an Agent goes to (#17, #170). A read the
// database refuses is an error, never an empty list, so no sentence is left without its names.
/** @param {import("@supabase/supabase-js").SupabaseClient} db @param {string} company @returns {Promise<string[]>} */
export async function ownerNames(db, company) {
 const { data, error } = await db.from('members').select('people(name)').eq('company_id', company).eq('role', 'owner').is('removed_at', null);
 if (error) throw error;
 return /** @type {{people:{name:string}|null}[]} */ (data || []).flatMap(row => (row.people ? [row.people.name] : [])).sort();
}
