import { newDb, type IMemoryDb } from "pg-mem";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { SEED_MATERIALS } from "@proofchain/shared";
import { ALL_ENTITIES, MaterialEntity } from "./entities";

/**
 * A real Postgres wire protocol, backed by memory instead of a server —
 * `pg-mem` gives the actual test suite (`test/support/database.ts`) a database
 * without a Docker daemon. This file exists to offer that same escape hatch to
 * a developer who wants to click through the dashboard/capture apps and has
 * no Postgres reachable at all: `--in-memory` on the backend's CLI (see
 * `main.ts`) routes here instead of a real `DATABASE_URL`.
 *
 * Explicitly NOT for anything beyond that: the data lives only in this
 * process's memory and is gone the moment it exits. No migration ever runs
 * against it — schema comes from `synchronize()`, same as the test suite —
 * so this must never be reachable from a production/`NODE_ENV=production`
 * boot path. `main.ts` and `app.module.ts` are both responsible for gating
 * that; this file only knows how to build the database, not when it's safe to.
 */

function registerPostgresShims(db: IMemoryDb): void {
  // TypeORM probes the server on connect; pg-mem ships neither function.
  db.public.registerFunction({
    name: "current_database",
    returns: "text" as never,
    implementation: () => "proofchain_dev_inmemory",
  });
  db.public.registerFunction({
    name: "version",
    returns: "text" as never,
    implementation: () => "PostgreSQL 16.0 (pg-mem)",
  });

  // The entities default their primary keys to uuid_generate_v4(), which lives
  // in the uuid-ossp extension the real migration enables.
  db.registerExtension("uuid-ossp", (schema) => {
    schema.registerFunction({
      name: "uuid_generate_v4",
      returns: "uuid" as never,
      implementation: () => randomUUID(),
      impure: true,
    });
  });
}

export async function createInMemoryDataSource(): Promise<DataSource> {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  registerPostgresShims(db);

  const dataSource: DataSource = await db.adapters.createTypeormDataSource({
    type: "postgres",
    entities: ALL_ENTITIES,
  });

  await dataSource.initialize();
  await dataSource.synchronize();

  // Ingest 400s on a material code the catalogue doesn't know, and a real
  // database gets this table from the Materials migration — synchronize()
  // only builds the empty table, so this stands in for that migration's data.
  await dataSource.getRepository(MaterialEntity).insert(
    SEED_MATERIALS.map((m) => ({
      code: m.code,
      name: m.name,
      description: m.description,
      examples: m.examples,
      active: m.active,
      sortOrder: m.sortOrder,
    })),
  );

  return dataSource;
}
