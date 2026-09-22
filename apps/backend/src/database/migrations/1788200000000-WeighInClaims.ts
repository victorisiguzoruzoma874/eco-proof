import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Walk-in claims: the server-side half of the QR a collector's phone shows
 * after a plain weigh-in, which whoever scans it first is credited for. See
 * `WeighInClaimEntity` for the model and `WalletService.claimWalkIn` for the
 * rules.
 *
 * A new table rather than columns on `collection_events`: that table is the
 * evidentiary record and nothing updates it after ingest, while a claim moves
 * from unclaimed to claimed to reconciled.
 *
 * Both `eventId` and `claimCodeHash` are unique. The first is "one claim per
 * weigh-in, ever"; the second is the lookup key when a code is scanned.
 *
 * Additive only: a new table with no rows, so nothing existing changes, and a
 * deployment that runs it before any phone sends a claim code is a no-op in
 * behaviour.
 */
export class WeighInClaims1788200000000 implements MigrationInterface {
  name = "WeighInClaims1788200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "weighin_claims" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"eventId" uuid NOT NULL, ` +
        `"claimCodeHash" character varying(64) NOT NULL, ` +
        `"requesterId" uuid, ` +
        `"claimedAt" TIMESTAMP WITH TIME ZONE, ` +
        `"creditedWeightKg" numeric(10,3), ` +
        `"reconciledAt" TIMESTAMP WITH TIME ZONE, ` +
        `"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_weighin_claims" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_weighin_claims_eventId" ON "weighin_claims" ("eventId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_weighin_claims_claimCodeHash" ON "weighin_claims" ("claimCodeHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_weighin_claims_requesterId" ON "weighin_claims" ("requesterId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "weighin_claims" ADD CONSTRAINT "FK_weighin_claims_event" ` +
        `FOREIGN KEY ("eventId") REFERENCES "collection_events"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "weighin_claims" ADD CONSTRAINT "FK_weighin_claims_requester" ` +
        `FOREIGN KEY ("requesterId") REFERENCES "requesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "weighin_claims" DROP CONSTRAINT "FK_weighin_claims_requester"`);
    await queryRunner.query(`ALTER TABLE "weighin_claims" DROP CONSTRAINT "FK_weighin_claims_event"`);
    await queryRunner.query(`DROP INDEX "IDX_weighin_claims_requesterId"`);
    await queryRunner.query(`DROP INDEX "IDX_weighin_claims_claimCodeHash"`);
    await queryRunner.query(`DROP INDEX "IDX_weighin_claims_eventId"`);
    await queryRunner.query(`DROP TABLE "weighin_claims"`);
  }
}
