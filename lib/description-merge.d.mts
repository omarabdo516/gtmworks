/** Two writers of one description merged by lines (#680): different lines both stay, a line both changed keeps both. */
export declare function mergeDescriptions(base: string, mine: string, theirs: string): {text:string, conflicted:boolean};
