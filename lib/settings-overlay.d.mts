export type OverlayIcon = 'building' | 'bot' | 'book' | 'bulb' | 'cpu' | 'plug' | 'repeat' | 'gauge' | 'archive' | 'user';
export type OverlaySection = 'company' | 'agents' | 'knowledge' | 'learning' | 'models' | 'apps' | 'routines' | 'usage' | 'backup' | 'account';
export const overlaySections: readonly (readonly [OverlaySection, string, OverlayIcon, boolean, boolean])[];
export function visibleSections(role: string): (readonly [OverlaySection, string, OverlayIcon, boolean, boolean])[];
export function pickSection(requested: unknown, role: string): OverlaySection;
export function overlayHref(slug: string, section: OverlaySection, extra?: Record<string, string | undefined>): string;
export function closeTarget(stored: unknown, slug: string): string;
export function agentsMainFirst<T extends { is_default: boolean }>(agents: T[]): T[];
export function usageTotals(rows: { company_id: string, day: string, input_tokens: number, output_tokens: number, runs: number, unknown_runs: number }[], company: string, days: number, today?: Date): { tokens: number, runs: number, unknown: number };
