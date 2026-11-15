import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { SignupsService, type SubmitSignupInput } from "../src/signups/signups.service";
import {
  CollectorEntity,
  SignupRequestEntity,
  UserEntity,
} from "../src/database/entities";
import { createTestDatabase, type TestDatabase } from "./support/database";
import { seedHub, type SeededHub } from "./support/fixtures";

/**
 * Submitting a sign-up. The rule these pin is that a sign-up is only ever a
 * request: it creates no user and no collector, hands back nothing secret, and
 * cannot be used to pile up rows or to squat on somebody else's email or phone
 * for ever.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "correct horse battery";

let db: TestDatabase;
let seeded: SeededHub;
let clock: Date;
let signups: SignupsService;

beforeEach(async () => {
  db ??= await createTestDatabase();
  await db.reset();
  seeded = await seedHub(db.dataSource);
  clock = new Date("2026-11-15T09:00:00.000Z");
  signups = new SignupsService(db.dataSource, { now: () => clock });
});

afterAll(async () => {
  await db?.close();
});

const requests = () => db.dataSource.getRepository(SignupRequestEntity);

function collector(overrides: Partial<SubmitSignupInput> = {}): SubmitSignupInput {
  return {
    role: "collector",
    name: "Amina Bello",
    phone: "+2348012345678",
    hubId: seeded.hub.id,
    ...overrides,
  };
}

function operator(overrides: Partial<SubmitSignupInput> = {}): SubmitSignupInput {
  return {
    role: "operator",
    name: "Tunde Okafor",
    phone: "+2348098765432",
    email: "tunde@example.com",
    password: PASSWORD,
    ...overrides,
  };
}

describe("SignupsService.submit", () => {
  it("stores a collector sign-up as pending with its hub and no credentials", async () => {
    const receipt = await signups.submit(
      collector({ email: "ignored@example.com", password: PASSWORD }),
    );

    expect(receipt).toEqual({
      id: expect.any(String),
      role: "collector",
      name: "Amina Bello",
      status: "pending",
    });

    const row = await requests().findOneByOrFail({ id: receipt.id });
    expect(row.status).toBe("pending");
    expect(row.hubId).toBe(seeded.hub.id);
    expect(row.email).toBeNull();
    expect(row.passwordHash).toBeNull();
  });

  it("stores an operator sign-up with a lower-cased email and an argon2 hash", async () => {
    const receipt = await signups.submit(operator({ email: " Ops@Example.com " }));

    expect(Object.keys(receipt).sort()).toEqual(["id", "name", "role", "status"]);

    const row = await requests().findOneByOrFail({ id: receipt.id });
    expect(row.email).toBe("ops@example.com");
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.hubId).toBeNull();
  });

  it("trims the name and phone it stores", async () => {
    const receipt = await signups.submit(collector({ name: "  Amina Bello ", phone: " +2348012345678 " }));

    const row = await requests().findOneByOrFail({ id: receipt.id });
    expect(row.name).toBe("Amina Bello");
    expect(row.phone).toBe("+2348012345678");
  });

  it("creates no user and no collector on submit", async () => {
    const usersBefore = await db.dataSource.getRepository(UserEntity).count();
    const collectorsBefore = await db.dataSource.getRepository(CollectorEntity).count();

    await signups.submit(collector());
    await signups.submit(operator());

    expect(await db.dataSource.getRepository(UserEntity).count()).toBe(usersBefore);
    expect(await db.dataSource.getRepository(CollectorEntity).count()).toBe(collectorsBefore);
  });

  it("rejects an operator email that already belongs to a user, ignoring case and spaces", async () => {
    await db.dataSource.getRepository(UserEntity).save({
      email: "ops@example.com",
      passwordHash: "x",
      role: "operator",
      active: true,
    } as UserEntity);

    await expect(signups.submit(operator({ email: " Ops@Example.com " }))).rejects.toThrow(
      new ConflictException("An account with this email already exists."),
    );
    expect(await requests().count()).toBe(0);
  });

  it("rejects a second pending sign-up with the same email", async () => {
    await signups.submit(operator());

    await expect(signups.submit(operator({ email: "TUNDE@example.com" }))).rejects.toThrow(
      new ConflictException("A sign-up with this email is already waiting for approval."),
    );
    expect(await requests().count()).toBe(1);
  });

  it("rejects a collector phone that already belongs to a collector", async () => {
    await expect(signups.submit(collector({ phone: seeded.collector.phone }))).rejects.toThrow(
      new ConflictException("A collector with this phone number already exists."),
    );
    expect(await requests().count()).toBe(0);
  });

  it("rejects a second pending collector sign-up with the same phone", async () => {
    await signups.submit(collector());

    await expect(signups.submit(collector({ name: "Somebody Else" }))).rejects.toThrow(
      new ConflictException("A sign-up with this phone number is already waiting for approval."),
    );
    expect(await requests().count()).toBe(1);
  });

  it("allows an operator to use a phone that a collector already has", async () => {
    await signups.submit(collector());

    const receipt = await signups.submit(
      operator({ phone: "+2348012345678" }),
    );
    expect(receipt.status).toBe("pending");

    const second = await signups.submit(
      operator({ phone: seeded.collector.phone, email: "second@example.com" }),
    );
    expect(second.status).toBe("pending");
  });

  it("rejects a hub id that does not exist with a conflict, not a database error", async () => {
    await expect(signups.submit(collector({ hubId: randomUUID() }))).rejects.toThrow(
      new ConflictException("That hub is no longer available. Choose another hub."),
    );
    expect(await requests().count()).toBe(0);
  });

  it("refuses new sign-ups at the pending ceiling", async () => {
    signups = new SignupsService(db.dataSource, { now: () => clock, maxPending: 2 });
    await signups.submit(collector());
    await signups.submit(operator());

    await expect(
      signups.submit(operator({ email: "third@example.com" })),
    ).rejects.toThrow(
      new ServiceUnavailableException("Sign-ups are paused for the moment. Please try again later."),
    );
    expect(await requests().count()).toBe(2);
  });

  it("lets a sign-up through once an old pending one has passed 14 days", async () => {
    const first = await signups.submit(operator());

    clock = new Date(clock.getTime() + 14 * DAY_MS + 1000);
    const second = await signups.submit(operator());

    expect(second.status).toBe("pending");
    const stale = await requests().findOneByOrFail({ id: first.id });
    expect(stale.status).toBe("expired");
    expect(stale.passwordHash).toBeNull();
  });

  it("still blocks a pending sign-up that is one second short of 14 days old", async () => {
    await signups.submit(operator());

    clock = new Date(clock.getTime() + 14 * DAY_MS - 1000);
    await expect(signups.submit(operator())).rejects.toThrow(ConflictException);
  });

  it("lets a rejected applicant sign up again", async () => {
    const first = await signups.submit(collector());
    await requests().update({ id: first.id }, { status: "rejected" });

    const second = await signups.submit(collector());
    expect(second.status).toBe("pending");
  });
});
