export const morningTimes: string[];
export const morningDefault: string;
export function morningTime(routine: { schedule: { expr: string | null } }): string | null;
export function morningCron(time: unknown): string | null;
export const zoneCities: string[];
export const morningMarker: string;
