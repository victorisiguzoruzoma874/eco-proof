import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { SignupsService } from "../src/signups/signups.service";
import { AuthService, type Role } from "../src/auth/auth.module";
import {
  CollectorEntity,
  SignupRequestEntity,
  UserEntity,
} from "../src/database/entities";
import { createTestDatabase, type TestDatabase } from "./support/database";
import { seedHub, type SeededHub } from "./support/fixtures";

/**
 * Deciding a sign-up. Approval is the only door from "somebody filled in a
 * form" to "somebody who can sign in or be paid", so these pin who may open
 * it, that it opens exactly once, and that it never opens onto a half-made
 * record.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "correct horse battery";
const OPERATOR_EMAIL = "tunde@example.com";
const COLLECTOR_PHONE = "+2348012345678";

let db: TestDatabase;
let seeded: SeededHub;
let clock: Date;
let signups: SignupsService;

beforeEach(async () => {
  db ??= await createTestDatabase();
  await db.reset();
  seeded = await seedHub(db.dataSource, { hub: { name: "Yaba Hub" } });
  clock = new Date("2026-11-15T09:00:00.000Z");
  signups = new SignupsService(db.dataSource, { now: () => clock });
});

afterAll(async () => {
  await db?.close();
});

const requests = () => db.dataSource.getRepository(SignupRequestEntity);
const users = () => db.dataSource.getRepository(UserEntity);
const collectors = () => db.dataSource.getRepository(CollectorEntity);

let staffSeq = 0;
async function staff(role: Role): Promise<{ sub: string; role: Role }> {
  staffSeq += 1;
  const user = await users().save({
    email: `${role}${staffSeq}@staff.example.com`,
    passwordHash: "x",
    role,
    active: true,
  } as UserEntity);
  return { sub: user.id, role };
}

function submitOperator() {
  return signups.submit({
    role: "operator",
    name: "Tunde Okafor",
    phone: "+2348098765432",
    email: OPERATOR_EMAIL,
    password: PASSWORD,
  });
}

function submitCollector() {
  return signups.submit({
    role: "collector",
    name: "Amina Bello",
    phone: COLLECTOR_PHONE,
    hubId: seeded.hub.id,
  });
}

function login(email: string, password: string) {
  return new AuthService(users(), new JwtService({ secret: "t" })).login(email, password);
}

describe("SignupsService decisions", () => {
  it("lists pending sign-ups oldest first, with the hub name and no password hash", async () => {
    const first = await submitOperator();
    clock = new Date(clock.getTime() + 60_000);
    const second = await submitCollector();

    const list = await signups.listPending(await staff("admin"));

    expect(list.map((s) => s.id)).toEqual([first.id, second.id]);
    expect(list[0]).toEqual({
      id: first.id,
      role: "operator",
      name: "Tunde Okafor",
      phone: "+2348098765432",
      email: OPERATOR_EMAIL,
      hubId: null,
      hubName: null,
      status: "pending",
      createdAt: expect.any(String),
    });
    expect(list[1]).toMatchObject({ role: "collector", hubId: seeded.hub.id, hubName: "Yaba Hub", email: null });

    const serialised = JSON.stringify(list);
    expect(serialised).not.toContain("passwordHash");
    expect(serialised).not.toContain("$argon2");
  });

  it("leaves decided sign-ups off the pending list", async () => {
    const admin = await staff("admin");
    const op = await submitOperator();
    const col = await submitCollector();
    await signups.approve(op.id, admin);
    await signups.reject(col.id, admin);

    expect(await signups.listPending(admin)).toEqual([]);
  });

  it("shows an operator only collector sign-ups", async () => {
    await submitOperator();
    const col = await submitCollector();

    const list = await signups.listPending(await staff("operator"));
    expect(list.map((s) => s.id)).toEqual([col.id]);
  });

  it("forbids an auditor from listing, approving and rejecting", async () => {
    const auditor = await staff("auditor");
    const col = await submitCollector();

    await expect(signups.listPending(auditor)).rejects.toThrow(ForbiddenException);
    await expect(signups.approve(col.id, auditor)).rejects.toThrow(ForbiddenException);
    await expect(signups.reject(col.id, auditor)).rejects.toThrow(ForbiddenException);
    expect((await requests().findOneByOrFail({ id: col.id })).status).toBe("pending");
  });

  it("approving an operator creates one active operator user who can sign in", async () => {
    const admin = await staff("admin");
    const op = await submitOperator();

    await expect(login(OPERATOR_EMAIL, PASSWORD)).rejects.toThrow(UnauthorizedException);

    const decision = await signups.approve(op.id, admin);

    const user = await users().findOneByOrFail({ email: OPERATOR_EMAIL });
    expect(user.role).toBe("operator");
    expect(user.active).toBe(true);
    expect(decision.createdUserId).toBe(user.id);
    expect(decision.createdCollectorId).toBeNull();
    expect(decision.signup.status).toBe("approved");

    const row = await requests().findOneByOrFail({ id: op.id });
    expect(row.status).toBe("approved");
    expect(row.passwordHash).toBeNull();
    expect(row.createdUserId).toBe(user.id);
    expect(row.decidedByUserId).toBe(admin.sub);
    expect(row.decidedAt?.toISOString()).toBe(clock.toISOString());

    await expect(login(OPERATOR_EMAIL, PASSWORD)).resolves.toMatchObject({ role: "operator" });
  });

  it("approving a collector creates one collector with kycLevel none", async () => {
    const col = await submitCollector();

    const decision = await signups.approve(col.id, await staff("admin"));

    const created = await collectors().findOneByOrFail({ phone: COLLECTOR_PHONE });
    expect(created.name).toBe("Amina Bello");
    expect(created.kycLevel).toBe("none");
    expect(created.active).toBe(true);
    expect(decision.createdCollectorId).toBe(created.id);
    expect(decision.createdUserId).toBeNull();

    const row = await requests().findOneByOrFail({ id: col.id });
    expect(row.createdCollectorId).toBe(created.id);
    expect(row.hubId).toBe(seeded.hub.id);
  });

  it("forbids an operator from deciding an operator sign-up", async () => {
    const operator = await staff("operator");
    const op = await submitOperator();

    await expect(signups.approve(op.id, operator)).rejects.toThrow(
      new ForbiddenException("Only an admin can decide operator sign-ups."),
    );
    await expect(signups.reject(op.id, operator)).rejects.toThrow(ForbiddenException);

    expect((await requests().findOneByOrFail({ id: op.id })).status).toBe("pending");
    expect(await users().countBy({ email: OPERATOR_EMAIL })).toBe(0);
  });

  it("lets an operator approve a collector sign-up", async () => {
    const col = await submitCollector();

    const decision = await signups.approve(col.id, await staff("operator"));
    expect(decision.signup.status).toBe("approved");
    expect(await collectors().countBy({ phone: COLLECTOR_PHONE })).toBe(1);
  });

  it("refuses to approve or reject a sign-up that is no longer pending", async () => {
    const admin = await staff("admin");
    const op = await submitOperator();
    const col = await submitCollector();
    await signups.approve(op.id, admin);
    await signups.reject(col.id, admin);

    await expect(signups.approve(op.id, admin)).rejects.toThrow(
      new ConflictException("This sign-up has already been approved."),
    );
    await expect(signups.reject(op.id, admin)).rejects.toThrow(ConflictException);
    await expect(signups.approve(col.id, admin)).rejects.toThrow(
      new ConflictException("This sign-up has already been rejected."),
    );
    expect(await users().countBy({ email: OPERATOR_EMAIL })).toBe(1);
    expect(await collectors().countBy({ phone: COLLECTOR_PHONE })).toBe(0);
  });

  it("refuses to approve an expired sign-up", async () => {
    const admin = await staff("admin");
    const op = await submitOperator();

    clock = new Date(clock.getTime() + 14 * DAY_MS + 1000);

    await expect(signups.approve(op.id, admin)).rejects.toThrow(
      new ConflictException("This sign-up has already been expired."),
    );
    expect(await users().countBy({ email: OPERATOR_EMAIL })).toBe(0);
    expect(await signups.listPending(admin)).toEqual([]);
  });

  it("creates exactly one user when two approvals race", async () => {
    const admin = await staff("admin");
    const op = await submitOperator();

    const results = await Promise.allSettled([
      signups.approve(op.id, admin),
      signups.approve(op.id, admin),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(await users().countBy({ email: OPERATOR_EMAIL })).toBe(1);
  });

  it("keeps the request pending, hash intact, when the email was taken before approval", async () => {
    const admin = await staff("admin");
    const op = await submitOperator();
    await users().save({
      email: OPERATOR_EMAIL,
      passwordHash: "x",
      role: "auditor",
      active: true,
    } as UserEntity);

    await expect(signups.approve(op.id, admin)).rejects.toThrow(
      new ConflictException(
        "An account with this email now exists. Reject this sign-up or ask the applicant to use another email.",
      ),
    );

    const row = await requests().findOneByOrFail({ id: op.id });
    expect(row.status).toBe("pending");
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await users().countBy({ email: OPERATOR_EMAIL })).toBe(1);
  });

  it("keeps the request pending when the collector phone was taken before approval", async () => {
    const col = await submitCollector();
    await collectors().save({
      name: "Earlier Person",
      phone: COLLECTOR_PHONE,
      cooperativeId: null,
      kycLevel: "basic",
      active: true,
    } as CollectorEntity);

    await expect(signups.approve(col.id, await staff("admin"))).rejects.toThrow(
      new ConflictException("A collector with this phone number now exists. Reject this sign-up."),
    );

    expect((await requests().findOneByOrFail({ id: col.id })).status).toBe("pending");
    expect(await collectors().countBy({ phone: COLLECTOR_PHONE })).toBe(1);
  });

  it("rejecting clears the hash and frees the email for a new sign-up", async () => {
    const admin = await staff("admin");
    const op = await submitOperator();

    const decision = await signups.reject(op.id, admin);
    expect(decision.signup.status).toBe("rejected");
    expect(decision.createdUserId).toBeNull();

    const row = await requests().findOneByOrFail({ id: op.id });
    expect(row.passwordHash).toBeNull();
    expect(row.decidedByUserId).toBe(admin.sub);
    expect(await users().countBy({ email: OPERATOR_EMAIL })).toBe(0);

    await expect(submitOperator()).resolves.toMatchObject({ status: "pending" });
  });

  it("reports a sign-up id that does not exist as not found", async () => {
    await expect(
      signups.approve("e8ec812e-8ad6-43ec-a7ef-17dc87c7e710", await staff("admin")),
    ).rejects.toThrow("sign-up e8ec812e-8ad6-43ec-a7ef-17dc87c7e710 not found");
  });
});
