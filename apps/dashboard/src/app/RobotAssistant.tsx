"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ASSISTANT_SCREENS, clearAssistantDrafts, saveAssistantDraft, validateAssistantAction } from '@/lib/assistant-actions';
import { applyDashboardTheme } from '@/lib/theme';

/** The standalone widget owns its Shadow DOM, listeners, and request lifecycle. */
export function RobotAssistant() {
  const mount = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (pathname.endsWith('/login') || pathname.endsWith('/signup')) clearAssistantDrafts();
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
      performAction: (action: unknown) => Promise<string>;
    };
    widget.setAttribute("placement", "left");
    widget.setAttribute("robot-src", "/ai-chat/robot-3d.png");
    widget.setAttribute("assistant-name", "ProofChain assistant");
    widget.setAttribute("offset-y", pathname.startsWith('/requester') ? '88' : '104');
    widget.requestAssistant = (url, init) => fetch(url, { ...init, credentials: 'same-origin' });
    widget.performAction = async value => {
      const action = validateAssistantAction(value);
      if (action.kind === 'set-theme') {
        applyDashboardTheme(action.theme);
        if (document.documentElement.dataset.theme !== action.theme) throw new Error('Display change was not confirmed.');
        return `${action.theme === 'dark' ? 'Dark' : 'Light'} mode applied.`;
      }
      let target: string;
      if (action.kind === 'navigate') target = ASSISTANT_SCREENS[action.target]!;
      else if (action.kind === 'review-withdrawal') target = `/requester/wallet?reviewAmount=${action.amountCredits}#withdraw`;
      else if (action.kind === 'review-reward') target = `/requester/rewards?reviewItem=${action.itemId}#reward-${action.itemId}`;
      else if (action.kind === 'review-pickup') target = `/requester/request?assistantReview=${saveAssistantDraft(action)}`;
      else if (action.kind === 'review-claim') target = `/requester/wallet?assistantReview=${saveAssistantDraft(action)}#claim-code`;
      else throw new Error('Unsupported application action.');
      router.push(target);
      // Router push is not confirmation. Wait for the requested screen to mount.
      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          if (!widget.isConnected) { reject(new Error('Assistant removed.')); return; }
          const expected = new URL(target, location.origin);
          let ready = true;
          if (action.kind === 'review-withdrawal') ready = document.querySelector<HTMLInputElement>('#amountCredits')?.value === String(action.amountCredits);
          if (action.kind === 'review-pickup') ready = document.querySelector<HTMLSelectElement>('#hubId')?.value === action.hubId && document.querySelector<HTMLInputElement>(`input[name="material-${action.material}"]`)?.value === String(action.estimatedWeightKg) && document.querySelector<HTMLInputElement>('#address')?.value === action.address && document.querySelector<HTMLTextAreaElement>('#notes')?.value === (action.notes || '');
          if (action.kind === 'review-claim') ready = document.querySelector<HTMLInputElement>('#redemptionCode')?.value === action.code;
          if (action.kind === 'review-reward') ready = !!document.getElementById(`reward-${action.itemId}`);
          if (location.pathname === expected.pathname && location.search === expected.search && ready) { resolve(); return; }
          if (Date.now() - start > 5000) reject(new Error('The application has not confirmed opening the screen.')); else setTimeout(check, 50);
        }; check();
      });
      if (action.kind === 'navigate') return 'Application screen opened.';
      return 'Review form opened with your details. Nothing booked, redeemed, submitted or paid.';
    };
    const endpoint = process.env.NEXT_PUBLIC_ASSISTANT_ENDPOINT || (pathname.startsWith('/requester/') ? '/api/v1/assistant' : '');
    if (endpoint) widget.setAttribute("endpoint", endpoint);
    container.append(widget);
    return () => widget.remove();
  }, [ready, router]);
  return <><div ref={mount} /><Script src="/ai-chat/widget.js" strategy="afterInteractive" onReady={() => setReady(true)} /></>;
}
