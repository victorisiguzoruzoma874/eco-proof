import type { Tone } from "./StatusBadge";

/**
 * A system message with a structure: what happened, what to do about it, and
 * the control that does it.
 *
 * `detail` is the underlying error verbatim, in mono, and it is deliberately
 * kept rather than swallowed — an operator who can read "connection refused"
 * knows to check the API process, and a support ticket that quotes it can be
 * answered. Presenting an error professionally means wrapping the real one,
 * never replacing it with a friendlier fiction.
 *
 * `role="alert"` only when the message is a failure: a success note announced
 * assertively interrupts a screen reader mid-sentence for no reason.
 */
export function Alert({
  tone = "neutral",
  title,
  children,
  detail,
  action,
}: {
  tone?: Tone;
  title: string;
  children?: React.ReactNode;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="alert" data-tone={tone} role={tone === "broken" ? "alert" : undefined}>
      <p className="alert-title">{title}</p>
      {children ? <p className="alert-body">{children}</p> : null}
      {detail ? <p className="alert-detail">{detail}</p> : null}
      {action}
    </div>
  );
}
