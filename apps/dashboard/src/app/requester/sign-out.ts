"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { REQUESTER_TOKEN_COOKIE } from "@/lib/api";

/**
 * End the requester session. The requester counterpart of the operator
 * `signOut`: deletes only this account's httpOnly cookie, so an operator
 * signed in on the same browser stays signed in.
 */
export async function requesterSignOut(): Promise<void> {
  (await cookies()).delete(REQUESTER_TOKEN_COOKIE);
  redirect("/requester/login?signedOut=1");
}
