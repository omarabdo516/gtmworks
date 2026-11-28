import SignInScreen from '@/app/sign-in/screen';
import type { PasswordLinkInvalid } from './form';
// A password link (#954, ADR 0019) opens the sign-in screen with its set-password form. The page itself learns nothing
// from the link: its secret is after `#`, which no request carries, so serving this page (to a person or to a link
// preview) uses nothing up.
const problems:Record<string,PasswordLinkInvalid>={passwordTooShort:'passwordTooShort',passwordsDoNotMatch:'passwordsDoNotMatch'};
export default async function PasswordLinkPage({searchParams}:{searchParams:Promise<{invalid?:string,language?:string}>}) {
 const {invalid,language}=await searchParams;
 return <SignInScreen mode="password-link" initialLanguage={language==='ar'?'ar':undefined} invalid={invalid&&Object.hasOwn(problems,invalid)?problems[invalid]:undefined} next="/" wordmark={<div className="brand">gtm<span>works</span></div>}/>;
}
