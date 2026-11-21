export type ScheduleForm = { kind: 'daily', h: number, m: number } | { kind: 'weekly', dow: number, h: number, m: number } | { kind: 'monthly', h: number, m: number } | { kind: 'hourly' };
type T = (key: string, ...values: unknown[]) => string;
export function cronOf(form: unknown): string | null;
export function formOf(expr: unknown): ScheduleForm | null;
export function scheduleLabel(t: T, schedule: { expr: string | null, display: string | null }): string;
export function whenOf(t: T, locale: string, iso: string, zone: string | null, now?: Date): string;
export function dayOffset(iso: string, zone: string | null, now?: Date): number | null;
export function clockLabel(t: T, h: number, m: number): string;
