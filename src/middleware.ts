import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Centralized auth middleware.
 *
 * Protects all dashboard pages and API routes by verifying:
 *   1. User is authenticated (has a valid session)
 *   2. User account is active (admin has enabled it)
 *
 * Public routes (excluded via `config.matcher`):
 *   - /login, /register — auth pages
 *   - /api/auth/* — NextAuth handlers
 *   - /api/register — self-registration
 *   - /api/kiosk/* — NFC kiosk (Bearer API key)
 *   - /api/external/* — external integrations (Bearer API key)
 *   - /api/employee-portal/* — employee personal API key
 *   - /api/telegram/webhook/* — Telegram bot webhook
 *   - /_next/*, /favicon.ico, static assets
 *
 * Note: admin-vs-employee authorization still happens per-route
 * via checkAuth() / checkAuthAny(). This middleware only gates
 * "is the user logged in and active?".
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // No session → redirect to login (pages) or 401 (API)
  if (!req.auth) {
    if (isApi) {
      return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Inactive account → 403 (API) or redirect to login with message (pages)
  const user = req.auth.user as { active?: boolean } | undefined;
  if (user && user.active === false) {
    if (isApi) {
      return NextResponse.json({ error: "Account non attivato" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/login?error=inactive", req.url));
  }

  // CSRF same-origin check on mutating requests.
  // Public routes (kiosk, external, telegram webhook, employee-portal, register,
  // NextAuth) are already excluded by config.matcher.
  const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  if (MUTATING_METHODS.has(req.method)) {
    const host = req.headers.get("host");
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");

    let allowed = false;
    if (origin) {
      try {
        allowed = new URL(origin).host === host;
      } catch {
        allowed = false;
      }
    } else if (referer) {
      try {
        allowed = new URL(referer).host === host;
      } catch {
        allowed = false;
      }
    }

    if (!allowed) {
      return NextResponse.json({ error: "CSRF blocked" }, { status: 403 });
    }
  }

  return NextResponse.next();
});

/**
 * Matcher: run middleware on all routes EXCEPT public ones.
 *
 * Next.js middleware matcher uses a simple path syntax:
 *   - /:path* matches everything
 *   - Negative lookahead isn't supported, so we list protected prefixes
 */
export const config = {
  matcher: [
    /*
     * Match all routes except:
     *   - _next/static, _next/image (Next.js internals)
     *   - favicon.ico, public assets
     *   - /login, /register (auth pages)
     *   - /api/auth (NextAuth)
     *   - /api/register (self-registration)
     *   - /api/kiosk (NFC kiosk, Bearer auth)
     *   - /api/external (external API, Bearer auth)
     *   - /api/employee-portal (employee API key)
     *   - /api/telegram/webhook (Telegram bot)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|logo\\.svg|logo-dark\\.svg|uploads/|login|register|api/auth|api/register|api/kiosk|api/external|api/employee-portal|api/telegram/webhook).*)",
  ],
};
