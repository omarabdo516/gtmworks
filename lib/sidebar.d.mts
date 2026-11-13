export function orderAgents<T extends { is_default: boolean }>(agents: T[]): T[];
export function groupRecents<T extends { created_at: string }>(conversations: T[], now?: Date): { day: 'today' | 'yesterday' | 'earlier', items: T[] }[];
export type CompanyAgent = { id: string, connection_id: string, name: string, speciality: string, is_default: boolean };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function companyAgents(db: any, company: string): Promise<CompanyAgent[]>;
export function waitingLabel(count: number): ['nothingWaitingOnYou'] | ['thingsWaitingOnYou', number];
export const themeChoices: readonly ['light', 'dark', 'device'];
