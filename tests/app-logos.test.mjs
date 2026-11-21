import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { logoOf, logoWaiting as waiting } from '../components/logos.ts';
import { apps, customApp, knownApp } from '../lib/app-catalogue.mjs';
import { markOf } from '../lib/app-mark.mjs';
import en from '../lib/messages/apps.en.json' with { type: 'json' };

// #577: every connectable app shows its company's own logo, a file of this install. The catalogue's apps are the
// `use.<key>` entries of its messages; `command`, `custom` and `own` name no company and keep their letter.
const noCompany = new Set(['command', 'custom', 'own']);
const keys = Object.keys(en).filter(key => key.startsWith('use.')).map(key => key.slice(4)).filter(key => !noCompany.has(key) && !waiting.has(key));

test('every app of the catalogue maps to a logo file in public/', () => {
  assert.ok(keys.length >= 84, `${keys.length} apps`);
  for (const key of keys) {
    const file = logoOf(key);
    assert.ok(file, `${key} has a logo`);
    assert.ok(existsSync(`public${file}`), `${key}: public${file} exists`);
  }
  for (const app of apps.filter(app => !noCompany.has(app.key) && !waiting.has(app.key))) assert.ok(logoOf(app.key), `${app.key} has a logo`);
  // A ready-made role's app with no drawn mark of its own (#424) takes its file too.
  assert.equal(logoOf('github'), '/logos/simple/github.svg');
  for (const key of waiting) assert.equal(logoOf(key), null, `${key} is still waiting: take it off the list once its file is in`);
});

// Each mark is the company the app is: these keys name a company another product shares a name with.
test('a shared name takes the right company\'s mark', () => {
  assert.equal(logoOf('apollo'), '/logos/brand/apollo.svg', 'Apollo.io, not Apollo GraphQL');
  assert.equal(logoOf('close'), '/logos/brand/close.svg', 'Close CRM');
  assert.equal(logoOf('make'), '/logos/simple/make.svg', 'Make.com');
  assert.match(readFileSync('public/logos/simple/make.svg', 'utf8'), /<title>Make<\/title>/);
  assert.match(logoOf('kiwi') ?? '', /^\/logos\/brand\/kiwi\.(svg|png)$/, 'Kiwi.com');
});

// A logo ships inside the install and draws nothing from outside: no script, no handler, no address of another site;
// a PNG is a real one.
test('every logo file is a static image of the install', () => {
  for (const set of ['simple', 'lobe', 'brand']) for (const name of readdirSync(`public/logos/${set}`).filter(name => /\.png$/.test(name)))
    assert.ok(readFileSync(`public/logos/${set}/${name}`).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${set}/${name} is a PNG`);
  for (const set of ['simple', 'lobe', 'brand']) for (const name of readdirSync(`public/logos/${set}`).filter(name => /\.svg$/.test(name))) {
    const svg = readFileSync(`public/logos/${set}/${name}`, 'utf8');
    assert.match(svg, /^<svg[\s>]/, `${set}/${name} is an SVG`);
    assert.match(svg, /viewBox=/, `${set}/${name} scales`);
    assert.doesNotMatch(svg, /<script|<foreignObject|<image|\son[a-z]+=|(?:xlink:)?href="(?!#)/i, `${set}/${name} is static`);
  }
});

// Each brand file names the official page it came from; the two icon sets keep their licences beside their files.
test('public/logos/brand/SOURCES.md names the official page of every brand file', () => {
  const sources = readFileSync('public/logos/brand/SOURCES.md', 'utf8');
  const files = readdirSync('public/logos/brand').filter(name => /\.(svg|png)$/.test(name));
  assert.ok(files.length > 0);
  for (const name of files) assert.match(sources, new RegExp(`\`${name.replace('.', '\\.')}\`[^\\n]*https://`), `${name} has its source page`);
  assert.ok(existsSync('public/logos/simple/LICENSE.md'));
  assert.ok(existsSync('public/logos/lobe/LICENSE'));
});

// A letter mark has one rule: the first letter of the name, uppercase.
test('a letter mark is the first letter of the name, uppercase', () => {
  assert.equal(markOf('Better Stack'), 'B');
  assert.equal(markOf(' n8n'), 'N');
  assert.equal(markOf('كانفا'), 'ك');
  assert.equal(markOf(''), '·');
  // Each catalogue app's letter, written out: the first letter of its name, uppercase.
  const expected = {
    airtable:'A', algolia:'A', alltrails:'A', amplitude:'A', asana:'A', atlassian:'A', attio:'A', 'aws-knowledge':'A',
    betterstack:'B', buildkite:'B', calendly:'C', canva:'C', circleci:'C', clickup:'C', close:'C', cloudflare:'C',
    cloudinary:'C', 'comfy-cloud':'C', context7:'C', craft:'C', datadog:'D', deepwiki:'D', dropbox:'D', figma:'F',
    fireflies:'F', gamma:'G', gitlab:'G', globalping:'G', grafana:'G', 'hugging_face':'H', indeed:'I', intercom:'I',
    kiwi:'K', klaviyo:'K', linear:'L', 'microsoft-learn':'M', miro:'M', mixpanel:'M', monday:'M', motherduck:'M',
    'n8n-official':'N', neon:'N', netlify:'N', notion:'N', paypal:'P', plaid:'P', postman:'P', 'prisma-postgres':'P',
    railway:'R', rentahuman:'R', robinhood:'R', semgrep:'S', sentry:'S', square:'S', strava:'S', stripe:'S',
    supabase:'S', todoist:'T', trivago:'T', 'twelve-data':'T', 'twilio-docs':'T', 'unreal-engine':'U', vercel:'V',
    webflow:'W', wolfram:'W', 'wordpress-com':'W', 'meta-ads':'M', 'tiktok-ads':'T', apollo:'A', semrush:'S',
    ahrefs:'A', supermetrics:'S', similarweb:'S', brevo:'B', 'mailchimp-transactional':'M', zapier:'Z', make:'M',
    buffer:'B', 'hootsuite-content':'H', 'hootsuite-inbox':'H', 'hootsuite-listening':'H', typeform:'T', clay:'C',
    lusha:'L', x:'X', own:'Y'
  };
  assert.deepEqual(Object.fromEntries(apps.map(app => [app.key, app.mark])), expected);
  assert.equal(customApp('my-crm').mark, 'M');
  assert.equal(knownApp('Google Analytics')?.mark, 'G');
});
