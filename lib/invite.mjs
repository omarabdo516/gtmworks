// Inviting a Member (#185; design-reference/app.js: EMAIL_RE, inviteErr, addInvitee). Pure, so the form, the server
// action and their tests share one check.
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The catalogue key of what is wrong with an email, or '' when it can be invited. `taken` holds the emails already
 * invited or of a Member, compared in any letter case.
 * @param {string} email @param {string[]} [taken]
 */
export function inviteError(email, taken = []) {
 const value = String(email ?? '').trim();
 if (!value) return 'inviteEmailEmpty';
 if (!emailPattern.test(value)) return 'inviteEmailMalformed';
 if (taken.some(used => used.toLowerCase() === value.toLowerCase())) return 'inviteEmailTaken';
 return '';
}

/** The name an invited person goes by until they join: the first word of the email's local part, capitalised. */
export function inviteeName(email) {
 const local = String(email ?? '').split('@')[0];
 const word = local.split(/[._\-+0-9]+/).filter(Boolean)[0] || local;
 return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
