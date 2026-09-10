import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import { randomInt } from "node:crypto";
import type { MaterialType } from "@proofchain/shared";
import {
  CollectionEventEntity,
  CollectionRequestEntity,
  CollectorEntity,
  EventReweighEntity,
  HubEntity,
} from "../database/entities";
import { MaterialsService } from "../materials/materials.service";
import type { CreateCollectionRequestDto } from "../common/dto";

const UNIQUE_VIOLATION = "23505";

/**
 * Uppercase alphanumeric, excluding 0/O/1/I — a person re-keying the code
 * printed under a QR label should not have to guess which glyph a character
 * is. Not cryptographically sized for secrecy (8 chars from a 32-symbol
 * alphabet); it doesn't need to be — `redemptionCode` is unique per the DB,
 * and redeeming it also requires being logged in as the exact requester who
 * owns the linked request (see `wallet.service.ts`).
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_CODE_ATTEMPTS = 5;

function generateRedemptionCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * The collection-request lifecycle: `requested -> assigned (optional) ->
 * collected (redemption code issued) -> redeemed`, plus `cancelled` from
 * `requested`/`assigned`. See `CollectionRequestEntity`'s doc comment.
 *
 * `fulfill` is the load-bearing method: it links a request to an
 * already-hub-reweighed event rather than accepting a signed capture payload
 * carrying a request id, reusing the exact same collector-signs /
 * integrity-checks / hub-reweighs pipeline the B2B path already has (Phase
 * plan decision #1) — nothing here re-verifies a weigh-in, it only checks
 * that one already has been.
 */
@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(CollectionRequestEntity)
    private readonly requests: Repository<CollectionRequestEntity>,
    @InjectRepository(HubEntity)
    private readonly hubs: Repository<HubEntity>,
    @InjectRepository(CollectorEntity)
    private readonly collectors: Repository<CollectorEntity>,
    @InjectRepository(CollectionEventEntity)
    private readonly events: Repository<CollectionEventEntity>,
    @InjectRepository(EventReweighEntity)
    private readonly reweighs: Repository<EventReweighEntity>,
    private readonly materials: MaterialsService,
  ) {}

  private async require(id: string): Promise<CollectionRequestEntity> {
    const request = await this.requests.findOne({ where: { id } });
    if (!request) throw new NotFoundException(`request ${id} not found`);
    return request;
  }

  async create(requesterId: string, dto: CreateCollectionRequestDto): Promise<CollectionRequestEntity> {
    const hub = await this.hubs.findOne({ where: { id: dto.hubId } });
    if (!hub) throw new BadRequestException(`hub ${dto.hubId} not found`);

    // Existence only, matching ingest's own `assertKnown` (not `assertOpenable`):
    // a request is a forward-looking ask, but rejecting a code the moment it is
    // retired is EventsService's call to make, not this one's to duplicate.
    await this.materials.assertKnown(dto.material);

    return this.requests.save(
      this.requests.create({
        requesterId,
        hubId: dto.hubId,
        material: dto.material as MaterialType,
        estimatedWeightKg: dto.estimatedWeightKg ?? null,
        address: dto.address?.trim() || null,
        notes: dto.notes?.trim() || null,
        status: "requested",
        assignedCollectorId: null,
        eventId: null,
        redemptionCode: null,
        redeemedAt: null,
      }),
    );
  }

  async mine(requesterId: string): Promise<CollectionRequestEntity[]> {
    return this.requests.find({ where: { requesterId }, order: { createdAt: "DESC" } });
  }

  async list(filter: { status?: string; hubId?: string }): Promise<CollectionRequestEntity[]> {
    return this.requests.find({
      where: {
        ...(filter.status ? { status: filter.status as CollectionRequestEntity["status"] } : {}),
        ...(filter.hubId ? { hubId: filter.hubId } : {}),
      },
      order: { createdAt: "DESC" },
    });
  }

  async assign(id: string, collectorId: string): Promise<CollectionRequestEntity> {
    const request = await this.require(id);
    if (request.status !== "requested") {
      throw new BadRequestException(`request ${id} is "${request.status}", not "requested" — cannot assign`);
    }

    const collector = await this.collectors.findOne({ where: { id: collectorId } });
    if (!collector) throw new NotFoundException(`collector ${collectorId} not found`);

    request.assignedCollectorId = collectorId;
    request.status = "assigned";
    return this.requests.save(request);
  }

  /**
   * Link an already-hub-reweighed event to this request, issuing the
   * redemption code the requester later exchanges for wallet credits.
   *
   * Both `"verified"` and `"flagged"` reweighs are fulfillable — the same
   * "credit the hub-verified weight either way" policy `PayoutsService`
   * already applies to cash payouts. Only `"rejected"` (or no reweigh at all)
   * blocks fulfillment.
   */
  async fulfill(id: string, eventId: string): Promise<CollectionRequestEntity> {
    const request = await this.require(id);
    if (request.status !== "requested" && request.status !== "assigned") {
      throw new BadRequestException(`request ${id} is "${request.status}" and cannot be fulfilled`);
    }

    const event = await this.events.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException(`event ${eventId} not found`);

    // Friendly pre-check ahead of the DB's own unique constraint on
    // collection_requests.eventId, which stays the real backstop against a race.
    const alreadyLinked = await this.requests.findOne({ where: { eventId } });
    if (alreadyLinked) {
      throw new ConflictException(`event ${eventId} is already linked to request ${alreadyLinked.id}`);
    }

    const reweigh = await this.reweighs.findOne({ where: { eventId } });
    if (!reweigh) {
      throw new BadRequestException(
        `event ${eventId} has not been hub-verified yet — record a reweigh first ` +
          `(POST /events/${eventId}/reweigh)`,
      );
    }
    if (reweigh.status === "rejected") {
      throw new BadRequestException(`event ${eventId}'s reweigh was rejected and cannot fulfill a request`);
    }

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const redemptionCode = generateRedemptionCode();
      try {
        await this.requests.update({ id }, { eventId, redemptionCode, status: "collected" });
        return this.require(id);
      } catch (error) {
        // Mirrors EventsService.ingest's race handling: the unique index is the
        // authority, not the earlier read. Either constraint (redemptionCode or
        // eventId) can fire here — distinguish them so a genuine eventId race
        // reports a useful conflict instead of silently retrying forever.
        if (error instanceof QueryFailedError && (error as { code?: string }).code === UNIQUE_VIOLATION) {
          const raced = await this.requests.findOne({ where: { eventId } });
          if (raced && raced.id !== id) {
            throw new ConflictException(`event ${eventId} is already linked to request ${raced.id}`);
          }
          continue; // must have been the redemptionCode — retry with a new one
        }
        throw error;
      }
    }

    throw new ConflictException(
      `could not generate a unique redemption code for request ${id} after ${MAX_CODE_ATTEMPTS} attempts`,
    );
  }

  /**
   * Operator-only cancellation. A requester cancelling their own still-open
   * request is plausible product surface, but out of scope for this pass —
   * the plan left the choice open and the dashboard section (a later phase)
   * has no requester-facing cancel affordance yet, so there is nothing that
   * depends on it today. Narrowing to operator-only keeps this endpoint's
   * trust boundary identical to assign/fulfill rather than introducing a
   * second authorization path (requester-owns-this-request) for one action.
   */
  async cancel(id: string): Promise<CollectionRequestEntity> {
    const request = await this.require(id);
    if (request.status !== "requested" && request.status !== "assigned") {
      throw new BadRequestException(`request ${id} is "${request.status}" and cannot be cancelled`);
    }
    request.status = "cancelled";
    return this.requests.save(request);
  }
}
