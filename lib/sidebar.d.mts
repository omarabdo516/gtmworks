export function orderAgents<T extends { is_default: boolean }>(agents: T[]): T[];
export function groupRecents<T extends { created_at: string }>(conversations: T[], now?: Date): { day: 'today' | 'yesterday' | 'earlier', items: T[] }[];
