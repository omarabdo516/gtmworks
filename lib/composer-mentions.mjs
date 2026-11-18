// The "@" and "/" tokens the composer's suggestion list follows (#154; design-reference: tokenAtCaret, pickPop). It
// starts at the message's start or after a space, so the "@" inside an email address opens nothing, and holds no space,
// "@" or "/", so a space typed after it closes the list. A query compares folded only: Arabic keeps its letters.

// The token under the caret, or null when there is none.
export function tokenAtCaret(value, caret) {
 const before = String(value ?? '').slice(0, caret);
 const match = before.match(/(^|\s)([@/])([^\s@/]*)$/);
 return match ? { type: match[2], q: match[3].toLowerCase(), start: caret - match[3].length - 1, end: caret } : null;
}

// Picking an entry puts its text in place of the token, one space after it, and leaves the caret after that space.
export function insertToken(value, token, insert) {
 const at = token.start + insert.length;
 return { value: value.slice(0, token.start) + insert + value.slice(token.end), caret: at };
}
