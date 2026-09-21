import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import type { BatchStatus, IntegrityVerdict, KycLevel, MaterialType } from "@proofchain/shared";

/**
 * The five core entities (plus Hub and Device, which the integrity checks need).
 * Designed backwards from the audit artifact: every column here exists because a
 * verifier, a PRO, or a credit buyer will ask about it.
 *
 * Numeric columns use `numeric` with an explicit transformer. Postgres returns
 * `numeric` as a string via node-postgres to avoid silent float truncation, and
 * weights denominated in money-grade credits must not be read as strings.
 */

const numericTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};

/** A physical collection hub. */
@Entity("hubs")
export class HubEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true })
  code: string;

  @Column()
  name: string;

  @Column("numeric", { precision: 10, scale: 3, default: 0.1, transformer: numericTransformer })
  minWeightKg: number;

  /**
   * Ten tonnes: a hub weighs aggregated loads, not what one person carries.
   * The old 500 kg ceiling assumed a single collector at a hand scale and
   * quarantined perfectly real deliveries once a hub started weighing a
   * truckload in one go.
   */
  @Column("numeric", { precision: 10, scale: 3, default: 10000, transformer: numericTransformer })
  maxWeightKg: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/** Who did the collection work. */
@Entity("collectors")
export class CollectorEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  /** Tied to mobile-money identity; unique so one person is one payee. */
  @Column({ unique: true })
  phone: string;

  @Column({ nullable: true, type: "varchar" })
  cooperativeId: string | null;

  @Column({ type: "varchar", default: "none" })
  kycLevel: KycLevel;

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => DeviceEntity, (d) => d.collector)
  devices: DeviceEntity[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/**
 * An enrolled capture device. Its ed25519 public key is the root of event
 * authenticity — revoking it invalidates nothing already signed, which is why
 * `revokedAt` is a timestamp rather than a delete.
 */
@Entity("devices")
export class DeviceEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  collectorId: string;

  @ManyToOne(() => CollectorEntity, (c) => c.devices, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "collectorId" })
  collector: CollectorEntity;

  @Column()
  label: string;

  /** Raw 32-byte ed25519 key, base64. Unique: one key, one device, forever. */
  @Column({ unique: true })
  publicKeyBase64: string;

  @CreateDateColumn({ type: "timestamptz" })
  enrolledAt: Date;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt: Date | null;
}

/** A group of events aggregated for processing / sale. */
@Entity("batches")
export class BatchEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  hubId: string;

  @ManyToOne(() => HubEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "hubId" })
  hub: HubEntity;

  @Column({ type: "varchar" })
  material: MaterialType;

  @Index()
  @Column({ type: "varchar", default: "open" })
  status: BatchStatus;

  @Column("numeric", { precision: 12, scale: 3, default: 0, transformer: numericTransformer })
  totalWeightKg: number;

  @Column("int", { default: 0 })
  eventCount: number;

  /** Set exactly once, at seal time. Never recomputed — that is the point. */
  @Column({ type: "varchar", nullable: true })
  merkleRoot: string | null;

  @Column({ type: "timestamptz", nullable: true })
  sealedAt: Date | null;

  @OneToMany(() => CollectionEventEntity, (e) => e.batch)
  events: CollectionEventEntity[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt: Date;
}

/** The atomic verified fact: one weigh-in. */
@Entity("collection_events")
@Unique("uq_event_payload_hash", ["payloadHash"])
@Index("ix_event_hub_captured", ["hubId", "capturedAt"])
export class CollectionEventEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  collectorId: string;

  @ManyToOne(() => CollectorEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "collectorId" })
  collector: CollectorEntity;

  @Index()
  @Column("uuid")
  hubId: string;

  @ManyToOne(() => HubEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "hubId" })
  hub: HubEntity;

  @Index()
  @Column("uuid")
  deviceId: string;

  @ManyToOne(() => DeviceEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "deviceId" })
  device: DeviceEntity;

  /** Null until the event is pulled into a batch; frozen once that batch seals. */
  @Index()
  @Column({ type: "uuid", nullable: true })
  batchId: string | null;

  @ManyToOne(() => BatchEntity, (b) => b.events, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "batchId" })
  batch: BatchEntity | null;

  @Column("numeric", { precision: 10, scale: 3, transformer: numericTransformer })
  weightKg: number;

  @Column({ type: "varchar" })
  material: MaterialType;

  /** Device clock at capture. */
  @Column("timestamptz")
  capturedAt: Date;

  /** Server clock at ingest. The gap between the two is an integrity signal. */
  @Column("timestamptz")
  receivedAt: Date;

  /** sha256 of the photo bytes. The photo itself never goes on-chain. */
  @Column()
  photoHash: string;

  @Column({ type: "varchar", nullable: true })
  photoUri: string | null;

  @Column()
  nonce: string;

  /** base64 ed25519 signature over the canonical payload. */
  @Column("text")
  signature: string;

  /**
   * sha256 of the canonical payload. Unique, so the same signed weigh-in cannot
   * be ingested twice — replay protection enforced by the database, not by code.
   */
  @Column()
  payloadHash: string;

  @Column("jsonb")
  integrity: IntegrityVerdict;

  /** Quarantined events are visible to operators but never enter a batch. */
  @Index()
  @Column({ default: false })
  quarantined: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/** Proves chain-of-custody between parties. */
@Entity("custody_transfers")
export class CustodyTransferEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  batchId: string;

  @ManyToOne(() => BatchEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "batchId" })
  batch: BatchEntity;

  @Column()
  fromParty: string;

  @Column()
  toParty: string;

  @Column("numeric", { precision: 12, scale: 3, transformer: numericTransformer })
  weightInKg: number;

  @Column("numeric", { precision: 12, scale: 3, transformer: numericTransformer })
  weightOutKg: number;

  /** Stored, not derived, so a later change to either weight is auditable. */
  @Column("numeric", { precision: 12, scale: 3, transformer: numericTransformer })
  varianceKg: number;

  @Column({ type: "varchar", nullable: true })
  reason: string | null;

  @Column("timestamptz")
  transferredAt: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/** Operator/auditor login. Collectors authenticate by device key, not password. */
@Entity("users")
export class UserEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true })
  email: string;

  @Column("text")
  passwordHash: string;

  /** operator runs the hub; auditor is read-only; admin manages enrolment. */
  @Column({ type: "varchar", default: "operator" })
  role: "admin" | "operator" | "auditor";

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/**
 * Hub re-weigh against a collector's claimed weight — the check that turns a
 * self-reported drop-off into something payable. One per event: a second
 * re-weigh of the same event would be a data-entry mistake, not a correction,
 * so the FK is unique rather than merely indexed.
 *
 * `UserEntity` is declared above this class (rather than in file order after
 * it, as it once was) because TypeScript's emitted `design:type` decorator
 * metadata evaluates a `@ManyToOne(() => UserEntity, ...)` target's identifier
 * eagerly, at class-decoration time — a forward reference here hits
 * `UserEntity`'s temporal dead zone and throws `ReferenceError` at import time,
 * not just at typecheck time. Keep every entity that types a relation as
 * `UserEntity` below this declaration.
 *
 * This is a deliberately separate table, not columns bolted onto
 * `CollectionEventEntity`: the event's signed/hashed columns feed the Merkle
 * leaf and are treated as immutable once ingested, so re-weigh data — captured
 * later, by hub staff, never signed by the device — must live somewhere else.
 *
 * `claimedWeightKg` is copied from the event at reweigh time rather than
 * joined live, so this row stays a self-contained audit fact on its own.
 * `varianceKg`/`variancePct` are stored, not derived, mirroring
 * `CustodyTransferEntity`'s convention: a later change to either weight must
 * not silently change the recorded variance.
 */
@Entity("event_reweighs")
export class EventReweighEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index({ unique: true })
  @Column("uuid")
  eventId: string;

  @OneToOne(() => CollectionEventEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "eventId" })
  event: CollectionEventEntity;

  @Column("numeric", { precision: 10, scale: 3, transformer: numericTransformer })
  claimedWeightKg: number;

  @Column("numeric", { precision: 10, scale: 3, transformer: numericTransformer })
  verifiedWeightKg: number;

  @Column("numeric", { precision: 10, scale: 3, transformer: numericTransformer })
  varianceKg: number;

  @Column("numeric", { precision: 6, scale: 3, transformer: numericTransformer })
  variancePct: number;

  /**
   * `verified` / `flagged` are set by the ±5% tolerance check at reweigh time
   * and both are payable. `rejected` is not set by that automated logic — it
   * exists only as a manual override hub staff could apply separately (e.g.
   * voiding a submission for cause).
   */
  @Column({ type: "varchar" })
  status: "verified" | "flagged" | "rejected";

  /** Required whenever status is flagged/rejected — the audit trail for why it diverged. */
  @Column({ type: "varchar", nullable: true })
  notes: string | null;

  @Index()
  @Column("uuid")
  verifiedByUserId: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "verifiedByUserId" })
  verifiedByUser: UserEntity;

  @Column("timestamptz")
  verifiedAt: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/**
 * The material catalogue an operator maintains at runtime.
 *
 * `code` is the primary key rather than a surrogate uuid, and that is deliberate:
 * the code is what devices sign and what every event and batch row already
 * stores, so a uuid would add a join without adding a fact. It also makes the
 * append-only rule structural — you cannot rename a primary key by accident.
 *
 * There is no foreign key from `collection_events.material` or
 * `batches.material` to this table. Adding one would be wrong: a retired or
 * deleted catalogue row must never be able to orphan or cascade into an anchored
 * event, whose material is a signed historical fact rather than a reference to
 * current configuration. Existence is checked at ingest instead, where it can be
 * reported to the collector as a 400 rather than as a constraint violation.
 */
@Entity("materials")
export class MaterialEntity {
  /** Uppercase, `PET`-shaped, immutable once signed. Never rename in place. */
  @PrimaryColumn({ type: "varchar", length: 16 })
  code: string;

  /** Presentation only — never signed, never hashed, safe to edit at will. */
  @Column({ type: "varchar", length: 120 })
  name: string;

  /** Field guidance: what actually counts as this material. */
  @Column({ type: "varchar", length: 300, nullable: true })
  description: string | null;

  /**
   * The products a collector would recognise this material as — "milk jugs",
   * "bottle caps".
   *
   * A real array rather than a delimited string, because these are separate
   * values that a picker renders one per chip, and packing them into one column
   * would put the parser in every reader instead of in the driver. Not null:
   * "no examples" is the empty array, so nothing downstream has to distinguish
   * absent from empty.
   */
  @Column({ type: "text", array: true, default: () => "'{}'" })
  examples: string[];

  /** False = retired: hidden from new capture, still valid in every stored event. */
  @Column({ default: true })
  active: boolean;

  @Column({ type: "int", default: 100 })
  sortOrder: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt: Date;
}

/**
 * One payment run to a collector, covering one or more verified re-weighs.
 *
 * Payout destination stays manual/cash for now — there is no structured
 * payout-account column on `CollectorEntity` in this phase. `method` is a
 * free-text record of how this specific payout was actually handed over
 * (cash, mobile money, bank), not a validated attribute of the collector.
 */
@Entity("payouts")
export class PayoutEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  collectorId: string;

  @ManyToOne(() => CollectorEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "collectorId" })
  collector: CollectorEntity;

  @Column("numeric", { precision: 12, scale: 2, transformer: numericTransformer })
  amount: number;

  @Column({ type: "varchar", default: "NGN" })
  currency: string;

  /** e.g. "cash" | "mobile_money" | "bank" — free text, not an enforced enum. */
  @Column({ type: "varchar" })
  method: string;

  @Column({ type: "varchar", nullable: true })
  payoutRef: string | null;

  @Column({ type: "varchar", default: "pending" })
  status: "pending" | "paid" | "failed";

  @Column({ type: "uuid", nullable: true })
  paidByUserId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "paidByUserId" })
  paidByUser: UserEntity | null;

  @Column({ type: "timestamptz", nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/**
 * One re-weigh's contribution to a payout. A payout can cover several
 * drop-offs, so this is a join row carrying the amount attributed to that
 * one re-weigh, not a duplicate of `PayoutEntity.amount`.
 */
@Entity("payout_items")
export class PayoutItemEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  payoutId: string;

  @ManyToOne(() => PayoutEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "payoutId" })
  payout: PayoutEntity;

  @Index()
  @Column("uuid")
  eventReweighId: string;

  @ManyToOne(() => EventReweighEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "eventReweighId" })
  eventReweigh: EventReweighEntity;

  @Column("numeric", { precision: 12, scale: 2, transformer: numericTransformer })
  amount: number;
}

/**
 * A fixed rate per kg for a material, optionally scoped to one hub.
 *
 * The payout service resolves the applicable rate rather than taking a manual
 * amount per item: most specific `hubId` match, most recent `effectiveFrom`
 * at or before now. `hubId: null` is the global default rate for a material.
 *
 * No FK from `collection_events`/`batches` to this table for the same reason
 * `MaterialEntity` has none from those tables — a rate is current
 * configuration, and a signed weigh-in's material must never be able to
 * dangle on a rate change.
 */
@Entity("material_rates")
export class MaterialRateEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ type: "varchar", length: 16 })
  materialCode: string;

  @ManyToOne(() => MaterialEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "materialCode" })
  material: MaterialEntity;

  /** Null = global default rate; set = an override scoped to one hub. */
  @Index()
  @Column({ type: "uuid", nullable: true })
  hubId: string | null;

  @ManyToOne(() => HubEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "hubId" })
  hub: HubEntity | null;

  @Column("numeric", { precision: 10, scale: 2, transformer: numericTransformer })
  ratePerKg: number;

  @Column("timestamptz")
  effectiveFrom: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/**
 * A self-registering consumer requesting pickups — a different trust
 * boundary from `UserEntity` (admin-provisioned operator/auditor accounts).
 * Own JWT and own guard land in a later phase; this pass is the data model
 * only. No forward entity references, so this can be declared anywhere —
 * it sits here, immediately before the first entity that references it.
 */
@Entity("requesters")
export class RequesterEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column("text")
  passwordHash: string;

  @Column({ type: "varchar", nullable: true })
  phone: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/**
 * A requester's pickup request. Fulfilled by linking it to an
 * already-hub-reweighed `CollectionEventEntity` rather than by changing the
 * signed capture payload schema to carry a request id — same signature, same
 * integrity checks, same hub scale, just credited to a requester's wallet
 * instead of (or alongside) a collector's cash payout. `eventId` is unique:
 * a request is fulfilled by exactly one event, and one event fulfills at
 * most one request.
 *
 * `RequesterEntity`, `HubEntity`, `CollectorEntity`, and
 * `CollectionEventEntity` are all declared above this class for the same
 * eager-decorator-metadata reason documented on `EventReweighEntity`: a
 * `@ManyToOne`/`@OneToOne` target referenced before its own class
 * declaration hits that class's temporal dead zone and throws
 * `ReferenceError` at import time, not just at typecheck time. Keep every
 * entity that types a relation as `CollectionRequestEntity` below this
 * declaration.
 *
 * `material` is a plain varchar with no FK, matching
 * `CollectionEventEntity.material` and `BatchEntity.material` — see
 * `MaterialEntity`'s doc comment for why a material code is never referenced
 * by foreign key. `address` is a descriptive free-text field only — no
 * lat/lng, consistent with `RemoveLocation.ts` removing coordinates from the
 * schema entirely.
 */
@Entity("collection_requests")
export class CollectionRequestEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  requesterId: string;

  @ManyToOne(() => RequesterEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "requesterId" })
  requester: RequesterEntity;

  @Index()
  @Column("uuid")
  hubId: string;

  @ManyToOne(() => HubEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "hubId" })
  hub: HubEntity;

  @Column({ type: "varchar" })
  material: MaterialType;

  @Column("numeric", {
    precision: 10,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  estimatedWeightKg: number | null;

  @Column({ type: "varchar", nullable: true })
  address: string | null;

  @Column({ type: "varchar", nullable: true })
  notes: string | null;

  /**
   * Where the waste actually is, for the collector's map.
   *
   * Nullable and additive to `address`, never a replacement for it: browser
   * geolocation is a permission the requester can refuse, and refusing it must
   * not block booking a pickup. A collector with only a street address is how
   * every request worked before these columns existed.
   */
  @Column("numeric", { precision: 9, scale: 6, nullable: true, transformer: numericTransformer })
  latitude: number | null;

  @Column("numeric", { precision: 9, scale: 6, nullable: true, transformer: numericTransformer })
  longitude: number | null;

  /**
   * `requested -> assigned (optional) -> collected (redemption code issued)
   * -> redeemed`, plus `cancelled` from `requested`/`assigned`. "Collected"
   * is reached only once the linked event has a `verified`/`flagged`
   * `EventReweighEntity` — never from a bare unverified weigh-in.
   */
  @Column({ type: "varchar", default: "requested" })
  status: "requested" | "assigned" | "collected" | "redeemed" | "cancelled";

  @Column({ type: "uuid", nullable: true })
  assignedCollectorId: string | null;

  @ManyToOne(() => CollectorEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "assignedCollectorId" })
  assignedCollector: CollectorEntity | null;

  /**
   * Set at fulfillment. Unique, not merely indexed — a request is fulfilled
   * by exactly one event, and one event fulfills at most one request.
   */
  @Index({ unique: true })
  @Column({ type: "uuid", nullable: true })
  eventId: string | null;

  @OneToOne(() => CollectionEventEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "eventId" })
  event: CollectionEventEntity | null;

  @Column({ type: "varchar", nullable: true, unique: true })
  redemptionCode: string | null;

  @Column({ type: "timestamptz", nullable: true })
  redeemedAt: Date | null;

  /**
   * Which weight the wallet credit was actually computed from, recorded at
   * redemption.
   *
   * A doorstep pickup is credited off the collector's scale so the requester
   * is paid at the gate rather than hours later; the hub may re-weigh the same
   * material afterwards and disagree. Storing the figure that was used makes
   * that later comparison possible without re-deriving it from a ledger
   * description.
   */
  @Column("numeric", { precision: 10, scale: 3, nullable: true, transformer: numericTransformer })
  creditedWeightKg: number | null;

  /**
   * When the door credit was settled against the hub's re-weigh.
   *
   * Also the idempotency guard: a request that has been reconciled once can
   * never be adjusted again, so a re-run or a second re-weigh cannot double
   * the correction.
   */
  @Column({ type: "timestamptz", nullable: true })
  reconciledAt: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt: Date;
}

/**
 * One wallet per requester, created alongside the requester. Deliberately no
 * balance column: balance is always computed on read from
 * `WalletTransactionEntity` — see that entity's doc comment for why, and
 * `reports.service.ts` / `batches.service.ts`'s Merkle root handling for the
 * same "recompute from source rows" convention elsewhere in this codebase.
 *
 * `RequesterEntity` is declared above this class for the same
 * eager-decorator-metadata reason as `CollectionRequestEntity` above.
 */
@Entity("waste_wallets")
export class WasteWalletEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** Unique — one wallet per requester. */
  @Index({ unique: true })
  @Column("uuid")
  requesterId: string;

  @OneToOne(() => RequesterEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "requesterId" })
  requester: RequesterEntity;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/**
 * One entry in a wallet's ledger. Wallet balance is ALWAYS computed as
 * `SUM(amountCredits)` filtered by `type` over this table for a wallet,
 * never stored on `WasteWalletEntity` — this mirrors the codebase's existing
 * "recompute from source rows" convention (audit totals in
 * `reports.service.ts`, the Merkle root in `batches.service.ts`). Only
 * `type: "credit"` is produced by anything in this pass; `"debit"` is
 * allowed by the column so a future spend/expiry path does not need a schema
 * change.
 *
 * `walletId` is `ON DELETE CASCADE` — a transaction has no meaning without
 * its wallet, and keeping orphans would block a wallet from ever being
 * removed. `collectionRequestId`/`eventId` are `ON DELETE RESTRICT` and
 * nullable — a transaction usually cites the request/event it was credited
 * for, but neither is required, so this table stays usable for other credit
 * sources later without a schema change.
 *
 * `WasteWalletEntity`, `CollectionRequestEntity`, and `CollectionEventEntity`
 * are all declared above this class for the same eager-decorator-metadata
 * reason as above.
 */
@Entity("wallet_transactions")
export class WalletTransactionEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  walletId: string;

  @ManyToOne(() => WasteWalletEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "walletId" })
  wallet: WasteWalletEntity;

  @Column({ type: "varchar" })
  type: "credit" | "debit";

  @Column("numeric", { precision: 12, scale: 3, transformer: numericTransformer })
  amountCredits: number;

  @Index()
  @Column({ type: "uuid", nullable: true })
  collectionRequestId: string | null;

  @ManyToOne(() => CollectionRequestEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "collectionRequestId" })
  collectionRequest: CollectionRequestEntity | null;

  @Index()
  @Column({ type: "uuid", nullable: true })
  eventId: string | null;

  @ManyToOne(() => CollectionEventEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "eventId" })
  event: CollectionEventEntity | null;

  @Column({ type: "varchar", nullable: true })
  description: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/**
 * A requester's cash-out request against their wallet — mirrors
 * `PayoutEntity`'s `pending -> paid` pattern exactly, on purpose (see that
 * entity's doc comment): a debit is only ever written to
 * `WalletTransactionEntity` once money has actually moved (`markPaid`), never
 * at request time, so a manual payout that falls through never leaves a
 * wallet showing a debit for cash the requester didn't receive.
 * `"rejected"` releases the hold with no debit ever written.
 *
 * `amountCredits` is the amount held, not copied from anywhere else — it is
 * the source fact this row exists to record.
 *
 * `RequesterEntity` and `UserEntity` are both already declared above this
 * class, so no forward-reference decorator-metadata issue arises here — same
 * eager-decorator-metadata reason documented on `EventReweighEntity`.
 */
@Entity("withdrawal_requests")
export class WithdrawalRequestEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  requesterId: string;

  @ManyToOne(() => RequesterEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "requesterId" })
  requester: RequesterEntity;

  @Column("numeric", { precision: 12, scale: 3, transformer: numericTransformer })
  amountCredits: number;

  @Column({ type: "varchar", default: "pending" })
  status: "pending" | "paid" | "rejected";

  @Column({ type: "varchar", nullable: true })
  payoutRef: string | null;

  @Column({ type: "uuid", nullable: true })
  paidByUserId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "paidByUserId" })
  paidByUser: UserEntity | null;

  @Column({ type: "timestamptz", nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/**
 * A fixed rate of waste credits per kg for a material, optionally scoped to
 * one hub — structurally identical to `MaterialRateEntity`, just a different
 * currency for a different beneficiary (consumer credits into a requester's
 * wallet, not collector cash payout). Same resolution rule: most specific
 * `hubId` match, most recent `effectiveFrom` at or before now. `hubId: null`
 * is the global default rate for a material.
 *
 * `materialCode` references `materials.code` with `ON DELETE RESTRICT` for
 * the same reason as `MaterialRateEntity.materialCode` — a rate is itself
 * current configuration, not evidence, so tying it to the catalogue row is
 * the correct, safe coupling.
 *
 * `MaterialEntity` and `HubEntity` are both already declared above this
 * class, so no forward-reference decorator-metadata issue arises here — same
 * placement rule as `MaterialRateEntity`, which has the identical dependency
 * shape.
 */
@Entity("credit_rates")
export class CreditRateEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ type: "varchar", length: 16 })
  materialCode: string;

  @ManyToOne(() => MaterialEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "materialCode" })
  material: MaterialEntity;

  /** Null = global default rate; set = an override scoped to one hub. */
  @Index()
  @Column({ type: "uuid", nullable: true })
  hubId: string | null;

  @ManyToOne(() => HubEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "hubId" })
  hub: HubEntity | null;

  @Column("numeric", { precision: 10, scale: 2, transformer: numericTransformer })
  creditsPerKg: number;

  @Column("timestamptz")
  effectiveFrom: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/**
 * The redemption catalogue an admin maintains at runtime — a requester
 * exchanges wallet credits for a listed item (airtime, goods, a discount)
 * instead of, or alongside, cashing out via `WithdrawalRequestEntity`.
 * `active: false` retires an item without touching any past redemption, the
 * same active/retired split `MaterialEntity` uses.
 *
 * `stock: null` means unlimited (e.g. a discount code with no unit cap);
 * a non-null value is decremented by `CatalogService.redeem` and never
 * allowed to go negative.
 *
 * No forward references to any other new entity, so this can be declared
 * anywhere — it sits here, immediately before the first entity that
 * references it.
 */
@Entity("catalog_items")
export class CatalogItemEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column({ type: "varchar", nullable: true })
  description: string | null;

  /** Free text, e.g. "airtime" | "goods" | "discount" — not an enforced enum. */
  @Column({ type: "varchar" })
  category: string;

  @Column("numeric", { precision: 12, scale: 3, transformer: numericTransformer })
  costCredits: number;

  @Column({ type: "int", nullable: true })
  stock: number | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

/**
 * One requester's redemption of a catalog item. Debits the wallet
 * immediately (unlike `WithdrawalRequestEntity`, which debits only at
 * `"paid"`) — no real money is being promised here, only an internal ledger
 * entry against a listed item, so there is no reason to delay it. A
 * physical/airtime fulfillment step still exists (`"pending_fulfillment" ->
 * "fulfilled"`) but does not gate the debit.
 *
 * `costCredits` is copied from the item at redemption time, not joined live
 * — the same "stored, not derived" convention as
 * `EventReweighEntity.claimedWeightKg` — so a later price change on the item
 * never rewrites the cost of a redemption already made.
 *
 * `RequesterEntity`, `CatalogItemEntity`, and `UserEntity` are all already
 * declared above this class, so no forward-reference decorator-metadata
 * issue arises here — same eager-decorator-metadata reason documented on
 * `EventReweighEntity`.
 */
@Entity("catalog_redemptions")
export class CatalogRedemptionEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  requesterId: string;

  @ManyToOne(() => RequesterEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "requesterId" })
  requester: RequesterEntity;

  @Index()
  @Column("uuid")
  itemId: string;

  @ManyToOne(() => CatalogItemEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "itemId" })
  item: CatalogItemEntity;

  @Column("numeric", { precision: 12, scale: 3, transformer: numericTransformer })
  costCredits: number;

  @Column({ type: "varchar", default: "pending_fulfillment" })
  status: "pending_fulfillment" | "fulfilled";

  @Column({ type: "uuid", nullable: true })
  fulfilledByUserId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn({ name: "fulfilledByUserId" })
  fulfilledByUser: UserEntity | null;

  @Column({ type: "timestamptz", nullable: true })
  fulfilledAt: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}

export const ALL_ENTITIES = [
  HubEntity,
  CollectorEntity,
  DeviceEntity,
  BatchEntity,
  CollectionEventEntity,
  CustodyTransferEntity,
  EventReweighEntity,
  UserEntity,
  MaterialEntity,
  PayoutEntity,
  PayoutItemEntity,
  MaterialRateEntity,
  RequesterEntity,
  CollectionRequestEntity,
  WasteWalletEntity,
  WalletTransactionEntity,
  WithdrawalRequestEntity,
  CreditRateEntity,
  CatalogItemEntity,
  CatalogRedemptionEntity,
];
