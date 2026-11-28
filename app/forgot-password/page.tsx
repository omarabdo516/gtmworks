import SignInScreen from '@/app/sign-in/screen';
// "Forgot password?" (#954, ADR 0019): the page says whom to ask for a password link; it sends no email.
export default async function ForgotPassword({searchParams}:{searchParams:Promise<{language?:string}>}) {
 const {language}=await searchParams;
 return <SignInScreen mode="forgot" next="/" initialLanguage={language==='ar'?'ar':undefined} wordmark={<div className="brand">gtm<span>works</span></div>}/>;
}
