import SignInScreen from '@/app/sign-in/screen';
import type { JoinInvalid } from './form';
// An Invite link (#950, ADR 0019) opens the sign-in screen with its join form. The page itself learns nothing from the
// link: its secret is after `#`, which no request carries, so serving this page (to a person or to a link preview)
// uses nothing up.
const problems:Record<string,JoinInvalid>={passwordTooShort:'passwordTooShort',passwordsDoNotMatch:'passwordsDoNotMatch',emailTaken:'inviteLinkEmailTaken','1':'setupInvalid'};
export default async function Join({searchParams}:{searchParams:Promise<{invalid?:string,language?:string}>}) {
 const {invalid,language}=await searchParams;
 return <SignInScreen mode="join" initialLanguage={language==='ar'?'ar':undefined} invalid={invalid&&Object.hasOwn(problems,invalid)?problems[invalid]:undefined} next="/" wordmark={<div className="brand">gtm<span>works</span></div>}/>;
}
