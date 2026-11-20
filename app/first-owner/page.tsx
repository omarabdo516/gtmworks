import SignInScreen from '@/app/sign-in/screen';
// The first-Owner link (#383, ADR 0019) opens the first-run screen with the Company's name preset. The page itself can
// learn nothing from the link: its secret is after `#`, which no request carries. The form asks the server whether the
// link is open and which Company waits behind it, and that check uses nothing up.
export default async function FirstOwner({searchParams}:{searchParams:Promise<{invalid?:string,language?:string}>}) {
 const {invalid,language}=await searchParams;
 const problem=invalid==='passwordTooShort'||invalid==='passwordsDoNotMatch'?invalid:invalid==='emailTaken'?'firstOwnerEmailTaken':invalid==='1'?'setupInvalid':undefined;
 return <SignInScreen mode="first-owner" initialLanguage={language==='ar'?'ar':undefined} invalid={problem} next="/" wordmark={<div className="brand">gtm<span>works</span></div>}/>;
}
