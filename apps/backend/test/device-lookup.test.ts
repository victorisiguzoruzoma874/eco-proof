import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RegistryService } from "../src/collectors/registry.service";
import { createTestDatabase, type TestDatabase } from "./support/database";
import { seedHub } from "./support/fixtures";
import { buildRegistryService } from "./support/services";

/**
 * A phone that lost its local pairing still holds its signing key, and that key
 * is unique on the server forever — so enrolling it again can only ever 409.
 * Looking the key up is how the phone finds out it is already paired and signs
 * straight back in instead of dead-ending on the enrolment form.
 */

let db: TestDatabase;
let service: RegistryService;

beforeEach(async () => {
  db ??= await createTestDatabase();
  await db.reset();
  service = buildRegistryService(db.dataSource);
});

afterAll(async () => {
  await db?.close();
});

describe("RegistryService.listDevices by public key", () => {
  it("finds the device enrolled under a key", async () => {
    const seeded = await seedHub(db.dataSource);

    const found = await service.listDevices(undefined, seeded.device.publicKeyBase64);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: seeded.device.id,
      collectorId: seeded.collector.id,
      revokedAt: null,
    });
  });

  it("returns nothing for a key that was never enrolled", async () => {
    await seedHub(db.dataSource);

    const found = await service.listDevices(undefined, "bm90LWFuLWVucm9sbGVkLWtleS1hdC1hbGwtMzJiISE=");

    expect(found).toEqual([]);
  });

  it("still reports a revoked device, so the phone can tell it must rotate its key", async () => {
    const seeded = await seedHub(db.dataSource, { device: { revokedAt: new Date() } });

    const [found] = await service.listDevices(undefined, seeded.device.publicKeyBase64);

    expect(found?.revokedAt).toBeInstanceOf(Date);
  });

  it("does not narrow by key when none is given", async () => {
    await seedHub(db.dataSource);
    await seedHub(db.dataSource);

    expect(await service.listDevices()).toHaveLength(2);
  });
});
