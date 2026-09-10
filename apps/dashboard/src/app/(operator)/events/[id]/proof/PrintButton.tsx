"use client";

/**
 * The only interactive bit of the proof page.
 *
 * Everything else on this route is a Server Component — the page itself is
 * static once rendered, so the print trigger is pulled into its own tiny
 * client island rather than making the whole page a client component. Mirrors
 * the print-then-save-as-PDF flow the batch report page describes in text;
 * this route additionally offers a button because a collector on a phone at
 * a hub is less likely to know the keyboard shortcut.
 */
export function PrintButton() {
  return (
    <button type="button" className="btn" data-variant="primary" onClick={() => window.print()}>
      Print this proof
    </button>
  );
}
