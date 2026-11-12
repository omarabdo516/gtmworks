import { notFound } from 'next/navigation';
import { setupIsOpen } from '@/lib/first-run';
import { setupCodeMatches } from '@/lib/setup-code.mjs';
import SignInScreen from '@/app/sign-in/screen';
export default async function FirstRun({searchParams}:{searchParams:Promise<{invalid?:string,language?:string,code?:string}>}) {
 if(!await setupIsOpen()) notFound();
 const {invalid,language,code}=await searchParams;
 // Without the code from the installer's setup link (issue #50) the page shows how to get it, and no form.
 return <SignInScreen firstRun setupCode={setupCodeMatches(code)?code:undefined} initialLanguage={language==='ar'?'ar':undefined} invalid={invalid==='1'} next="/" wordmark={<div className="brand">gtm<span>works</span></div>}/>;
}
