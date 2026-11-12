import SignInScreen from '@/app/sign-in/screen';
export default async function ForgotPassword({searchParams}:{searchParams:Promise<{link?:string,language?:string}>}) {
 const {link,language}=await searchParams;
 return <SignInScreen mode="forgot" invalidLink={link==='invalid'} next="/" initialLanguage={language==='ar'?'ar':undefined} wordmark={<div className="brand">gtm<span>works</span></div>}/>;
}
