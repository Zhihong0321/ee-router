import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './pool.js';

export async function migrate(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationPath = join(dirname(fileURLToPath(import.meta.url)), 'migrations', '001_initial.sql');
  const sql = await readFile(migrationPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('eter-router-migrations'))");
    const applied = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations WHERE version = $1',
      ['001_initial'],
    );
    if (applied.rowCount) {
      await client.query('COMMIT');
      return;
    }
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', ['001_initial']);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
