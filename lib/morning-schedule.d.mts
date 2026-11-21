export const morningTimes: string[];
export const morningDefault: string;
export const morningLevel: number;
export function morningTime(routine: { schedule: { expr: string | null } }): string | null;
export function morningCron(time: unknown): string | null;
