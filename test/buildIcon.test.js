import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import sharp from 'sharp';
import { buildIcon } from '../scripts/build-icon.mjs';

test('renders the existing Margin imprint as an opaque square Windows icon', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'margin-icon-'));
  const outputPath = path.join(tempDir, 'icon.png');

  try {
    await buildIcon({
      sourcePath: new URL('../frontend/public/assets/achievements/new_path.svg', import.meta.url),
      outputPath
    });
    const metadata = await sharp(outputPath).metadata();

    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.equal(metadata.hasAlpha, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
