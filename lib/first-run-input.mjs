import { passwordProblem } from './password.mjs';
// The fields both first-run screens ask for: a Person's name, email and password in the page's language. The password
// goes on to the auth service exactly as typed, so it is never trimmed.
function authored(form) {
 const name=String(form.get('name')||'').trim();
 const email=String(form.get('email')||'').trim().toLowerCase(), language=form.get('language');
 const password=form.get('password'), confirm=form.get('confirm');
 if(!name || name.length>120 || email.length>254 || /\p{Cc}/u.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['en','ar'].includes(language) || passwordProblem(password,confirm ?? '')) return null;
 return {name,email,language,password};
}
export function firstRunInput(form) {
 const company=String(form.get('company')||'').trim(), input=authored(form);
 if(!input || !company || company.length>120) return null;
 return {...input,company};
}
// The first-Owner link's page asks the same fields, and the Company's name comes from the link, never from the form (#383).
export function ownerLinkInput(form) { return authored(form); }
// An Invite link's page asks the same fields; the Company and the Role come from the link, never from the form (#950).
export function inviteLinkInput(form) { return authored(form); }
