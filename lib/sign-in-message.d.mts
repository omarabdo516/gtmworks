export declare function signInFailure(error: unknown): { message: string };
export declare function signInMessage(error: { status?: number; code?: string } | null | undefined): '' | 'wrongEmailOrPassword' | 'tooManySignInAttempts';
