/**
 * What a page shows when there is nothing to show.
 *
 * An empty screen is an invitation to act, so it names what is missing, says
 * why the screen might be empty, and carries the one control that could change
 * it. The dashed grey box reading "No withdrawals yet." that used to sit here
 * did the first of those three.
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <p className="empty-body">{children}</p> : null}
      {action}
    </div>
  );
}
