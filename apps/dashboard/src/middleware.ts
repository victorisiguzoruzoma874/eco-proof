import { NextResponse, type NextRequest } from "next/server";
import { TOKEN_COOKIE } from "@/lib/cookie-names";
import { unverifiedTokenRole } from "@/lib/token-role";

/**
 * Send a signed-in collector to `/collector` before any staff page renders.
 *
 * A collector signs in at `/login` like staff, but every screen in the
 * `(operator)` group calls staff-only routes the backend refuses them, so all
 * they would ever see there is errors. This is navigation, not security: the
 * backend's `JwtAuthGuard` is what keeps a collector token off staff routes.
 */
export function middleware(request: NextRequest) {
  const role = unverifiedTokenRole(request.cookies.get(TOKEN_COOKIE)?.value);
  if (role !== "collector") return NextResponse.next();
  return NextResponse.redirect(new URL("/collector", request.url));
}

export const config = {
  // Pages only. Not the collector's own page, not the requester app (a
  // separate account with its own cookie), and not API routes or files.
  // `collector$` and `collector/` rather than `collector`, which would also
  // skip the staff roster at `/collectors`.
  matcher: [
    "/((?!collector$|collector/|requester|api/|_next/|favicon\\.ico|illustrations/|ai-chat/).*)",
  ],
};
