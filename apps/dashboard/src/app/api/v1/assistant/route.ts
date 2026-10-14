import { REQUESTER_TOKEN_COOKIE } from '@/lib/api';
import { proxyAssistant } from '@/lib/assistant-proxy';
export function POST(request: Request) { return proxyAssistant(request, REQUESTER_TOKEN_COOKIE, '/api/v1/assistant', 'Sign in with your requester account.'); }
