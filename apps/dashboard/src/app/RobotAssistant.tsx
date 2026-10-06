"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/** The standalone widget owns its Shadow DOM, listeners, and request lifecycle. */
export function RobotAssistant() {
  const mount = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const widget = mount.current?.querySelector('proofchain-chat');
    if (!widget) return;
    widget.setAttribute('offset-y', pathname.startsWith('/requester') ? '88' : '104');
    const endpoint = process.env.NEXT_PUBLIC_ASSISTANT_ENDPOINT || (pathname.startsWith('/requester/') ? '/api/v1/assistant' : '');
    if (endpoint) widget.setAttribute('endpoint', endpoint); else widget.removeAttribute('endpoint');
  }, [pathname, ready]);
  useEffect(() => {
    const container = mount.current;
    if (!ready || !container) return;
    const widget = document.createElement("proofchain-chat") as HTMLElement & {
      requestAssistant: typeof fetch;
      performAction: (action: { kind: string; target?: string; amountCredits?: number }) => Promise<string>;
    };
    widget.setAttribute("placement", "left");
    widget.setAttribute("robot-src", "/ai-chat/robot.png");
    widget.setAttribute("assistant-name", "ProofChain assistant");
    widget.setAttribute("offset-y", pathname.startsWith('/requester') ? '88' : '104');
    widget.requestAssistant = (url, init) => fetch(url, { ...init, credentials: 'same-origin' });
    widget.performAction = async action => {
      const screens: Record<string, string> = { dashboard: '/requester/dashboard', wallet: '/requester/wallet', history: '/requester/history', rewards: '/requester/rewards', request: '/requester/request' };
      let target: string;
      if (action.kind === 'navigate' && action.target && screens[action.target]) target = screens[action.target]!;
      else if (action.kind === 'review-withdrawal' && typeof action.amountCredits === 'number' && Number.isFinite(action.amountCredits) && action.amountCredits > 0 && action.amountCredits <= 1000000 && Math.abs(action.amountCredits * 1000 - Math.round(action.amountCredits * 1000)) < 1e-7) target = `/requester/wallet?reviewAmount=${action.amountCredits}#withdraw`;
      else throw new Error('Unsupported application action.');
      router.push(target);
      // Router push is not confirmation. Wait for the requested screen to mount.
      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          if (!widget.isConnected) { reject(new Error('Assistant removed.')); return; }
          const expected = new URL(target, location.origin);
          if (location.pathname === expected.pathname && location.search === expected.search && (action.kind !== 'review-withdrawal' || document.querySelector<HTMLInputElement>('#amountCredits')?.value === String(action.amountCredits))) { resolve(); return; }
          if (Date.now() - start > 5000) reject(new Error('The application has not confirmed opening the screen.')); else setTimeout(check, 50);
        }; check();
      });
      return action.kind === 'review-withdrawal' ? 'Withdrawal form opened for review. Nothing submitted or paid.' : 'Application screen opened.';
    };
    const endpoint = process.env.NEXT_PUBLIC_ASSISTANT_ENDPOINT || (pathname.startsWith('/requester/') ? '/api/v1/assistant' : '');
    if (endpoint) widget.setAttribute("endpoint", endpoint);
    container.append(widget);
    return () => widget.remove();
  }, [ready, router]);
  return <><div ref={mount} /><Script src="/ai-chat/widget.js" strategy="afterInteractive" onReady={() => setReady(true)} /></>;
}
