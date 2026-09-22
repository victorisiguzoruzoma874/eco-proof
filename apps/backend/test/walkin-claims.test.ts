import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WeighInPayload } from "@proofchain/shared";
import type { EventsService } from "../src/events/events.service";
import { WalletService } from "../src/wallet/wallet.service";
import { hashClaimCode } from "../src/wallet/claim-code";
import {
  CollectionEventEntity,
  CollectionRequestEntity,
  CreditRateEntity,
  EventReweighEntity,
  RequesterEntity,
  UserEntity,
  WalletTransactionEntity,
  WasteWalletEntity,
  WeighInClaimEntity,
} from "../src/database/entities";
import { createTestDatabase, type TestDatabase } from "./support/database";
import { seedHub, type SeededHub } from "./support/fixtures";
import { buildEventsService } from "./support/services";

/**
 * Walk-in weigh-ins: the collector's phone shows a QR after a plain weigh-in,
 * and whoever scans it first is credited for it.
 *
 * The rules these pin are the money-safety ones: the code is stored only as a
 * hash, one weigh-in pays out once (not twice to two scanners, not once by
 * scan and again through a pickup), evidence that failed verification pays
 * nothing, and the hub's later re-weigh corrects a scale-reading credit.
 */

const CODE = "K7M2QRT9XA";
const OTHER_CODE = "B4N8PW3ZHC";

let db: TestDatabase;
let events: EventsService;
let wallet: WalletService;
let seeded: SeededHub;

beforeEach(async () => {
  db ??= await createTestDatabase();
  await db.reset();
  events = buildEventsService(db.dataSource);
  wallet = new WalletService(db.dataSource);
  seeded = await seedHub(db.dataSource);

  // 10 credits per kg of PET, global default.
  await db.dataSource.getRepository(CreditRateEntity).save({
    materialCode: "PET",
    hubId: null,
    creditsPerKg: 10,
    effectiveFrom: new Date(Date.now() - 60_000),
  } as CreditRateEntity);
});

afterAll(async () => {
  await db?.close();
});

let requesterSeq = 0;
async function requester(): Promise<string> {
  requesterSeq += 1;
  const r = await db.dataSource.getRepository(RequesterEntity).save({
    name: `Walk-in ${requesterSeq}`,
    email: `walkin${requesterSeq}-${Date.now()}@example.com`,
    passwordHash: "x",
    phone: null,
    active: true,
  } as RequesterEntity);
  await db.dataSource.getRepository(WasteWalletEntity).save({ requesterId: r.id } as WasteWalletEntity);
  return r.id;
}

async function weighIn(claimCode?: string, overrides: Partial<WeighInPayload> = {}) {
  const payload = seeded.payload({ weightKg: 12.5, material: "PET", ...overrides });
  const signature = seeded.sign(payload);
  const result = await events.ingest(payload, signature, claimCode);
  return { ...result, payload, signature };
}

async function reweigh(eventId: string, verifiedWeightKg: number) {
  const user = await db.dataSource.getRepository(UserEntity).save({
    email: `op-${Date.now()}-${Math.random()}@example.com`,
    passwordHash: "x",
    role: "operator",
    active: true,
  } as UserEntity);
  await db.dataSource.getRepository(EventReweighEntity).save({
    eventId,
    claimedWeightKg: 12.5,
    verifiedWeightKg,
    varianceKg: verifiedWeightKg - 12.5,
    variancePct: 0,
    status: "verified",
    notes: null,
    verifiedByUserId: user.id,
    verifiedAt: new Date(),
  } as EventReweighEntity);
}

describe("ingest with a claim code", () => {
  it("stores the code's hash, never the code", async () => {
    const { eventId } = await weighIn(CODE);

    const claim = await db.dataSource.getRepository(WeighInClaimEntity).findOneByOrFail({ eventId });
    expect(claim.claimCodeHash).toBe(hashClaimCode(CODE));
    expect(claim.claimCodeHash).not.toContain(CODE);
    expect(claim.claimedAt).toBeNull();
  });

  it("keeps the first code when the same weigh-in is resent", async () => {
    const first = await weighIn(CODE);
    const again = await events.ingest(first.payload, first.signature, OTHER_CODE);

    expect(again.duplicate).toBe(true);
    const claims = await db.dataSource.getRepository(WeighInClaimEntity).findBy({ eventId: first.eventId });
    expect(claims).toHaveLength(1);
    expect(claims[0]?.claimCodeHash).toBe(hashClaimCode(CODE));
  });

  it("records a ticket on a retry whose first attempt saved only the event", async () => {
    const first = await weighIn(); // the lost first attempt, no ticket stored
    await events.ingest(first.payload, first.signature, CODE);

    const claim = await db.dataSource.getRepository(WeighInClaimEntity).findOneBy({ eventId: first.eventId });
    expect(claim?.claimCodeHash).toBe(hashClaimCode(CODE));
  });

  it("stores nothing for a weigh-in sent without a code", async () => {
    await weighIn();
    expect(await db.dataSource.getRepository(WeighInClaimEntity).count()).toBe(0);
  });
});

describe("claiming a walk-in", () => {
  it("credits the scanner the weigh-in's weight at the material rate", async () => {
    const { eventId } = await weighIn(CODE);
    const who = await requester();

    const result = await wallet.redeem(who, CODE);

    expect(result.transaction).toMatchObject({ type: "credit", amountCredits: 125, eventId, collectionRequestId: null });
    expect(result.transaction.description).toContain("drop-off");
    expect(result.balanceCredits).toBe(125);

    const claim = await db.dataSource.getRepository(WeighInClaimEntity).findOneByOrFail({ eventId });
    expect(claim.requesterId).toBe(who);
    expect(claim.claimedAt).toBeInstanceOf(Date);
    expect(claim.creditedWeightKg).toBe(12.5);
    expect(claim.reconciledAt).toBeNull();
  });

  it("accepts the code as typed from the screen: lowercase, with the dash", async () => {
    await weighIn(CODE);
    const result = await wallet.redeem(await requester(), " k7m2q-rt9xa ");
    expect(result.balanceCredits).toBe(125);
  });

  it("pays out once: a second scanner is refused and nothing is credited", async () => {
    await weighIn(CODE);
    const first = await requester();
    const second = await requester();
    await wallet.redeem(first, CODE);

    await expect(wallet.redeem(second, CODE)).rejects.toThrow(/already been claimed/);
    await expect(wallet.redeem(first, CODE)).rejects.toThrow(/already claimed this weigh-in/);

    const credits = await db.dataSource.getRepository(WalletTransactionEntity).count();
    expect(credits).toBe(1);
  });

  it("credits the hub-verified weight when the reweigh came first", async () => {
    const { eventId } = await weighIn(CODE);
    await reweigh(eventId, 11);

    const result = await wallet.redeem(await requester(), CODE);

    expect(result.transaction.amountCredits).toBe(110);
    expect(result.transaction.description).toContain("verified at the hub");
    const claim = await db.dataSource.getRepository(WeighInClaimEntity).findOneByOrFail({ eventId });
    expect(claim.reconciledAt).toBeInstanceOf(Date);
  });

  it("refuses a weigh-in that failed verification", async () => {
    const { eventId } = await weighIn(CODE);
    await db.dataSource.getRepository(CollectionEventEntity).update({ id: eventId }, { quarantined: true });

    await expect(wallet.redeem(await requester(), CODE)).rejects.toThrow(/did not pass verification/);
  });

  it("refuses a weigh-in that a booked pickup pays for", async () => {
    const { eventId } = await weighIn(CODE);
    const owner = await requester();
    await db.dataSource.getRepository(CollectionRequestEntity).save({
      requesterId: owner,
      hubId: seeded.hub.id,
      material: "PET",
      estimatedWeightKg: 12,
      address: "1 Test Road",
      notes: null,
      status: "collected",
      eventId,
      redemptionCode: "ABCDEFGH",
    } as unknown as CollectionRequestEntity);

    await expect(wallet.redeem(await requester(), CODE)).rejects.toThrow(/booked pickup/);
  });

  it("tells a scanner a fresh code may still be on its way, not that it is wrong", async () => {
    await expect(wallet.redeem(await requester(), CODE)).rejects.toThrow(/may still be sending it/);
  });

  it("gives an unknown code of any other shape the plain answer", async () => {
    await expect(wallet.redeem(await requester(), "NOPE")).rejects.toThrow(/no pickup or weigh-in matches/);
  });
});

describe("reconciling a claimed walk-in against the hub", () => {
  it("credits the difference when the hub finds more", async () => {
    const { eventId } = await weighIn(CODE);
    const who = await requester();
    await wallet.redeem(who, CODE);

    await wallet.reconcile(eventId, 13.5);

    const rows = await db.dataSource.getRepository(WalletTransactionEntity).find({ order: { createdAt: "ASC" } });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ type: "credit", amountCredits: 10 });
    expect(rows[1]?.description).toContain("drop-off");
  });

  it("debits the difference when the hub finds less, and only once", async () => {
    const { eventId } = await weighIn(CODE);
    await wallet.redeem(await requester(), CODE);

    await wallet.reconcile(eventId, 12);
    await wallet.reconcile(eventId, 12);

    const rows = await db.dataSource.getRepository(WalletTransactionEntity).find({ order: { createdAt: "ASC" } });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ type: "debit", amountCredits: 5 });
  });

  it("does nothing for a ticket nobody has claimed yet", async () => {
    const { eventId } = await weighIn(CODE);
    await wallet.reconcile(eventId, 13.5);
    expect(await db.dataSource.getRepository(WalletTransactionEntity).count()).toBe(0);
  });
});
