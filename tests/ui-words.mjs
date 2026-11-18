// Words a person never reads in the interface, shared by the catalogue guards and the browser journey (#329).
// The Engine's product name (#286), in either language.
export const engineName = /hermes|هيرمس|هرمس/i;
// An Agency (ADR 0012). Arabic: the Agency stem is وكال (وكيل, an agent, is not).
export const agency = { en: /agenc/i, ar: /وكال/u };
// A reviewer, a Role that is gone (ADR 0012). Arabic: مراجع as a word, while مراجعة (a review) stays.
export const reviewer = { en: /\breviewers?\b/i, ar: /(?<!\p{L})(?:[وفبل])?(?:ال)?مراجع(?:ون|ين|و)?(?!\p{L})/u };
