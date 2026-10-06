import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { CollectionRequestEntity, CreditRateEntity } from '../database/entities';
import { WalletService } from '../wallet/wallet.service';
import { objectArgs, validAmount } from './contracts';

export const SCREENS = ['dashboard', 'wallet', 'history', 'rewards', 'request'] as const;
const definition = (name: string, description: string, properties = {}, required: string[] = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
export const TOOLS = [
  definition('get_balance', 'Read your live waste-credit balance and held withdrawals.'),
  definition('get_transactions', 'Read recent wallet transactions.', { limit: { type: 'integer', minimum: 1, maximum: 10 } }),
  definition('get_orders', 'Read recent pickup requests; payment and conversion orders are unsupported.', { limit: { type: 'integer', minimum: 1, maximum: 10 } }),
  definition('get_prices', 'Read current credit-per-kg rates from the application rate table. Credits are pegged to NGN, not crypto prices.'),
  definition('open_screen', 'Offer a button to an application screen; opening requires a user click.', { target: { type: 'string', enum: SCREENS } }, ['target']),
  definition('prepare_withdrawal', 'Prepare credits for review in the existing withdrawal form. Never submits or pays.', { amountCredits: { type: 'number', minimum: 0.001, maximum: 1000000 } }, ['amountCredits']),
];
@Injectable()
export class AssistantTools {
  constructor(private readonly wallet: WalletService, @InjectDataSource() private readonly db: DataSource) {}
  async execute(name: string, input: unknown, user: string) {
    switch (name) {
      case 'get_balance': { objectArgs(input, []); const w = await this.wallet.getWallet(user); return { balanceCredits: w.balanceCredits, heldCredits: w.pendingWithdrawals.reduce((s, x) => s + Number(x.amountCredits), 0), currency: 'waste credits', accountStatus: 'active' }; }
      case 'get_transactions': {
        const a = objectArgs(input, ['limit']); const limit = this.limit(a.limit);
        const w = await this.wallet.getWallet(user);
        return w.transactions.slice(0, limit).map(t => ({ type: t.type, amountCredits: t.amountCredits, description: t.description, createdAt: t.createdAt }));
      }
      case 'get_orders': {
        const a = objectArgs(input, ['limit']); const limit = this.limit(a.limit);
        const orders = await this.db.manager.find(CollectionRequestEntity, { where: { requesterId: user }, order: { createdAt: 'DESC' }, take: limit });
        return orders.map(o => ({ status: o.status, material: o.material, createdAt: o.createdAt }));
      }
      case 'get_prices': {
        objectArgs(input, []);
        const rates = await this.db.manager.find(CreditRateEntity, { where: { effectiveFrom: LessThanOrEqual(new Date()) }, order: { effectiveFrom: 'DESC' }, take: 100 });
        const seen = new Set<string>();
        return rates.filter(r => { const key = `${r.materialCode}:${r.hubId}`; if (seen.has(key)) return false; seen.add(key); return true; }).map(r => ({ materialCode: r.materialCode, hubId: r.hubId, creditsPerKg: r.creditsPerKg, effectiveFrom: r.effectiveFrom }));
      }
      case 'open_screen': {
        const a = objectArgs(input, ['target']); if (!SCREENS.includes(a.target as any)) throw new Error('Unsupported screen');
        return { action: { kind: 'navigate', target: a.target }, label: `Open ${a.target}`, status: 'Offered; not opened yet.' };
      }
      case 'prepare_withdrawal': {
        const a = objectArgs(input, ['amountCredits']); if (!validAmount(a.amountCredits)) throw new Error('Invalid credit amount');
        const w = await this.wallet.getWallet(user);
        const available = w.balanceCredits - w.pendingWithdrawals.reduce((s, x) => s + Number(x.amountCredits), 0);
        if (a.amountCredits > available) throw new Error('Insufficient available credits');
        return { action: { kind: 'review-withdrawal', amountCredits: a.amountCredits }, label: `Review withdrawal of ${a.amountCredits} credits`, status: 'Ready for review. Nothing submitted or paid.' };
      }
      default: throw new Error('Unsupported tool');
    }
  }
  private limit(v: unknown) { if (v === undefined) return 5; if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10) throw new Error('Invalid record limit'); return v; }
}
