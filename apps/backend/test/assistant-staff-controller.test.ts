import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { StaffAssistantController, staffToolError } from '../src/assistant/staff.controller';
import { ToolInputError } from '../src/assistant/contracts';
import { complete } from '../src/assistant/deepseek';
vi.mock('../src/assistant/deepseek', () => ({ complete: vi.fn() }));
const originalKey = process.env.DEEPSEEK_API_KEY;
afterEach(() => {
  vi.resetAllMocks();
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalKey;
});
describe('staff assistant controller', () => {
  it('sends only the role’s tools and passes the staff identity', async () => {
    process.env.DEEPSEEK_API_KEY = 'mock-only';
    const req = new EventEmitter(); const res: any = new EventEmitter(); let out = '';
    res.status = () => res; res.set = () => res; res.flushHeaders = () => {}; res.write = (s: string) => { out += s; }; res.end = () => { res.writableEnded = true; };
    const tools = { execute: vi.fn().mockResolvedValue({ ok: true }), confirm: vi.fn() };
    vi.mocked(complete).mockResolvedValueOnce({ role: 'assistant', content: '', tool_calls: [{ id: 't', type: 'function', function: { name: 'list_batches', arguments: '{}' } }] } as any).mockResolvedValueOnce({ role: 'assistant', content: 'done' } as any);
    const user = { sub: 'au-1', email: 'u@x.test', role: 'auditor' as const };
    await new StaffAssistantController(tools as any).chat({ messages: [{ role: 'user', content: 'list batches' }] }, user, req as any, res);
    const sent = vi.mocked(complete).mock.calls[0]![1] as any[];
    expect(sent.map(t => t.function.name)).not.toContain('seal_batch');
    expect(tools.execute).toHaveBeenCalledWith('list_batches', {}, user);
    expect(out).toContain('[DONE]');
  });
  it('surfaces client-facing service errors but hides server failures', () => {
    expect(staffToolError(new ToolInputError('limit must be 1'))).toBe('limit must be 1');
    expect(staffToolError(new ConflictException('event already has a reweigh'))).toBe('event already has a reweigh');
    expect(staffToolError(new InternalServerErrorException('db password leaked'))).not.toContain('password');
  });
  it('delegates confirmation to the tools with the caller', async () => {
    const tools = { confirm: vi.fn().mockResolvedValue({ summary: 's', result: {} }) };
    const user = { sub: 'admin-1', email: 'a@x.test', role: 'admin' as const };
    await new StaffAssistantController(tools as any).confirm('e8ec812e-8ad6-43ec-a7ef-17dc87c7e710', user);
    expect(tools.confirm).toHaveBeenCalledWith('e8ec812e-8ad6-43ec-a7ef-17dc87c7e710', user);
  });
  it('guards routes by role metadata', () => {
    expect(Reflect.getMetadata('roles', StaffAssistantController.prototype.confirm)).toEqual(['admin']);
    expect(Reflect.getMetadata('roles', StaffAssistantController.prototype.chat)).toEqual(['admin', 'operator', 'auditor']);
  });
});
