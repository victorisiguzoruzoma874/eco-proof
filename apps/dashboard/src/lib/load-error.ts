import { ApiError } from "./api";

/**
 * Turns whatever a page's data fetch threw into something an operator can act
 * on.
 *
 * Every operator page used to render one string for every failure:
 *
 *     catch { return <p className="error">Could not reach the backend.</p> }
 *
 * which is wrong far more often than it is right. `/wallet/withdrawals` is
 * guarded by `@Roles("admin", "operator")`, so an auditor opening it gets a 403
 * and an expired session gets a 401 — and both were reported as a network
 * outage. Someone would go and check whether the API was running, find that it
 * was, and have nowhere else to look.
 *
 * So the four cases are separated, because the reader's next action differs in
 * each: sign in, ask for access, retry, or go and look at the server.
 */
export type LoadErrorKind = "offline" | "unauthenticated" | "forbidden" | "server";

export interface LoadErrorInfo {
  kind: LoadErrorKind;
  /** What happened, as a heading. */
  title: string;
  /** What to do about it. */
  message: string;
  /** The underlying failure, verbatim — shown in mono under the message. */
  detail?: string;
  /** Whether re-running the request could plausibly succeed. */
  retryable: boolean;
}

/**
 * `resource` names the thing that failed to load, in the reader's words
 * ("withdrawal requests", "the batch list"), and is used in the message.
 */
export function describeLoadError(error: unknown, resource: string): LoadErrorInfo {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      /*
       * Deliberately not "your session has ended": a 401 here covers both the
       * operator whose token expired and the anonymous visitor who never had
       * one, and telling the second person their session ended sends them
       * looking for a session they never started. "Not signed in" is true of
       * both, and is the phrase `e2e/dashboard.mjs` asserts on.
       */
      return {
        kind: "unauthenticated",
        title: "You are not signed in",
        message: `Sign in to see ${resource}.`,
        detail: error.detail,
        retryable: false,
      };
    }

    if (error.status === 403) {
      return {
        kind: "forbidden",
        title: "This queue needs an operator account",
        message: `Your account can sign in, but is not allowed to read ${resource}. An admin can change your role.`,
        detail: error.detail,
        retryable: false,
      };
    }

    return {
      kind: "server",
      title: "The server could not complete the request",
      message: `${capitalise(resource)} could not be loaded. This is an error on the server, not a connection problem — retrying is worth one attempt.`,
      detail: error.detail ? `${error.status} — ${error.detail}` : `${error.message} (${error.status})`,
      retryable: true,
    };
  }

  /*
   * Anything that is not an ApiError never reached the backend at all: `fetch`
   * rejects before there is a status to read. That is the only case the old
   * message was ever correct about.
   */
  return {
    kind: "offline",
    title: "Unable to reach the backend",
    message: `${capitalise(resource)} could not be loaded. Check that the API is running and reachable, then try again.`,
    detail: detailOfThrown(error),
    retryable: true,
  };
}

/**
 * Node wraps the real reason one level down: a refused connection arrives as
 * `TypeError: fetch failed` with `cause: Error { code: "ECONNREFUSED" }`. The
 * outer message alone says nothing, so the cause is unwrapped and shown — it is
 * the difference between "the API is not running" and "DNS is wrong".
 */
function detailOfThrown(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? `${error.message} — ${code}` : `${error.message} — ${cause.message}`;
  }
  return error.message;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
