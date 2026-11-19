// The lines of a Skill's text and their comparison (#181). The pinned Engine has no management route over its Skill
// ledger (engine.md), so the page draws one column of the text it has; this comparison is kept because a route that
// returns the text before a change would make the reference's two-column page possible. The reference's heuristic
// (design-reference/app.js 7276-7280): the same line is untagged, a line only in one text is New or Removed, and a line
// only there whose first two words match one only in the other text is Edited in both.
const clean = line => line.replace(/[ \t]+$/, '');
const head = line => line.trim().split(/\s+/).slice(0, 2).join(' ');

/** @param {unknown} text @returns {string[]} */
export function skillLines(text) {
  if (typeof text !== 'string') return [];
  return text.replace(/\r\n?/g, '\n').split('\n').map(clean).filter(line => line.trim() !== '');
}

/** @param {string[]} lines @param {string[]} other @param {'new'|'removed'} alone @returns {{text:string,tag:'new'|'edited'|'removed'|null}[]} */
function tagLines(lines, other, alone) {
  const here = new Set(lines);
  const there = new Set(other);
  const onlyOther = other.filter(line => !here.has(line));
  return lines.map(text => {
    if (there.has(text)) return { text, tag: null };
    return { text, tag: onlyOther.some(line => head(line) === head(text)) ? 'edited' : alone };
  });
}

/** @param {unknown} before @param {unknown} after */
export function compareSkillText(before, after) {
  const oldLines = skillLines(before);
  const newLines = skillLines(after);
  return { before: tagLines(oldLines, newLines, 'removed'), after: tagLines(newLines, oldLines, 'new') };
}
