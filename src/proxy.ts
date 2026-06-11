import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/modules/platform-core/auth/constants";

/**
 * Route protection (Next 16 `proxy.ts` — the `middleware` convention is
 * deprecated and renamed to proxy).
 *
 * This is an OPTIMISTIC check only: it tests cookie *presence*, never the DB
 * (the proxy must not rely on shared modules like `getDb()`, and per the
 * Next.js docs it must never be the only auth layer). Real session validation
 * happens server-side via `getSessionUser()` from
 * `@/modules/platform-core/auth/adapter` in every layout/page under /w/** and
 * inside every server action.
 *
 * Routing contract:
 * - `/login`, `/register`: public. They always render; the pages themselves
 *   redirect away when `getSessionUser()` is non-null (avoids redirect loops
 *   with stale cookies).
 * - `/`: redirects by session — with cookie → `/w`, without → `/login`.
 * - `/w` (no slug): resolver page; uses `getSessionUser()` to redirect to
 *   `/w/[slug]` or `/onboarding`.
 * - `/w/**`, `/onboarding`: require a session cookie; otherwise → `/login`
 *   with the original path in `?next=`.
 * - `/review/**`: PUBLIC by design and therefore intentionally OUTSIDE the
 *   matcher — it is the client review surface (§7.7, R8): no account, no
 *   session; the review token in the URL is the whole credential and every
 *   read/mutation validates it against the DB in the review module. Do NOT
 *   add it to the matcher.
 */

const PUBLIC_ROUTES = new Set(["/login", "/register"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  if (PUBLIC_ROUTES.has(pathname)) {
    return NextResponse.next();
  }

  if (pathname === "/") {
    return NextResponse.redirect(
      new URL(hasSessionCookie ? "/w" : "/login", request.url),
    );
  }

  // Protected area: /w/** and /onboarding.
  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/register", "/onboarding", "/w/:path*"],
};
