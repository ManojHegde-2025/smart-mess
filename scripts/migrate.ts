import "./env";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { closePool, transaction } from "../src/lib/db";
async function main() {
  try {
    const files = (await readdir("db"))
      .filter((f) => /^\d+.*\.sql$/.test(f))
      .sort();
    await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(782614305)");
      await c.query(
        "CREATE TABLE IF NOT EXISTS smart_mess_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
      );
      await c.query(
        "ALTER TABLE smart_mess_migrations ENABLE ROW LEVEL SECURITY",
      );
      for (const file of files) {
        const sql = await readFile(`db/${file}`, "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        const old = (
          await c.query(
            "SELECT checksum FROM smart_mess_migrations WHERE name=$1",
            [file],
          )
        ).rows[0];
        if (old) {
          if (old.checksum !== checksum)
            throw new Error(`Previously applied migration changed: ${file}`);
          console.log(`Already applied: ${file}`);
          continue;
        }
        await c.query(sql);
        await c.query(
          "INSERT INTO smart_mess_migrations(name,checksum) VALUES($1,$2)",
          [file, checksum],
        );
        console.log(`Applied: ${file}`);
      }
    });
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message.replace(
            /postgres(?:ql)?:\/\/\S+/g,
            "[redacted database URL]",
          )
        : "Migration failed",
    );
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
void main();
