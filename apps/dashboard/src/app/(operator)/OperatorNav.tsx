"use client";

import Link from "next/link";
import { signOut } from "./sign-out";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Primary nav, on one line, with the rest behind "More" — and below 1120px the
 * whole thing behind one menu button.
 *
 * Eleven links do not fit on one row at any sane font size. Splitting by
 * frequency rather than alphabetically: the six an operator touches during a
 * shift stay visible, and configuration a hub sets up once lives in the
 * overflow. Below the breakpoint even six will not fit beside the wordmark and
 * the account controls, so both groups collapse into a single stacked panel —
 * same links, same routes, no items dropped.
 */
const PRIMARY = [
  { href: "/", label: "Batches" },
  { href: "/events", label: "Weigh-ins" },
  { href: "/reweigh", label: "Reweigh" },
  { href: "/payouts", label: "Payouts" },
  { href: "/requests", label: "Requests" },
  { href: "/withdrawals", label: "Withdrawals" },
] as const;

const MORE = [
  { href: "/material-rates", label: "Material rates" },
  { href: "/materials", label: "Materials" },
  { href: "/catalog-items", label: "Catalog items" },
  { href: "/catalog-redemptions", label: "Catalog redemptions" },
] as const;

/**
 * `/` would otherwise match every route, so the root is compared exactly and
 * everything else by prefix (so `/batches/:id` still lights up Batches — note
 * Batches IS the root here, hence the explicit pair of cases).
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/batches");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Shared by both disclosures: close on an outside click or Escape, and close on
 * any navigation. A panel that can only be dismissed by clicking its own
 * trigger again is a trap once the pointer has moved on, and one that survives
 * a route change hangs over the page it just took you to.
 */
function useDismissable(
  open: boolean,
  close: () => void,
  pathname: string,
  /**
   * A panel rendered outside the element `ref` is attached to. Without it, a
   * press inside that panel counts as "outside": the panel closes on mousedown
   * and unmounts before the click lands, so none of its links ever navigated.
   */
  panel?: React.RefObject<HTMLElement | null>,
) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panel?.current?.contains(target)) return;
      if (ref.current && !ref.current.contains(target)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, panel]);

  useEffect(() => {
    close();
    // Only on a route change: `close` is stable enough that including it here
    // would fire this on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return ref;
}

export function OperatorNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const moreActive = MORE.some((item) => isActive(pathname, item.href));

  const moreRef = useDismissable(moreOpen, () => setMoreOpen(false), pathname);
  const menuPanelRef = useRef<HTMLElement>(null);
  const menuRef = useDismissable(menuOpen, () => setMenuOpen(false), pathname, menuPanelRef);

  return (
    <>
      <nav className="links" aria-label="Operator sections">
        {PRIMARY.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="nav-link"
            data-active={isActive(pathname, item.href)}
          >
            {item.label}
          </Link>
        ))}

        <div className="nav-more" ref={moreRef}>
          <button
            type="button"
            className="nav-link nav-more-trigger"
            data-active={moreActive}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            onClick={() => setMoreOpen((prev) => !prev)}
          >
            More
            <span className="nav-more-caret" aria-hidden="true">
              ▾
            </span>
          </button>

          {moreOpen ? (
            <div className="nav-more-panel" role="menu">
              {MORE.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  className="nav-more-item"
                  data-active={isActive(pathname, item.href)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </nav>

      {/*
       * The small-screen menu. Both the button and the panel are always
       * rendered and shown or hidden by CSS at the 1120px breakpoint — doing
       * this with a JavaScript width check instead would render the wrong one
       * during SSR and flip after hydration.
       */}
      <div className="nav-toggle" ref={menuRef}>
        <button
          type="button"
          className="btn"
          aria-expanded={menuOpen}
          aria-controls="operator-menu"
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <MenuIcon open={menuOpen} />
          Menu
        </button>
      </div>

      {menuOpen ? (
        <nav className="nav-panel" id="operator-menu" aria-label="Operator sections" ref={menuPanelRef}>
          {PRIMARY.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="nav-link"
              data-active={isActive(pathname, item.href)}
            >
              {item.label}
            </Link>
          ))}

          <p className="nav-panel-group">Configuration</p>
          {MORE.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="nav-link"
              data-active={isActive(pathname, item.href)}
            >
              {item.label}
            </Link>
          ))}

          {/*
           * The two account links live in the topbar on a wide screen, where
           * this panel does not exist; they are hidden there below the
           * breakpoint and reappear here so neither route becomes unreachable
           * on a phone.
           */}
          <p className="nav-panel-group">Account</p>
          {signedIn ? (
            <form action={signOut}>
              <button type="submit" className="nav-link">
                Sign out
              </button>
            </form>
          ) : (
            <Link href="/login" className="nav-link">
              Sign in
            </Link>
          )}
          <Link href="/requester/login" className="nav-link">
            Requester login
          </Link>
        </nav>
      ) : null}
    </>
  );
}

/** Three bars, or a cross once the panel is open. 16px, to sit with 13px text. */
function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M3.5 3.5 12.5 12.5" />
          <path d="M12.5 3.5 3.5 12.5" />
        </>
      ) : (
        <>
          <path d="M2.5 4.5h11" />
          <path d="M2.5 8h11" />
          <path d="M2.5 11.5h11" />
        </>
      )}
    </svg>
  );
}
