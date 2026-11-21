import type { ScheduleForm } from './routine-schedule.mjs';
export type ScheduleDraft = { kind: 'daily' | 'weekly' | 'monthly' | 'hourly', dow?: number, h?: number, m?: number };
export function readRoutineSentence(raw: unknown): { name: string | null, prompt: string, form: ScheduleForm | null, draft: ScheduleDraft | null } | null;
