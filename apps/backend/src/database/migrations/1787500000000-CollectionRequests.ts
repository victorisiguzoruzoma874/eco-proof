import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A requester's pickup request. Fulfilled by linking it to an
 * already-hub-reweighed `collection_events` row rather than by changing the
 * signed capture payload schema — same signature, same integrity checks,
 * same hub scale, just credited to a requester's wallet instead of (or
 * alongside) a collector's cash payout.
 *
 * `eventId` is `ON DELETE RESTRICT` and unique, not merely indexed — a
 * request is fulfilled by exactly one event, and one event fulfills at most
 * one request, matching the `event_reweighs.eventId` precedent for a
 * unique-and-RESTRICT FK onto `collection_events`.
 *
 * `requesterId` is `ON DELETE RESTRICT` against `requesters`, and `hubId` /
 * `assignedCollectorId` are `ON DELETE RESTRICT` against `hubs` / `collectors`
 * for the same reason every other FK onto those tables is RESTRICT in this
 * schema: a request references real operational history and must not be
 * able to dangle or silently disappear.
 *
 * `material` has no FK — a plain varchar, matching `collection_events.material`
 * and `batches.material` (see the `materials` migration's doc comment for why
 * a material code is never referenced by foreign key).
 *
 * `redemptionCode` is unique so two requests can never collide on the same
 * QR-printed code.
 *
 * Additive only: no existing table is touched.
 */
export class CollectionRequests1787500000000 implements MigrationInterface {
  name = "CollectionRequests1787500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "collection_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "requesterId" uuid NOT NULL, "hubId" uuid NOT NULL, "material" character varying NOT NULL, "estimatedWeightKg" numeric(10,3), "address" character varying, "notes" character varying, "status" character varying NOT NULL DEFAULT 'requested', "assignedCollectorId" uuid, "eventId" uuid, "redemptionCode" character varying, "redeemedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_collection_requests_redemption_code" UNIQUE ("redemptionCode"), CONSTRAINT "PK_collection_requests_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_collection_requests_requester" ON "collection_requests" ("requesterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_collection_requests_hub" ON "collection_requests" ("hubId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_collection_requests_event" ON "collection_requests" ("eventId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_requests" ADD CONSTRAINT "FK_collection_requests_requester" FOREIGN KEY ("requesterId") REFERENCES "requesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_requests" ADD CONSTRAINT "FK_collection_requests_hub" FOREIGN KEY ("hubId") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_requests" ADD CONSTRAINT "FK_collection_requests_assigned_collector" FOREIGN KEY ("assignedCollectorId") REFERENCES "collectors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_requests" ADD CONSTRAINT "FK_collection_requests_event" FOREIGN KEY ("eventId") REFERENCES "collection_events"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "collection_requests" DROP CONSTRAINT "FK_collection_requests_event"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_requests" DROP CONSTRAINT "FK_collection_requests_assigned_collector"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_requests" DROP CONSTRAINT "FK_collection_requests_hub"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_requests" DROP CONSTRAINT "FK_collection_requests_requester"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_collection_requests_event"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_collection_requests_hub"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_collection_requests_requester"`);
    await queryRunner.query(`DROP TABLE "collection_requests"`);
  }
}
