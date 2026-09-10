import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Records a hub re-weigh against a collector's claimed weight — one row per
 * event, since a second re-weigh of the same event is a data-entry mistake
 * rather than a correction (hence the unique index on `eventId`, not merely
 * an indexed one).
 *
 * Additive only: no existing table is touched, so this is safe to apply to a
 * database already holding sealed batches and captured events. An event with
 * no re-weigh yet simply has no row here, which is the expected state for
 * anything not yet brought to a hub for verification.
 *
 * `eventId` is `ON DELETE RESTRICT` against `collection_events`, matching
 * every other FK onto that table (`custody_transfers` is the only CASCADE
 * exception, and that is onto `batches`, not events): a signed event is
 * evidence, and evidence is never allowed to vanish out from under a re-weigh
 * that references it.
 */
export class EventReweighs1787100000000 implements MigrationInterface {
  name = "EventReweighs1787100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "event_reweighs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "eventId" uuid NOT NULL, "claimedWeightKg" numeric(10,3) NOT NULL, "verifiedWeightKg" numeric(10,3) NOT NULL, "varianceKg" numeric(10,3) NOT NULL, "variancePct" numeric(6,3) NOT NULL, "status" character varying NOT NULL, "notes" character varying, "verifiedByUserId" uuid NOT NULL, "verifiedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_event_reweighs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_event_reweighs_event" ON "event_reweighs" ("eventId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_event_reweighs_verified_by" ON "event_reweighs" ("verifiedByUserId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "event_reweighs" ADD CONSTRAINT "FK_event_reweighs_event" FOREIGN KEY ("eventId") REFERENCES "collection_events"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_reweighs" ADD CONSTRAINT "FK_event_reweighs_verified_by" FOREIGN KEY ("verifiedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "event_reweighs" DROP CONSTRAINT "FK_event_reweighs_verified_by"`,
    );
    await queryRunner.query(`ALTER TABLE "event_reweighs" DROP CONSTRAINT "FK_event_reweighs_event"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_event_reweighs_verified_by"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_event_reweighs_event"`);
    await queryRunner.query(`DROP TABLE "event_reweighs"`);
  }
}
