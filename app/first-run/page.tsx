import { notFound } from 'next/navigation';
import { setupIsOpen } from '@/lib/first-run';
import SignInScreen from '@/app/sign-in/screen';
export default async function FirstRun({searchParams}:{searchParams:Promise<{invalid?:string,language?:string}>}) {
 if(!await setupIsOpen()) notFound();
 const {invalid,language}=await searchParams;
 // The form reads the setup link's fragment in the browser (issue #50); the server never sees it.
 return <SignInScreen firstRun initialLanguage={language==='ar'?'ar':undefined} invalid={invalid==='1'} next="/" wordmark={<div className="brand">gtm<span>works</span></div>}/>;
}
