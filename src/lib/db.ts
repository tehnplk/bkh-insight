import "server-only";
import mysql from "mysql2/promise";
import type { Pool as MysqlPool, RowDataPacket } from "mysql2/promise";
import type { PoolConnection as CoreConnection, ExecuteValues } from "mysql2";
import { Pool as PgPool, types } from "pg";
import type { CustomTypesConfig } from "pg";

type Db = "HIS" | "INSIGHT";

// Cached on globalThis so dev HMR reuses pools instead of opening new ones on every reload.
const cache = globalThis as typeof globalThis & { __hisPool?: MysqlPool; __insightPool?: PgPool };

function config(db: Db) {
  const keys = ["HOST", "PORT", "USER", "PASSWORD", "DATABASE"].map((k) => `${db}_${k}`);
  const missing = keys.filter((k) => !process.env[k]);
  // Names only, never values.
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  const [host, port, user, password, database] = keys.map((k) => process.env[k]!);
  return { host, port: Number(port), user, password, database };
}

/** HIS = HOSxP on MySQL (production, read-only). */
function hisPool(): MysqlPool {
  if (cache.__hisPool) return cache.__hisPool;
  const p = mysql.createPool({
    ...config("HIS"),
    charset: "UTF8MB4_UNICODE_CI",
    timezone: "+07:00",
    dateStrings: true, // DATE/DATETIME come back as Thai-local strings, no UTC shift
    multipleStatements: false,
    connectionLimit: 3, // keep the production HIS lightly loaded
    maxIdle: 1,
    idleTimeout: 60_000,
    queueLimit: 50,
    connectTimeout: 10_000,
    enableKeepAlive: true,
  });
  // Runs before any query on a new connection; a connection that cannot be made read-only is destroyed.
  // The event hands over the core (callback) connection despite the promise typings.
  p.on("connection", (c) => {
    const conn = c as unknown as CoreConnection;
    // The server's init_connect forces SET NAMES tis620, so UTF-8 params would be misread (Thai search finds nothing).
    conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci", (err) => err && conn.destroy());
    conn.query("SET SESSION TRANSACTION READ ONLY", (err) => err && conn.destroy());
  });
  return (cache.__hisPool = p);
}

// DATE/TIMESTAMP/TIMESTAMPTZ come back as the server's text (Thai time via the session timezone),
// matching his. Scoped to the insight pool, so pg's global type parsers stay untouched.
const DATE_TYPES = new Set<number>([types.builtins.DATE, types.builtins.TIMESTAMP, types.builtins.TIMESTAMPTZ]);
const insightTypes: CustomTypesConfig = {
  getTypeParser: (id, format) => (DATE_TYPES.has(id) ? (v: string) => v : types.getTypeParser(id, format)),
};

/** INSIGHT = this app's own PostgreSQL. */
function insightPool(): PgPool {
  return (cache.__insightPool ??= new PgPool({
    ...config("INSIGHT"),
    options: "-c timezone=Asia/Bangkok",
    types: insightTypes,
    max: 10,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  }));
}

// ponytail: this guard is only a backstop. The real protection is the HIS DB user having SELECT-only
// grants. Leading comments are rejected outright (they can hide the verb, incl. /*! executable */ ones),
// and any ';' except a trailing one is rejected, so a literal ';' inside a string must go in params.
// Note: a session READ ONLY transaction still allows TEMPORARY tables; the guard blocks CREATE.
const READ_ONLY = /^(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i;

export function assertReadOnlySql(sql: string): void {
  const s = sql.trim().replace(/;\s*$/, "");
  if (!READ_ONLY.test(s) || s.includes(";")) {
    throw new Error("HIS is read-only: only a single SELECT/WITH/SHOW/DESCRIBE/EXPLAIN statement is allowed");
  }
}

/**
 * Escape % _ \ so user text matches literally. Works for both DBs: `\` is the default LIKE escape in
 * MySQL and PostgreSQL. his: `LIKE ?`, insight: `LIKE $1`, with `%${escapeLike(q)}%` as the param.
 */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** Read from the hospital HIS (production, read-only). Placeholders are `?`. There is intentionally no write API for HIS. */
export async function hisQuery<T = RowDataPacket>(sql: string, params: ExecuteValues[] = []): Promise<T[]> {
  assertReadOnlySql(sql);
  const [rows] = await hisPool().query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

/** Read from the app's own database. Placeholders are `$1, $2, …` (PostgreSQL), not `?`. */
export async function insightQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await insightPool().query(sql, params);
  return rows as T[];
}

/**
 * INSERT/UPDATE/DELETE on the app's own database. Placeholders are `$1, $2, …`.
 * Need generated values back? Use `insightQuery` with `RETURNING`.
 */
export async function insightExecute(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
  const { rowCount } = await insightPool().query(sql, params);
  return { rowCount: rowCount ?? 0 };
}
