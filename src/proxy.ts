import { NextResponse } from "next/server";
import { auth } from "@/auth";

// /admin and /api/admin, whole path segments only (/administrator is not admin).
const ADMIN_PATH = /^\/(api\/)?admin(\/|$)/;

// Route protection for the whole app (Next 16 proxy, Auth.js `auth` wrapper). Every route the matcher
// lets through needs a session: pages redirect to /login, /api/* gets 401 JSON. Everything under /admin and
// /api/admin also needs role "admin" (from the JWT, no DB read): pages redirect to /, /api/admin/* gets 403.
// The admin layout and each admin route handler check again; the proxy is not the only gate.
export const proxy = auth((req) => {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  if (req.auth) {
    if (!ADMIN_PATH.test(pathname) || req.auth.user.role === "admin") return;
    if (isApi) return Response.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
  if (isApi) return Response.json({ error: "unauthorized" }, { status: 401 });

  // callbackUrl is a path on this origin only; the login action re-checks it before redirecting.
  const login = new URL("/login", req.nextUrl);
  login.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(login);
});

export const config = {
  // Public: the login page, the SSO redirect_uri (/auth/callback, forwards to Auth.js), Auth.js endpoints, build assets
  // and static files. New routes are protected by default.
  matcher: [
    "/((?!login$|auth/callback$|api/auth/|_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
