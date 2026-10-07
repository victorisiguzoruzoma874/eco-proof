export type AssistantAction =
  | { kind: 'navigate'; target: string }
  | { kind: 'review-withdrawal'; amountCredits: number }
  | { kind: 'review-pickup'; hubId: string; material: string; estimatedWeightKg: number; address: string; notes?: string }
  | { kind: 'review-reward'; itemId: string }
  | { kind: 'review-claim'; code: string }
  | { kind: 'set-theme'; theme: 'light' | 'dark' };
export const ASSISTANT_SCREENS: Record<string, string> = { dashboard: '/requester/dashboard', wallet: '/requester/wallet', history: '/requester/history', rewards: '/requester/rewards', request: '/requester/request' };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const amount = (v: unknown, max = 1000000): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max && Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-7;
export function validateAssistantAction(value: unknown): AssistantAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid application action.');
  const a = value as Record<string, unknown>;
  const keys = (...allowed: string[]) => Object.keys(a).every(k => allowed.includes(k));
  const valid =
    a.kind === 'navigate' && keys('kind', 'target') && typeof a.target === 'string' && Object.hasOwn(ASSISTANT_SCREENS, a.target) ||
    a.kind === 'review-withdrawal' && keys('kind', 'amountCredits') && amount(a.amountCredits) ||
    a.kind === 'review-reward' && keys('kind', 'itemId') && uuid(a.itemId) ||
    a.kind === 'review-claim' && keys('kind', 'code') && typeof a.code === 'string' && /^(?:[A-HJ-NP-Z2-9]{8}|[A-HJ-NP-Z2-9]{10})$/.test(a.code) ||
    a.kind === 'set-theme' && keys('kind', 'theme') && (a.theme === 'light' || a.theme === 'dark') ||
    a.kind === 'review-pickup' && keys('kind', 'hubId', 'material', 'estimatedWeightKg', 'address', 'notes') && uuid(a.hubId) && typeof a.material === 'string' && /^[A-Z0-9_-]{2,16}$/.test(a.material) && amount(a.estimatedWeightKg, 100000) && typeof a.address === 'string' && !!a.address.trim() && a.address.length <= 500 && (a.notes === undefined || typeof a.notes === 'string' && a.notes.length <= 1000);
  if (!valid) throw new Error('Unsupported application action.');
  return Object.freeze({ ...a }) as AssistantAction;
}

// Host UI drafts only, outside the reusable widget. Private details never enter
// URLs, localStorage or sessionStorage. Reloading discards unsubmitted drafts.
const drafts = new Map<string, { action: AssistantAction; expires: number }>();
export function saveAssistantDraft(action: AssistantAction): string {
  for (const [key, draft] of drafts) if (draft.expires <= Date.now()) drafts.delete(key);
  if (drafts.size >= 32) drafts.delete(drafts.keys().next().value!);
  const token = crypto.randomUUID();
  drafts.set(token, { action: validateAssistantAction(action), expires: Date.now() + 15 * 60000 });
  return token;
}
export function readAssistantDraft(token: string | null): AssistantAction | undefined {
  if (!token) return;
  const draft = drafts.get(token);
  if (draft && draft.expires > Date.now()) return draft.action;
  drafts.delete(token);
}
export function clearAssistantDrafts() { drafts.clear(); }
