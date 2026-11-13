import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { feedSince, formatFigure, numbersTiles, parsePeriod } from '../lib/numbers.mjs';
import { i18n } from '../lib/i18n.mjs';

// The Numbers page (#35): every figure comes from a connected app and names its source and period.
const fakeApps = [
 { app: 'Fake Ads', period: '7', spend: 1200, leads: 40, currency: 'EGP' },
 { app: 'Fake Sheet', period: '7', revenue: 9000, currency: 'EGP' },
 { app: 'Fake Ads', period: '30', spend: 5000, leads: 100, currency: 'EGP' },
];

test('each figure is read from the fake app source, with its source and period', () => {
 const { connected, tiles } = numbersTiles(fakeApps, '7');
 assert.equal(connected, true);
 const byName = Object.fromEntries(tiles.map(tile => [tile.name, tile]));
 assert.deepEqual(tiles.map(tile => tile.label), ['numbersSpend', 'numbersLeads', 'numbersCostPerLead', 'numbersRevenue']);
 assert.deepEqual([byName.spend.value, byName.spend.sources, byName.spend.period], [1200, ['Fake Ads'], '7']);
 assert.deepEqual([byName.leads.value, byName.leads.sources], [40, ['Fake Ads']]);
 assert.deepEqual([byName.costPerLead.value, byName.costPerLead.sources], [30, ['Fake Ads']]);
 assert.deepEqual([byName.revenue.value, byName.revenue.sources], [9000, ['Fake Sheet']]);
 const { t, locale } = i18n('en');
 assert.equal(formatFigure(byName.spend, locale), '1,200');
 assert.equal(formatFigure(byName.costPerLead, locale), '30.0');
 assert.equal(t('numbersSource', byName.spend.sources.join(', '), t('numbersLast7')), 'From Fake Ads · Last 7 days');
 assert.equal(i18n('ar').t('numbersSource', 'Fake Sheet', i18n('ar').t('numbersLast7')), 'من Fake Sheet · آخر 7 أيام');
 // The other period reads only its own readings.
 const month = Object.fromEntries(numbersTiles(fakeApps, '30').tiles.map(tile => [tile.name, tile]));
 assert.deepEqual([month.spend.value, month.costPerLead.value, month.revenue.value], [5000, 50, null]);
});

test('with no app connected there are no numbers', () => {
 const { connected, tiles } = numbersTiles([], '7');
 assert.equal(connected, false);
 assert.equal(tiles.length, 4);
 for (const tile of tiles) { assert.equal(tile.value, null, tile.name); assert.deepEqual(tile.sources, []); assert.equal(formatFigure(tile, 'en-US'), null); }
 assert.equal(numbersTiles(undefined, '30').connected, false);
});

test('cost per lead needs spend and leads from the same apps; an unknown period is the last 7 days', () => {
 const tiles = Object.fromEntries(numbersTiles([{ app: 'Spend only', period: '7', spend: 500 }, { app: 'Leads only', period: '7', leads: 10 }], '7').tiles.map(tile => [tile.name, tile]));
 assert.equal(tiles.spend.value, 500);
 assert.equal(tiles.leads.value, 10);
 assert.equal(tiles.costPerLead.value, null);
 assert.equal(parsePeriod('30'), '30');
 assert.equal(parsePeriod('90'), '7');
 assert.equal(parsePeriod(undefined), '7');
 assert.equal(feedSince(Date.parse('2026-11-13T12:00:00Z')), '2026-11-06T12:00:00.000Z');
});

// The reference's demo figures (design-reference/app.js: DATA, PRICE and the dashboard's sample-data line) are not in
// the product's source, catalogues or styles. Each constant is first found in the reference, so a wrong list fails.
test('no demo figure from the reference is in the build', () => {
 const reference = readFileSync('design-reference/app.js', 'utf8');
 const demo = ['3480', '2150', '5210', '50400', '14900', '9300', '22800', '196800', 'const PRICE = 2400', 'بيانات تجريبية للنموذج', 'Sample data for this prototype', 'سعر الكورس', 'Course price'];
 for (const value of demo) assert.ok(reference.includes(value), `the reference has ${value}`);
 const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
 const product = [...files('app'), ...files('lib'), ...files('components')].filter(file => /\.(tsx?|mjs|css|json)$/.test(file));
 assert.ok(product.some(file => file.endsWith(join('numbers', 'page.tsx'))), 'the Numbers page is scanned');
 const figures = ['3480', '3,480', '2150', '2,150', '5210', '50400', '50,400', '14900', '9300', '22800', '196800', '2400', '2,400', '5,630', '55,200', '29.3', 'بيانات تجريبية للنموذج', 'Sample data for this prototype', 'سعر الكورس', 'Course price'];
 for (const file of product) {
  const source = readFileSync(file, 'utf8');
  // A figure counts only as itself, not inside a longer number (24000 is not 2400).
  for (const value of figures) assert.ok(!new RegExp(`(?<![\\d.,])${value.replace(/[.]/g, '\\.')}(?![\\d,]|\\.\\d)`).test(source), `${file} carries the reference's demo figure ${value}`);
 }
});
