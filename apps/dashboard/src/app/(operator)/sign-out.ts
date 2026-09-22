"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TOKEN_COOKIE } from "@/lib/api";

/**
 * End the operator session.
 *
 * The token is a stateless JWT, so there is nothing to revoke server-side:
 * signing out means this browser stops holding it. The cookie is httpOnly,
 * which is why this has to be a server action — client JavaScript cannot
 * reach it to delete it. Only the operator cookie goes; a requester session
 * in the same browser is a separate account and is left alone.
 */
export async function signOut(): Promise<void> {
  (await cookies()).delete(TOKEN_COOKIE);
  redirect("/login?signedOut=1");
}
