import SignInScreen from './screen';
import { safeNext } from '@/lib/navigation';
export default async function SignIn({searchParams}:{searchParams:Promise<{next?:string,language?:string,invitation?:string}>}) {
 const {next,language,invitation}=await searchParams;
 return <SignInScreen wordmark={<div className="brand">gtm<span>works</span></div>} next={safeNext(next || null)} initialLanguage={language==='ar'?'ar':undefined} notice={invitation==='failed'?'couldNotAcceptTheInvitation':undefined}/>;
}
