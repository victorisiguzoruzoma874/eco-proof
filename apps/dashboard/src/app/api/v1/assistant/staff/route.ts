import { TOKEN_COOKIE } from '@/lib/api';
import { proxyAssistant } from '@/lib/assistant-proxy';
export function POST(request: Request) { return proxyAssistant(request, TOKEN_COOKIE, '/api/v1/assistant/staff', 'Sign in with your staff account.'); }
