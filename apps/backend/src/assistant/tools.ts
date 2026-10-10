import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { CollectionRequestEntity, CreditRateEntity, HubEntity, MaterialEntity, RequesterEntity, CatalogItemEntity, CatalogRedemptionEntity } from '../database/entities';
import { WalletService } from '../wallet/wallet.service';
import { RequestsService } from '../requests/requests.service';
import { CatalogService } from '../catalog/catalog.service';
import { WithdrawalsService } from '../withdrawals/withdrawals.service';
import type { CreateCollectionRequestDto } from '../common/dto';
import { objectArgs, validAmount, isUuid, ToolInputError } from './contracts';

export const SCREENS = ['dashboard', 'wallet', 'history', 'rewards', 'request'] as const;
const definition = (name: string, description: string, properties = {}, required: string[] = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
export const TOOLS = [
  definition('book_pickup', 'Book a pickup immediately when the user requests it. Resolve hub/material and collect weight/address first.', { hubId: { type: 'string', format: 'uuid' }, material: { type: 'string' }, estimatedWeightKg: { type: 'number' }, address: { type: 'string' }, notes: { type: 'string' } }, ['hubId', 'material', 'estimatedWeightKg', 'address']),
  definition('redeem_reward', 'Spend credits and place a reward order immediately when requested by the user.', { itemId: { type: 'string', format: 'uuid' } }, ['itemId']),
  definition('claim_credits', 'Redeem a user-supplied pickup or weigh-in code into their wallet immediately.', { code: { type: 'string' } }, ['code']),
  definition('request_withdrawal', 'Submit a withdrawal request immediately for the user-specified credit amount. Actual payout is handled by operators.', { amountCredits: { type: 'number', minimum: 0.001, maximum: 1000000 } }, ['amountCredits']),
  definition('get_capabilities', 'Explain the precise operations available to this signed-in requester; no universal or admin access.'),
  definition('get_account', 'Read the signed-in requester profile without passwords or credentials.'),
  definition('get_pickup_options', 'List real collection hubs and active materials before choosing pickup details.'),
  definition('get_rewards', 'Browse available rewards with real prices and stock.', { limit: { type: 'integer', minimum: 1, maximum: 10 } }),
  definition('get_reward_orders', 'Read this requester’s latest reward redemption orders.', { limit: { type: 'integer', minimum: 1, maximum: 10 } }),
  definition('get_balance', 'Read your live waste-credit balance and held withdrawals.'),
  definition('get_transactions', 'Read recent wallet transactions.', { limit: { type: 'integer', minimum: 1, maximum: 10 } }),
  definition('get_orders', 'Read recent pickup requests; payment and conversion orders are unsupported.', { limit: { type: 'integer', minimum: 1, maximum: 10 } }),
  definition('get_prices', 'Read current credit-per-kg rates from the application rate table. Credits are pegged to NGN, not crypto prices.'),
  definition('open_screen', 'Offer a button to an application screen; opening requires a user click.', { target: { type: 'string', enum: SCREENS } }, ['target']),
  definition('prepare_withdrawal', 'Prepare credits for review in the existing withdrawal form. Never submits or pays.', { amountCredits: { type: 'number', minimum: 0.001, maximum: 1000000 } }, ['amountCredits']),
  definition('prepare_pickup', 'Prepare a pickup for review, never book it. First resolve hub/material and ask for missing weight/address.', { hubId: { type: 'string', format: 'uuid' }, material: { type: 'string', pattern: '^[A-Z0-9_-]{2,16}$' }, estimatedWeightKg: { type: 'number', minimum: 0.001, maximum: 100000 }, address: { type: 'string', minLength: 1, maxLength: 500 }, notes: { type: 'string', maxLength: 1000 } }, ['hubId', 'material', 'estimatedWeightKg', 'address']),
  definition('prepare_reward', 'Prepare an available reward for review in the existing form; never spend credits automatically.', { itemId: { type: 'string', format: 'uuid' } }, ['itemId']),
  definition('prepare_claim', 'Prepare a user-supplied pickup/weigh-in code for review, without claiming or adding credits. Checks format only; existing form verifies eligibility.', { code: { type: 'string', minLength: 8, maxLength: 16 } }, ['code']),
  definition('set_theme', 'Offer a button to apply the user’s explicitly chosen display theme.', { theme: { type: 'string', enum: ['light', 'dark'] } }, ['theme']),
];
@Injectable()
export class AssistantTools {
  constructor(private readonly wallet: WalletService, @InjectDataSource() private readonly db: DataSource,
    private readonly requests: RequestsService, private readonly catalog: CatalogService,
    private readonly withdrawals: WithdrawalsService) {}
  async execute(name: string, input: unknown, user: string) {
    switch (name) {
      case 'get_capabilities': { objectArgs(input, []); return { tools: TOOLS.map(t => ({ name: t.function.name, description: t.function.description })), permissions: 'Authenticated requester account. Booking, reward redemption, claims and withdrawal requests execute directly when requested. Prepare tools offer optional form review. UI actions wait for a click. Existing service validation and account ownership apply.' }; }
      case 'book_pickup': {
        const prepared = await this.execute('prepare_pickup', input, user) as { action: Record<string, unknown> };
        const { kind, ...details } = prepared.action;
        const request = await this.requests.create(user, details as unknown as CreateCollectionRequestDto);
        return { status: 'Booked', requestId: request.id, pickupStatus: request.status, hubId: request.hubId, material: request.material, estimatedWeightKg: request.estimatedWeightKg, address: request.address };
      }
      case 'redeem_reward': {
        await this.execute('prepare_reward', input, user);
        const a = objectArgs(input, ['itemId']);
        const result = await this.catalog.redeem(user, a.itemId as string);
        return { status: 'Redeemed', orderId: result.redemption.id, fulfillmentStatus: result.redemption.status, balanceCredits: result.balanceCredits };
      }
      case 'claim_credits': {
        const prepared = await this.execute('prepare_claim', input, user) as { action: { code: string } };
        const result = await this.wallet.redeem(user, prepared.action.code);
        return { status: 'Claimed', amountCredits: result.transaction.amountCredits, balanceCredits: result.balanceCredits };
      }
      case 'request_withdrawal': {
        await this.execute('prepare_withdrawal', input, user);
        const a = objectArgs(input, ['amountCredits']);
        const request = await this.withdrawals.request(user, a.amountCredits as number);
        return { status: 'Submitted', withdrawalId: request.id, withdrawalStatus: request.status, amountCredits: request.amountCredits, paid: false };
      }
      case 'get_account': {
        objectArgs(input, []);
        const profile = await this.db.manager.findOne(RequesterEntity, { where: { id: user }, select: { name: true, email: true, phone: true, active: true } });
        if (!profile) throw new ToolInputError('The signed-in account is unavailable.');
        return { name: profile.name, email: profile.email, phone: profile.phone, active: profile.active };
      }
      case 'get_pickup_options': {
        objectArgs(input, []);
        const [hubs, materials] = await Promise.all([
          this.db.manager.find(HubEntity, { order: { name: 'ASC' }, take: 100 }),
          this.db.manager.find(MaterialEntity, { where: { active: true }, order: { sortOrder: 'ASC' }, take: 100 }),
        ]);
        return { hubs: hubs.map(h => ({ id: h.id, code: h.code, name: h.name })), materials: materials.map(m => ({ code: m.code, name: m.name, description: m.description })) };
      }
      case 'get_rewards': {
        const a = objectArgs(input, ['limit']);
        const items = await this.db.manager.find(CatalogItemEntity, { where: { active: true }, order: { name: 'ASC' }, take: this.limit(a.limit) });
        return items.map(i => ({ id: i.id, name: i.name, description: i.description, category: i.category, costCredits: i.costCredits, stock: i.stock }));
      }
      case 'get_reward_orders': {
        const a = objectArgs(input, ['limit']);
        const orders = await this.db.manager.find(CatalogRedemptionEntity, { where: { requesterId: user }, order: { createdAt: 'DESC' }, take: this.limit(a.limit) });
        return orders.map(o => ({ id: o.id, itemId: o.itemId, costCredits: o.costCredits, status: o.status, createdAt: o.createdAt, fulfilledAt: o.fulfilledAt }));
      }
      case 'get_balance': { objectArgs(input, []); const w = await this.wallet.getWallet(user); return { balanceCredits: w.balanceCredits, heldCredits: w.pendingWithdrawals.reduce((s, x) => s + Number(x.amountCredits), 0), currency: 'waste credits', accountStatus: 'active' }; }
      case 'get_transactions': {
        const a = objectArgs(input, ['limit']); const limit = this.limit(a.limit);
        const w = await this.wallet.getWallet(user);
        return w.transactions.slice(0, limit).map(t => ({ type: t.type, amountCredits: t.amountCredits, description: t.description, createdAt: t.createdAt }));
      }
      case 'get_orders': {
        const a = objectArgs(input, ['limit']); const limit = this.limit(a.limit);
        const orders = await this.db.manager.find(CollectionRequestEntity, { where: { requesterId: user }, order: { createdAt: 'DESC' }, take: limit });
        return orders.map(o => ({ id: o.id, hubId: o.hubId, status: o.status, material: o.material, estimatedWeightKg: o.estimatedWeightKg, address: o.address, notes: o.notes, createdAt: o.createdAt }));
      }
      case 'get_prices': {
        objectArgs(input, []);
        const rates = await this.db.manager.find(CreditRateEntity, { where: { effectiveFrom: LessThanOrEqual(new Date()) }, order: { effectiveFrom: 'DESC' }, take: 100 });
        const seen = new Set<string>();
        return rates.filter(r => { const key = `${r.materialCode}:${r.hubId}`; if (seen.has(key)) return false; seen.add(key); return true; }).map(r => ({ materialCode: r.materialCode, hubId: r.hubId, creditsPerKg: r.creditsPerKg, effectiveFrom: r.effectiveFrom }));
      }
      case 'open_screen': {
        const a = objectArgs(input, ['target']); if (!SCREENS.includes(a.target as any)) throw new ToolInputError('Unsupported screen');
        return { action: { kind: 'navigate', target: a.target }, label: `Open ${a.target}`, status: 'Offered; not opened yet.' };
      }
      case 'prepare_withdrawal': {
        const a = objectArgs(input, ['amountCredits']); if (!validAmount(a.amountCredits)) throw new ToolInputError('Invalid credit amount');
        const w = await this.wallet.getWallet(user);
        const available = w.balanceCredits - w.pendingWithdrawals.reduce((s, x) => s + Number(x.amountCredits), 0);
        if (a.amountCredits > available) throw new ToolInputError('Insufficient available credits');
        return { action: { kind: 'review-withdrawal', amountCredits: a.amountCredits }, label: `Review withdrawal of ${a.amountCredits} credits`, status: 'Ready for review. Nothing submitted or paid.' };
      }
      case 'prepare_pickup': {
        const a = objectArgs(input, ['hubId', 'material', 'estimatedWeightKg', 'address', 'notes']);
        if (!isUuid(a.hubId)) throw new ToolInputError('Select a real hub from get_pickup_options.');
        if (typeof a.material !== 'string' || !/^[A-Z0-9_-]{2,16}$/.test(a.material)) throw new ToolInputError('Select an active material code.');
        if (!validAmount(a.estimatedWeightKg) || a.estimatedWeightKg > 100000) throw new ToolInputError('Weight must be positive, at most 100000 kg, with up to three decimal places.');
        if (typeof a.address !== 'string' || !a.address.trim() || a.address.length > 500) throw new ToolInputError('Ask for a pickup address of 1–500 characters.');
        if (a.notes !== undefined && (typeof a.notes !== 'string' || a.notes.length > 1000)) throw new ToolInputError('Notes may contain at most 1000 characters.');
        const [hub, material] = await Promise.all([
          this.db.manager.findOne(HubEntity, { where: { id: a.hubId } }),
          this.db.manager.findOne(MaterialEntity, { where: { code: a.material, active: true } }),
        ]);
        if (!hub || !material) throw new ToolInputError('Hub or active material is unavailable. Refresh pickup options.');
        return { action: { kind: 'review-pickup', hubId: hub.id, material: material.code, estimatedWeightKg: a.estimatedWeightKg, address: a.address, ...(a.notes !== undefined ? { notes: a.notes } : {}) }, label: `Review ${a.estimatedWeightKg} kg ${material.name} pickup at ${hub.name}`, status: 'Ready for review; no pickup has been booked.' };
      }
      case 'prepare_reward': {
        const a = objectArgs(input, ['itemId']);
        if (!isUuid(a.itemId)) throw new ToolInputError('Select a real item from get_rewards.');
        const item = await this.db.manager.findOne(CatalogItemEntity, { where: { id: a.itemId, active: true } });
        if (!item || item.stock !== null && item.stock <= 0) throw new ToolInputError('Reward unavailable or out of stock.');
        const w = await this.wallet.getWallet(user);
        const available = w.balanceCredits - w.pendingWithdrawals.reduce((s, x) => s + Number(x.amountCredits), 0);
        if (Number(item.costCredits) > available) throw new ToolInputError('Insufficient available credits for this reward.');
        return { action: { kind: 'review-reward', itemId: item.id }, label: `Review ${item.name} for ${Number(item.costCredits)} credits`, status: 'Ready for review; no credits have been spent.' };
      }
      case 'prepare_claim': {
        const a = objectArgs(input, ['code']);
        if (typeof a.code !== 'string' || a.code.length > 16) throw new ToolInputError('Provide the pickup or weigh-in code.');
        const code = a.code.trim().toUpperCase().replace(/[\s-]/g, '');
        if (!/^(?:[A-HJ-NP-Z2-9]{8}|[A-HJ-NP-Z2-9]{10})$/.test(code)) throw new ToolInputError('Code must contain 8 or 10 valid letters/digits.');
        return { action: { kind: 'review-claim', code }, label: 'Review claim code', status: 'Format checked only. Nothing redeemed; the existing form verifies eligibility.' };
      }
      case 'set_theme': {
        const a = objectArgs(input, ['theme']);
        if (a.theme !== 'light' && a.theme !== 'dark') throw new ToolInputError('Choose light or dark theme.');
        return { action: { kind: 'set-theme', theme: a.theme }, label: `Use ${a.theme} mode`, status: 'Offered; display has not changed yet.' };
      }
      default: throw new ToolInputError('Unsupported tool');
    }
  }
  private limit(v: unknown) { if (v === undefined) return 5; if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10) throw new ToolInputError('Invalid record limit'); return v; }
}
