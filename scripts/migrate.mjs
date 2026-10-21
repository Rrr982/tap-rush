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

/**
 * Split a SQL file into single statements.
 *
 * The Neon serverless driver sends every query as a prepared statement, and
 * Postgres rejects a prepared statement that holds more than one command. The
 * schema is a list of DDL statements, so they are applied one at a time.
 */
function splitStatements(sqlText) {
  return sqlText
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

const statements = splitStatements(schema);

console.log(`[migrate] Applying db/schema.sql (${statements.length} statements) ...`);
for (const statement of statements) {
  await sql.query(statement);
}
console.log('[migrate] Done.');
