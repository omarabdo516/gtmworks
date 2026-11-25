import type { ScreenPicture } from './engine.mjs';
export type AgentScreen = { state: 'none' | 'asleep' | 'awake', control: 'agent' | 'person', refusal: null | 'missing' | 'busy', busy?: string };
type ScreenRequest = { company: string, agent: unknown, hermes?: { address: string, key: string } | null, engine?: unknown };
export function readAgentScreen(db: unknown, request: ScreenRequest): Promise<{ state: 'found', screen: AgentScreen } | { state: 'missing' | 'unreachable' }>;
export type AgentScreenWake = { state: 'awake' } | { state: 'notStarted', reason: 'missing' | 'failed' | 'busy', busy?: string } | { state: 'notAllowed' | 'missing' | 'unreachable' | 'failed' };
export function wakeAgentScreen(db: unknown, request: ScreenRequest): Promise<AgentScreenWake>;
export function agentScreenPicture(db: unknown, request: ScreenRequest): Promise<ScreenPicture>;
