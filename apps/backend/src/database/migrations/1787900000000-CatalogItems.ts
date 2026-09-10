import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The redemption catalogue an admin maintains at runtime — see
 * `CatalogItemEntity`'s doc comment. `stock` is nullable: null means
 * unlimited, a set value is the unit cap `CatalogService.redeem` decrements
 * and never lets go negative. `active` is the same retire-without-deleting
 * split `materials.active` uses.
 *
 * Additive only: no existing table is touched.
 */
export class CatalogItems1787900000000 implements MigrationInterface {
  name = "CatalogItems1787900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "catalog_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "description" character varying, "category" character varying NOT NULL, "costCredits" numeric(12,3) NOT NULL, "stock" integer, "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_catalog_items_id" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "catalog_items"`);
  }
}
