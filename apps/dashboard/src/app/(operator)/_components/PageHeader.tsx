/**
 * The header every operator page opens with.
 *
 *   eyebrow   where in the product you are — "Cash-out queue"
 *   title     what this page is — "Withdrawals"
 *   summary   what you can do here, in one line
 *   actions   the page-level controls, right-aligned on the same baseline
 *
 * Every page in this section rendered this pattern by hand, which is how ten of
 * them ended up carrying a 2px full-ink divider that read as a redaction bar.
 * The rule under the header is now a hairline, declared once in `.page-head`.
 *
 * A server component: it holds no state and takes no interaction, so shipping
 * it to the browser would buy nothing.
 */
export function PageHeader({
  eyebrow,
  title,
  summary,
  actions,
}: {
  eyebrow: string;
  title: string;
  summary?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        {summary ? <p className="page-summary">{summary}</p> : null}
      </div>
      {/* `no-print`: page controls are not part of the audit artifact. */}
      {actions ? <div className="actions no-print">{actions}</div> : null}
    </header>
  );
}
