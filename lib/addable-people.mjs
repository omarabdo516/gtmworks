// The people an Administrator may add to a Company without a link (#952, ADR 0019): the active Members of another
// Company they administer, who are not already active Members here, each with the Company they come from. The database
// decides the list (company_addable_people), so the form offers the people add_company_member accepts.
export async function addablePeople(db, company) {
 const { data, error } = await db.rpc('company_addable_people', { c: company });
 if (error) throw error;
 return (data || []).map(row => ({ person_id: row.person_id, name: row.name, company: row.company }));
}
