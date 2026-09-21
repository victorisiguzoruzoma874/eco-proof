import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import { randomInt } from "node:crypto";
import type { IntegrityVerdict, MaterialType, WeighInPayload } from "@proofchain/shared";
import {
  CollectionEventEntity,
  CollectionRequestEntity,
  CollectorEntity,
  EventReweighEntity,
  HubEntity,
} from "../database/entities";
import { MaterialsService } from "../materials/materials.service";
import { EventsService } from "../events/events.service";
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

/** One row of a collector's job list, flattened for a field phone. */
export interface CollectorJobView {
  id: string;
  hubId: string;
  hubName: string | null;
  hubCode: string | null;
  material: MaterialType;
  estimatedWeightKg: number | null;
  address: string | null;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  createdAt: string;
}

/** What the phone gets back after a successful doorstep collection. */
export interface CollectResult {
  requestId: string;
  eventId: string;
  payloadHash: string;
  /** The code the requester scans. Rendered as a QR on the collector's screen. */
  redemptionCode: string;
  weightKg: number;
  material: MaterialType;
  integrity: IntegrityVerdict;
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
    private readonly events_: EventsService,
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

    // Both or neither. Half a coordinate pair is not a location, and storing
    // one would drop a pin on the null meridian — worse than having no pin at
    // all, because the collector would trust it.
    const hasLatitude = dto.latitude !== undefined && dto.latitude !== null;
    const hasLongitude = dto.longitude !== undefined && dto.longitude !== null;
    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException("latitude and longitude must be provided together");
    }

    return this.requests.save(
      this.requests.create({
        requesterId,
        hubId: dto.hubId,
        material: dto.material as MaterialType,
        estimatedWeightKg: dto.estimatedWeightKg ?? null,
        address: dto.address?.trim() || null,
        notes: dto.notes?.trim() || null,
        latitude: hasLatitude ? (dto.latitude as number) : null,
        longitude: hasLongitude ? (dto.longitude as number) : null,
        status: "requested",
        assignedCollectorId: null,
        eventId: null,
        redemptionCode: null,
        redeemedAt: null,
        creditedWeightKg: null,
        reconciledAt: null,
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

  /**
   * The collector's job list, as read by a field phone.
   *
   * Scoped to one collector and to the two statuses that still need someone to
   * turn up. `assigned` is the dispatched work; `requested` at the same hubs is
   * deliberately NOT included — an unassigned request is the operator's to
   * route, and showing every open job to every phone would turn dispatch into a
   * race between collectors driving to the same address.
   *
   * Returns the hub alongside each request because the phone has no other way
   * to resolve a hub id to a name, and a job card reading "hub
   * 7f3a-..." helps nobody standing on a street.
   */
  async assignedTo(collectorId: string): Promise<CollectorJobView[]> {
    const requests = await this.requests.find({
      where: { assignedCollectorId: collectorId, status: "assigned" },
      order: { createdAt: "ASC" },
    });
    if (requests.length === 0) return [];

    const hubs = await this.hubs.find();
    const byId = new Map(hubs.map((h) => [h.id, h]));

    return requests.map((request) => {
      const hub = byId.get(request.hubId);
      return {
        id: request.id,
        hubId: request.hubId,
        hubName: hub?.name ?? null,
        hubCode: hub?.code ?? null,
        material: request.material,
        estimatedWeightKg: request.estimatedWeightKg,
        address: request.address,
        notes: request.notes,
        latitude: request.latitude,
        longitude: request.longitude,
        status: request.status,
        createdAt: request.createdAt.toISOString(),
      };
    });
  }

  /**
   * Collect at the door: ingest the collector's signed weigh-in and issue the
   * redemption code in one step.
   *
   * This is the doorstep counterpart to `fulfill`. `fulfill` links a request to
   * a weigh-in the hub has already re-weighed, and is the right shape when the
   * material travels to the hub before anyone is paid. This method instead
   * issues the code while the collector is still standing there, so the
   * requester can scan it before the van pulls away.
   *
   * The weight that ends up credited is therefore the collector's scale
   * reading, not the hub's. That is a real reduction in independent
   * corroboration and it is taken deliberately, bounded two ways: a quarantined
   * weigh-in can never issue a code (so the six integrity checks still gate the
   * door), and the hub's later re-weigh still runs, reconciling the difference
   * through `WalletService.reconcile` rather than being discarded.
   */
  async collect(
    id: string,
    device: { deviceId: string; collectorId: string },
    payload: WeighInPayload,
    signature: string,
  ): Promise<CollectResult> {
    const request = await this.require(id);

    if (request.status !== "requested" && request.status !== "assigned") {
      throw new BadRequestException(`request ${id} is "${request.status}" and cannot be collected`);
    }

    // An assigned job belongs to the collector it was assigned to. An
    // unassigned one is first-come, which is what lets a dispatcher hand a
    // route out verbally without also clicking Assign.
    if (request.assignedCollectorId && request.assignedCollectorId !== device.collectorId) {
      throw new ForbiddenException(`request ${id} is assigned to another collector`);
    }

    // The signed payload must agree with the authenticated device about who is
    // capturing. Without this a phone could sign a weigh-in naming a different
    // collector and still have it accepted, because the header signature and
    // the payload signature are checked against the same key but cover
    // different claims.
    if (payload.deviceId !== device.deviceId || payload.collectorId !== device.collectorId) {
      throw new ForbiddenException("the signed weigh-in does not match the authenticated device");
    }

    if (payload.material !== request.material) {
      throw new BadRequestException(
        `this request is for "${request.material}" but the weigh-in is for "${payload.material}"`,
      );
    }

    const ingest = await this.events_.ingest(payload, signature);

    // A quarantined weigh-in is stored (it is evidence) but must never issue a
    // code — that is the whole reason the integrity checks run before anyone is
    // credited, and it is the one gate the doorstep path does not relax.
    if (ingest.quarantined) {
      throw new BadRequestException({
        message: ingest.duplicate
          ? "this weigh-in has already been submitted"
          : "this weigh-in failed integrity checks and cannot complete a collection",
        integrity: ingest.integrity,
      });
    }

    const fulfilled = await this.issueCode(request.id, ingest.eventId);

    return {
      requestId: fulfilled.id,
      eventId: ingest.eventId,
      payloadHash: ingest.payloadHash,
      redemptionCode: fulfilled.redemptionCode as string,
      weightKg: payload.weightKg,
      material: fulfilled.material,
      integrity: ingest.integrity,
    };
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

    return this.issueCode(id, eventId);
  }

  /**
   * Link the event and mint the code — the step `fulfill` (hub-verified) and
   * `collect` (doorstep) both end in, kept in one place so the two paths can
   * never drift on how a code is generated or how a collision is handled.
   */
  private async issueCode(id: string, eventId: string): Promise<CollectionRequestEntity> {
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
