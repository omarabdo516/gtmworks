export type InviteError = '' | 'inviteEmailEmpty' | 'inviteEmailMalformed' | 'inviteEmailTaken';
export function inviteError(email: string, taken?: string[]): InviteError;
export function inviteeName(email: string): string;
