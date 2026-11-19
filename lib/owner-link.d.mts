export function generateOwnerSecret(): string;
export function ownerSecretHash(secret: string): string;
export function ownerLink(origin: string, secret: string): string;
