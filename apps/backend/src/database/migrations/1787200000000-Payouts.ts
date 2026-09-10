import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Records payouts to collectors and the verified re-weighs each one covers.
 *
 * Two tables, added together because `payout_items` cannot exist without
 * `payouts`: `payouts` is one payment run to a collector; `payout_items` is
 * the join row attributing part of that amount to one `event_reweighs` row,
 * since a single payout can cover several drop-offs.
 *
 * `payout_items.payoutId` is `ON DELETE CASCADE` — an item has no meaning
 * without its payout, and keeping orphans would block a payout from ever
 * being removed (matches the `custody_transfers` -> `batches` precedent).
 * `payout_items.eventReweighId` is `ON DELETE RESTRICT` — a re-weigh already
 * cited by a payout is evidence of what was paid for and must not vanish out
 * from under that record.
 *
 * No FK is added onto `collectors` beyond `payouts.collectorId`; payout
 * destination stays manual/cash for now, so there is no structured
 * payout-account column to reference.
 */
export class Payouts1787200000000 implements MigrationInterface {
  name = "Payouts1787200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "payouts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "collectorId" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "currency" character varying NOT NULL DEFAULT 'NGN', "method" character varying NOT NULL, "payoutRef" character varying, "status" character varying NOT NULL DEFAULT 'pending', "paidByUserId" uuid, "paidAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_payouts_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_payouts_collector" ON "payouts" ("collectorId") `);
    await queryRunner.query(
      `ALTER TABLE "payouts" ADD CONSTRAINT "FK_payouts_collector" FOREIGN KEY ("collectorId") REFERENCES "collectors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payouts" ADD CONSTRAINT "FK_payouts_paid_by" FOREIGN KEY ("paidByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TABLE "payout_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "payoutId" uuid NOT NULL, "eventReweighId" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, CONSTRAINT "PK_payout_items_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payout_items_payout" ON "payout_items" ("payoutId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payout_items_event_reweigh" ON "payout_items" ("eventReweighId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "payout_items" ADD CONSTRAINT "FK_payout_items_payout" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payout_items" ADD CONSTRAINT "FK_payout_items_event_reweigh" FOREIGN KEY ("eventReweighId") REFERENCES "event_reweighs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payout_items" DROP CONSTRAINT "FK_payout_items_event_reweigh"`,
    );
    await queryRunner.query(`ALTER TABLE "payout_items" DROP CONSTRAINT "FK_payout_items_payout"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payout_items_event_reweigh"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payout_items_payout"`);
    await queryRunner.query(`DROP TABLE "payout_items"`);

    await queryRunner.query(`ALTER TABLE "payouts" DROP CONSTRAINT "FK_payouts_paid_by"`);
    await queryRunner.query(`ALTER TABLE "payouts" DROP CONSTRAINT "FK_payouts_collector"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payouts_collector"`);
    await queryRunner.query(`DROP TABLE "payouts"`);
  }
}
