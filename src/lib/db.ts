import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

let pool: Pool | undefined;
export function getDatabaseUrl() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url)
    throw new Error(
      "DATABASE_URL or POSTGRES_URL is required in live mode",
    );
  return url;
}
export function getPool() {
  pool ??= new Pool({
    connectionString: getDatabaseUrl(),
    max: 3,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
  });
  return pool;
}
export function getDb() {
  return drizzle(getPool());
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return (await getPool().query<T>(text, values)).rows;
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}
