/** One line of a Card's description, as the approved Card reads it (design-reference-card: deParse). */
export type Block =
  | { t: 'p' | 'h1' | 'h2' | 'quote' | 'ul' | 'ol' | 'todo' | 'code', l: number, x: string, c?: boolean }
  | { t: 'hr', l: number }
  | { t: 'img', l: number, alt: string, src: string }
  | { t: 'table', l: number, rows: string[][] };
/** A line's inline Markdown (design-reference-card: deIn). */
export type Inline = { t: 'text', v: string } | { t: 'code', v: string } | { t: 'br' } | { t: 'b' | 's' | 'i', in: Inline[] } | { t: 'a', href: string | null, in: Inline[] };
export declare function parseDescription(markdown: string | null | undefined): Block[];
export declare function numberOf(list: Block[], at: number): number;
export declare function todoRuns(list: Block[]): Map<number, { done: number, total: number }>;
export declare function tickTodo(markdown: string | null | undefined, index: number, text: string, done: boolean): string | null;
export declare function todoCount(markdown: string | null | undefined): { done: number, total: number };
export declare function lineDirection(value: string): 'rtl' | 'ltr' | '';
export declare function parseInline(value: string): Inline[];
