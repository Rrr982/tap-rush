#!/usr/bin/env node
/**
 * Apply db/schema.sql to the configured database.
 *
 * Usage:
 *   node scripts/migrate.mjs
 *   node scripts/migrate.mjs --url postgres://...
 *
 * The connection string is read from DATABASE_URL. A local .env.local or .env
 * file is loaded if one is present.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function loadEnvFile() {
  for (const name of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(resolve(root, name));
      console.log(`[migrate] Loaded ${name}.`);
      return;
    } catch {
      // No such file, try the next one.
    }
  }
}

function readUrlArg() {
  const index = process.argv.indexOf('--url');
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return undefined;
}

loadEnvFile();

const url = readUrlArg() ?? process.env.DATABASE_URL;

if (!url) {
  console.error('[migrate] No DATABASE_URL found. Set it in the environment or pass --url.');
  process.exit(1);
}

const sql = neon(url);
const schema = await readFile(resolve(root, 'db', 'schema.sql'), 'utf8');

console.log('[migrate] Applying db/schema.sql ...');
await sql.query(schema);
console.log('[migrate] Done.');
