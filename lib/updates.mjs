import whatsNewFile from './whats-new.json' with { type: 'json' };

// Update ready (#442): what's new is one entry per change a person can see, newest first, in both languages, shipped in
// the image (lib/whats-new.json). The image knows its own version from the release that built it (GTMWORKS_VERSION:
// X.Y.Z for a release, main for a main build, nothing for a source checkout or a test image, which check nothing).
const repo = 'omarabdo516/gtmworks';
const semver = version => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version || '')?.slice(1).map(Number);
const newer = (a, b) => { const [x, y] = [semver(a), semver(b)]; const i = x && y ? x.findIndex((n, j) => n !== y[j]) : -1; return i >= 0 && x[i] > y[i]; };
const text = part => typeof part?.title === 'string' && !!part.title.trim() && typeof part.body === 'string' && !!part.body.trim();
const valid = item => Number.isInteger(item?.issue) && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && text(item.en) && text(item.ar);
// The remote file is read from the network: only well-formed entries, with only their own fields, reach the page.
const clean = list => Array.isArray(list) ? list.filter(valid).map(({ issue, date, en, ar }) => ({ issue, date, en: { title: en.title, body: en.body }, ar: { title: ar.title, body: ar.body } })) : [];

export const whatsNew = clean(whatsNewFile);

/** Where the newest version is read: GitHub, or another source the install names (tests). */
export const updateSource = base => base ? { api: base.replace(/\/+$/, ''), raw: base.replace(/\/+$/, '') }
 : { api: `https://api.github.com/repos/${repo}`, raw: `https://raw.githubusercontent.com/${repo}` };

/**
 * The newest version on this install's channel, when it is newer than the installed one: `{version, date, entries}`
 * with the entries the installed build lacks. A release is newer by its tag; main is newer when it brings at least one
 * entry, since a main build with nothing a person can see has nothing to tell them. null when up to date or when
 * nothing is installed from a release; it throws when the check fails (offline, refused, unreadable), which the caller
 * hides.
 */
export async function checkUpdate({ installed, local = whatsNew, source = updateSource(), fetch = globalThis.fetch }) {
 if (installed !== 'main' && !semver(installed)) return null;
 const read = async url => {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw Object.assign(new Error(`${url} answered ${response.status}`), { status: response.status });
  return response.json();
 };
 const known = new Set(local.map(item => item.issue));
 const since = ref => read(`${source.raw}/${ref}/lib/whats-new.json`).then(list => { if (!Array.isArray(list)) throw new Error('the what\'s-new file is unreadable'); return clean(list); }).then(list => list.filter(item => !known.has(item.issue)));
 if (installed === 'main') {
  const entries = await since('main');
  return entries.length ? { version: 'main', date: entries.map(item => item.date).sort().at(-1), entries } : null;
 }
 // Stable is the highest vX.Y.Z GitHub does not mark as a prerelease, as gtmworks update picks it (scripts/get.sh
 // latest_release), not GitHub's latest, which is the last published and may be a hotfix of an older line.
 // Every page is read, 100 releases a page, up to one with fewer.
 const list = [];
 for (let page = 1; ; page++) {
  const one = await read(`${source.api}/releases?per_page=100&page=${page}`);
  if (!Array.isArray(one)) throw new Error('the list of releases is unreadable');
  list.push(...one);
  if (one.length < 100) break;
 }
 const release = list.filter(item => !item?.draft && !item?.prerelease && semver(item?.tag_name) && typeof item.published_at === 'string')
  .reduce((best, item) => !best || newer(item.tag_name, best.tag_name) ? item : best, null);
 if (!release || !newer(release.tag_name, installed)) return null;
 // A release from before #442 has no what's-new file (404): it is still an update, with no lines. Any other failure fails
 // the check.
 const entries = await since(release.tag_name).catch(error => { if (error?.status === 404) return []; throw error; });
 return { version: release.tag_name, date: release.published_at, entries };
}

/**
 * What's new after an update, for one person in one browser: the shipped entries they have not seen (`seen`, the issues
 * recorded when they last saw it), or with no record the entries dated after the day they joined, so a fresh install's
 * first Owner is shown nothing and an Owner from before the update is shown what arrived.
 */
export function unseenEntries(local, seen, joined) {
 if (Array.isArray(seen)) { const shown = new Set(seen); return local.filter(item => !shown.has(item.issue)); }
 const day = typeof joined === 'string' ? joined.slice(0, 10) : '';
 return day ? local.filter(item => item.date > day) : [];
}
