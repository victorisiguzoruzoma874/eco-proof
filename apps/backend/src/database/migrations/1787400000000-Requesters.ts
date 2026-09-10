import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A self-registering consumer requesting pickups — a different trust
 * boundary from `users` (admin-provisioned operator/auditor accounts).
 * Own JWT/guard land in a later phase; this migration is the data model
 * only.
 *
 * Additive only: no existing table is touched.
 */
export class Requesters1787400000000 implements MigrationInterface {
  name = "Requesters1787400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "requesters" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "email" character varying NOT NULL, "passwordHash" text NOT NULL, "phone" character varying, "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_requesters_email" UNIQUE ("email"), CONSTRAINT "PK_requesters_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "requesters"`);
  }
}
