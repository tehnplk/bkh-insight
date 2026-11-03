import "server-only";
import mysql from "mysql2/promise";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { PoolConnection as CoreConnection, ExecuteValues } from "mysql2";

type Db = "HIS" | "INSIGHT";
type Params = ExecuteValues[]; // positional `?` placeholders

// Cached on globalThis so dev HMR reuses pools instead of opening new ones on every reload.
const cache = globalThis as typeof globalThis & { __dbPools?: Partial<Record<Db, Pool>> };
const pools = (cache.__dbPools ??= {});

function config(db: Db) {
  const keys = ["HOST", "PORT", "USER", "PASSWORD", "DATABASE"].map((k) => `${db}_${k}`);
  const missing = keys.filter((k) => !process.env[k]);
  // Names only, never values.
  if (missing.length) throw new Error(`Missing env: ${missing.join(", ")}`);
  const [host, port, user, password, database] = keys.map((k) => process.env[k]!);
  return { host, port: Number(port), user, password, database };
}

function pool(db: Db): Pool {
  if (pools[db]) return pools[db];
  const p = mysql.createPool({
    ...config(db),
    charset: "UTF8MB4_UNICODE_CI",
    timezone: "+07:00",
    dateStrings: true, // DATE/DATETIME come back as Thai-local strings, no UTC shift
    multipleStatements: false,
    connectionLimit: db === "HIS" ? 3 : 10, // keep the production HIS lightly loaded
    maxIdle: db === "HIS" ? 1 : 5,
    idleTimeout: 60_000,
    queueLimit: 50,
    connectTimeout: 10_000,
    enableKeepAlive: true,
  });
  if (db === "HIS") {
    // Runs before any query on a new connection; a connection that cannot be made read-only is destroyed.
    // The event hands over the core (callback) connection despite the promise typings.
    p.on("connection", (c) => {
      const conn = c as unknown as CoreConnection;
      conn.query("SET SESSION TRANSACTION READ ONLY", (err) => err && conn.destroy());
    });
  }
  return (pools[db] = p);
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

/** Escape % _ \ so user text matches literally: `LIKE ?` with `%${escapeLike(q)}%` as the param. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** Read from the hospital HIS (production, read-only). There is intentionally no write API for HIS. */
export async function hisQuery<T = RowDataPacket>(sql: string, params: Params = []): Promise<T[]> {
  assertReadOnlySql(sql);
  const [rows] = await pool("HIS").query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

/** Read from the app's own database. */
export async function insightQuery<T = RowDataPacket>(sql: string, params: Params = []): Promise<T[]> {
  const [rows] = await pool("INSIGHT").query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

/** INSERT/UPDATE/DELETE on the app's own database. */
export async function insightExecute(sql: string, params: Params = []): Promise<ResultSetHeader> {
  const [result] = await pool("INSIGHT").execute<ResultSetHeader>(sql, params);
  return result;
}
