import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { WalletTransactionEntity, WasteWalletEntity, WithdrawalRequestEntity } from "../database/entities";
import { WalletService } from "../wallet/wallet.service";

/**
 * A requester's cash-out queue — mirrors `PayoutsService`'s `pending -> paid`
 * pattern exactly, on purpose (see `WithdrawalRequestEntity`'s doc comment):
 * the debit against `wallet_transactions` is written only at `markPaid`
 * time, never at request time, so a manual payout that falls through never
 * leaves a wallet showing a debit for cash the requester never received.
 * `reject` releases the hold with no debit ever written.
 */
@Injectable()
export class WithdrawalsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly wallet: WalletService,
  ) {}

  async list(status?: string): Promise<WithdrawalRequestEntity[]> {
    return this.dataSource.manager.find(WithdrawalRequestEntity, {
      where: status ? { status: status as WithdrawalRequestEntity["status"] } : {},
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Balance available to withdraw is the wallet balance MINUS whatever this
   * requester already has held in other `"pending"` withdrawals — an unpaid
   * pending withdrawal is already spoken for, so it must not be countable
   * again toward a second request for the same credits.
   */
  async request(requesterId: string, amountCredits: number): Promise<WithdrawalRequestEntity> {
    return this.dataSource.transaction(async (manager) => {
      const { balanceCredits } = await this.wallet.getBalance(manager, requesterId);

      const pending = await manager.find(WithdrawalRequestEntity, {
        where: { requesterId, status: "pending" },
      });
      const alreadyHeld = pending.reduce((sum, w) => sum + Number(w.amountCredits), 0);
      const available = Number((balanceCredits - alreadyHeld).toFixed(3));

      if (amountCredits > available) {
        throw new BadRequestException(
          `insufficient balance: ${available} credit(s) available to withdraw (wallet balance ` +
            `${balanceCredits}, ${alreadyHeld} already held in pending withdrawal(s)), requested ${amountCredits}`,
        );
      }

      return manager.save(
        manager.create(WithdrawalRequestEntity, {
          requesterId,
          amountCredits,
          status: "pending",
          payoutRef: null,
          paidByUserId: null,
          paidAt: null,
        }),
      );
    });
  }

  async markPaid(id: string, payoutRef: string | undefined, paidByUserId: string): Promise<WithdrawalRequestEntity> {
    return this.dataSource.transaction(async (manager) => {
      const withdrawal = await manager.findOne(WithdrawalRequestEntity, {
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!withdrawal) throw new NotFoundException(`withdrawal ${id} not found`);
      if (withdrawal.status !== "pending") {
        throw new ConflictException(`withdrawal ${id} is already ${withdrawal.status}`);
      }

      const wallet = await manager.findOne(WasteWalletEntity, {
        where: { requesterId: withdrawal.requesterId },
      });
      if (!wallet) throw new NotFoundException(`no wallet found for requester ${withdrawal.requesterId}`);

      await manager.save(
        manager.create(WalletTransactionEntity, {
          walletId: wallet.id,
          type: "debit",
          amountCredits: withdrawal.amountCredits,
          collectionRequestId: null,
          eventId: null,
          description: `Withdrawal ${withdrawal.id} paid out${payoutRef ? ` — ref ${payoutRef}` : ""}`,
        }),
      );

      await manager.update(
        WithdrawalRequestEntity,
        { id },
        {
          status: "paid",
          payoutRef: payoutRef?.trim() || null,
          paidByUserId,
          paidAt: new Date(),
        },
      );

      return manager.findOneOrFail(WithdrawalRequestEntity, { where: { id } });
    });
  }

  async reject(id: string): Promise<WithdrawalRequestEntity> {
    return this.dataSource.transaction(async (manager) => {
      const withdrawal = await manager.findOne(WithdrawalRequestEntity, {
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!withdrawal) throw new NotFoundException(`withdrawal ${id} not found`);
      if (withdrawal.status !== "pending") {
        throw new ConflictException(`withdrawal ${id} is already ${withdrawal.status}`);
      }

      await manager.update(WithdrawalRequestEntity, { id }, { status: "rejected" });
      return manager.findOneOrFail(WithdrawalRequestEntity, { where: { id } });
    });
  }
}
