"use client";
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { readAssistantDraft } from '@/lib/assistant-actions';

export function AssistantClaimInput() {
  const token = useSearchParams().get('assistantReview');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!token) { setNotice(''); return; }
    const draft = readAssistantDraft(token);
    if (draft?.kind === 'review-claim') { setCode(draft.code); setNotice('Review this code, then click Redeem. Eligibility has not been verified and no credits have been claimed.'); }
    else setNotice('The assistant draft expired. Enter your code again.');
  }, [token]);
  return <><input id="redemptionCode" name="redemptionCode" className="rq-code-input" required maxLength={16} placeholder="7K9M2QRT" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={code} onChange={e => setCode(e.target.value)} />{notice ? <span className="rq-note" role="status">{notice}</span> : null}</>;
}
