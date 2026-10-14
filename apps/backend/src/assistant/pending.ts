import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type PendingOp = { id: string; actorId: string; tool: string; args: Record<string, unknown>; summary: string; expires: number };
const TTL_MS = 5 * 60000, CAP = 200;
/**
 * Admin changes the model has prepared but a human has not confirmed.
 * In memory on purpose: a restart drops them and the admin simply asks again.
 */
@Injectable()
export class PendingAdminOps {
  private ops = new Map<string, PendingOp>();
  create(op: Omit<PendingOp, 'id' | 'expires'>, now = Date.now()): PendingOp {
    this.sweep(now);
    if (this.ops.size >= CAP) this.ops.delete(this.ops.keys().next().value!);
    const entry = { ...op, id: randomUUID(), expires: now + TTL_MS };
    this.ops.set(entry.id, entry);
    return entry;
  }
  /** Removes and returns the op only for the actor who prepared it. */
  take(id: string, actorId: string, now = Date.now()): PendingOp | undefined {
    this.sweep(now);
    const op = this.ops.get(id);
    if (!op || op.actorId !== actorId) return undefined;
    this.ops.delete(id);
    return op;
  }
  private sweep(now: number) { for (const [id, op] of this.ops) if (op.expires <= now) this.ops.delete(id); }
}
