import "reflect-metadata";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RegistryController } from "../src/collectors/registry.controller";
import { RegistryService } from "../src/collectors/registry.service";
import { SignupsService } from "../src/signups/signups.service";
import { ROLES_KEY } from "../src/auth/auth.module";
import {
  CollectorEntity,
  DeviceEntity,
  PayoutEntity,
  SignupRequestEntity,
  UserEntity,
} from "../src/database/entities";
import { createTestDatabase, type TestDatabase } from "./support/database";
import { insertEvent, seedHub, type SeededHub } from "./support/fixtures";
import { buildRegistryService } from "./support/services";

/**
 * Deleting a collector. It is permanent, so what matters is that it only ever
 * removes a collector nothing else depends on, and that when it does, it
 * leaves nothing behind that could still act as them: no device, no login.
 */

let db: TestDatabase;
let seeded: SeededHub;
let registry: RegistryService;

beforeEach(async () => {
  db ??= await createTestDatabase();
  await db.reset();
  seeded = await seedHub(db.dataSource);
  registry = buildRegistryService(db.dataSource);
});

afterAll(async () => {
  await db?.close();
});

const collectors = () => db.dataSource.getRepository(CollectorEntity);
const devices = () => db.dataSource.getRepository(DeviceEntity);
const users = () => db.dataSource.getRepository(UserEntity);
const requests = () => db.dataSource.getRepository(SignupRequestEntity);

async function approvedSignup(): Promise<{ collectorId: string; signupId: string }> {
  const admin = await users().save({
    email: "admin@staff.example.com",
    passwordHash: "x",
    role: "admin",
    active: true,
  } as UserEntity);
  const signups = new SignupsService(db.dataSource);
  const receipt = await signups.submit({
    role: "collector",
    name: "Amina Bello",
    phone: "+2348012345678",
    email: "amina@example.com",
    password: "correct horse battery",
    hubId: seeded.hub.id,
  });
  const decision = await signups.approve(receipt.id, { sub: admin.id, role: "admin" });
  return { collectorId: decision.createdCollectorId!, signupId: receipt.id };
}

describe("DELETE /collectors/:id", () => {
  it("is admin only", () => {
    expect(Reflect.getMetadata(ROLES_KEY, RegistryController.prototype.deleteCollector)).toEqual([
      "admin",
    ]);
  });

  it("deletes a collector with no history, along with their devices", async () => {
    await expect(registry.deleteCollector(seeded.collector.id)).resolves.toEqual({
      id: seeded.collector.id,
      name: seeded.collector.name,
    });
    expect(await collectors().countBy({ id: seeded.collector.id })).toBe(0);
    expect(await devices().countBy({ collectorId: seeded.collector.id })).toBe(0);
  });

  it("deletes an approved sign-up's collector and their login, and keeps the sign-up record", async () => {
    const { collectorId, signupId } = await approvedSignup();

    await registry.deleteCollector(collectorId);

    expect(await collectors().countBy({ id: collectorId })).toBe(0);
    expect(await users().countBy({ email: "amina@example.com" })).toBe(0);
    const signup = await requests().findOneByOrFail({ id: signupId });
    expect(signup.status).toBe("approved");
    expect(signup.createdCollectorId).toBeNull();
    expect(signup.createdUserId).toBeNull();
  });

  it("frees the phone and email to sign up again", async () => {
    const { collectorId } = await approvedSignup();
    await registry.deleteCollector(collectorId);

    await expect(
      new SignupsService(db.dataSource).submit({
        role: "collector",
        name: "Amina Bello",
        phone: "+2348012345678",
        email: "amina@example.com",
        password: "correct horse battery",
        hubId: seeded.hub.id,
      }),
    ).resolves.toMatchObject({ status: "pending" });
  });

  it("refuses a collector with weigh-ins, and changes nothing", async () => {
    await insertEvent(db.dataSource, seeded);
    await insertEvent(db.dataSource, seeded);

    await expect(registry.deleteCollector(seeded.collector.id)).rejects.toThrow(
      new ConflictException(
        `${seeded.collector.name} has 2 weigh-ins and cannot be deleted: ` +
          "those records must keep pointing at the collector who made them.",
      ),
    );
    expect(await collectors().countBy({ id: seeded.collector.id })).toBe(1);
    expect(await devices().countBy({ collectorId: seeded.collector.id })).toBe(1);
  });

  it("refuses a collector with a payout", async () => {
    await db.dataSource.getRepository(PayoutEntity).save({
      collectorId: seeded.collector.id,
      amount: 500,
      method: "cash",
    } as PayoutEntity);

    await expect(registry.deleteCollector(seeded.collector.id)).rejects.toThrow(
      /has 1 payout and cannot be deleted/,
    );
    expect(await collectors().countBy({ id: seeded.collector.id })).toBe(1);
  });

  it("404s for a collector that does not exist", async () => {
    await expect(registry.deleteCollector(randomUUID())).rejects.toThrow(NotFoundException);
  });
});
