// The one password rule gtmworks shows before the auth service (GoTrue) applies its own, configured to the same length.
// gtmworks only checks a typed password here; it never stores, logs or returns one.
export const PASSWORD_MIN_LENGTH = 10;

// A message key, or null when the password may be sent. Length counts characters, so Arabic letters and emoji count once.
export function passwordProblem(password, confirm) {
 if (typeof password !== 'string' || [...password].length < PASSWORD_MIN_LENGTH) return 'passwordTooShort';
 if (confirm !== undefined && confirm !== password) return 'passwordsDoNotMatch';
 return null;
}
