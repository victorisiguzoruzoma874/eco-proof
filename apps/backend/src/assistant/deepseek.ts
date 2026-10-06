export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
/** Provider boundary: replace this adapter without changing tools or authentication. */
export async function complete(messages: unknown[], tools: unknown[], signal: AbortSignal, delta: (text: string) => void) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-flash', messages, tools, stream: true, max_tokens: 1600, thinking: { type: 'disabled' } }),
  });
  if (!response.ok || !response.body) throw new Error('Provider unavailable');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', content = '', doneMarker = false, bytes = 0;
  const calls: ToolCall[] = [];
  const consume = (block: string) => {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { doneMarker = true; return; }
    const event = JSON.parse(data); if (event.error) throw new Error('Provider error');
    const finish = event.choices?.[0]?.finish_reason;
    if (finish && !['stop', 'tool_calls'].includes(finish)) throw new Error('Incomplete provider response');
    const d = event.choices?.[0]?.delta;
    if (typeof d?.content === 'string') { content += d.content; delta(d.content); }
    for (const c of d?.tool_calls || []) {
      if (!Number.isInteger(c.index) || c.index < 0 || c.index > 7) throw new Error('Too many tools');
      calls[c.index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
      const call = calls[c.index]!;
      if (c.id) call.id = c.id;
      if (c.function?.name) call.function.name += c.function.name;
      if (c.function?.arguments) call.function.arguments += c.function.arguments;
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read(); bytes += value?.length || 0;
      if (bytes > 262144) throw new Error('Provider response too large');
      buffer += decoder.decode(value, { stream: !done }); buffer = buffer.replace(/\r\n/g, '\n');
      let i; while ((i = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0, i)); buffer = buffer.slice(i + 2); }
      if (done) break;
    }
    if (!doneMarker) throw new Error('Interrupted provider stream');
    return { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
