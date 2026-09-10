import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { CatalogItemEntity, CatalogRedemptionEntity, WalletTransactionEntity } from "../database/entities";
import { WalletService } from "../wallet/wallet.service";
import type { CreateCatalogItemDto } from "../common/dto";

/**
 * The redemption catalogue and its fulfillment queue.
 *
 * Unlike `WithdrawalsService`, `redeem` debits the wallet immediately rather
 * than at a later "paid" step: no real money is being promised to move on
 * the requester's behalf, only an internal ledger entry against a listed
 * item, so there is no reason to delay it. The `"pending_fulfillment" ->
 * "fulfilled"` queue tracks the operational hand-over (send the airtime,
 * hand over the item) but never gates the debit.
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(CatalogItemEntity)
    private readonly items: Repository<CatalogItemEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Active items only — mirrors `MaterialsService`'s active/retired split,
   * just without the "return retired ones too, flagged" escape hatch
   * `GET /materials` offers: nothing in this pass can retire a catalog item
   * yet, so there is nothing an admin needs to see beyond what is currently
   * offered.
   */
  async list(): Promise<CatalogItemEntity[]> {
    return this.items.find({ where: { active: true }, order: { category: "ASC", name: "ASC" } });
  }

  async create(dto: CreateCatalogItemDto): Promise<CatalogItemEntity> {
    return this.items.save(
      this.items.create({
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        category: dto.category.trim(),
        costCredits: dto.costCredits,
        stock: dto.stock ?? null,
        active: true,
      }),
    );
  }

  /**
   * Redeem one item against a requester's wallet.
   *
   * The item row is locked for the duration of the transaction so two
   * concurrent redemptions of the last unit of a tracked-stock item cannot
   * both succeed — the second sees the decremented `stock` (or the first's
   * lock blocks it until that decrement commits) and is rejected instead of
   * driving stock negative.
   */
  async redeem(
    requesterId: string,
    itemId: string,
  ): Promise<{ redemption: CatalogRedemptionEntity; balanceCredits: number }> {
    return this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(CatalogItemEntity, {
        where: { id: itemId },
        lock: { mode: "pessimistic_write" },
      });
      if (!item) throw new NotFoundException(`catalog item ${itemId} not found`);
      if (!item.active) {
        throw new BadRequestException(`catalog item ${itemId} is retired and no longer redeemable`);
      }
      if (item.stock !== null && item.stock <= 0) {
        throw new BadRequestException(`catalog item ${itemId} is out of stock`);
      }

      const { wallet, balanceCredits } = await this.wallet.getBalance(manager, requesterId);
      const cost = Number(item.costCredits);
      if (cost > balanceCredits) {
        throw new BadRequestException(
          `insufficient balance: ${balanceCredits} credit(s) available, "${item.name}" costs ${cost}`,
        );
      }

      if (item.stock !== null) {
        await manager.update(CatalogItemEntity, { id: item.id }, { stock: item.stock - 1 });
      }

      const redemption = await manager.save(
        manager.create(CatalogRedemptionEntity, {
          requesterId,
          itemId: item.id,
          // Copied, not joined live — see CatalogRedemptionEntity's doc
          // comment: a later price change on the item must not rewrite the
          // cost of a redemption already made.
          costCredits: cost,
          status: "pending_fulfillment",
          fulfilledByUserId: null,
          fulfilledAt: null,
        }),
      );

      await manager.save(
        manager.create(WalletTransactionEntity, {
          walletId: wallet.id,
          type: "debit",
          amountCredits: cost,
          collectionRequestId: null,
          eventId: null,
          description: `Redeemed "${item.name}" from the catalog — ${cost} credit(s)`,
        }),
      );

      const after = await this.wallet.getBalance(manager, requesterId);
      return { redemption, balanceCredits: after.balanceCredits };
    });
  }

  async fulfill(id: string, fulfilledByUserId: string): Promise<CatalogRedemptionEntity> {
    return this.dataSource.transaction(async (manager) => {
      const redemption = await manager.findOne(CatalogRedemptionEntity, {
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!redemption) throw new NotFoundException(`catalog redemption ${id} not found`);
      if (redemption.status !== "pending_fulfillment") {
        throw new ConflictException(`catalog redemption ${id} is already ${redemption.status}`);
      }

      await manager.update(
        CatalogRedemptionEntity,
        { id },
        { status: "fulfilled", fulfilledByUserId, fulfilledAt: new Date() },
      );

      return manager.findOneOrFail(CatalogRedemptionEntity, { where: { id } });
    });
  }

  async listRedemptions(status?: string): Promise<CatalogRedemptionEntity[]> {
    return this.dataSource.manager.find(CatalogRedemptionEntity, {
      where: status ? { status: status as CatalogRedemptionEntity["status"] } : {},
      order: { createdAt: "DESC" },
    });
  }
}
