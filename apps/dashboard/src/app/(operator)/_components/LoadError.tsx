import Link from "next/link";
import { describeLoadError } from "@/lib/load-error";
import { Alert } from "./Alert";
import { RetryButton } from "./RetryButton";

/**
 * The banner a page shows when its data would not load.
 *
 * It classifies the failure first (see `lib/load-error.ts`) and then offers the
 * control that matches it: a retry when re-running the request could plausibly
 * work, a sign-in link when the session has ended, and nothing at all when the
 * answer is "ask an admin for a different role" — a Retry button that cannot
 * succeed is worse than no button, because it invites the reader to keep
 * pressing it instead of reading the sentence above it.
 */
export function LoadError({ error, resource }: { error: unknown; resource: string }) {
  const info = describeLoadError(error, resource);

  return (
    <Alert
      tone={info.kind === "offline" || info.kind === "server" ? "broken" : "pending"}
      title={info.title}
      detail={info.detail}
      action={
        info.retryable ? (
          <RetryButton />
        ) : info.kind === "unauthenticated" ? (
          <Link className="btn" href="/login">
            Sign in
          </Link>
        ) : null
      }
    >
      {info.message}
    </Alert>
  );
}
