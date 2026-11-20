import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import manifest from '../app/manifest.ts';

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// #453: a browser tab and an installed app show the gtmworks mark. A browser reads the icons the manifest names, so
// each one must be a real PNG in public/ at the size it declares, and one must be maskable for an Android or Chrome
// install, which crops the icon to its own shape.
test('every icon the web app manifest names is a PNG in public/ at its declared size, and one is maskable', () => {
  const icons = manifest().icons ?? [];
  assert.ok(icons.length > 0, 'the manifest names icons');
  for (const icon of icons) {
    const file = `public${icon.src}`;
    assert.ok(existsSync(file), `${file} exists`);
    // A PNG keeps its size in the IHDR header: width and height as big-endian uint32s at bytes 16 and 20.
    const bytes = readFileSync(file);
    assert.ok(bytes.subarray(0, 8).equals(pngSignature), `${file} is a PNG`);
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes, `${file} is ${icon.sizes}`);
  }
  assert.ok(icons.some(icon => icon.purpose === 'maskable'), 'one icon is maskable');
});
