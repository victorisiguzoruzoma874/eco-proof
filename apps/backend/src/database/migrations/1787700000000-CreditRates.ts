import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A fixed rate of waste credits per kg for a material, optionally scoped to
 * one hub — structurally identical to `material_rates`, just a different
 * currency for a different beneficiary (consumer credits into a requester's
 * wallet, not collector cash payout). The wallet redemption path resolves
 * the applicable rate the same way payouts resolve `material_rates`: most
 * specific `hubId` match, most recent `effectiveFrom` at or before now. A
 * row with `hubId` null is the global default rate for that material; a row
 * with `hubId` set overrides it at that one hub.
 *
 * `materialCode` references `materials.code` with `ON DELETE RESTRICT` —
 * unlike `collection_events.material`/`collection_requests.material`, which
 * are plain varchars on purpose, a rate is itself current configuration, not
 * evidence, so tying it to the catalogue row is the correct, safe coupling
 * here (matches `material_rates.materialCode`).
 *
 * Additive only: no existing table is touched, and an empty table simply
 * means the redemption service has nothing to resolve against yet.
 */
export class CreditRates1787700000000 implements MigrationInterface {
  name = "CreditRates1787700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "credit_rates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "materialCode" character varying(16) NOT NULL, "hubId" uuid, "creditsPerKg" numeric(10,2) NOT NULL, "effectiveFrom" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_credit_rates_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_credit_rates_material" ON "credit_rates" ("materialCode") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_credit_rates_hub" ON "credit_rates" ("hubId") `);
    await queryRunner.query(
      `ALTER TABLE "credit_rates" ADD CONSTRAINT "FK_credit_rates_material" FOREIGN KEY ("materialCode") REFERENCES "materials"("code") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "credit_rates" ADD CONSTRAINT "FK_credit_rates_hub" FOREIGN KEY ("hubId") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "credit_rates" DROP CONSTRAINT "FK_credit_rates_hub"`);
    await queryRunner.query(`ALTER TABLE "credit_rates" DROP CONSTRAINT "FK_credit_rates_material"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_credit_rates_hub"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_credit_rates_material"`);
    await queryRunner.query(`DROP TABLE "credit_rates"`);
  }
}
