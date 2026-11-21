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

/** Where the newest version is read: GitHub, a public registry, or another source the install names (tests). */
export const updateSource = base => {
 const root = (base || '').replace(/\/+$/, '');
 return root ? { api: root, raw: root, registry: root, image: repo }
  : { api: `https://api.github.com/repos/${repo}`, raw: `https://raw.githubusercontent.com/${repo}`, registry: 'https://ghcr.io', image: repo };
};

/**
 * The latest stable release, as GitHub lists it (its `tag_name`, `published_at` and `assets`), or null when none is
 * published. Stable is the highest vX.Y.Z GitHub does not mark as a prerelease or a draft, as gtmworks update picks it
 * (scripts/get.sh latest_release), not GitHub's latest, which is the last published and may be a hotfix of an older
 * line. Every page is read, 100 releases a page, up to one with fewer. Update ready reads it (checkUpdate), and so does
 * the install proof's release-update area, which installs it (scripts/latest-release.mjs, #483). It throws when the
 * list cannot be read.
 */
export async function latestStableRelease({ source = updateSource(), fetch = globalThis.fetch, headers = {}, signal } = {}) {
 const list = [];
 for (let page = 1; ; page++) {
  const url = `${source.api}/releases?per_page=100&page=${page}`;
  const response = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal });
  if (!response.ok) throw Object.assign(new Error(`${url} answered ${response.status}`), { status: response.status });
  const one = await response.json();
  if (!Array.isArray(one)) throw new Error('the list of releases is unreadable');
  list.push(...one);
  if (one.length < 100) break;
 }
 return list.filter(item => !item?.draft && !item?.prerelease && semver(item?.tag_name) && typeof item.published_at === 'string')
  .reduce((best, item) => !best || newer(item.tag_name, best.tag_name) ? item : best, null);
}

/**
 * The newest version on this install's channel, when it is newer than the installed one: `{version, date, entries}`
 * with the entries the installed build lacks. A release is newer by its tag; main is newer when the published `:main`
 * image, the one `gtmworks update` installs, brings at least one entry, since a main build with nothing a person can
 * see has nothing to tell them. null when up to date or when nothing is installed from a release; it throws when the
 * check fails (offline, refused, unreadable), which the caller hides.
 */
export async function checkUpdate({ installed, local = whatsNew, source = updateSource(), fetch = globalThis.fetch }) {
 if (installed !== 'main' && !semver(installed)) return null;
 // One deadline for the whole check: a main check makes three reads (token, index, what's-new) and the page should not
 // wait three times as long for a registry that does not answer.
 const signal = AbortSignal.timeout(8000);
 const read = async (url, headers = { accept: 'application/json' }) => {
  const response = await fetch(url, { headers, signal });
  if (!response.ok) throw Object.assign(new Error(`${url} answered ${response.status}`), { status: response.status });
  return response.json();
 };
 const known = new Set(local.map(item => item.issue));
 const since = ref => read(`${source.raw}/${ref}/lib/whats-new.json`).then(list => { if (!Array.isArray(list)) throw new Error('the what\'s-new file is unreadable'); return clean(list); }).then(list => list.filter(item => !known.has(item.issue)));
 if (installed === 'main') {
  // The branch can be ahead of the published image for a whole CI and release run, and stays ahead forever for a commit
  // whose CI failed: an offer read from the branch names a version the updater cannot install, and Update now does
  // nothing (#468). The image records the commit it was built from in its index annotations, the value the release
  // workflow reads back (#448): an anonymous pull token for the public package, then the index at its revision.
  const token = await read(`${source.registry}/token?scope=repository:${source.image}:pull&service=ghcr.io`).then(body => body?.token);
  if (typeof token !== 'string' || !token) throw new Error('the registry gave no pull token');
  const index = await read(`${source.registry}/v2/${source.image}/manifests/main`, {
   accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
   authorization: `Bearer ${token}`,
  });
  const revision = index?.annotations?.['org.opencontainers.image.revision'];
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('the published main image records no commit');
  const entries = await since(revision);
  return entries.length ? { version: 'main', date: entries.map(item => item.date).sort().at(-1), entries } : null;
 }
 const release = await latestStableRelease({ source, fetch, signal });
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
