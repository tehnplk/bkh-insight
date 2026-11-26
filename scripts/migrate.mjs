// Run: node --env-file=.env scripts/migrate.mjs [--no-backup]
// Applies db/migrations/*.sql to the insight PostgreSQL DB (never his), in name order, one transaction each.
// When anything is pending it first backs up with scripts/backup-db.sh premigrate; a failed backup = nothing migrated.
// A machine that cannot run the backup (e.g. a Windows dev box on the same DB) stops unless --no-backup is given.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const keys = ["HOST", "PORT", "USER", "PASSWORD", "DATABASE"].map((k) => `INSIGHT_${k}`);
const missing = keys.filter((k) => !process.env[k]);
if (missing.length) {
  // Names only, never values.
  console.error(`Missing env: ${missing.join(", ")}`);
  process.exit(1);
}
const [host, port, user, password, database] = keys.map((k) => process.env[k]);

const dir = new URL("../db/migrations/", import.meta.url);
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

function backupFirst(count) {
  const script = fileURLToPath(new URL("./backup-db.sh", import.meta.url));
  const tools = spawnSync("bash", ["-c", "command -v pg_dump && command -v gpg && command -v flock"], { stdio: "ignore" });
  if (!existsSync(script) || !process.env.BACKUP_PASSWORD || tools.status !== 0) {
    console.warn(
      `WARNING: ${count} pending migration(s), and this machine cannot back up the DB first (needs bash, pg_dump, gpg, flock and BACKUP_PASSWORD).\n` +
        `Back up first with "สำรองตอนนี้" at /admin/backup, then rerun: npm run db:migrate -- --no-backup`,
    );
    if (!process.argv.includes("--no-backup")) throw new Error("not backed up, nothing migrated (see warning above)");
    console.warn("--no-backup given: migrating WITHOUT a fresh backup");
    return;
  }
  console.log("Backing up before migration (scripts/backup-db.sh premigrate)...");
  const r = spawnSync("bash", [script, "premigrate"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`backup failed (exit ${r.status ?? r.signal}), nothing migrated`);
}

const client = new pg.Client({ host, port: Number(port), user, password, database });
try {
  await client.connect();
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const pending = files.filter((f) => !done.has(f));
  if (pending.length) backupFirst(pending.length);
  const applied = [];
  for (const name of pending) {
    const sql = await readFile(new URL(name, dir), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`${name}: ${e.message}`);
    }
    applied.push(name);
  }
  console.log(applied.length ? `Applied:\n${applied.join("\n")}` : "Nothing to apply");
} catch (e) {
  console.error(`Migration failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
