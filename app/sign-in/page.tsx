import SignInScreen from './screen';
import { safeNext } from '@/lib/navigation';
export default async function SignIn({searchParams}:{searchParams:Promise<{next?:string,message?:string,language?:string}>}) {
 const {next,message,language}=await searchParams;
 return <SignInScreen wordmark={<div className="brand">gtm<span>works</span></div>} next={safeNext(next || null)} message={message} initialLanguage={language==='ar'?'ar':undefined}/>;
}
