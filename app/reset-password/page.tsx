import { redirect } from 'next/navigation';
import SignInScreen from '@/app/sign-in/screen';
import { supabase } from '@/lib/supabase';
// Opened only by a working reset link (app/auth/reset/route.ts), which has just signed the person in.
export default async function ResetPassword() {
 const {data:{user}}=await (await supabase()).auth.getUser();
 if(!user) redirect('/forgot-password?link=invalid');
 return <SignInScreen mode="reset" next="/" wordmark={<div className="brand">gtm<span>works</span></div>}/>;
}
