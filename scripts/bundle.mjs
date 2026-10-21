#!/usr/bin/env node
/**
 * Package the built game into a zip that can be uploaded to Facebook.
 *
 * The archive contains index.html at its root, which is what the Instant
 * Games platform expects.
 *
 * Usage:
 *   node scripts/bundle.mjs
 */

import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipArchive } from 'archiver';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const distDir = resolve(root, 'apps', 'game', 'dist');
const outDir = resolve(root, 'dist');
const outFile = resolve(outDir, 'tap-rush.zip');

try {
  const info = await stat(resolve(distDir, 'index.html'));
  if (!info.isFile()) throw new Error('not a file');
} catch {
  console.error(`[bundle] ${distDir}\\index.html not found. Run "npm run build:game" first.`);
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
await rm(outFile, { force: true });

await new Promise((resolvePromise, rejectPromise) => {
  const output = createWriteStream(outFile);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  output.on('close', () => {
    console.log(`[bundle] Wrote ${outFile} (${archive.pointer()} bytes).`);
    resolvePromise();
  });
  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') console.warn('[bundle] warning:', err.message);
    else rejectPromise(err);
  });
  archive.on('error', rejectPromise);

  archive.pipe(output);
  archive.directory(distDir, false);
  void archive.finalize();
});
