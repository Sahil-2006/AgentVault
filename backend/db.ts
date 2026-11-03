import { Pool } from 'pg';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { schema } from './schema.js';
import type { Config } from './config.js';

export interface Queryable { query<T = Record<string, any>>(sql: string, values?: any[]): Promise<{ rows: T[] }> }
export interface Database extends Queryable { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>; close(): Promise<void> }
export async function openDatabase(config: Pick<Config, 'production' | 'databaseUrl' | 'localPath'>): Promise<Database> {
  let db: Database;
  if (config.databaseUrl) {
    const pool = new Pool({ connectionString: config.databaseUrl, max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000 });
    db = {
      query: async <T>(sql: string, args?: any[]) => ({ rows: (await pool.query(sql, args)).rows as T[] }), close: () => pool.end(),
      async transaction(fn) {
        const client = await pool.connect();
        try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
    };
  } else {
    if (config.production) throw new Error('DATABASE_URL must be configured for hosted use.');
    const { PGlite } = await import('@electric-sql/pglite');
    if (config.localPath !== ':memory:') await mkdir(dirname(resolve(config.localPath)), { recursive: true });
    const local = new PGlite(config.localPath === ':memory:' ? undefined : config.localPath);
    await local.waitReady;
    db = { query: (sql, args) => local.query(sql, args), transaction: fn => local.transaction(fn), close: () => local.close() };
  }
  await db.transaction(async tx => {
    // Serializes first-run migrations across serverless instances.
    await tx.query('SELECT pg_advisory_xact_lock(86423519)');
    for (const statement of schema.split(';').filter(x => x.trim())) await tx.query(statement);
  });
  return db;
}
export async function one<T = Record<string, any>>(db: Queryable, sql: string, values: any[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, values)).rows[0];
}
