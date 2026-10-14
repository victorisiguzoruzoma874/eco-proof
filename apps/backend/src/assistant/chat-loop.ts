import { ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { complete } from './deepseek';
import type { Message } from './contracts';

export type ChatOptions = { system: string; tools: { function: { name: string } }[]; execute: (name: string, args: unknown) => Promise<unknown>; describeError: (error: unknown) => string };
const MAX_TOOL_RESULT = 16000;
export async function runChat(history: Message[], req: Request, res: Response, opts: ChatOptions) {
  const messages: any[] = [{ role: 'system', content: opts.system }, ...history];
  if (!process.env.DEEPSEEK_API_KEY) throw new ServiceUnavailableException('Assistant backend is not configured.');
  const abort = new AbortController(); const cancel = () => { if (!res.writableEnded) abort.abort(); };
  res.on('close', cancel); req.on('aborted', cancel);
  const timer = setTimeout(() => abort.abort(), 45000);
  const emit = (value: unknown) => { if (!res.destroyed && !abort.signal.aborted) res.write(`data: ${JSON.stringify(value)}\n\n`); };
  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
  try {
    let executions = 0;
    for (let round = 0; round < 4; round++) {
      const answer = await complete(messages, opts.tools, abort.signal, text => emit({ delta: text }));
      if (!answer.tool_calls?.length) { res.write('data: [DONE]\n\n'); return; }
      if (round === 3 || executions + answer.tool_calls.length > 8) throw new Error('Tool budget exhausted');
      messages.push(answer);
      for (const call of answer.tool_calls) {
        executions++; if (abort.signal.aborted) throw new Error('Cancelled');
        // Activity reflects an actual tool attempt, not invented progress.
        emit({ activity: 'Checking an application request…' });
        let result: unknown;
        try {
          if (!opts.tools.some(t => t.function.name === call.function.name)) throw new Error('Unsupported tool');
          result = await opts.execute(call.function.name, JSON.parse(call.function.arguments));
          if (abort.signal.aborted) throw new Error('Cancelled');
          const action = result as { action?: unknown; label?: string };
          if (action?.action) emit({ action: action.action, label: action.label?.slice(0, 200) });
        } catch (error) { result = { error: opts.describeError(error) }; }
        const content = JSON.stringify(result) ?? 'null';
        messages.push({ role: 'tool', tool_call_id: call.id, content: content.length > MAX_TOOL_RESULT ? `${content.slice(0, MAX_TOOL_RESULT)}…[truncated; narrow the query or lower limit]` : content });
      }
    }
  } catch {
    if (!res.destroyed) res.write(`data: ${JSON.stringify({ error: 'The assistant service is unavailable. Please retry.' })}\n\n`);
  } finally { clearTimeout(timer); abort.abort(); res.off('close', cancel); req.off('aborted', cancel); res.end(); }
}
