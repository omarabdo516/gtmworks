export declare const PASSWORD_MIN_LENGTH: number;
export declare function passwordProblem(password: unknown, confirm?: unknown): 'passwordTooShort' | 'passwordsDoNotMatch' | null;
export declare function passwordNeedsSecondStep(level: {currentLevel?: string | null, nextLevel?: string | null} | null | undefined): boolean;
