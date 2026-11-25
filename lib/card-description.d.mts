import type { Root } from 'mdast';
/** A description's to-do items in reading order (#679): the line each is on (1-based), its text, ticked or not. */
export declare function todoItems(body: string | null | undefined): {line:number, item:string, done:boolean}[];
/** How many to-do items are ticked, of how many: the "2/5" beside the list and on the tile. */
export declare function todoProgress(body: string | null | undefined): {done:number, total:number};
/** The description's Markdown tree (GFM); raw HTML stays an `html` node, drawn as text. */
export declare function parseDescription(body: string | null | undefined): Root;
/** A link's address when it is a web page, an email address or a page of this app; null for anything else. */
export declare function safeHref(url: string | null | undefined): string | null;
/** A picture's address only when it is a file of this Company's own storage (`/c/<slug>/files/<id>`); null otherwise. */
export declare function companyImage(url: string | null | undefined, slug: string): string | null;
