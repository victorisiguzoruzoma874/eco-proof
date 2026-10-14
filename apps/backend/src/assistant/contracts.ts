import { BadRequestException, HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

export type Message = { role: 'user' | 'assistant'; content: string };
export class ToolInputError extends Error {}
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function validateMessages(body: unknown): Message[] {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join() !== 'messages') throw new BadRequestException('Expected messages only.');
  const messages = (body as { messages: unknown }).messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 30) throw new BadRequestException('Supply 1–30 messages.');
  let total = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).sort().join() !== 'content,role' || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 4000) throw new BadRequestException('Invalid message.');
    total += m.content.length;
  }
  if (total > 24000 || messages.at(-1).role !== 'user') throw new BadRequestException('Conversation too long or missing user turn.');
  return messages;
}
export function objectArgs(args: unknown, keys: string[]) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !keys.includes(k))) throw new ToolInputError('Invalid tool arguments.');
  return args as Record<string, unknown>;
}
/** Same rules as the global ValidationPipe, applied to model-supplied tool input. */
export function dtoArgs<T extends object>(cls: new () => T, args: unknown): T {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolInputError('Invalid tool arguments.');
  const instance = plainToInstance(cls, args, { enableImplicitConversion: false });
  const errors = validateSync(instance, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) throw new ToolInputError(errors.flatMap(e => Object.values(e.constraints ?? {})).slice(0, 3).join('; ') || 'Invalid tool arguments.');
  return Object.fromEntries(Object.entries(instance).filter(([, v]) => v !== undefined)) as T;
}
export function idArgs(args: unknown, key: string) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolInputError('Invalid tool arguments.');
  const { [key]: id, ...rest } = args as Record<string, unknown>;
  if (!isUuid(id)) throw new ToolInputError(`${key} must be a real id from a list tool.`);
  return { id, rest };
}
export function validAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000000 && Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-7;
}
export class UserLimiter {
  private buckets = new Map<string, { count: number; reset: number }>();
  check(user: string, now = Date.now()) {
    for (const [id, bucket] of this.buckets) if (bucket.reset <= now) this.buckets.delete(id);
    const bucket = this.buckets.get(user) || { count: 0, reset: now + 60000 };
    if (bucket.count >= 12) throw new HttpException('Too many assistant requests. Please wait a minute.', 429);
    bucket.count++; this.buckets.set(user, bucket);
  }
}
