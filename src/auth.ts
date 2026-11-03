import { createHash, timingSafeEqual } from "node:crypto";
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";

// Hash first so both sides are 32 bytes: timingSafeEqual needs equal lengths and must not leak the real length.
const sha256 = (s: string) => createHash("sha256").update(s).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(sha256(a), sha256(b));

const providers: Provider[] = [];

// Super user from .env. Off unless both vars are set, so an empty password can never match.
const { AUTH_ADMIN_USER: adminUser, AUTH_ADMIN_PASSWORD: adminPassword } = process.env;
if (adminUser && adminPassword) {
  providers.push(
    Credentials({
      credentials: { username: {}, password: {} },
      authorize({ username, password }) {
        // Compare both fields every time, so the response time does not tell which one was wrong.
        const userOk = safeEqual(String(username ?? ""), adminUser);
        const passOk = safeEqual(String(password ?? ""), adminPassword);
        return userOk && passOk ? { id: "admin", name: adminUser } : null;
      },
    }),
  );
}

// ponytail: SSO plugs in here. Push one OIDC provider and set its env; Auth.js reads AUTH_<PROVIDER>_ID / _SECRET / _ISSUER itself.
//   import Keycloak from "next-auth/providers/keycloak";   // AUTH_KEYCLOAK_ID / _SECRET / _ISSUER
//   if (process.env.AUTH_KEYCLOAK_ID) providers.push(Keycloak);
//   Microsoft Entra: "next-auth/providers/microsoft-entra-id" + AUTH_MICROSOFT_ENTRA_ID_ID / _SECRET / _ISSUER.
//   Any other IdP: push { id, name, type: "oidc", issuer, clientId, clientSecret }.
// Callback URL to register at the IdP: {origin}/api/auth/callback/<provider-id>. Add a button on /login that calls signIn("<provider-id>").

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  // No DB adapter yet: the session is an encrypted JWT cookie (AUTH_SECRET). 3 days, sliding: proxy.ts re-issues the
  // cookie on every request, so it expires after 3 idle days. jwt.maxAge defaults to this value.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 3 },
  pages: { signIn: "/login" },
});
