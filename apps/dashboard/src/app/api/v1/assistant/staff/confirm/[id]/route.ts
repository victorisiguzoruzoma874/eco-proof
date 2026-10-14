import { cookies } from 'next/headers';
import { BACKEND_URL, TOKEN_COOKIE } from '@/lib/api';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: 'Invalid confirmation.' }, { status: 400 });
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) return Response.json({ error: 'Sign in with your staff account.' }, { status: 401 });
  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/assistant/staff/confirm/${id}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const m = body.message, detail = typeof m === 'string' ? m : Array.isArray(m) && m.every((x: unknown) => typeof x === 'string') ? m.join('; ') : '';
      const error = upstream.status === 403 ? 'Only an admin can confirm this change.'
        : upstream.status === 410 ? 'This confirmation expired or was already used. Ask the assistant again.'
        : upstream.status === 401 ? 'Your session expired. Sign in again.'
        : upstream.status < 500 && detail ? detail : 'The change could not be applied. Please retry.';
      return Response.json({ error }, { status: upstream.status });
    }
    return Response.json({ summary: body.summary, temporaryPassword: body.result?.temporaryPassword });
  } catch { return Response.json({ error: 'The change could not be applied. Please retry.' }, { status: 503 }); }
}
