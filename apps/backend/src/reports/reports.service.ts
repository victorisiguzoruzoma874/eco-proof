import { Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  hashLeaf,
  merkleProof,
  merkleRootHex,
  verifyMerkleProof,
  type MerkleProofStep,
} from "@proofchain/shared";
import {
  BatchEntity,
  CollectionEventEntity,
  CollectorEntity,
  CustodyTransferEntity,
  EventReweighEntity,
  HubEntity,
  PayoutEntity,
  PayoutItemEntity,
} from "../database/entities";

/**
 * The audit artifact — the document a PRO, verifier or credit buyer accepts as
 * evidence. Per the project plan this IS the product spec; the rest of the
 * system exists to be able to generate it.
 *
 * Deliberately self-contained: a recipient can re-derive the Merkle root from
 * the event list in this file alone, without calling our API or trusting our
 * word.
 */

export interface AuditReportEvent {
  eventId: string;
  collectorId: string;
  collectorName: string;
  weightKg: number;
  material: string;
  capturedAt: string;
  receivedAt: string;
  photoHash: string;
  /** True once bytes matching photoHash have been uploaded and stored. */
  photoAvailable: boolean;
  /**
   * Where to fetch those bytes. Relative on purpose: the report is served from
   * whatever host the reader reached us on, and baking an absolute URL in would
   * hand a buyer a link that only resolves on our own network.
   */
  photoUrl: string | null;
  payloadHash: string;
  leaf: string;
  merkleProof: MerkleProofStep[];
  integrityOutcome: string;
  integrityFindings: { check: string; outcome: string; detail?: string }[];
}

export interface AuditReport {
  reportVersion: "proofchain.audit.v1";
  generatedAt: string;
  batch: {
    id: string;
    status: string;
    material: string;
    totalWeightKg: number;
    totalWeightTonnes: number;
    eventCount: number;
    sealedAt: string | null;
    createdAt: string;
  };
  hub: {
    id: string;
    code: string;
    name: string;
  };
  collectors: {
    id: string;
    name: string;
    kycLevel: string;
    eventCount: number;
    weightKg: number;
  }[];
  chainOfCustody: {
    id: string;
    fromParty: string;
    toParty: string;
    weightInKg: number;
    weightOutKg: number;
    varianceKg: number;
    variancePct: number | null;
    reason: string | null;
    transferredAt: string;
  }[];
  reconciliation: {
    collectedKg: number;
    finalWeightOutKg: number | null;
    gapKg: number | null;
    gapPct: number | null;
    explained: boolean;
  };
  proof: {
    merkleRoot: string | null;
    /** Recomputed here from the events listed below, not read from the batch row. */
    recomputedRoot: string | null;
    rootMatchesSealedValue: boolean;
    allProofsValid: boolean;
    leafHashAlgorithm: "sha256(0x00 || payloadHash)";
    nodeHashAlgorithm: "sha256(0x01 || left || right)";
    ordering: "capturedAt ASC, id ASC";
  };
  events: AuditReportEvent[];
  /**
   * The hub re-weigh against each event's claimed weight, where one has been
   * recorded. An event with no reweigh yet simply has no entry here — that is
   * the normal state for anything not yet brought to a hub for verification.
   */
  reweighs: {
    eventId: string;
    claimedWeightKg: number;
    verifiedWeightKg: number;
    variancePct: number;
    status: string;
  }[];
  /** Payment runs covering one or more of this batch's reweighs. */
  payouts: {
    id: string;
    collectorId: string;
    amount: number;
    currency: string;
    method: string;
    status: string;
    paidAt: string | null;
  }[];
  /**
   * Stated plainly so nobody mistakes a Merkle proof for proof of the physical
   * fact.
   */
  attestationNotes: string[];
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(BatchEntity) private readonly batches: Repository<BatchEntity>,
    @InjectRepository(CollectionEventEntity)
    private readonly events: Repository<CollectionEventEntity>,
    @InjectRepository(CustodyTransferEntity)
    private readonly custody: Repository<CustodyTransferEntity>,
    @InjectRepository(CollectorEntity)
    private readonly collectors: Repository<CollectorEntity>,
    @InjectRepository(HubEntity) private readonly hubs: Repository<HubEntity>,
    @InjectRepository(EventReweighEntity)
    private readonly eventReweighs: Repository<EventReweighEntity>,
    @InjectRepository(PayoutEntity) private readonly payouts: Repository<PayoutEntity>,
    @InjectRepository(PayoutItemEntity)
    private readonly payoutItems: Repository<PayoutItemEntity>,
  ) {}

  async buildAuditReport(batchId: string): Promise<AuditReport> {
    // Deliberately not findOneOrFail: TypeORM's EntityNotFoundError is not an
    // HttpException, so Nest renders it as a 500. On a public verification
    // endpoint that is actively misleading — a verifier checking an unknown id
    // would be told our service is broken rather than that no such batch exists.
    const batch = await this.batches.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`no batch exists with id ${batchId}`);

    // A batch referencing a missing hub is a genuine internal inconsistency, so
    // 500 is the honest answer here — but say why, rather than leaking an ORM error.
    const hub = await this.hubs.findOne({ where: { id: batch.hubId } });
    if (!hub) {
      throw new InternalServerErrorException(
        `batch ${batchId} references hub ${batch.hubId}, which does not exist`,
      );
    }

    const events = await this.events.find({
      where: { batchId },
      order: { capturedAt: "ASC", id: "ASC" },
    });

    const transfers = await this.custody.find({
      where: { batchId },
      order: { transferredAt: "ASC" },
    });

    // Recomputed from source rows on every call, same as everything else in
    // this report: reweighs and payouts are never cached against the batch.
    const eventIds = events.map((e) => e.id);
    const reweighRows =
      eventIds.length > 0 ? await this.eventReweighs.find({ where: { eventId: In(eventIds) } }) : [];

    const reweighIds = reweighRows.map((r) => r.id);
    const payoutItemRows =
      reweighIds.length > 0
        ? await this.payoutItems.find({ where: { eventReweighId: In(reweighIds) } })
        : [];
    const payoutIds = [...new Set(payoutItemRows.map((p) => p.payoutId))];
    const payoutRows =
      payoutIds.length > 0
        ? await this.payouts.find({ where: { id: In(payoutIds) }, order: { createdAt: "ASC" } })
        : [];

    const collectorIds = [...new Set(events.map((e) => e.collectorId))];
    const collectorRows = collectorIds.length ? await this.collectors.findByIds(collectorIds) : [];
    const collectorById = new Map(collectorRows.map((c) => [c.id, c]));

    const leaves = events.map((e) => hashLeaf(e.payloadHash));
    const recomputedRoot = leaves.length > 0 ? merkleRootHex(leaves) : null;

    const reportEvents: AuditReportEvent[] = events.map((e, index) => {
      const proof = leaves.length > 0 ? merkleProof(leaves, index) : [];
      return {
        eventId: e.id,
        collectorId: e.collectorId,
        collectorName: collectorById.get(e.collectorId)?.name ?? "(unknown)",
        weightKg: Number(e.weightKg),
        material: e.material,
        capturedAt: e.capturedAt.toISOString(),
        receivedAt: e.receivedAt.toISOString(),
        photoHash: e.photoHash,
        photoAvailable: e.photoUri !== null,
        photoUrl: e.photoUri === null ? null : `/events/${e.id}/photo`,
        payloadHash: e.payloadHash,
        leaf: leaves[index]!,
        merkleProof: proof,
        integrityOutcome: e.integrity?.outcome ?? "unknown",
        integrityFindings: e.integrity?.findings ?? [],
      };
    });

    const allProofsValid =
      recomputedRoot !== null &&
      reportEvents.every((e) => verifyMerkleProof(e.leaf, e.merkleProof, recomputedRoot));

    const collectedKg = Number(events.reduce((sum, e) => sum + Number(e.weightKg), 0).toFixed(3));
    const lastTransfer = transfers.at(-1) ?? null;
    const finalWeightOutKg = lastTransfer ? Number(lastTransfer.weightOutKg) : null;
    const gapKg =
      finalWeightOutKg === null ? null : Number((collectedKg - finalWeightOutKg).toFixed(3));
    const gapPct =
      gapKg === null || collectedKg === 0 ? null : Number(((gapKg / collectedKg) * 100).toFixed(2));

    const perCollector = collectorIds.map((id) => {
      const own = events.filter((e) => e.collectorId === id);
      const c = collectorById.get(id);
      return {
        id,
        name: c?.name ?? "(unknown)",
        kycLevel: c?.kycLevel ?? "none",
        eventCount: own.length,
        weightKg: Number(own.reduce((s, e) => s + Number(e.weightKg), 0).toFixed(3)),
      };
    });

    return {
      reportVersion: "proofchain.audit.v1",
      generatedAt: new Date().toISOString(),
      batch: {
        id: batch.id,
        status: batch.status,
        material: batch.material,
        totalWeightKg: Number(batch.totalWeightKg),
        totalWeightTonnes: Number((Number(batch.totalWeightKg) / 1000).toFixed(6)),
        eventCount: batch.eventCount,
        sealedAt: batch.sealedAt?.toISOString() ?? null,
        createdAt: batch.createdAt.toISOString(),
      },
      hub: {
        id: hub.id,
        code: hub.code,
        name: hub.name,
      },
      collectors: perCollector,
      chainOfCustody: transfers.map((t) => {
        const inKg = Number(t.weightInKg);
        return {
          id: t.id,
          fromParty: t.fromParty,
          toParty: t.toParty,
          weightInKg: inKg,
          weightOutKg: Number(t.weightOutKg),
          varianceKg: Number(t.varianceKg),
          variancePct: inKg === 0 ? null : Number(((Number(t.varianceKg) / inKg) * 100).toFixed(2)),
          reason: t.reason,
          transferredAt: t.transferredAt.toISOString(),
        };
      }),
      reconciliation: {
        collectedKg,
        finalWeightOutKg,
        gapKg,
        gapPct,
        explained: transfers.every((t) => Number(t.varianceKg) === 0 || Boolean(t.reason)),
      },
      proof: {
        merkleRoot: batch.merkleRoot,
        recomputedRoot,
        rootMatchesSealedValue:
          batch.merkleRoot !== null &&
          recomputedRoot !== null &&
          batch.merkleRoot === recomputedRoot,
        allProofsValid,
        leafHashAlgorithm: "sha256(0x00 || payloadHash)",
        nodeHashAlgorithm: "sha256(0x01 || left || right)",
        ordering: "capturedAt ASC, id ASC",
      },
      events: reportEvents,
      reweighs: reweighRows.map((r) => ({
        eventId: r.eventId,
        claimedWeightKg: Number(r.claimedWeightKg),
        verifiedWeightKg: Number(r.verifiedWeightKg),
        variancePct: Number(r.variancePct),
        status: r.status,
      })),
      payouts: payoutRows.map((p) => ({
        id: p.id,
        collectorId: p.collectorId,
        amount: Number(p.amount),
        currency: p.currency,
        method: p.method,
        status: p.status,
        paidAt: p.paidAt?.toISOString() ?? null,
      })),
      attestationNotes: [
        "The Merkle proof shows each event is part of the sealed batch's committed set. It does not, by itself, prove the material weighed was real or additional.",
        "Source-level assurance comes from device signatures, hub geofencing, photo evidence and duplicate detection, recorded per event above.",
        "Each event's photoHash was signed by the capture device. Where photoAvailable is true, the stored bytes have been checked to hash to that value; download the photo and recompute the sha256 to confirm it independently.",
        "Baseline and additionality figures must be completed against the selected Verra Plastic Waste Reduction Standard track before submission.",
      ],
    };
  }

  /** Flat CSV of the event log — what a verifier will open in a spreadsheet. */
  async buildEventCsv(batchId: string): Promise<string> {
    const report = await this.buildAuditReport(batchId);

    const header = [
      "event_id",
      "collector_id",
      "collector_name",
      "captured_at",
      "received_at",
      "material",
      "weight_kg",
      "photo_sha256",
      "photo_url",
      "payload_sha256",
      "merkle_leaf",
      "integrity",
    ];

    const rows = report.events.map((e) =>
      [
        e.eventId,
        e.collectorId,
        e.collectorName,
        e.capturedAt,
        e.receivedAt,
        e.material,
        e.weightKg.toFixed(3),
        e.photoHash,
        // Empty rather than absent so the column count stays fixed: a
        // spreadsheet with ragged rows silently misaligns every later field.
        e.photoUrl ?? "",
        e.payloadHash,
        e.leaf,
        e.integrityOutcome,
      ].map(csvCell),
    );

    return [header.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
  }
}

/** RFC 4180 quoting. Collector names are free text and will contain commas. */
function csvCell(value: string): string {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
