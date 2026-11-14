// The one password rule gtmworks shows before the auth service (GoTrue) applies its own, configured to the same length.
// gtmworks only checks a typed password here; it never stores, logs or returns one.
export const PASSWORD_MIN_LENGTH = 10;

// A message key, or null when the password may be sent. Length counts characters, so Arabic letters and emoji count once.
export function passwordProblem(password, confirm) {
 if (typeof password !== 'string' || [...password].length < PASSWORD_MIN_LENGTH) return 'passwordTooShort';
 if (confirm !== undefined && confirm !== password) return 'passwordsDoNotMatch';
 return null;
}

// With a verified authenticator (nextLevel aal2), a password changes only from a session that passed the second step
// (aal2). The auth service enforces this itself; the form asks for the code first so the refusal is never the answer.
export function passwordNeedsSecondStep(level) {
 return level?.nextLevel === 'aal2' && level?.currentLevel !== 'aal2';
}
