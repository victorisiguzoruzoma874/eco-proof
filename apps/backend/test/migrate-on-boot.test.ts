import { describe, expect, it, vi } from "vitest";
import { migrateOnBoot, shouldMigrateOnBoot } from "../src/database/migrate-on-boot";

/**
 * The deploy is the migration step: a release whose code expects columns the
 * database lacks must either migrate first or never serve. These pin the three
 * outcomes — applied, nothing to do, and failed — plus the opt-out.
 */

function fakeDataSource(result: { name: string }[] | Error) {
  return {
    runMigrations: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result as never;
    }),
  };
}

describe("migrateOnBoot", () => {
  it("applies pending migrations in a single transaction and reports them", async () => {
    const ds = fakeDataSource([{ name: "DoorstepCollection1788100000000" }]);
    const log = vi.fn();

    const applied = await migrateOnBoot(ds, log, {});

    expect(ds.runMigrations).toHaveBeenCalledWith({ transaction: "all" });
    expect(applied).toEqual(["DoorstepCollection1788100000000"]);
    expect(log).toHaveBeenCalledWith("applied migrations: DoorstepCollection1788100000000");
  });

  it("says so when the schema is already current", async () => {
    const log = vi.fn();

    expect(await migrateOnBoot(fakeDataSource([]), log, {})).toEqual([]);
    expect(log).toHaveBeenCalledWith("schema up to date");
  });

  it("lets a failed migration fail the boot, so the old release keeps serving", async () => {
    const ds = fakeDataSource(new Error('column "latitude" already exists'));

    await expect(migrateOnBoot(ds, vi.fn(), {})).rejects.toThrow(/latitude/);
  });

  it("skips entirely when opted out", async () => {
    const ds = fakeDataSource([{ name: "X1" }]);

    expect(await migrateOnBoot(ds, vi.fn(), { MIGRATE_ON_BOOT: "false" })).toEqual([]);
    expect(ds.runMigrations).not.toHaveBeenCalled();
  });
});

describe("shouldMigrateOnBoot", () => {
  it("is on by default", () => {
    expect(shouldMigrateOnBoot({})).toBe(true);
    expect(shouldMigrateOnBoot({ MIGRATE_ON_BOOT: "" })).toBe(true);
  });

  it("accepts the usual spellings", () => {
    expect(shouldMigrateOnBoot({ MIGRATE_ON_BOOT: "FALSE" })).toBe(false);
    expect(shouldMigrateOnBoot({ MIGRATE_ON_BOOT: "0" })).toBe(false);
    expect(shouldMigrateOnBoot({ MIGRATE_ON_BOOT: "true" })).toBe(true);
  });

  it("refuses a typo rather than silently skipping migrations", () => {
    expect(() => shouldMigrateOnBoot({ MIGRATE_ON_BOOT: "flase" })).toThrow(/MIGRATE_ON_BOOT/);
  });
});
