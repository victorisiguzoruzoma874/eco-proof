import type { DataSource } from "typeorm";

/**
 * Apply pending migrations before the app accepts traffic.
 *
 * The runbook used to say "run `migration:run:prod` from a shell after each
 * deploy that changes the schema". Render's free plan has no shell and no
 * pre-deploy step, so that step never happened: the doorstep release went live
 * against a database without its columns, and every query touching
 * `collection_requests` 500'd until someone noticed.
 *
 * Running them here makes the deploy itself the migration step:
 *  - the new code never serves a request against the old schema;
 *  - a failing migration throws, the process exits, the health check never
 *    passes, and Render keeps the previous deploy serving — a failed release
 *    rather than a half-working one;
 *  - all pending migrations run in one transaction, so a failure part-way
 *    leaves the schema exactly as it was.
 *
 * Concurrency: TypeORM takes no lock around `runMigrations`. That is safe while
 * the service runs a single instance (Render replaces the old instance only
 * after the new one is healthy, and the old one has nothing left to apply).
 * Scaling to several instances that boot simultaneously would need an advisory
 * lock here, or `MIGRATE_ON_BOOT=false` plus a pre-deploy command.
 */

/** `MIGRATE_ON_BOOT=false` opts out, for a host that migrates as a separate step. */
export function shouldMigrateOnBoot(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.MIGRATE_ON_BOOT?.trim().toLowerCase();
  if (value === undefined || value === "") return true;
  if (["false", "0", "off", "no"].includes(value)) return false;
  if (["true", "1", "on", "yes"].includes(value)) return true;
  // A typo must not silently disable the one step that keeps code and schema
  // in step; fail the boot so it gets fixed.
  throw new Error(`MIGRATE_ON_BOOT is "${env.MIGRATE_ON_BOOT}"; use true or false`);
}

/** Returns the names of the migrations it applied, in order. */
export async function migrateOnBoot(
  dataSource: Pick<DataSource, "runMigrations">,
  log: (message: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  if (!shouldMigrateOnBoot(env)) {
    log("MIGRATE_ON_BOOT=false — skipping migrations; the schema must be migrated separately");
    return [];
  }

  const applied = await dataSource.runMigrations({ transaction: "all" });
  const names = applied.map((m) => m.name);
  log(names.length > 0 ? `applied migrations: ${names.join(", ")}` : "schema up to date");
  return names;
}
