export const periods: readonly ['7', '30'];
export type Period = '7' | '30';
export function parsePeriod(value: unknown): Period;
export const figureKeys: readonly (readonly [string, string])[];
export type AppReading = { app: string, period: Period, spend?: number, leads?: number, revenue?: number, currency?: string };
export type NumbersTile = { name: 'spend' | 'leads' | 'costPerLead' | 'revenue', label: string, value: number | null, sources: string[], period: Period, money: boolean, currency: string | null };
export function numbersTiles(readings: AppReading[] | null | undefined, period: Period): { connected: boolean, tiles: NumbersTile[] };
export function formatFigure(tile: NumbersTile, locale: string): string | null;
