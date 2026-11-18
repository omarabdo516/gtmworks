type Write = (line: string) => void;
type Env = Record<string, string | undefined>;
type Form = { get(name: string): unknown } | null | undefined;
export function companyContext(form: Form): { company: string | null; slug: string | null };
export function logActionFailure(action: string, error: unknown, options?: { outcome?: 'threw' | 'returned'; write?: Write; env?: Env; form?: Form }): void;
export function withActionLog<A extends unknown[], R>(action: string, run: (...args: A) => Promise<R>, options?: { write?: Write; env?: Env }): (...args: A) => Promise<R>;
export function limiter(max?: number, windowMs?: number, clock?: () => number): () => boolean;
export function clientErrorResponse(request: Request, options?: { write?: Write; env?: Env; allowed?: () => boolean }): Promise<Response>;
export function chatOpenLine(open: { company: string; conversation: string; steps: Record<string, number> }, options?: { now?: Date }): string;
