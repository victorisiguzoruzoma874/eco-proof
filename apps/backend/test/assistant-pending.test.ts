import { describe, expect, it } from 'vitest';
import { PendingAdminOps } from '../src/assistant/pending';
const op = { actorId: 'admin-1', tool: 'create_hub', args: { code: 'LAG' }, summary: 'Create hub LAG' };
describe('pending admin operations', () => {
  it('is single use and bound to the requesting admin', () => {
    const store = new PendingAdminOps(); const p = store.create(op, 0);
    expect(store.take(p.id, 'admin-2', 1)).toBeUndefined();
    expect(store.take(p.id, 'admin-1', 1)).toMatchObject({ tool: 'create_hub', args: { code: 'LAG' } });
    expect(store.take(p.id, 'admin-1', 2)).toBeUndefined();
  });
  it('expires after five minutes', () => {
    const store = new PendingAdminOps(); const p = store.create(op, 0);
    expect(store.take(p.id, 'admin-1', 5 * 60000)).toBeUndefined();
  });
  it('holds at most 200 operations, dropping the oldest', () => {
    const store = new PendingAdminOps(); const first = store.create(op, 0);
    for (let i = 0; i < 200; i++) store.create(op, 0);
    expect(store.take(first.id, 'admin-1', 0)).toBeUndefined();
  });
});
