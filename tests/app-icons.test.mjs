import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import manifest from '../app/manifest.ts';

// #453: a browser tab and an installed app show the gtmworks mark. A browser reads the icons the manifest names, so
// each one must be a real PNG in public/ at the size it declares, and one must be maskable for an Android or Chrome
// install, which crops the icon to its own shape.
test('every icon the web app manifest names is a PNG in public/ at its declared size, and one is maskable', async () => {
  const icons = manifest().icons ?? [];
  assert.ok(icons.length > 0, 'the manifest names icons');
  for (const icon of icons) {
    const file = `public${icon.src}`;
    assert.ok(existsSync(file), `${file} exists`);
    const { format, width, height } = await sharp(file).metadata();
    assert.equal(format, 'png', `${file} is a PNG`);
    assert.equal(`${width}x${height}`, icon.sizes, `${file} is ${icon.sizes}`);
  }
  assert.ok(icons.some(icon => icon.purpose === 'maskable'), 'one icon is maskable');
});
