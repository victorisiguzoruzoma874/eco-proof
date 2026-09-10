import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, IsNull, Repository } from "typeorm";
import {
  hashLeaf,
  merkleProof,
  merkleRootHex,
  verifyMerkleProof,
  type BatchStatus,
  type EventVerification,
  type MaterialType,
} from "@proofchain/shared";
import { BatchEntity, CollectionEventEntity } from "../database/entities";
import { MaterialsService } from "../materials/materials.service";

/**
 * Batch lifecycle: open -> sealed -> processed -> sold.
 *
 * Sealing is the hinge of the entire product. Before it, a batch is a mutable
 * working set; after it, its membership and Merkle root are frozen and a root
 * goes to the ledger. Everything here exists to make that transition
 * irreversible and reproducible by a third party.
 */

const LEGAL_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  open: ["sealed"],
  sealed: ["processed"],
  processed: ["sold"],
  sold: [],
};

@Injectable()
export class BatchesService {
  constructor(
    @InjectRepository(BatchEntity)
    private readonly batches: Repository<BatchEntity>,
    @InjectRepository(CollectionEventEntity)
    private readonly events: Repository<CollectionEventEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly materials: MaterialsService,
  ) {}

  /**
   * Events are ordered by capture time then id. Any deterministic total order
   * works, but it must never change: the Merkle root — and therefore every proof
   * already handed to a buyer — depends on it.
   */
  private orderedEvents(batchId: string): Promise<CollectionEventEntity[]> {
    return this.events.find({
      where: { batchId },
      order: { capturedAt: "ASC", id: "ASC" },
    });
  }

  private static leavesOf(events: CollectionEventEntity[]): string[] {
    return events.map((e) => hashLeaf(e.payloadHash));
  }

  async create(hubId: string, material: MaterialType): Promise<BatchEntity> {
    // Stricter than ingest: a new batch must use a material that is still
    // offered. An operator opening one is making a forward-looking choice with
    // the live catalogue in front of them, so a retired code here is a mistake to
    // block rather than history to preserve.
    await this.materials.assertOpenable(material);

    const batch = this.batches.create({
      hubId,
      material,
      status: "open",
      totalWeightKg: 0,
      eventCount: 0,
      merkleRoot: null,
      sealedAt: null,
    });
    return this.batches.save(batch);
  }

  async findOne(id: string): Promise<BatchEntity> {
    const batch = await this.batches.findOne({ where: { id } });
    if (!batch) throw new NotFoundException(`batch ${id} not found`);
    return batch;
  }

  async list(status?: BatchStatus): Promise<BatchEntity[]> {
    return this.batches.find({
      where: status ? { status } : {},
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Pull unassigned, non-quarantined events at the hub into an open batch.
   * Quarantined events are never eligible — a failed integrity check must not be
   * able to reach a saleable credit.
   */
  async addEvents(batchId: string, eventIds: string[]): Promise<BatchEntity> {
    return this.dataSource.transaction(async (manager) => {
      const batch = await manager.findOne(BatchEntity, {
        where: { id: batchId },
        lock: { mode: "pessimistic_write" },
      });
      if (!batch) throw new NotFoundException(`batch ${batchId} not found`);
      if (batch.status !== "open") {
        throw new ConflictException(`batch ${batchId} is ${batch.status}, not open`);
      }

      const candidates = await manager.find(CollectionEventEntity, {
        where: { id: In(eventIds), batchId: IsNull(), quarantined: false, hubId: batch.hubId },
      });

      const found = new Set(candidates.map((c) => c.id));
      const rejected = eventIds.filter((id) => !found.has(id));
      if (rejected.length > 0) {
        throw new BadRequestException(
          `events not eligible for this batch (already batched, quarantined, or at another hub): ${rejected.join(", ")}`,
        );
      }

      const mismatched = candidates.filter((c) => c.material !== batch.material);
      if (mismatched.length > 0) {
        throw new BadRequestException(
          `events do not match batch material ${batch.material}: ${mismatched.map((m) => m.id).join(", ")}`,
        );
      }

      await manager.update(CollectionEventEntity, { id: In([...found]) }, { batchId });

      const totals = await this.recomputeTotals(manager, batchId);
      await manager.update(BatchEntity, { id: batchId }, totals);

      return manager.findOneOrFail(BatchEntity, { where: { id: batchId } });
    });
  }

  async removeEvent(batchId: string, eventId: string): Promise<BatchEntity> {
    return this.dataSource.transaction(async (manager) => {
      const batch = await manager.findOne(BatchEntity, {
        where: { id: batchId },
        lock: { mode: "pessimistic_write" },
      });
      if (!batch) throw new NotFoundException(`batch ${batchId} not found`);
      if (batch.status !== "open") {
        throw new ConflictException(
          `batch ${batchId} is ${batch.status}; sealed membership cannot change`,
        );
      }

      const result = await manager.update(
        CollectionEventEntity,
        { id: eventId, batchId },
        { batchId: null },
      );
      if (result.affected === 0) {
        throw new NotFoundException(`event ${eventId} is not in batch ${batchId}`);
      }

      const totals = await this.recomputeTotals(manager, batchId);
      await manager.update(BatchEntity, { id: batchId }, totals);
      return manager.findOneOrFail(BatchEntity, { where: { id: batchId } });
    });
  }

  private async recomputeTotals(
    manager: DataSource["manager"],
    batchId: string,
  ): Promise<{ totalWeightKg: number; eventCount: number }> {
    const rows = await manager.find(CollectionEventEntity, {
      where: { batchId },
      select: { id: true, weightKg: true },
    });
    const totalWeightKg = Number(rows.reduce((sum, r) => sum + Number(r.weightKg), 0).toFixed(3));
    return { totalWeightKg, eventCount: rows.length };
  }

  /**
   * Freeze membership and compute the root. Runs inside a transaction with the
   * batch row locked, so two concurrent seals cannot produce two different roots
   * for the same batch.
   */
  async seal(batchId: string): Promise<BatchEntity> {
    return this.dataSource.transaction(async (manager) => {
      const batch = await manager.findOne(BatchEntity, {
        where: { id: batchId },
        lock: { mode: "pessimistic_write" },
      });
      if (!batch) throw new NotFoundException(`batch ${batchId} not found`);
      if (batch.status !== "open") {
        throw new ConflictException(`batch ${batchId} is already ${batch.status}`);
      }

      const events = await manager.find(CollectionEventEntity, {
        where: { batchId },
        order: { capturedAt: "ASC", id: "ASC" },
      });

      if (events.length === 0) {
        throw new BadRequestException("cannot seal an empty batch");
      }
      const quarantined = events.filter((e) => e.quarantined);
      if (quarantined.length > 0) {
        // Defence in depth: addEvents already excludes these.
        throw new ConflictException(
          `batch contains quarantined events: ${quarantined.map((e) => e.id).join(", ")}`,
        );
      }

      const merkleRoot = merkleRootHex(BatchesService.leavesOf(events));
      const totalWeightKg = Number(
        events.reduce((sum, e) => sum + Number(e.weightKg), 0).toFixed(3),
      );

      await manager.update(
        BatchEntity,
        { id: batchId },
        {
          status: "sealed",
          sealedAt: new Date(),
          merkleRoot,
          totalWeightKg,
          eventCount: events.length,
        },
      );

      return manager.findOneOrFail(BatchEntity, { where: { id: batchId } });
    });
  }

  async advanceStatus(batchId: string, to: BatchStatus): Promise<BatchEntity> {
    const batch = await this.findOne(batchId);

    const allowed = LEGAL_TRANSITIONS[batch.status];
    if (!allowed.includes(to)) {
      throw new ConflictException(
        `illegal transition ${batch.status} -> ${to} (allowed: ${allowed.join(", ") || "none"})`,
      );
    }

    // Checked after the transition table, not before, so that moving backwards
    // to "sealed" is still reported as the illegal transition it is. What is
    // left here is the one case the table calls legal: open -> sealed.
    //
    // That step is legal in the lifecycle but cannot be taken by setting a
    // column. Sealing means computing and freezing the root; arriving at
    // "sealed" without one leaves a batch that cannot be added to, cannot be
    // removed from, and cannot be sealed either, because seal() only accepts
    // an open batch. The batch and every event in it would be stuck there
    // permanently.
    if (to === "sealed") {
      throw new ConflictException(
        "a batch is sealed by POST /batches/:id/seal, which computes and freezes its Merkle root",
      );
    }

    if (to === "processed" && !batch.merkleRoot) {
      throw new ConflictException("batch must be sealed before it can be processed");
    }
    await this.batches.update({ id: batchId }, { status: to });
    return this.findOne(batchId);
  }

  /**
   * The verification an auditor runs: recompute the leaf and rebuild the proof
   * from stored events, and check it against the sealed root.
   */
  async verifyEvent(batchId: string, eventId: string): Promise<EventVerification> {
    const batch = await this.findOne(batchId);
    if (!batch.merkleRoot) {
      throw new ConflictException(`batch ${batchId} has not been sealed`);
    }

    const events = await this.orderedEvents(batchId);
    const index = events.findIndex((e) => e.id === eventId);
    if (index < 0) throw new NotFoundException(`event ${eventId} is not in batch ${batchId}`);

    const leaves = BatchesService.leavesOf(events);
    const leaf = leaves[index]!;
    const proof = merkleProof(leaves, index);

    return {
      eventId,
      batchId,
      leaf,
      proof,
      merkleRoot: batch.merkleRoot,
      proofValid: verifyMerkleProof(leaf, proof, batch.merkleRoot),
    };
  }

  async eventsOf(batchId: string): Promise<CollectionEventEntity[]> {
    await this.findOne(batchId);
    return this.orderedEvents(batchId);
  }
}
