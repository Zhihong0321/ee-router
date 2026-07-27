import { readFile, readdir } from 'node:fs/promises';
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

  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const migrationFiles = (await readdir(migrationsDir))
    .filter(file => /^\d+_.+\.sql$/.test(file))
    .sort();

  for (const file of migrationFiles) {
    const version = file.replace(/\.sql$/, '');
    const applied = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [version],
    );
    if (applied.rowCount) continue;

    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('eter-router-migrations'))");
      const lockedApplied = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [version],
      );
      if (lockedApplied.rowCount) {
        await client.query('COMMIT');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      console.log(`[migration] Applied ${version}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
