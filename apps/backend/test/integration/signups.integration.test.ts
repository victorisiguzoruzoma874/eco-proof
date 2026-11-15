import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { SignupsService } from "../../src/signups/signups.service";
import {
  CollectorEntity,
  HubEntity,
  SignupRequestEntity,
  UserEntity,
} from "../../src/database/entities";
import { createTestDataSource, resetTables } from "./database";

/**
 * Sign-up against a real Postgres, with the real migrations applied.
 *
 * What the in-memory suite cannot show: that the `signup_requests` migration
 * runs on the engine production uses, that its partial unique indexes are what
 * stops two simultaneous submissions, and that the row lock in `approve` makes
 * two members of staff pressing Approve together produce one account. pg-mem
 * parses `FOR UPDATE` but does not block on it, so only this suite can tell a
 * lock from a lucky ordering.
 */

const PASSWORD = "correct horse battery";

let dataSource: DataSource;
let signups: SignupsService;
let hubId: string;
let adminId: string;

beforeAll(async () => {
  dataSource = await createTestDataSource();
}, 60_000);

afterAll(async () => {
  await dataSource?.destroy();
});

beforeEach(async () => {
  await resetTables(dataSource);
  signups = new SignupsService(dataSource);

  const hub = await dataSource.getRepository(HubEntity).save({
    code: "SGN-01",
    name: "Sign-up Hub",
    minWeightKg: 0.1,
    maxWeightKg: 500,
  } as HubEntity);
  hubId = hub.id;

  const admin = await dataSource.getRepository(UserEntity).save({
    email: "admin@signup.test",
    passwordHash: "x",
    role: "admin",
    active: true,
  } as UserEntity);
  adminId = admin.id;
});

const requests = () => dataSource.getRepository(SignupRequestEntity);
const admin = () => ({ sub: adminId, role: "admin" as const });

function operator(email = "tunde@example.com") {
  return signups.submit({
    role: "operator",
    name: "Tunde Okafor",
    phone: "+2348098765432",
    email,
    password: PASSWORD,
  });
}

function collector(phone = "+2348012345678") {
  return signups.submit({ role: "collector", name: "Amina Bello", phone, hubId });
}

describe("sign-ups on Postgres", () => {
  it("stores, lists, approves and rejects through the migrated schema", async () => {
    const op = await operator();
    const col = await collector();
    const other = await collector("+2348000000009");

    expect((await signups.listPending(admin())).map((s) => s.id).sort()).toEqual(
      [op.id, col.id, other.id].sort(),
    );

    const approvedOp = await signups.approve(op.id, admin());
    const approvedCol = await signups.approve(col.id, admin());
    await signups.reject(other.id, admin());

    const user = await dataSource.getRepository(UserEntity).findOneByOrFail({ email: "tunde@example.com" });
    expect(user.role).toBe("operator");
    expect(approvedOp.createdUserId).toBe(user.id);

    const created = await dataSource
      .getRepository(CollectorEntity)
      .findOneByOrFail({ phone: "+2348012345678" });
    expect(approvedCol.createdCollectorId).toBe(created.id);

    expect(await signups.listPending(admin())).toEqual([]);
    const rows = await requests().find();
    expect(rows.every((r) => r.passwordHash === null)).toBe(true);
  });

  it("lets only one of two simultaneous sign-ups with the same email through", async () => {
    const results = await Promise.allSettled([operator(), operator()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictException);
    expect(await requests().countBy({ email: "tunde@example.com" })).toBe(1);
  });

  it("lets only one of two simultaneous collector sign-ups with the same phone through", async () => {
    const results = await Promise.allSettled([collector(), collector()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictException);
    expect(await requests().countBy({ phone: "+2348012345678" })).toBe(1);
  });

  it("creates exactly one user when two approvals arrive together", async () => {
    const op = await operator();

    const results = await Promise.allSettled([
      signups.approve(op.id, admin()),
      signups.approve(op.id, admin()),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictException);
    expect(await dataSource.getRepository(UserEntity).countBy({ email: "tunde@example.com" })).toBe(1);
  });

  it("creates exactly one collector when an approval and a rejection arrive together", async () => {
    const col = await collector();

    const results = await Promise.allSettled([
      signups.approve(col.id, admin()),
      signups.reject(col.id, admin()),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const row = await requests().findOneByOrFail({ id: col.id });
    const collectors = await dataSource
      .getRepository(CollectorEntity)
      .countBy({ phone: "+2348012345678" });
    expect(collectors).toBe(row.status === "approved" ? 1 : 0);
  });

  it("frees an email once its request is rejected", async () => {
    const first = await operator();
    await signups.reject(first.id, admin());

    await expect(operator()).resolves.toMatchObject({ status: "pending" });
  });
});
