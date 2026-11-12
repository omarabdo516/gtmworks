// The message the sign-in page shows for the auth service's answer to a password sign-in. Its own rate limit answers
// 429; a wrong password, an unknown email and anything else refused get the same message, so the page never tells
// whether an account exists.
export function signInMessage(error) {
 if(!error) return '';
 if(error.status===429 || error.code==='over_request_rate_limit') return 'tooManySignInAttempts';
 return 'wrongEmailOrPassword';
}

// What a failed sign-in reports to the server log: the error's kind, code and status, each only when it is a plain word or
// number. Never its message or stack, whose text could carry what was typed or the provider's words.
export function signInFailure(error) {
 const word=(value,fallback)=>typeof value==='string' && /^[A-Za-z_]{1,64}$/.test(value) ? value : fallback;
 const status=Number.isInteger(error?.status) ? error.status : 'none';
 return {message:`Sign-in failed: ${word(error?.name,'Error')} ${word(error?.code,'unknown')} ${status}`};
}
