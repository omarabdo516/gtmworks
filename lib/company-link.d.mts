export const linkSecretShape: RegExp;
export function generateLinkSecret(): string;
export function linkSecretHash(secret: string): string;
export function inviteLink(origin: string, secret: string): string;
