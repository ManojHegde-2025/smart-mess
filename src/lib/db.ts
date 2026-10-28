import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

let pool: Pool | undefined;
export function getPool() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required in live mode");
  const max = process.env.DATABASE_POOL_SIZE
    ? parseInt(process.env.DATABASE_POOL_SIZE, 10)
    : 10;
  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max,
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
