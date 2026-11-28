// The name an invited person goes by until they join: the first word of the email's local part, capitalised. Email
// invitations are ended (#953); the name still labels an ended row in the Team table and the invitation lines a Company's
// channels kept (#207). The database makes the same name in public.invitee_name.
export function inviteeName(email) {
 const local = String(email ?? '').split('@')[0];
 const word = local.split(/[._\-+0-9]+/).filter(Boolean)[0] || local;
 return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
