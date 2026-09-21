import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Doorstep collection: coordinates so a collector can navigate to a pickup,
 * and the two columns that let a credit issued at the door be reconciled
 * against the hub's later re-weigh.
 *
 * `latitude` / `longitude` sit alongside the existing free-text `address`
 * rather than replacing it. The address is what the requester typed and what a
 * human reads at the gate; the coordinates are what a map app consumes. Both
 * are nullable because geolocation is a permission the requester can refuse,
 * and refusing it must not block booking a pickup — a collector with only a
 * street address is how every request works today.
 *
 * `numeric(9,6)` for both: six decimal places is ~11 cm at the equator, far
 * finer than a phone's GPS fix, and `numeric` rather than `double precision`
 * for the same reason every weight in this schema is numeric — no binary
 * floating point in a column a human will read back.
 *
 * `creditedWeightKg` records which weight a wallet credit was actually
 * computed from at redemption time. When a request is redeemed at the door it
 * is the collector's scale reading; the hub may later re-weigh the same
 * material and disagree. `reconciledAt` stamps the moment that difference was
 * settled by an adjusting ledger entry, and doubles as the idempotency guard
 * that stops a second re-weigh from adjusting twice.
 *
 * Additive only: every column is nullable, so existing rows are untouched and
 * the B2B path is unaffected.
 */
export class DoorstepCollection1788100000000 implements MigrationInterface {
  name = "DoorstepCollection1788100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "collection_requests" ADD "latitude" numeric(9,6)`);
    await queryRunner.query(`ALTER TABLE "collection_requests" ADD "longitude" numeric(9,6)`);
    await queryRunner.query(`ALTER TABLE "collection_requests" ADD "creditedWeightKg" numeric(10,3)`);
    await queryRunner.query(
      `ALTER TABLE "collection_requests" ADD "reconciledAt" TIMESTAMP WITH TIME ZONE`,
    );
    // The collector's job list is "my assigned, still-open requests" — the one
    // query the capture app makes, on every poll, from every phone in the field.
    await queryRunner.query(
      `CREATE INDEX "IDX_collection_requests_assigned_status" ON "collection_requests" ("assignedCollectorId", "status") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_collection_requests_assigned_status"`);
    await queryRunner.query(`ALTER TABLE "collection_requests" DROP COLUMN "reconciledAt"`);
    await queryRunner.query(`ALTER TABLE "collection_requests" DROP COLUMN "creditedWeightKg"`);
    await queryRunner.query(`ALTER TABLE "collection_requests" DROP COLUMN "longitude"`);
    await queryRunner.query(`ALTER TABLE "collection_requests" DROP COLUMN "latitude"`);
  }
}
