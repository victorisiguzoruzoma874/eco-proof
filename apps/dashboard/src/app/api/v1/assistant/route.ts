import { cookies } from 'next/headers';
import { BACKEND_URL, REQUESTER_TOKEN_COOKIE } from '@/lib/api';

/** Session bridge: the browser never receives the httpOnly JWT or provider key. */
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  const token = (await cookies()).get(REQUESTER_TOKEN_COOKIE)?.value;
  if (!token) return Response.json({ error: 'Sign in with your requester account.' }, { status: 401 });
  if (Number(request.headers.get('content-length')) > 100000) return Response.json({ error: 'Request too large.' }, { status: 413 });
  const text = await request.text();
  if (text.length > 100000) return Response.json({ error: 'Request too large.' }, { status: 413 });
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/assistant`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: text, signal: request.signal, cache: 'no-store' });
    if (!upstream.ok) return Response.json({ error: upstream.status === 401 ? 'Your session expired. Sign in again.' : upstream.status === 429 ? 'Too many requests. Please wait.' : 'The assistant is unavailable. Please retry.' }, { status: upstream.status });
    return new Response(upstream.body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
  } catch { return Response.json({ error: 'The assistant is unavailable. Please retry.' }, { status: 503 }); }
}
