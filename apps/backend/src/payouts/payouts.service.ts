import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, IsNull, LessThanOrEqual, Repository } from "typeorm";
import {
  CollectorEntity,
  EventReweighEntity,
  MaterialRateEntity,
  PayoutEntity,
  PayoutItemEntity,
} from "../database/entities";

/**
 * Turns verified re-weighs into a payment run.
 *
 * A reweigh becomes payable the moment it exists — both `"verified"` and
 * `"flagged"` (Phase 1 decision #2: the collector is paid the hub-verified
 * weight even on a flagged discrepancy; nothing here re-litigates that). What
 * this service guards against is a reweigh being paid twice, paid to the
 * wrong collector, or paid at a rate nobody configured.
 */
@Injectable()
export class PayoutsService {
  constructor(
    @InjectRepository(PayoutEntity)
    private readonly payouts: Repository<PayoutEntity>,
    @InjectRepository(EventReweighEntity)
    private readonly reweighs: Repository<EventReweighEntity>,
    @InjectRepository(CollectorEntity)
    private readonly collectors: Repository<CollectorEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findOne(id: string): Promise<PayoutEntity> {
    const payout = await this.payouts.findOne({ where: { id } });
    if (!payout) throw new NotFoundException(`payout ${id} not found`);
    return payout;
  }

  async list(collectorId?: string): Promise<PayoutEntity[]> {
    return this.payouts.find({
      where: collectorId ? { collectorId } : {},
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Resolve the applicable rate for a material at a hub: the most specific
   * `hubId` match wins outright over the `hubId: null` default, and within
   * whichever tier applies, the latest `effectiveFrom` at or before now wins.
   */
  private async resolveRate(
    manager: EntityManager,
    materialCode: string,
    hubId: string,
    now: Date,
  ): Promise<MaterialRateEntity> {
    const [hubSpecific] = await manager.find(MaterialRateEntity, {
      where: { materialCode, hubId, effectiveFrom: LessThanOrEqual(now) },
      order: { effectiveFrom: "DESC" },
      take: 1,
    });
    if (hubSpecific) return hubSpecific;

    const [globalDefault] = await manager.find(MaterialRateEntity, {
      where: { materialCode, hubId: IsNull(), effectiveFrom: LessThanOrEqual(now) },
      order: { effectiveFrom: "DESC" },
      take: 1,
    });
    if (globalDefault) return globalDefault;

    throw new BadRequestException(
      `no material rate configured for "${materialCode}" (checked hub ${hubId} and the global default) — set one via POST /material-rates`,
    );
  }

  async create(
    collectorId: string,
    eventReweighIds: string[],
    method: string,
  ): Promise<PayoutEntity> {
    if (eventReweighIds.length === 0) {
      throw new BadRequestException("a payout must cover at least one reweigh");
    }

    return this.dataSource.transaction(async (manager) => {
      const collector = await manager.findOne(CollectorEntity, { where: { id: collectorId } });
      if (!collector) throw new NotFoundException(`collector ${collectorId} not found`);

      const reweighRows = await manager.find(EventReweighEntity, {
        where: { id: In(eventReweighIds) },
        relations: { event: true },
      });

      const found = new Map(reweighRows.map((r) => [r.id, r]));
      const missing = eventReweighIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new NotFoundException(`reweigh(s) not found: ${missing.join(", ")}`);
      }

      const mismatchedCollector = reweighRows.filter((r) => r.event.collectorId !== collectorId);
      if (mismatchedCollector.length > 0) {
        throw new BadRequestException(
          `reweigh(s) do not belong to collector ${collectorId}: ${mismatchedCollector.map((r) => r.id).join(", ")}`,
        );
      }

      const rejected = reweighRows.filter((r) => r.status === "rejected");
      if (rejected.length > 0) {
        throw new BadRequestException(
          `reweigh(s) are rejected and not payable: ${rejected.map((r) => r.id).join(", ")}`,
        );
      }

      const alreadyPaid = await manager.find(PayoutItemEntity, {
        where: { eventReweighId: In(eventReweighIds) },
      });
      if (alreadyPaid.length > 0) {
        throw new ConflictException(
          `reweigh(s) already attached to a payout: ${alreadyPaid.map((p) => p.eventReweighId).join(", ")}`,
        );
      }

      const now = new Date();
      const items: Array<{ eventReweighId: string; amount: number }> = [];
      for (const reweigh of reweighRows) {
        const rate = await this.resolveRate(manager, reweigh.event.material, reweigh.event.hubId, now);
        const amount = Number((Number(reweigh.verifiedWeightKg) * Number(rate.ratePerKg)).toFixed(2));
        items.push({ eventReweighId: reweigh.id, amount });
      }

      const totalAmount = Number(items.reduce((sum, i) => sum + i.amount, 0).toFixed(2));

      const payout = await manager.save(
        manager.create(PayoutEntity, {
          collectorId,
          amount: totalAmount,
          currency: "NGN",
          method,
          payoutRef: null,
          status: "pending",
          paidByUserId: null,
          paidAt: null,
        }),
      );

      await manager.save(
        PayoutItemEntity,
        items.map((item) =>
          manager.create(PayoutItemEntity, {
            payoutId: payout.id,
            eventReweighId: item.eventReweighId,
            amount: item.amount,
          }),
        ),
      );

      return payout;
    });
  }

  async markPaid(payoutId: string, payoutRef: string | undefined, paidByUserId: string): Promise<PayoutEntity> {
    return this.dataSource.transaction(async (manager) => {
      const payout = await manager.findOne(PayoutEntity, {
        where: { id: payoutId },
        lock: { mode: "pessimistic_write" },
      });
      if (!payout) throw new NotFoundException(`payout ${payoutId} not found`);
      if (payout.status !== "pending") {
        throw new ConflictException(`payout ${payoutId} is already ${payout.status}`);
      }

      await manager.update(
        PayoutEntity,
        { id: payoutId },
        {
          status: "paid",
          payoutRef: payoutRef?.trim() || null,
          paidByUserId,
          paidAt: new Date(),
        },
      );

      return manager.findOneOrFail(PayoutEntity, { where: { id: payoutId } });
    });
  }
}
