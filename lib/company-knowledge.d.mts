export type KnowledgePart = 'voice' | 'audience' | 'products' | 'banned' | 'decisions';
export const knowledgeParts: ReadonlyArray<readonly [part: KnowledgePart, title: string, heading: string]>;
export function pickPart(requested: unknown): KnowledgePart;
export function knowledgeInstructions(parts: unknown): string | undefined;
export type KnowledgeBlock = { kind: 'p', text: string } | { kind: 'ul', items: string[] };
export function knowledgeBlocks(body: string): KnowledgeBlock[];
