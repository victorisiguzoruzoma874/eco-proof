"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/requester/dashboard", label: "Home" },
  { href: "/requester/wallet", label: "Wallet" },
  { href: "/requester/rewards", label: "Rewards" },
  { href: "/requester/history", label: "Activity" },
] as const;

/**
 * Left sidebar nav, shown only on authenticated requester screens (the layout
 * decides that server-side, before this ever mounts — see requester/layout.tsx).
 * A client component only because active-tab highlighting needs the current
 * path; everything else about the requester shell stays server-rendered.
 */
export function RequesterTabs() {
  const pathname = usePathname();

  return (
    <nav className="rq-tabs no-print">
      <div className="rq-nav-brand">
        <span className="rq-nav-logo" aria-hidden="true">
          ♻️
        </span>
        <span className="rq-nav-word">ProofChain</span>
      </div>
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className="rq-tab"
          data-active={pathname.startsWith(tab.href)}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
