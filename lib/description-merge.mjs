// Two writers of one description at once (#680, spec #668): the text each read, the text one of them saved meanwhile
// ("theirs") and the text the other is saving now ("mine") are merged by lines, as git merges. Changes to different
// lines both stay; a line both changed keeps both choices, the newer saved one first and the one being saved after it,
// so nothing either wrote is lost.
import { diff3Merge } from 'node-diff3';

/**
 * @param {string} base the text both read
 * @param {string} mine the text being saved now
 * @param {string} theirs the text saved meanwhile
 * @returns {{text:string, conflicted:boolean}}
 */
export function mergeDescriptions(base, mine, theirs) {
  if (mine === theirs) return { text: mine, conflicted: false };
  if (mine === base) return { text: theirs, conflicted: false };
  if (theirs === base) return { text: mine, conflicted: false };
  const lines = [];
  let conflicted = false;
  for (const block of diff3Merge(mine.split('\n'), base.split('\n'), theirs.split('\n'), { excludeFalseConflicts: true })) {
    if ('ok' in block && block.ok) lines.push(...block.ok);
    else if ('conflict' in block && block.conflict) {
      const { a, o, b } = block.conflict;
      // Changes on neighbouring lines meet in one region; when neither side added or took away a line there, each line
      // is decided on its own, and only a line both changed keeps both.
      if (a.length === o.length && b.length === o.length) {
        o.forEach((line, i) => {
          if (a[i] === line || a[i] === b[i]) lines.push(b[i]);
          else if (b[i] === line) lines.push(a[i]);
          else { conflicted = true; lines.push(b[i], a[i]); }
        });
      } else {
        conflicted = true;
        lines.push(...b, ...a.filter((line) => !b.includes(line)));
      }
    }
  }
  return { text: lines.join('\n'), conflicted };
}
