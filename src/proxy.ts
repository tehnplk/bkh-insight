import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Route protection for the whole app (Next 16 proxy, Auth.js `auth` wrapper). Every route the matcher
// lets through needs a session: pages redirect to /login, /api/* gets 401 JSON.
export const proxy = auth((req) => {
  if (req.auth) return;
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) return Response.json({ error: "unauthorized" }, { status: 401 });

  // callbackUrl is a path on this origin only; the login action re-checks it before redirecting.
  const login = new URL("/login", req.nextUrl);
  login.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(login);
});

export const config = {
  // Public: the login page, Auth.js endpoints, build assets and static files. New routes are protected by default.
  matcher: [
    "/((?!login$|api/auth/|_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
