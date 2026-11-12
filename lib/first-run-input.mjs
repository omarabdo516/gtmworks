export function firstRunInput(form) {
 const name=String(form.get('name')||'').trim(), company=String(form.get('company')||'').trim();
 const email=String(form.get('email')||'').trim().toLowerCase(), language=form.get('language');
 if(!name || name.length>120 || !company || company.length>120 || email.length>254 || /\p{Cc}/u.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['en','ar'].includes(language)) return null;
 return {name,email,company,language};
}
