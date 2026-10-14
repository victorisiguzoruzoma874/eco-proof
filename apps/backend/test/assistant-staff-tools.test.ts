import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { StaffAssistantTools, toolsFor } from '../src/assistant/staff-tools';
import { PendingAdminOps } from '../src/assistant/pending';
const id = 'e8ec812e-8ad6-43ec-a7ef-17dc87c7e710';
const admin = { sub: 'admin-1', email: 'a@x.test', role: 'admin' as const };
const operator = { sub: 'op-1', email: 'o@x.test', role: 'operator' as const };
const auditor = { sub: 'au-1', email: 'u@x.test', role: 'auditor' as const };
function setup() {
  const svc = () => new Proxy({}, { get: (t: any, k) => (t[k] ||= vi.fn().mockResolvedValue({ ok: k })) });
  const s = { batches: svc(), events: svc(), reports: svc(), custody: svc(), reweigh: svc(), requests: svc(), withdrawals: svc(), payouts: svc(), catalog: svc(), registry: svc(), materials: svc(), materialRates: svc(), creditRates: svc(), users: svc() } as any;
  s.events.list = vi.fn().mockResolvedValue(Array.from({ length: 120 }, (_, i) => ({ id: i })));
  const db = { manager: { findOne: vi.fn().mockResolvedValue({ id, name: 'Lagos', code: 'LAG' }) } };
  const pending = new PendingAdminOps();
  const tools = new StaffAssistantTools(db as any, pending, s.batches, s.events, s.reports, s.custody, s.reweigh, s.requests, s.withdrawals, s.payouts, s.catalog, s.registry, s.materials, s.materialRates, s.creditRates, s.users);
  return { s, tools, pending };
}
const names = (role: any) => toolsFor(role).map(t => t.function.name);
describe('staff assistant tools', () => {
  it('offers each role only its tiers', () => {
    expect(names('auditor')).toContain('list_batches');
    expect(names('auditor')).not.toContain('seal_batch');
    expect(names('auditor')).not.toContain('list_requests');
    expect(names('operator')).toEqual(expect.arrayContaining(['seal_batch', 'mark_withdrawal_paid', 'list_requests']));
    expect(names('operator')).not.toContain('create_hub');
    expect(names('operator')).not.toContain('list_users');
    expect(names('admin')).toEqual(expect.arrayContaining(['create_hub', 'update_user', 'list_users']));
    for (const role of ['admin', 'operator', 'auditor']) expect(names(role)).not.toContain('confirm_admin');
  });
  it('refuses tools above the actor role even when named directly', async () => {
    const t = setup();
    await expect(t.tools.execute('seal_batch', { batchId: id }, auditor)).rejects.toThrow('operator or admin');
    await expect(t.tools.execute('create_hub', { code: 'LAG', name: 'Lagos' }, operator)).rejects.toThrow('admin');
    expect(t.s.batches.seal).not.toHaveBeenCalled(); expect(t.s.registry.createHub).not.toHaveBeenCalled();
  });
  it('runs operator actions directly with the staff identity', async () => {
    const t = setup();
    await t.tools.execute('record_reweigh', { eventId: id, verifiedWeightKg: 4.5 }, operator);
    expect(t.s.reweigh.create).toHaveBeenCalledWith(id, { verifiedWeightKg: 4.5 }, 'op-1');
    await t.tools.execute('mark_withdrawal_paid', { withdrawalId: id, payoutRef: 'TX1' }, operator);
    expect(t.s.withdrawals.markPaid).toHaveBeenCalledWith(id, 'TX1', 'op-1');
  });
  it('clips large lists', async () => {
    const t = setup();
    expect(await t.tools.execute('list_events', {}, auditor)).toMatchObject({ total: 120, showing: 10 });
    await expect(t.tools.execute('list_events', { limit: 51 }, auditor)).rejects.toThrow('limit');
  });
  it('prepares admin changes without executing them, then executes once on confirm', async () => {
    const t = setup();
    const prepared: any = await t.tools.execute('create_credit_rate', { materialCode: 'PET', hubId: id, creditsPerKg: 120 }, admin);
    expect(prepared.action.kind).toBe('confirm-admin');
    expect(prepared.label).toContain('Lagos');
    expect(t.s.creditRates.create).not.toHaveBeenCalled();
    await expect(t.tools.confirm(prepared.action.id, { ...admin, sub: 'admin-2' })).rejects.toBeInstanceOf(NotFoundException);
    expect(await t.tools.confirm(prepared.action.id, admin)).toMatchObject({ summary: expect.stringContaining('PET') });
    expect(t.s.creditRates.create).toHaveBeenCalledWith({ materialCode: 'PET', hubId: id, creditsPerKg: 120 });
    await expect(t.tools.confirm(prepared.action.id, admin)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('refuses confirmation after demotion without consuming the op', async () => {
    const t = setup();
    const prepared: any = await t.tools.execute('create_hub', { code: 'ABJ', name: 'Abuja' }, admin);
    await expect(t.tools.confirm(prepared.action.id, { ...admin, role: 'operator' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.s.registry.createHub).not.toHaveBeenCalled();
  });
  it('creates users with a generated password that only the confirm result carries', async () => {
    const t = setup();
    await expect(t.tools.execute('create_user', { email: 'n@x.test', role: 'operator', password: 'chosen-by-model' }, admin)).rejects.toThrow();
    const prepared: any = await t.tools.execute('create_user', { email: 'n@x.test', role: 'operator' }, admin);
    expect(JSON.stringify(prepared)).not.toMatch(/password/i);
    const done: any = await t.tools.confirm(prepared.action.id, admin);
    expect(done.result.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(t.s.users.create).toHaveBeenCalledWith({ email: 'n@x.test', role: 'operator', password: done.result.temporaryPassword });
  });
  it('lets service conflicts propagate', async () => {
    const t = setup(); t.s.reweigh.create = vi.fn().mockRejectedValue(new ConflictException('event already has a reweigh'));
    await expect(t.tools.execute('record_reweigh', { eventId: id, verifiedWeightKg: 1 }, operator)).rejects.toThrow('already has a reweigh');
  });
});
