export type SkillLine = { text: string, tag: 'new' | 'edited' | 'removed' | null };
export function skillLines(text: unknown): string[];
export function compareSkillText(before: unknown, after: unknown): { before: SkillLine[], after: SkillLine[] };
