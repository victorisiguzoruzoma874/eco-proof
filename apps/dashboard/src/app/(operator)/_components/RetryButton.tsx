"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Re-runs the current page's server render.
 *
 * `router.refresh()` is the whole mechanism, and it is the right one here: every
 * page in this section is a server component that fetches through `lib/api.ts`
 * with `cache: "no-store"`, so re-rendering on the server IS re-fetching. No
 * client-side data layer is introduced, no request is duplicated, and the retry
 * goes through the same authenticated path as the original load.
 *
 * Wrapped in `useTransition` so the button can say it is working. A retry
 * against a backend that is down resolves in milliseconds — without the pending
 * state the button looks inert and gets clicked five more times.
 */
export function RetryButton({ label = "Retry" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Retrying…" : label}
    </button>
  );
}
