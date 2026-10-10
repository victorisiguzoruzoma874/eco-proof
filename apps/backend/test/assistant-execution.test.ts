import { describe, expect, it, vi } from 'vitest';
import { AssistantTools } from '../src/assistant/tools';

const id = 'e8ec812e-8ad6-43ec-a7ef-17dc87c7e710';
function setup() {
  const wallet = { getWallet: vi.fn().mockResolvedValue({ balanceCredits: 100, pendingWithdrawals: [] }), redeem: vi.fn().mockResolvedValue({ transaction: { amountCredits: 5 }, balanceCredits: 105 }) };
  const manager = { findOne: vi.fn().mockResolvedValue({ id, code: 'PET', name: 'Plastic', stock: 1, costCredits: 10 }) };
  const requests = { create: vi.fn().mockResolvedValue({ id, status: 'requested' }) };
  const catalog = { redeem: vi.fn().mockResolvedValue({ redemption: { id, status: 'pending_fulfillment' }, balanceCredits: 90 }) };
  const withdrawals = { request: vi.fn().mockResolvedValue({ id, status: 'pending', amountCredits: 10 }) };
  return { wallet, requests, catalog, withdrawals, tools: new AssistantTools(wallet as any, { manager } as any, requests as any, catalog as any, withdrawals as any) };
}
describe('direct assistant operations', () => {
  it('calls existing services with authenticated identity and reports committed results', async () => {
    const t = setup();
    const pickup = { hubId: id, material: 'PET', estimatedWeightKg: 5, address: '12 Example Road' };
    expect(await t.tools.execute('book_pickup', pickup, 'session-user')).toMatchObject({ status: 'Booked', requestId: id });
    expect(t.requests.create).toHaveBeenCalledWith('session-user', pickup);
    expect(await t.tools.execute('redeem_reward', { itemId: id }, 'session-user')).toMatchObject({ status: 'Redeemed', fulfillmentStatus: 'pending_fulfillment' });
    expect(t.catalog.redeem).toHaveBeenCalledWith('session-user', id);
    expect(await t.tools.execute('claim_credits', { code: 'abcd-efgh' }, 'session-user')).toMatchObject({ status: 'Claimed', balanceCredits: 105 });
    expect(t.wallet.redeem).toHaveBeenCalledWith('session-user', 'ABCDEFGH');
    expect(await t.tools.execute('request_withdrawal', { amountCredits: 10 }, 'session-user')).toMatchObject({ status: 'Submitted', withdrawalStatus: 'pending', paid: false });
    expect(t.withdrawals.request).toHaveBeenCalledWith('session-user', 10);
  });
  it('rejects account overrides and malformed arguments before executing mutations', async () => {
    const t = setup();
    for (const [name, args] of [
      ['book_pickup', { hubId: id, material: 'PET', estimatedWeightKg: 5, address: 'Road', userId: 'victim' }],
      ['redeem_reward', { itemId: id, requesterId: 'victim' }],
      ['claim_credits', { code: 'invalid' }],
      ['request_withdrawal', { amountCredits: -1 }],
    ] as const) await expect(t.tools.execute(name, args, 'session-user')).rejects.toThrow();
    expect(t.requests.create).not.toHaveBeenCalled();
    expect(t.catalog.redeem).not.toHaveBeenCalled();
    expect(t.wallet.redeem).not.toHaveBeenCalled();
    expect(t.withdrawals.request).not.toHaveBeenCalled();
  });
  it('propagates service failures instead of claiming completion', async () => {
    const t = setup();
    t.withdrawals.request.mockRejectedValue(new Error('Insufficient balance'));
    await expect(t.tools.execute('request_withdrawal', { amountCredits: 10 }, 'session-user')).rejects.toThrow('Insufficient balance');
  });
});
