/**
 * The role a session token claims, read without verifying it.
 *
 * For choosing which screen to show only, never for deciding what someone may
 * do: anyone can write a cookie. The backend verifies the token and re-reads
 * the role on every request.
 *
 * Uses `atob`, not `Buffer`, so it also runs in middleware's edge runtime.
 */
export function unverifiedTokenRole(token: string | undefined): string | undefined {
  const payload = token?.split(".")[1];
  if (!payload) return undefined;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64)) as { role?: unknown };
    return typeof claims.role === "string" ? claims.role : undefined;
  } catch {
    return undefined;
  }
}
