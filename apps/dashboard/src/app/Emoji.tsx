import "./emoji.css";

/**
 * An emoji with motion, usable from either section.
 *
 * A plain server component — the animation is entirely CSS, so this ships no
 * client JavaScript. It exists mainly to guarantee the `<span>` wrapper is
 * present (a bare emoji in a text node can't be targeted or transformed) and
 * to carry the accessibility bits in one place instead of at 16 call sites.
 *
 * `role="img"` plus a label is what stops a screen reader announcing
 * "recycling symbol" in the middle of a sentence that already says the
 * material's name — the emoji here is always decorative, sitting immediately
 * beside the text it illustrates, so it's hidden from assistive tech by
 * default.
 *
 * NOTE: cannot be used inside an `<option>` — HTML forbids element children
 * there, and browsers silently strip them. Those call sites keep the bare
 * string from `materialEmoji()`.
 */
export function Emoji({ children, label }: { children: React.ReactNode; label?: string }) {
  if (label) {
    return (
      <span className="emoji" role="img" aria-label={label}>
        {children}
      </span>
    );
  }

  return (
    <span className="emoji" aria-hidden="true">
      {children}
    </span>
  );
}
