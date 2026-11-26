import type { KnowledgePart } from './company-knowledge.mjs';
export type KnowledgeOutcome = 'companyKnowledgeSaved' | 'companyKnowledgeCleared' | 'companyKnowledgeUnchanged' | 'companyKnowledgeNotAllowed' | 'companyKnowledgeInvalid' | 'companyKnowledgeTooLong' | 'companyKnowledgeSecret' | 'companyKnowledgeFailed';
export function knowledgeSkill(parts: Partial<Record<KnowledgePart, string>>): string;
export function readKnowledge(db: unknown, company: string): Promise<{ state: string, parts: Partial<Record<KnowledgePart, string>> | null }>;
export function saveKnowledge(db: unknown, edit: { company: string, part: unknown, body: unknown }): Promise<KnowledgeOutcome>;
