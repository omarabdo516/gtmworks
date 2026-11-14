import { notFound } from 'next/navigation';
import { setupIsOpen } from '@/lib/first-run';
import SignInScreen from '@/app/sign-in/screen';
export default async function FirstRun({searchParams}:{searchParams:Promise<{invalid?:string,language?:string}>}) {
 if(!await setupIsOpen()) notFound();
 const {invalid,language}=await searchParams;
 const problem=invalid==='passwordTooShort'||invalid==='passwordsDoNotMatch'?invalid:invalid==='1'?'setupInvalid':undefined;
 // The form reads the setup link's fragment in the browser (issue #50); the server never sees it.
 return <SignInScreen mode="first-run" initialLanguage={language==='ar'?'ar':undefined} invalid={problem} next="/" wordmark={<div className="brand">gtm<span>works</span></div>}/>;
}
