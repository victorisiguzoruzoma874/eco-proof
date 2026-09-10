import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CollectionEventEntity, EventReweighEntity } from "../database/entities";
import type { RecordReweighDto } from "../common/dto";

/**
 * Hub re-weigh against a collector's claimed weight — the check that turns a
 * self-reported drop-off into something payable.
 *
 * Mirrors `CustodyService`'s two-weight + variance + mandatory-reason-on-mismatch
 * pattern: variance is always stored, and a discrepancy outside tolerance
 * without a stated reason is refused at write time. The tolerance here is a
 * fixed ±5% (Phase 1 decision #1) rather than "any nonzero variance", and
 * unlike custody, a discrepancy never blocks the record — it only changes the
 * status from "verified" to "flagged", both of which remain payable.
 */
const TOLERANCE_PCT = 5;

@Injectable()
export class ReweighService {
  constructor(
    @InjectRepository(EventReweighEntity)
    private readonly reweighs: Repository<EventReweighEntity>,
    @InjectRepository(CollectionEventEntity)
    private readonly events: Repository<CollectionEventEntity>,
  ) {}

  async list(eventId: string): Promise<EventReweighEntity[]> {
    return this.reweighs.find({ where: { eventId }, order: { verifiedAt: "ASC" } });
  }

  async create(
    eventId: string,
    dto: RecordReweighDto,
    verifiedByUserId: string,
  ): Promise<EventReweighEntity> {
    const event = await this.events.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`event ${eventId} not found`);

    const existing = await this.reweighs.findOne({ where: { eventId } });
    if (existing) {
      throw new ConflictException(`event ${eventId} already has a reweigh (${existing.id})`);
    }

    const claimedWeightKg = Number(event.weightKg);
    const varianceKg = Number((claimedWeightKg - dto.verifiedWeightKg).toFixed(3));
    const variancePct =
      claimedWeightKg === 0 ? 0 : Number(((varianceKg / claimedWeightKg) * 100).toFixed(3));

    const status: "verified" | "flagged" = Math.abs(variancePct) <= TOLERANCE_PCT ? "verified" : "flagged";

    if (status === "flagged" && !dto.notes?.trim()) {
      throw new BadRequestException(
        `a variance of ${variancePct}% (${varianceKg} kg) exceeds the ${TOLERANCE_PCT}% tolerance and must carry a stated reason`,
      );
    }

    return this.reweighs.save(
      this.reweighs.create({
        eventId,
        claimedWeightKg,
        verifiedWeightKg: dto.verifiedWeightKg,
        varianceKg,
        variancePct,
        status,
        notes: dto.notes?.trim() || null,
        verifiedByUserId,
        verifiedAt: new Date(),
      }),
    );
  }
}
