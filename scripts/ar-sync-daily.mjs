// Run: npm run ar:sync (node --env-file=.env scripts/ar-sync-daily.mjs), daily by deploy/bkh-insight-ar-sync.timer.
// Same as pressing "ดึงยอดล่าสุด" on /fund/ar-ledger: POST /api/fund/ar-sync { mode: "daily" } with a 5-minute session
// JWT for a role "user" service identity, so proxy.ts needs no exception and /api/admin/* stays 403.
import { encode } from "next-auth/jwt";

const secret = process.env.AUTH_SECRET;
if (!secret) {
  console.error("Missing env: AUTH_SECRET");
  process.exit(1);
}
const base = process.env.AR_SYNC_URL ?? "http://127.0.0.1:3000";
// Fields the jwt/session callbacks in src/auth.ts read; no userId because there is no users row. name lands in ar_sync_log.
const token = { name: "ระบบตั้งเวลา", role: "user", sub: "ar-sync-timer" };
// Auth.js picks the cookie name (which is also the encryption salt) from AUTH_URL or the request protocol, so send both.
const names = ["authjs.session-token", "__Secure-authjs.session-token"];
const cookie = (await Promise.all(names.map(async (salt) => `${salt}=${await encode({ token, secret, salt, maxAge: 300 })}`))).join("; ");

// shortcut: fetch gives up after 5 min without response headers (undici default), switch to node:http if a daily sync ever takes that long.
const res = await fetch(`${base}/api/fund/ar-sync`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ mode: "daily" }),
});
const body = await res.json().catch(() => null);
console.log(`ar-sync ${res.status}`, JSON.stringify(body?.counts ?? body?.error ?? body));
if (!res.ok) process.exit(1);
