import { readFileSync } from 'node:fs';

// The work sandbox image every Company's Agents run in (ADR 0018) is built from one file of its own, and that file names
// one base image: the Engine's own sandbox image, pinned by tag and digest. The tag names the reviewed release; the
// digest names the reviewed bytes, so a tag pushed again upstream cannot change what an install runs.
export const dockerfile = 'sandbox/Dockerfile';

// A reference with a tag and a sha256 digest, as a release's compose file and the app's own Dockerfile pin theirs.
const pinned = /^[a-z0-9][\w./-]*:[\w.-]+@sha256:[a-f0-9]{64}$/;

/**
 * The one base image a build file names, refusing any base the build file does not pin by tag and digest. A `FROM` that
 * names an earlier stage builds on that stage. Throws with the line to fix, so the static test fails on a pin by tag.
 * @param {string} text
 * @returns {string}
 */
export function pinnedBase(text) {
  const stages = new Set();
  const external = [];
  // Every FROM counts: its flags (`--platform=...`) are read past, and a form this cannot read is refused rather than skipped.
  for (const [line] of text.matchAll(/^FROM\b.*$/gim)) {
    const match = line.match(/^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i);
    if (!match) throw new Error(`A work sandbox build file's FROM line could not be read: ${line}`);
    const [, reference, stage] = match;
    if (!stages.has(reference)) external.push(reference);
    if (stage) stages.add(stage);
  }
  if (external.length !== 1) throw new Error(`A work sandbox build file names one base image; this one names ${external.length}: ${external.join(', ')}`);
  const [base] = external;
  if (!pinned.test(base)) throw new Error(`The work sandbox base image must be pinned by tag and digest (name:tag@sha256:<64 hex>): ${base}`);
  return base;
}

/** The base image of the work sandbox build file in this checkout. */
export function workSandboxBase() {
  return pinnedBase(readFileSync(dockerfile, 'utf8'));
}
