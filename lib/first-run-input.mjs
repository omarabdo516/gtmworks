import { passwordProblem } from './password.mjs';
export function firstRunInput(form) {
 const name=String(form.get('name')||'').trim(), company=String(form.get('company')||'').trim();
 const email=String(form.get('email')||'').trim().toLowerCase(), language=form.get('language');
 // The password goes on to the auth service exactly as typed, so it is never trimmed.
 const password=form.get('password'), confirm=form.get('confirm');
 if(!name || name.length>120 || !company || company.length>120 || email.length>254 || /\p{Cc}/u.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['en','ar'].includes(language) || passwordProblem(password,confirm ?? '')) return null;
 return {name,email,company,language,password};
}
