import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A fixed rate per kg for a material, optionally scoped to one hub.
 *
 * The payout service resolves the applicable rate rather than taking a manual
 * amount per item: most specific `hubId` match, most recent `effectiveFrom`
 * at or before now. A row with `hubId` null is the global default rate for
 * that material; a row with `hubId` set overrides it at that one hub.
 *
 * `materialCode` references `materials.code` with `ON DELETE RESTRICT` —
 * unlike `collection_events.material`/`batches.material`, which are plain
 * varchars on purpose (a signed weigh-in's material must never dangle on a
 * catalogue edit), a rate is itself current configuration, not evidence, so
 * tying it to the catalogue row is the correct — and safe — coupling here.
 *
 * Additive only: no existing table is touched, and an empty table simply
 * means the payout service has nothing to resolve against yet, which Phase 4
 * addresses by seeding a default rate per active material.
 */
export class MaterialRates1787300000000 implements MigrationInterface {
  name = "MaterialRates1787300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "material_rates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "materialCode" character varying(16) NOT NULL, "hubId" uuid, "ratePerKg" numeric(10,2) NOT NULL, "effectiveFrom" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_material_rates_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_material_rates_material" ON "material_rates" ("materialCode") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_material_rates_hub" ON "material_rates" ("hubId") `);
    await queryRunner.query(
      `ALTER TABLE "material_rates" ADD CONSTRAINT "FK_material_rates_material" FOREIGN KEY ("materialCode") REFERENCES "materials"("code") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "material_rates" ADD CONSTRAINT "FK_material_rates_hub" FOREIGN KEY ("hubId") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "material_rates" DROP CONSTRAINT "FK_material_rates_hub"`);
    await queryRunner.query(
      `ALTER TABLE "material_rates" DROP CONSTRAINT "FK_material_rates_material"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_material_rates_hub"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_material_rates_material"`);
    await queryRunner.query(`DROP TABLE "material_rates"`);
  }
}
