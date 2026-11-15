import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { SignupRequests1788400000000 } from "../src/database/migrations/1788400000000-SignupRequests";
import { ALL_ENTITIES, SignupRequestEntity } from "../src/database/entities";

/**
 * The sign-up queue is a new table, so the migration has to stand on its own:
 * a deployed database gets `signup_requests` from this SQL, never from the
 * entity. The suite builds the rest of the schema from every other entity and
 * lets the migration create this table on its own.
 */

let dataSource: DataSource;

beforeEach(async () => {
  await dataSource?.destroy();

  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: "current_database",
    returns: "text" as never,
    implementation: () => "proofchain_test",
  });
  db.public.registerFunction({
    name: "version",
    returns: "text" as never,
    implementation: () => "PostgreSQL 16.0 (pg-mem)",
  });
  db.registerExtension("uuid-ossp", (schema) => {
    schema.registerFunction({
      name: "uuid_generate_v4",
      returns: "uuid" as never,
      implementation: () => randomUUID(),
      impure: true,
    });
  });

  dataSource = await db.adapters.createTypeormDataSource({
    type: "postgres",
    entities: ALL_ENTITIES.filter((entity) => entity !== SignupRequestEntity),
  });
  await dataSource.initialize();
  await dataSource.synchronize();
});

afterAll(async () => {
  await dataSource?.destroy();
});

async function tableExists(): Promise<boolean> {
  const rows: unknown[] = await dataSource.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name = 'signup_requests'`,
  );
  return rows.length > 0;
}

describe("SignupRequests migration", () => {
  it("creates signup_requests and can be reverted", async () => {
    const migration = new SignupRequests1788400000000();
    const runner = dataSource.createQueryRunner();

    await migration.up(runner);
    expect(await tableExists()).toBe(true);

    await dataSource.query(
      `INSERT INTO "signup_requests" ("role", "name", "phone") VALUES ('collector', 'Amina Bello', '+2348012345678')`,
    );
    const rows: Array<{ status: string; email: string | null; passwordHash: string | null }> =
      await dataSource.query(`SELECT "status", "email", "passwordHash" FROM "signup_requests"`);
    expect(rows).toEqual([{ status: "pending", email: null, passwordHash: null }]);

    // The same two rules the entity declares, enforced by the migration's own
    // indexes: one pending request per collector phone, and a decided request
    // does not block a new one.
    await expect(
      dataSource.query(
        `INSERT INTO "signup_requests" ("role", "name", "phone") VALUES ('collector', 'Second', '+2348012345678')`,
      ),
    ).rejects.toThrow();
    await dataSource.query(`UPDATE "signup_requests" SET "status" = 'rejected'`);
    await dataSource.query(
      `INSERT INTO "signup_requests" ("role", "name", "phone") VALUES ('collector', 'Second', '+2348012345678')`,
    );
    await dataSource.query(`DELETE FROM "signup_requests"`);

    await migration.down(runner);
    expect(await tableExists()).toBe(false);

    await runner.release();
  });
});
